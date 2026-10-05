import { z } from "zod";
import {
  customSlotComponent,
  customSlotComponentVariable,
  customSlotSchemaVariable,
  customSlotValuesVariable,
  customSlotOverridesVariable,
  parseCustomSlotOverrides,
  getCustomSlotCopy,
  getCustomSlotEnclosingCopies,
  encodeDataVariableId,
  findCustomSlotDataSource,
  findTreeInstanceIds,
  getCustomSlotContentRootId,
  getCustomSlotVariantState,
  parseCustomSlotFieldValues,
  parseCustomSlotFields,
  type CustomSlotField,
  type CustomSlotFieldValue,
  type DataSource,
  type Instance,
  type Prop,
  type WebstudioData,
} from "@webstudio-is/sdk";
import type { BuilderState } from "../state/builder-state";
import type { BuilderRuntimeContext } from "./context";
import { produceWebstudioDataMutation } from "./data";
import { validateHtmlEmbedCode } from "./html-embed";
import { throwBuilderRuntimeError } from "./errors";
import { createRuntimeMutation } from "./mutation";

/**
 * Custom Slot properties work like Figma or Webflow component properties:
 * the property list is shared by every copy, elements inside the shared
 * Fragment connect to `component.<name>`, and each copy stores its own value.
 */

export const customSlotFieldNamespaces = [
  "instances",
  "props",
  "dataSources",
] as const;

/** Changing properties also removes styles of deleted variants. */
export const customSlotSchemaNamespaces = [
  ...customSlotFieldNamespaces,
  "styles",
] as const;

type CustomSlotFieldState = Pick<
  BuilderState,
  (typeof customSlotFieldNamespaces)[number]
>;

type CustomSlotFieldData = Pick<
  WebstudioData,
  (typeof customSlotFieldNamespaces)[number]
>;

type CustomSlotSchemaState = Pick<
  BuilderState,
  (typeof customSlotSchemaNamespaces)[number]
>;

type CustomSlotSchemaData = Pick<
  WebstudioData,
  (typeof customSlotSchemaNamespaces)[number]
>;

const fieldNameInput = z
  .string()
  .regex(
    /^[A-Za-z_$][\w$]*$/,
    "Property name must start with a letter and contain only letters, digits or underscores"
  );

const fieldValueInput = z.union([
  z.object({ type: z.literal("literal"), value: z.unknown() }),
  z.object({ type: z.literal("expression"), value: z.string() }),
  z.object({ type: z.literal("asset"), value: z.string().min(1) }),
  z.object({
    type: z.literal("page"),
    value: z.union([
      z.string(),
      z.object({ pageId: z.string(), instanceId: z.string() }),
    ]),
  }),
]);

const fieldTypeInput = z.enum([
  "text",
  "link",
  "html",
  "boolean",
  "image",
  "variant",
]);

const variantOptionsInput = z
  .array(
    z.object({
      id: z
        .string()
        .regex(/^[A-Za-z0-9_-]+$/, "Variant option id must be a plain id"),
      name: z.string().min(1),
    })
  )
  .describe("Choices of a variant property, e.g. Small and Large");

/** Converts a label like "Button Link" into a bindable name "buttonLink". */
export const toCustomSlotFieldName = (label: string) => {
  const words = label
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const name = words
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join("");
  return /^[0-9]/.test(name) ? `_${name}` : name;
};

const getRequiredState = <
  Namespace extends (typeof customSlotSchemaNamespaces)[number],
>(
  state: Partial<Pick<BuilderState, Namespace>>,
  namespaces: readonly Namespace[]
) => {
  for (const namespace of namespaces) {
    if (state[namespace] === undefined) {
      return throwBuilderRuntimeError(
        "BAD_REQUEST",
        `${namespace} namespace is missing`
      );
    }
  }
  return state as Pick<WebstudioData, Namespace>;
};

const getSchemaDataSource = (
  data: CustomSlotFieldData,
  fragmentId: Instance["id"]
) => {
  const schema = findCustomSlotDataSource(
    data.dataSources,
    fragmentId,
    customSlotSchemaVariable
  );
  const component = findCustomSlotDataSource(
    data.dataSources,
    fragmentId,
    customSlotComponentVariable
  );
  if (
    data.instances.get(fragmentId)?.component !== "Fragment" ||
    schema?.type !== "variable" ||
    component?.type !== "parameter"
  ) {
    return throwBuilderRuntimeError(
      "NOT_FOUND",
      "Custom Slot properties were not found"
    );
  }
  return { schema, component };
};

const readFields = (schema: DataSource) =>
  parseCustomSlotFields(
    schema.type === "variable" && schema.value.type === "json"
      ? schema.value.value
      : undefined
  );

/** HTML Embed values get the same check as an HTML Embed's Code. */
const requireValidFieldValue = (
  field: undefined | CustomSlotField,
  value: undefined | null | CustomSlotFieldValue
) => {
  if (
    field?.type !== "html" ||
    value?.type !== "literal" ||
    typeof value.value !== "string"
  ) {
    return;
  }
  const issue = validateHtmlEmbedCode(value.value);
  if (issue !== undefined) {
    return throwBuilderRuntimeError("BAD_REQUEST", issue.message);
  }
};

const writeFields = (
  data: CustomSlotFieldData,
  schema: DataSource,
  fields: CustomSlotField[]
) => {
  if (schema.type !== "variable") {
    return;
  }
  data.dataSources.set(schema.id, {
    ...schema,
    value: { type: "json", value: fields },
  });
};

const getFieldReference = (componentId: DataSource["id"], name: string) =>
  `${encodeDataVariableId(componentId)}.${name}`;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const listCustomSlotOccurrenceIds = (
  data: CustomSlotFieldData,
  fragmentId: Instance["id"]
) => {
  const ids: Instance["id"][] = [];
  for (const instance of data.instances.values()) {
    if (
      instance.component === customSlotComponent &&
      getCustomSlotContentRootId(data.instances, instance.id) === fragmentId
    ) {
      ids.push(instance.id);
    }
  }
  return ids;
};

/**
 * Removes values copies of this component store for a property, in their own
 * values and in overrides their parent copies set for them.
 */
const removeCopyValuesMutable = (
  data: CustomSlotFieldData,
  fragmentId: Instance["id"],
  fieldId: string,
  shouldRemove: (value: CustomSlotFieldValue) => boolean = () => true
) => {
  const copyIds = new Set(listCustomSlotOccurrenceIds(data, fragmentId));
  for (const dataSource of data.dataSources.values()) {
    if (dataSource.type !== "variable" || dataSource.value.type !== "json") {
      continue;
    }
    if (
      dataSource.name === customSlotValuesVariable &&
      copyIds.has(dataSource.scopeInstanceId ?? "")
    ) {
      const values = parseCustomSlotFieldValues(dataSource.value.value);
      const value = values[fieldId];
      if (value === undefined || shouldRemove(value) === false) {
        continue;
      }
      delete values[fieldId];
      data.dataSources.set(dataSource.id, {
        ...dataSource,
        value: { type: "json", value: values },
      });
    }
    if (dataSource.name === customSlotOverridesVariable) {
      const overrides = parseCustomSlotOverrides(dataSource.value.value);
      let changed = false;
      for (const [key, values] of Object.entries(overrides)) {
        const value = values[fieldId];
        // override keys end with the nested copy they belong to
        if (
          value === undefined ||
          copyIds.has(key.split("/").at(-1) ?? "") === false ||
          shouldRemove(value) === false
        ) {
          continue;
        }
        delete values[fieldId];
        if (Object.keys(values).length === 0) {
          delete overrides[key];
        }
        changed = true;
      }
      if (changed) {
        data.dataSources.set(dataSource.id, {
          ...dataSource,
          value: { type: "json", value: overrides },
        });
      }
    }
  }
};

/** Deletes the styles of variant options that no longer exist. */
const removeVariantOptionsMutable = (
  data: CustomSlotSchemaData,
  fragmentId: Instance["id"],
  field: CustomSlotField,
  removedOptionIds: Set<string>
) => {
  if (removedOptionIds.size === 0) {
    return;
  }
  const states = new Set(
    Array.from(removedOptionIds, (id) => getCustomSlotVariantState(id))
  );
  for (const [key, styleDecl] of data.styles) {
    if (styleDecl.state !== undefined && states.has(styleDecl.state)) {
      data.styles.delete(key);
    }
  }
  // copies using a deleted variant go back to the base design
  removeCopyValuesMutable(
    data,
    fragmentId,
    field.id,
    (value) =>
      value.type === "literal" && removedOptionIds.has(String(value.value))
  );
};

/** Visits every expression used by the shared Fragment content. */
const updateFragmentExpressionsMutable = (
  data: CustomSlotFieldData,
  fragmentId: Instance["id"],
  update: {
    expression: (expression: string) => string;
    prop?: (prop: Extract<Prop, { type: "expression" }>) => Prop | undefined;
    child?: (
      child: Extract<Instance["children"][number], { type: "expression" }>
    ) => Instance["children"][number] | undefined;
  }
) => {
  const instanceIds = findTreeInstanceIds(data.instances, fragmentId);
  for (const instanceId of instanceIds) {
    const instance = data.instances.get(instanceId);
    if (instance === undefined) {
      continue;
    }
    instance.children = instance.children.map((child) => {
      if (child.type !== "expression") {
        return child;
      }
      return (
        update.child?.(child) ?? {
          ...child,
          value: update.expression(child.value),
        }
      );
    });
  }
  for (const prop of data.props.values()) {
    if (instanceIds.has(prop.instanceId) === false) {
      continue;
    }
    if (prop.type === "expression") {
      data.props.set(
        prop.id,
        update.prop?.(prop) ?? {
          ...prop,
          value: update.expression(prop.value),
        }
      );
    }
    if (prop.type === "action") {
      data.props.set(prop.id, {
        ...prop,
        value: prop.value.map((action) => ({
          ...action,
          code: update.expression(action.code),
        })),
      });
    }
  }
};

const toLiteralProp = (
  prop: Extract<Prop, { type: "expression" }>,
  value: unknown
): Prop => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { type, value: expression, ...base } = prop;
  if (typeof value === "number") {
    return { ...base, type: "number", value };
  }
  if (typeof value === "boolean") {
    return { ...base, type: "boolean", value };
  }
  if (typeof value === "string") {
    return { ...base, type: "string", value };
  }
  return { ...base, type: "json", value: value ?? null };
};

export const createCustomSlotFieldInput = z.object({
  fragmentId: z.string().min(1),
  fieldId: z
    .string()
    .min(1)
    .optional()
    .describe("Id for the new property, so later steps can refer to it"),
  name: fieldNameInput,
  type: fieldTypeInput.optional(),
  options: variantOptionsInput.optional(),
  baseName: z
    .string()
    .optional()
    .describe("Name of the design without a variant; empty resets to Base"),
  defaultValue: fieldValueInput.optional(),
});

export const createCustomSlotField = (
  state: CustomSlotFieldState,
  input: z.infer<typeof createCustomSlotFieldInput>,
  context: BuilderRuntimeContext
) => {
  const before = getRequiredState(state, customSlotFieldNamespaces);
  const fieldId = input.fieldId ?? context.createId();
  let componentId = "";
  const { payload } = produceWebstudioDataMutation(before, (draft) => {
    const { schema, component } = getSchemaDataSource(draft, input.fragmentId);
    componentId = component.id;
    const fields = readFields(schema);
    if (fields.some((field) => field.name === input.name)) {
      return throwBuilderRuntimeError(
        "CONFLICT",
        `Property "${input.name}" already exists`
      );
    }
    const field: CustomSlotField = { id: fieldId, name: input.name };
    if (input.type !== undefined) {
      field.type = input.type;
    }
    if (input.type === "variant") {
      field.options = input.options ?? [];
      const baseName = input.baseName?.trim();
      if (baseName !== undefined && baseName.length > 0) {
        field.baseName = baseName;
      }
    }
    if (input.defaultValue !== undefined) {
      field.defaultValue = input.defaultValue as CustomSlotFieldValue;
    }
    requireValidFieldValue(field, field.defaultValue);
    writeFields(draft, schema, [...fields, field]);
  });
  return createRuntimeMutation({
    payload,
    result: {
      fieldId,
      expression: getFieldReference(componentId, input.name),
    },
    invalidatesNamespaces: customSlotFieldNamespaces,
  });
};

export const updateCustomSlotFieldInput = z.object({
  fragmentId: z.string().min(1),
  fieldId: z.string().min(1),
  name: fieldNameInput.optional(),
  type: fieldTypeInput.optional(),
  options: variantOptionsInput.optional(),
  baseName: z
    .string()
    .optional()
    .describe("Name of the design without a variant; empty resets to Base"),
  defaultValue: fieldValueInput.nullable().optional(),
});

export const updateCustomSlotField = (
  state: CustomSlotSchemaState,
  input: z.infer<typeof updateCustomSlotFieldInput>
) => {
  const before = getRequiredState(state, customSlotSchemaNamespaces);
  const { payload } = produceWebstudioDataMutation(before, (draft) => {
    const { schema, component } = getSchemaDataSource(draft, input.fragmentId);
    const fields = readFields(schema);
    const field = fields.find((field) => field.id === input.fieldId);
    if (field === undefined) {
      return throwBuilderRuntimeError("NOT_FOUND", "Property not found");
    }
    const nextField: CustomSlotField = { ...field };
    if (input.name !== undefined && input.name !== field.name) {
      if (fields.some((item) => item.name === input.name)) {
        return throwBuilderRuntimeError(
          "CONFLICT",
          `Property "${input.name}" already exists`
        );
      }
      nextField.name = input.name;
      // keep connected settings working after rename
      const pattern = new RegExp(
        `${escapeRegExp(
          getFieldReference(component.id, field.name)
        )}(?![\\w$])`,
        "g"
      );
      const replacement = getFieldReference(component.id, input.name);
      updateFragmentExpressionsMutable(draft, input.fragmentId, {
        expression: (expression) => expression.replace(pattern, replacement),
      });
    }
    if (input.type !== undefined) {
      nextField.type = input.type;
    }
    if (input.options !== undefined) {
      nextField.options = input.options;
      const keptIds = new Set(input.options.map((option) => option.id));
      removeVariantOptionsMutable(
        draft,
        input.fragmentId,
        field,
        new Set(
          (field.options ?? [])
            .map((option) => option.id)
            .filter((id) => keptIds.has(id) === false)
        )
      );
    }
    if (input.baseName !== undefined) {
      const baseName = input.baseName.trim();
      if (baseName.length > 0) {
        nextField.baseName = baseName;
      } else {
        delete nextField.baseName;
      }
    }
    if (input.defaultValue === null) {
      delete nextField.defaultValue;
    } else if (input.defaultValue !== undefined) {
      nextField.defaultValue = input.defaultValue as CustomSlotFieldValue;
    }
    requireValidFieldValue(nextField, nextField.defaultValue);
    writeFields(
      draft,
      schema,
      fields.map((item) => (item.id === field.id ? nextField : item))
    );
  });
  return createRuntimeMutation({
    payload,
    result: { fieldId: input.fieldId },
    invalidatesNamespaces: customSlotSchemaNamespaces,
  });
};

export const deleteCustomSlotFieldInput = z.object({
  fragmentId: z.string().min(1),
  fieldId: z.string().min(1),
});

export const deleteCustomSlotField = (
  state: CustomSlotSchemaState,
  input: z.infer<typeof deleteCustomSlotFieldInput>
) => {
  const before = getRequiredState(state, customSlotSchemaNamespaces);
  const { payload } = produceWebstudioDataMutation(before, (draft) => {
    const { schema, component } = getSchemaDataSource(draft, input.fragmentId);
    const fields = readFields(schema);
    const field = fields.find((field) => field.id === input.fieldId);
    if (field === undefined) {
      return throwBuilderRuntimeError("NOT_FOUND", "Property not found");
    }
    // detach connected settings and keep the default, like Figma detaching
    const reference = getFieldReference(component.id, field.name);
    const fallback =
      field.defaultValue?.type === "literal"
        ? field.defaultValue.value
        : undefined;
    updateFragmentExpressionsMutable(draft, input.fragmentId, {
      expression: (expression) => expression,
      prop: (prop) => {
        if (prop.value.trim() !== reference) {
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { type, value, ...base } = prop;
        return field.defaultValue?.type === "page"
          ? { ...base, type: "page", value: field.defaultValue.value }
          : toLiteralProp(prop, fallback);
      },
      child: (child) =>
        child.value.trim() === reference
          ? { type: "text", value: String(fallback ?? "") }
          : undefined,
    });
    writeFields(
      draft,
      schema,
      fields.filter((item) => item.id !== field.id)
    );
    removeVariantOptionsMutable(
      draft,
      input.fragmentId,
      field,
      new Set((field.options ?? []).map((option) => option.id))
    );
    removeCopyValuesMutable(draft, input.fragmentId, field.id);
  });
  return createRuntimeMutation({
    payload,
    result: { fieldId: input.fieldId },
    invalidatesNamespaces: customSlotSchemaNamespaces,
  });
};

export const setCustomSlotFieldValueInput = z.object({
  slotId: z.string().min(1),
  fieldId: z.string().min(1),
  // null resets this copy to the property default
  value: fieldValueInput.nullable(),
  override: z
    .object({ ownerSlotId: z.string().min(1), key: z.string().min(1) })
    .optional()
    .describe(
      "Save the value only for this parent copy, like a Figma override of a nested instance"
    ),
});

export const setCustomSlotFieldValue = (
  state: CustomSlotFieldState,
  input: z.infer<typeof setCustomSlotFieldValueInput>,
  context: BuilderRuntimeContext
) => {
  const before = getRequiredState(state, customSlotFieldNamespaces);
  const { payload } = produceWebstudioDataMutation(before, (draft) => {
    if (draft.instances.get(input.slotId)?.component !== customSlotComponent) {
      return throwBuilderRuntimeError("NOT_FOUND", "Custom Slot not found");
    }
    const fragmentId = getCustomSlotContentRootId(
      draft.instances,
      input.slotId
    );
    const schema =
      fragmentId === undefined
        ? undefined
        : findCustomSlotDataSource(
            draft.dataSources,
            fragmentId,
            customSlotSchemaVariable
          );
    requireValidFieldValue(
      schema === undefined
        ? undefined
        : readFields(schema).find((field) => field.id === input.fieldId),
      input.value as null | CustomSlotFieldValue
    );
    if (input.override !== undefined) {
      const { ownerSlotId, key } = input.override;
      if (draft.instances.get(ownerSlotId)?.component !== customSlotComponent) {
        return throwBuilderRuntimeError("NOT_FOUND", "Parent copy not found");
      }
      const existing = findCustomSlotDataSource(
        draft.dataSources,
        ownerSlotId,
        customSlotOverridesVariable
      );
      const overrides = parseCustomSlotOverrides(
        existing?.type === "variable" && existing.value.type === "json"
          ? existing.value.value
          : undefined
      );
      const nested = { ...overrides[key] };
      if (input.value === null) {
        delete nested[input.fieldId];
      } else {
        nested[input.fieldId] = input.value as CustomSlotFieldValue;
      }
      if (Object.keys(nested).length === 0) {
        delete overrides[key];
      } else {
        overrides[key] = nested;
      }
      const id = existing?.id ?? context.createId();
      draft.dataSources.set(id, {
        type: "variable",
        id,
        scopeInstanceId: ownerSlotId,
        name: customSlotOverridesVariable,
        value: { type: "json", value: overrides },
      });
      return;
    }
    const values = findCustomSlotDataSource(
      draft.dataSources,
      input.slotId,
      customSlotValuesVariable
    );
    const localValues = parseCustomSlotFieldValues(
      values?.type === "variable" && values.value.type === "json"
        ? values.value.value
        : undefined
    );
    if (input.value === null) {
      delete localValues[input.fieldId];
    } else {
      localValues[input.fieldId] = input.value as CustomSlotFieldValue;
    }
    const id = values?.id ?? context.createId();
    draft.dataSources.set(id, {
      type: "variable",
      id,
      scopeInstanceId: input.slotId,
      name: customSlotValuesVariable,
      value: { type: "json", value: localValues },
    });
  });
  return createRuntimeMutation({
    payload,
    result: { slotId: input.slotId, fieldId: input.fieldId },
    invalidatesNamespaces: customSlotFieldNamespaces,
  });
};

export type CustomSlotProperty = {
  field: CustomSlotField;
  /** this copy's own value, undefined when it uses the default */
  localValue?: CustomSlotFieldValue;
};

/** Reads the properties shown when a Custom Slot copy is selected. */
export const getCustomSlotProperties = ({
  instances,
  dataSources,
  slotId,
}: Pick<WebstudioData, "instances" | "dataSources"> & {
  slotId: Instance["id"];
}) => {
  const fragmentId = getCustomSlotContentRootId(instances, slotId);
  if (fragmentId === undefined) {
    return;
  }
  const schema = findCustomSlotDataSource(
    dataSources,
    fragmentId,
    customSlotSchemaVariable
  );
  const values = findCustomSlotDataSource(
    dataSources,
    slotId,
    customSlotValuesVariable
  );
  const localValues = parseCustomSlotFieldValues(
    values?.type === "variable" && values.value.type === "json"
      ? values.value.value
      : undefined
  );
  return {
    fragmentId,
    properties: (schema === undefined ? [] : readFields(schema)).map(
      (field): CustomSlotProperty => ({
        field,
        localValue: localValues[field.id],
      })
    ),
  };
};

/**
 * Finds the Custom Slot whose properties an element can connect to, from the
 * data source ids available in the element's binding scope.
 */
export const findCustomSlotConnection = ({
  dataSources,
  availableDataSourceIds,
  excludeFragmentId,
}: Pick<WebstudioData, "dataSources"> & {
  availableDataSourceIds: Iterable<DataSource["id"]>;
  /**
   * A copy's own component, whose values cannot connect to itself.
   * A nested copy still connects to the component it is inside, so each
   * parent copy can fill in the nested one, like Figma nested properties.
   */
  excludeFragmentId?: Instance["id"];
}) => {
  for (const id of availableDataSourceIds) {
    const component = dataSources.get(id);
    if (
      component?.type !== "parameter" ||
      component.name !== customSlotComponentVariable ||
      component.scopeInstanceId === undefined ||
      component.scopeInstanceId === excludeFragmentId
    ) {
      continue;
    }
    const schema = findCustomSlotDataSource(
      dataSources,
      component.scopeInstanceId,
      customSlotSchemaVariable
    );
    if (schema === undefined) {
      continue;
    }
    return {
      fragmentId: component.scopeInstanceId,
      fields: readFields(schema),
      getExpression: (name: string) => getFieldReference(component.id, name),
    };
  }
};

/** Internal Custom Slot storage that should not appear as user variables. */
export const isCustomSlotInternalVariable = (dataSource: DataSource) =>
  dataSource.name === customSlotSchemaVariable ||
  dataSource.name === customSlotValuesVariable ||
  dataSource.name === customSlotOverridesVariable;

const toPropertyLabel = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());

/**
 * The closest copy an element is shown inside. Selectors go from the element
 * to the page root, so the first Fragment owned by a copy is the closest.
 */
const findEnclosingCopy = (
  instances: WebstudioData["instances"],
  instanceSelector: readonly Instance["id"][]
) => {
  for (let index = 1; index < instanceSelector.length - 1; index += 1) {
    const fragmentId = instanceSelector[index];
    const slotId = instanceSelector[index + 1];
    if (
      instances.get(fragmentId)?.component === "Fragment" &&
      instances.get(slotId)?.component === customSlotComponent
    ) {
      return {
        fragmentId,
        slotId,
        copySelector: instanceSelector.slice(index + 1),
      };
    }
  }
};

/**
 * Style states an element offers for the variants of the component it is
 * inside, e.g. "Size: Small", so variant styles use the native Style panel.
 */
export const getCustomSlotVariantStates = ({
  instances,
  dataSources,
  instanceSelector,
}: Pick<WebstudioData, "instances" | "dataSources"> & {
  instanceSelector: readonly Instance["id"][];
}) => {
  const copy = findEnclosingCopy(instances, instanceSelector);
  if (copy === undefined) {
    return [];
  }
  const schema = findCustomSlotDataSource(
    dataSources,
    copy.fragmentId,
    customSlotSchemaVariable
  );
  return (schema === undefined ? [] : readFields(schema)).flatMap((field) =>
    field.type === "variant"
      ? (field.options ?? []).map((option) => ({
          label: `${toPropertyLabel(field.name)}: ${option.name}`,
          selector: getCustomSlotVariantState(option.id),
        }))
      : []
  );
};

/**
 * The variant style state to edit for an element inside a copy, so styling
 * an element in a copy set to Small edits Small, like Webflow and Figma.
 * Undefined when the copy uses the base design.
 */
export const getCustomSlotActiveVariantState = ({
  instances,
  dataSources,
  instanceSelector,
}: Pick<WebstudioData, "instances" | "dataSources"> & {
  instanceSelector: readonly Instance["id"][];
}) => {
  const enclosing = findEnclosingCopy(instances, instanceSelector);
  if (enclosing === undefined) {
    return;
  }
  // a nested copy uses the variant its parent copy picked for it
  const copy = getCustomSlotCopy({
    instances,
    dataSources,
    slotId: enclosing.slotId,
    enclosingCopyIds: getCustomSlotEnclosingCopies(
      instances,
      enclosing.copySelector
    ),
  });
  for (const field of copy?.fields ?? []) {
    const value = copy?.values[field.id] ?? field.defaultValue;
    const option = field.options?.find(
      (option) => value?.type === "literal" && option.id === value.value
    );
    if (field.type === "variant" && option !== undefined) {
      return getCustomSlotVariantState(option.id);
    }
  }
};
