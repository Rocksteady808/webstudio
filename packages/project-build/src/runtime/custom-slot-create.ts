import { z } from "zod";
import { transpileExpression } from "@webstudio-is/expression";
import {
  ROOT_INSTANCE_ID,
  SYSTEM_VARIABLE_ID,
  customSlotComponent,
  customSlotComponentVariable,
  customSlotOverridesVariable,
  customSlotSchemaVariable,
  customSlotValuesVariable,
  decodeDataVariableId,
  defaultComponentName,
  encodeDataVariableId,
  findTreeInstanceIds,
  findTreeInstanceIdsExcludingSlotDescendants,
  parseCustomSlotFieldValues,
  parseCustomSlotOverrides,
  type CustomSlotField,
  type CustomSlotFieldType,
  type CustomSlotFieldValues,
  type DataSource,
  type Instance,
  type WebstudioData,
} from "@webstudio-is/sdk";
import type { BuilderState } from "../state/builder-state";
import type { BuilderRuntimeContext } from "./context";
import { produceWebstudioDataMutation, traverseExpressions } from "./data";
import { BuilderRuntimeError, throwBuilderRuntimeError } from "./errors";
import { createRuntimeMutation } from "./mutation";
import {
  isCustomSlotInternalVariable,
  toCustomSlotFieldName,
} from "./custom-slot-fields";

/**
 * Turns selected elements into a component, like Figma's Create component:
 * the selection becomes the shared source and a linked copy takes its place.
 */

export const createComponentNamespaces = [
  "instances",
  "props",
  "dataSources",
  "resources",
] as const;

type CreateComponentData = Pick<
  WebstudioData,
  (typeof createComponentNamespaces)[number]
>;

export const createComponentFromInstanceInput = z.object({
  instanceSelector: z
    .array(z.string().min(1))
    .min(2)
    .describe(
      "Leaf-to-root path of the element to turn into a component. The first id is the element, the second its direct parent."
    ),
  name: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Component name; made unique automatically"),
});

/** Names of every component in the project, from their shared Fragments. */
export const listComponentNames = (
  data: Pick<WebstudioData, "instances" | "dataSources">
) => {
  const names = new Set<string>();
  for (const dataSource of data.dataSources.values()) {
    if (dataSource.name !== customSlotSchemaVariable) {
      continue;
    }
    const fragment = data.instances.get(dataSource.scopeInstanceId ?? "");
    if (fragment?.component === "Fragment") {
      names.add(fragment.label || defaultComponentName);
    }
  }
  return names;
};

const getUniqueName = (name: string, taken: Set<string>) => {
  if (taken.has(name) === false) {
    return name;
  }
  let index = 2;
  while (taken.has(`${name} ${index}`)) {
    index += 1;
  }
  return `${name} ${index}`;
};

const getUniqueFieldName = (name: string, taken: Set<string>) => {
  const base = toCustomSlotFieldName(name) || "value";
  let candidate = base;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = `${base}${index}`;
    index += 1;
  }
  taken.add(candidate);
  return candidate;
};

const getFieldType = (dataSource: DataSource): CustomSlotFieldType => {
  if (dataSource.type !== "variable") {
    return "json";
  }
  switch (dataSource.value.type) {
    case "string":
      return "text";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "json";
  }
};

const getRequiredData = (
  state: Partial<Pick<BuilderState, (typeof createComponentNamespaces)[number]>>
) => {
  for (const namespace of createComponentNamespaces) {
    if (state[namespace] === undefined) {
      return throwBuilderRuntimeError(
        "BAD_REQUEST",
        `${namespace} namespace is missing`
      );
    }
  }
  return state as CreateComponentData;
};

/**
 * Visits the expressions nested copies inside the selection use for their
 * values, which run in the selection's scope like any other setting.
 */
const updateCopyValueExpressionsMutable = (
  data: CreateComponentData,
  instanceIds: Set<Instance["id"]>,
  update: (expression: string) => string
) => {
  const updateValues = (values: CustomSlotFieldValues) => {
    for (const [id, value] of Object.entries(values)) {
      if (value.type === "expression") {
        values[id] = { type: "expression", value: update(value.value) };
      }
    }
  };
  for (const dataSource of data.dataSources.values()) {
    if (
      dataSource.type !== "variable" ||
      dataSource.value.type !== "json" ||
      instanceIds.has(dataSource.scopeInstanceId ?? "") === false ||
      data.instances.get(dataSource.scopeInstanceId ?? "")?.component !==
        customSlotComponent
    ) {
      continue;
    }
    if (dataSource.name === customSlotValuesVariable) {
      const values = parseCustomSlotFieldValues(dataSource.value.value);
      updateValues(values);
      dataSource.value = { type: "json", value: values };
    }
    if (dataSource.name === customSlotOverridesVariable) {
      const overrides = parseCustomSlotOverrides(dataSource.value.value);
      Object.values(overrides).forEach(updateValues);
      dataSource.value = { type: "json", value: overrides };
    }
  }
};

const visitSelectionExpressionsMutable = (
  data: CreateComponentData,
  selectedId: Instance["id"],
  update: (expression: string) => string
) => {
  traverseExpressions({
    startingInstanceId: selectedId,
    pages: undefined,
    instances: data.instances,
    props: data.props,
    dataSources: data.dataSources,
    resources: data.resources,
    update: (expression) => update(expression),
  });
  updateCopyValueExpressionsMutable(
    data,
    findTreeInstanceIdsExcludingSlotDescendants(data.instances, selectedId),
    update
  );
};

export const createComponentFromInstance = (
  state: Partial<
    Pick<BuilderState, (typeof createComponentNamespaces)[number]>
  >,
  input: z.infer<typeof createComponentFromInstanceInput>,
  context: BuilderRuntimeContext
) => {
  const before = getRequiredData(state);
  const slotId = context.createId();
  const fragmentId = context.createId();
  const componentId = context.createId();
  let name = "";
  const { payload } = produceWebstudioDataMutation(before, (draft) => {
    const [instanceId, parentId] = input.instanceSelector;
    const selected = draft.instances.get(instanceId);
    const parent = draft.instances.get(parentId);
    if (selected === undefined || parent === undefined) {
      return throwBuilderRuntimeError(
        "NOT_FOUND",
        "Instance or parent not found"
      );
    }
    if (selected.id === ROOT_INSTANCE_ID || selected.component === "Fragment") {
      return throwBuilderRuntimeError(
        "BAD_REQUEST",
        "This element cannot become a component"
      );
    }
    const childIndex = parent.children.findIndex(
      (child) => child.type === "id" && child.value === selected.id
    );
    if (childIndex === -1) {
      return throwBuilderRuntimeError(
        "BAD_REQUEST",
        "instanceSelector[1] must be the direct parent of instanceSelector[0]"
      );
    }

    name = getUniqueName(
      input.name ?? (selected.label || defaultComponentName),
      listComponentNames(draft)
    );

    // Inside a component only global variables and its properties are
    // available. Variables the selection reads from the page become
    // properties, and the copy keeps reading them from the page.
    const treeIds = findTreeInstanceIds(draft.instances, selected.id);
    const takenNames = new Set<string>();
    for (const dataSource of draft.dataSources.values()) {
      if (
        treeIds.has(dataSource.scopeInstanceId ?? "") &&
        isCustomSlotInternalVariable(dataSource) === false
      ) {
        takenNames.add(dataSource.name);
      }
    }
    const fields: CustomSlotField[] = [];
    const values: CustomSlotFieldValues = {};
    const replacementByIdentifier = new Map<string, string>();
    const getReplacement = (identifier: string, assignee: boolean) => {
      const existing = replacementByIdentifier.get(identifier);
      if (existing !== undefined) {
        if (assignee) {
          throwOuterAssignment(identifier);
        }
        return existing;
      }
      const dataSourceId = decodeDataVariableId(identifier);
      if (dataSourceId === undefined || dataSourceId === SYSTEM_VARIABLE_ID) {
        return;
      }
      const dataSource = draft.dataSources.get(dataSourceId);
      const scopeInstanceId = dataSource?.scopeInstanceId ?? ROOT_INSTANCE_ID;
      if (
        dataSource === undefined ||
        scopeInstanceId === ROOT_INSTANCE_ID ||
        treeIds.has(scopeInstanceId)
      ) {
        return;
      }
      if (assignee) {
        throwOuterAssignment(identifier);
      }
      const field: CustomSlotField = {
        id: context.createId(),
        name: getUniqueFieldName(dataSource.name, takenNames),
        type: getFieldType(dataSource),
      };
      fields.push(field);
      values[field.id] = { type: "expression", value: identifier };
      const replacement = `${encodeDataVariableId(componentId)}.${field.name}`;
      replacementByIdentifier.set(identifier, replacement);
      return replacement;
    };
    const throwOuterAssignment = (identifier: string) => {
      const dataSource = draft.dataSources.get(
        decodeDataVariableId(identifier) ?? ""
      );
      return throwBuilderRuntimeError(
        "BAD_REQUEST",
        `An action inside the selection changes "${dataSource?.name ?? identifier}", which belongs to the page. Move that variable into the selection or make it global first.`
      );
    };
    visitSelectionExpressionsMutable(draft, selected.id, (expression) => {
      try {
        return transpileExpression({
          expression,
          replaceVariable: getReplacement,
        });
      } catch (error) {
        // keep unparsable expressions as they are, like the rest of the
        // Builder does, but never swallow our own errors
        if (error instanceof BuilderRuntimeError) {
          throw error;
        }
        return expression;
      }
    });

    draft.instances.set(fragmentId, {
      type: "instance",
      id: fragmentId,
      component: "Fragment",
      label: name,
      children: [{ type: "id", value: selected.id }],
    });
    draft.instances.set(slotId, {
      type: "instance",
      id: slotId,
      component: customSlotComponent,
      children: [{ type: "id", value: fragmentId }],
    });
    parent.children[childIndex] = { type: "id", value: slotId };
    draft.dataSources.set(componentId, {
      type: "parameter",
      id: componentId,
      scopeInstanceId: fragmentId,
      name: customSlotComponentVariable,
    });
    const schemaId = context.createId();
    draft.dataSources.set(schemaId, {
      type: "variable",
      id: schemaId,
      scopeInstanceId: fragmentId,
      name: customSlotSchemaVariable,
      value: { type: "json", value: fields },
    });
    const valuesId = context.createId();
    draft.dataSources.set(valuesId, {
      type: "variable",
      id: valuesId,
      scopeInstanceId: slotId,
      name: customSlotValuesVariable,
      value: { type: "json", value: values },
    });
  });
  return createRuntimeMutation({
    payload,
    result: {
      instanceSelector: [slotId, ...input.instanceSelector.slice(1)],
      fragmentId,
      name,
    },
    invalidatesNamespaces: createComponentNamespaces,
  });
};
