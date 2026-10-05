import { z } from "zod";
import { getExpressionIdentifiers } from "@webstudio-is/expression";
import { showAttribute, textContentAttribute } from "@webstudio-is/react-sdk";
import {
  ROOT_INSTANCE_ID,
  SYSTEM_VARIABLE_ID,
  builderComponentValuesVariable,
  decodeDataVariableId,
  findBuilderComponentDataSource,
  parseBuilderComponentFieldValues,
  type BuilderComponentField,
  type BuilderComponentFieldValue,
  type DataSources,
  type Prop,
  type WebstudioData,
} from "@webstudio-is/sdk";
import type { BuilderState } from "../state/builder-state";
import type { BuilderRuntimeContext } from "./context";
import { produceWebstudioDataMutation } from "./data";
import { throwBuilderRuntimeError } from "./errors";
import { getEditableTextTarget } from "./instances";
import { createRuntimeMutation } from "./mutation";
import {
  builderComponentFieldNamespaces,
  getBuilderComponentFieldReference,
  getBuilderComponentSchemaDataSource,
  listBuilderComponentOccurrenceIds,
  readBuilderComponentFields,
  requireUniqueBuilderComponentFieldName,
  writeBuilderComponentFields,
} from "./builder-component-fields";

/**
 * Exposes settings of an element inside a component as component
 * properties: the current value becomes the default, the setting connects to
 * the new property, and data a setting was bound to moves to every copy.
 */

const exposableTypes = [
  "text",
  "richText",
  "number",
  "boolean",
  "link",
  "image",
  "json",
] as const;

export const exposeBuilderComponentPropertiesInput = z.object({
  fragmentId: z.string().min(1),
  instanceId: z.string().min(1).describe("Element inside the component"),
  properties: z
    .array(
      z.object({
        propName: z
          .string()
          .min(1)
          .describe(
            `Setting to expose; "${textContentAttribute}" for the text content`
          ),
        name: z.string().regex(/^[A-Za-z_$][\w$]*$/),
        type: z
          .enum(exposableTypes)
          .optional()
          .describe("Property type when the setting has no value yet"),
      })
    )
    .min(1),
});

const getLiteralField = (
  prop: Prop
): undefined | Pick<BuilderComponentField, "type" | "defaultValue"> => {
  switch (prop.type) {
    case "string":
      return {
        type: prop.name === "href" ? "link" : "text",
        defaultValue: { type: "literal", value: prop.value },
      };
    case "number":
      return {
        type: "number",
        defaultValue: { type: "literal", value: prop.value },
      };
    case "boolean":
      return {
        type: "boolean",
        defaultValue: { type: "literal", value: prop.value },
      };
    case "json":
    case "string[]":
      return {
        type: "json",
        defaultValue: { type: "literal", value: prop.value },
      };
    case "page":
      return {
        type: "link",
        defaultValue: { type: "page", value: prop.value },
      };
    case "asset":
      return {
        type: "image",
        defaultValue: { type: "asset", value: prop.value },
      };
  }
};

/** Copies run in their owner's scope, where only global data is shared. */
const isMovableToCopies = (expression: string, dataSources: DataSources) => {
  for (const identifier of getExpressionIdentifiers(expression)) {
    const id = decodeDataVariableId(identifier);
    if (id === undefined || id === SYSTEM_VARIABLE_ID) {
      continue;
    }
    const scopeInstanceId =
      dataSources.get(id)?.scopeInstanceId ?? ROOT_INSTANCE_ID;
    if (scopeInstanceId !== ROOT_INSTANCE_ID) {
      return false;
    }
  }
  return true;
};

export const exposeBuilderComponentProperties = (
  state: Partial<
    Pick<BuilderState, (typeof builderComponentFieldNamespaces)[number]>
  >,
  input: z.infer<typeof exposeBuilderComponentPropertiesInput>,
  context: BuilderRuntimeContext
) => {
  for (const namespace of builderComponentFieldNamespaces) {
    if (state[namespace] === undefined) {
      return throwBuilderRuntimeError(
        "BAD_REQUEST",
        `${namespace} namespace is missing`
      );
    }
  }
  const before = state as Pick<
    WebstudioData,
    (typeof builderComponentFieldNamespaces)[number]
  >;
  const fieldIds: string[] = [];
  const { payload } = produceWebstudioDataMutation(before, (draft) => {
    const { schema, component } = getBuilderComponentSchemaDataSource(
      draft,
      input.fragmentId
    );
    const instance = draft.instances.get(input.instanceId);
    if (instance === undefined) {
      return throwBuilderRuntimeError("NOT_FOUND", "Element not found");
    }
    const fields = readBuilderComponentFields(schema);
    // data a setting was bound to, filled in on every copy
    const copyValues = new Map<string, BuilderComponentFieldValue>();
    for (const item of input.properties) {
      requireUniqueBuilderComponentFieldName(
        draft,
        input.fragmentId,
        fields,
        item.name
      );
      const field: BuilderComponentField = {
        id: context.createId(),
        name: item.name,
        type: item.type ?? "text",
      };
      const reference = getBuilderComponentFieldReference(
        component.id,
        item.name
      );
      const takeExpression = (expression: string, label: string) => {
        if (isMovableToCopies(expression, draft.dataSources) === false) {
          return throwBuilderRuntimeError(
            "BAD_REQUEST",
            `${label} uses data from inside the component, so it stays as it is.`
          );
        }
        // required: each copy keeps showing the data through its own value
        copyValues.set(field.id, { type: "expression", value: expression });
      };

      if (item.propName === textContentAttribute) {
        const target = getEditableTextTarget(instance);
        if (target === undefined && instance.children.length > 0) {
          return throwBuilderRuntimeError(
            "BAD_REQUEST",
            "Text with formatting or nested elements cannot become a property"
          );
        }
        if (target?.child.type === "text") {
          field.defaultValue = { type: "literal", value: target.child.value };
        }
        if (target?.child.type === "expression") {
          takeExpression(target.child.value, "Text");
        }
        const child = { type: "expression" as const, value: reference };
        if (target === undefined) {
          instance.children = [child];
        } else {
          instance.children[target.childIndex] = child;
        }
      } else {
        const prop = Array.from(draft.props.values()).find(
          (prop) =>
            prop.instanceId === instance.id && prop.name === item.propName
        );
        if (prop?.type === "expression") {
          takeExpression(prop.value, item.propName);
        } else if (prop !== undefined) {
          const literal = getLiteralField(prop);
          if (literal === undefined) {
            return throwBuilderRuntimeError(
              "BAD_REQUEST",
              `${item.propName} cannot become a property`
            );
          }
          Object.assign(field, literal);
          // Markdown content is a rich text property, not plain text
          if (item.type === "richText" && literal.type === "text") {
            field.type = "richText";
          }
        } else if (item.propName === showAttribute) {
          // elements without Show set are visible
          field.type = "boolean";
          field.defaultValue = { type: "literal", value: true };
        }
        // no value and no binding: a required property
        const id = prop?.id ?? context.createId();
        draft.props.set(id, {
          id,
          instanceId: instance.id,
          name: item.propName,
          type: "expression",
          value: reference,
        });
      }
      fields.push(field);
      fieldIds.push(field.id);
    }
    writeBuilderComponentFields(draft, schema, fields);

    for (const slotId of listBuilderComponentOccurrenceIds(
      draft,
      input.fragmentId
    )) {
      if (copyValues.size === 0) {
        break;
      }
      const existing = findBuilderComponentDataSource(
        draft.dataSources,
        slotId,
        builderComponentValuesVariable
      );
      const values = parseBuilderComponentFieldValues(
        existing?.type === "variable" && existing.value.type === "json"
          ? existing.value.value
          : undefined
      );
      for (const [fieldId, value] of copyValues) {
        values[fieldId] ??= value;
      }
      const id = existing?.id ?? context.createId();
      draft.dataSources.set(id, {
        type: "variable",
        id,
        scopeInstanceId: slotId,
        name: builderComponentValuesVariable,
        value: { type: "json", value: values },
      });
    }
  });
  return createRuntimeMutation({
    payload,
    result: { fieldIds },
    invalidatesNamespaces: builderComponentFieldNamespaces,
  });
};
