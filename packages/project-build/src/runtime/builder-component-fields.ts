import { z } from "zod";
import {
  builderComponent,
  builderComponentParameterVariable,
  builderComponentSchemaVariable,
  builderComponentValuesVariable,
  builderComponentOverridesVariable,
  parseBuilderComponentOverrides,
  getBuilderComponentCopy,
  getBuilderComponentEnclosingCopies,
  encodeDataVariableId,
  findBuilderComponentDataSource,
  findTreeInstanceIds,
  getBuilderComponentContentRootId,
  getBuilderComponentChoiceState,
  splitBuilderComponentChoiceState,
  parseBuilderComponentFieldValues,
  parseBuilderComponentFields,
  type BuilderComponentField,
  type BuilderComponentFieldValue,
  type BuilderComponentFieldValues,
  type DataSource,
  type Instance,
  type WebstudioData,
} from "@webstudio-is/sdk";
import type { BuilderState } from "../state/builder-state";
import type { BuilderRuntimeContext } from "./context";
import { produceWebstudioDataMutation } from "./data";
import { validateHtmlEmbedCode } from "./html-embed";
import { throwBuilderRuntimeError } from "./errors";
import { createRuntimeMutation } from "./mutation";

/**
 * Builder component properties work like Figma or Webflow component properties:
 * the property list is shared by every copy, elements inside the shared
 * Fragment connect to `component.<name>`, and each copy stores its own value.
 */

export const builderComponentFieldNamespaces = [
  "instances",
  "props",
  "dataSources",
] as const;

/** Deleting a choice property also removes the styles of its values. */
export const builderComponentSchemaNamespaces = [
  ...builderComponentFieldNamespaces,
  "styles",
] as const;

type BuilderComponentFieldState = Pick<
  BuilderState,
  (typeof builderComponentFieldNamespaces)[number]
>;

type BuilderComponentFieldData = Pick<
  WebstudioData,
  (typeof builderComponentFieldNamespaces)[number]
>;

type BuilderComponentSchemaState = Pick<
  BuilderState,
  (typeof builderComponentSchemaNamespaces)[number]
>;

type BuilderComponentSchemaData = Pick<
  WebstudioData,
  (typeof builderComponentSchemaNamespaces)[number]
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
  "richText",
  "number",
  "link",
  "html",
  "boolean",
  "image",
  "json",
  "choice",
]);

const choicesInput = z
  .array(z.string().min(1))
  .describe("Values of a choice property; each value is also its label");

/** Converts a label like "Button Link" into a bindable name "buttonLink". */
export const toBuilderComponentFieldName = (label: string) => {
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
  Namespace extends (typeof builderComponentSchemaNamespaces)[number],
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

export const getBuilderComponentSchemaDataSource = (
  data: BuilderComponentFieldData,
  fragmentId: Instance["id"]
) => {
  const schema = findBuilderComponentDataSource(
    data.dataSources,
    fragmentId,
    builderComponentSchemaVariable
  );
  const component = findBuilderComponentDataSource(
    data.dataSources,
    fragmentId,
    builderComponentParameterVariable
  );
  if (
    data.instances.get(fragmentId)?.component !== "Fragment" ||
    schema?.type !== "variable" ||
    component?.type !== "parameter"
  ) {
    return throwBuilderRuntimeError(
      "NOT_FOUND",
      "Builder component properties were not found"
    );
  }
  return { schema, component };
};

export const readBuilderComponentFields = (schema: DataSource) =>
  parseBuilderComponentFields(
    schema.type === "variable" && schema.value.type === "json"
      ? schema.value.value
      : undefined
  );

/** Defaults are fixed values; data and expressions belong to each copy. */
const requireLiteralDefault = (
  defaultValue: undefined | null | BuilderComponentFieldValue
) => {
  if (defaultValue?.type === "expression") {
    return throwBuilderRuntimeError(
      "BAD_REQUEST",
      "A default must be a fixed value. Connect data on each copy instead."
    );
  }
};

/**
 * Names of variables created inside the component. Properties are read as
 * `component.<name>`, but sharing a name with a variable is confusing.
 */
const getComponentVariableNames = (
  data: BuilderComponentFieldData,
  fragmentId: Instance["id"]
) => {
  const instanceIds = findTreeInstanceIds(data.instances, fragmentId);
  const names = new Set<string>();
  for (const dataSource of data.dataSources.values()) {
    if (
      dataSource.scopeInstanceId !== undefined &&
      instanceIds.has(dataSource.scopeInstanceId) &&
      dataSource.type !== "parameter" &&
      isBuilderComponentInternalVariable(dataSource) === false
    ) {
      names.add(dataSource.name);
    }
  }
  return names;
};

export const requireUniqueBuilderComponentFieldName = (
  data: BuilderComponentFieldData,
  fragmentId: Instance["id"],
  fields: readonly BuilderComponentField[],
  name: string
) => {
  if (fields.some((field) => field.name === name)) {
    return throwBuilderRuntimeError(
      "CONFLICT",
      `Property "${name}" already exists`
    );
  }
  if (getComponentVariableNames(data, fragmentId).has(name)) {
    return throwBuilderRuntimeError(
      "CONFLICT",
      `A variable inside this component is already named "${name}"`
    );
  }
};

/** HTML Embed values get the same check as an HTML Embed's Code. */
const requireValidFieldValue = (
  field: undefined | BuilderComponentField,
  value: undefined | null | BuilderComponentFieldValue
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

export const writeBuilderComponentFields = (
  data: BuilderComponentFieldData,
  schema: DataSource,
  fields: BuilderComponentField[]
) => {
  if (schema.type !== "variable") {
    return;
  }
  data.dataSources.set(schema.id, {
    ...schema,
    value: { type: "json", value: fields },
  });
};

export const getBuilderComponentFieldReference = (
  componentId: DataSource["id"],
  name: string
) => `${encodeDataVariableId(componentId)}.${name}`;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const listBuilderComponentOccurrenceIds = (
  data: BuilderComponentFieldData,
  fragmentId: Instance["id"]
) => {
  const ids: Instance["id"][] = [];
  for (const instance of data.instances.values()) {
    if (
      instance.component === builderComponent &&
      getBuilderComponentContentRootId(data.instances, instance.id) ===
        fragmentId
    ) {
      ids.push(instance.id);
    }
  }
  return ids;
};

/**
 * Deletes the styles conditioned on values of a deleted choice property, so
 * no styles stay behind for a property no copy can use any more.
 */
const removeChoiceStylesMutable = (
  data: BuilderComponentSchemaData,
  fieldId: string
) => {
  for (const [key, styleDecl] of data.styles) {
    if (
      splitBuilderComponentChoiceState(styleDecl.state)?.fieldId === fieldId
    ) {
      data.styles.delete(key);
    }
  }
};

/** Visits every expression used by the shared Fragment content. */
const updateFragmentExpressionsMutable = (
  data: BuilderComponentFieldData,
  fragmentId: Instance["id"],
  update: { expression: (expression: string) => string }
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
      return { ...child, value: update.expression(child.value) };
    });
  }
  for (const prop of data.props.values()) {
    if (instanceIds.has(prop.instanceId) === false) {
      continue;
    }
    if (prop.type === "expression") {
      data.props.set(prop.id, {
        ...prop,
        value: update.expression(prop.value),
      });
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
  // nested copies inside the component may fill their values from it
  const updateValues = (values: BuilderComponentFieldValues) => {
    let changed = false;
    for (const [id, value] of Object.entries(values)) {
      if (value.type === "expression") {
        const next = update.expression(value.value);
        if (next !== value.value) {
          values[id] = { type: "expression", value: next };
          changed = true;
        }
      }
    }
    return changed;
  };
  for (const dataSource of data.dataSources.values()) {
    if (
      dataSource.type !== "variable" ||
      dataSource.value.type !== "json" ||
      instanceIds.has(dataSource.scopeInstanceId ?? "") === false
    ) {
      continue;
    }
    if (dataSource.name === builderComponentValuesVariable) {
      const values = parseBuilderComponentFieldValues(dataSource.value.value);
      if (updateValues(values)) {
        data.dataSources.set(dataSource.id, {
          ...dataSource,
          value: { type: "json", value: values },
        });
      }
    }
    if (dataSource.name === builderComponentOverridesVariable) {
      const overrides = parseBuilderComponentOverrides(dataSource.value.value);
      let changed = false;
      for (const values of Object.values(overrides)) {
        changed = updateValues(values) || changed;
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

export const createBuilderComponentFieldInput = z.object({
  fragmentId: z.string().min(1),
  fieldId: z
    .string()
    .min(1)
    .optional()
    .describe("Id for the new property, so later steps can refer to it"),
  name: fieldNameInput,
  type: fieldTypeInput.optional(),
  choices: choicesInput.optional(),
  defaultValue: fieldValueInput
    .optional()
    .describe("Fixed default value. A property without a default is required"),
});

export const createBuilderComponentField = (
  state: BuilderComponentFieldState,
  input: z.infer<typeof createBuilderComponentFieldInput>,
  context: BuilderRuntimeContext
) => {
  const before = getRequiredState(state, builderComponentFieldNamespaces);
  const fieldId = input.fieldId ?? context.createId();
  let componentId = "";
  const { payload } = produceWebstudioDataMutation(before, (draft) => {
    const { schema, component } = getBuilderComponentSchemaDataSource(
      draft,
      input.fragmentId
    );
    componentId = component.id;
    const fields = readBuilderComponentFields(schema);
    requireUniqueBuilderComponentFieldName(
      draft,
      input.fragmentId,
      fields,
      input.name
    );
    requireLiteralDefault(input.defaultValue as BuilderComponentFieldValue);
    const field: BuilderComponentField = { id: fieldId, name: input.name };
    if (input.type !== undefined) {
      field.type = input.type;
    }
    if (input.type === "choice") {
      field.choices = input.choices ?? [];
    }
    if (input.defaultValue !== undefined) {
      field.defaultValue = input.defaultValue as BuilderComponentFieldValue;
    }
    requireValidFieldValue(field, field.defaultValue);
    writeBuilderComponentFields(draft, schema, [...fields, field]);
  });
  return createRuntimeMutation({
    payload,
    result: {
      fieldId,
      expression: getBuilderComponentFieldReference(componentId, input.name),
    },
    invalidatesNamespaces: builderComponentFieldNamespaces,
  });
};

export const updateBuilderComponentFieldInput = z.object({
  fragmentId: z.string().min(1),
  fieldId: z.string().min(1),
  name: fieldNameInput.optional(),
  type: fieldTypeInput.optional(),
  choices: choicesInput.optional(),
  defaultValue: fieldValueInput
    .nullable()
    .optional()
    .describe("Fixed default value; null removes it and makes it required"),
});

export const updateBuilderComponentField = (
  state: BuilderComponentSchemaState,
  input: z.infer<typeof updateBuilderComponentFieldInput>
) => {
  const before = getRequiredState(state, builderComponentSchemaNamespaces);
  const { payload } = produceWebstudioDataMutation(before, (draft) => {
    const { schema, component } = getBuilderComponentSchemaDataSource(
      draft,
      input.fragmentId
    );
    const fields = readBuilderComponentFields(schema);
    const field = fields.find((field) => field.id === input.fieldId);
    if (field === undefined) {
      return throwBuilderRuntimeError("NOT_FOUND", "Property not found");
    }
    const nextField: BuilderComponentField = { ...field };
    requireLiteralDefault(input.defaultValue as BuilderComponentFieldValue);
    if (input.name !== undefined && input.name !== field.name) {
      requireUniqueBuilderComponentFieldName(
        draft,
        input.fragmentId,
        fields,
        input.name
      );
      nextField.name = input.name;
      // keep connected settings working after rename
      const pattern = new RegExp(
        `${escapeRegExp(
          getBuilderComponentFieldReference(component.id, field.name)
        )}(?![\\w$])`,
        "g"
      );
      const replacement = getBuilderComponentFieldReference(
        component.id,
        input.name
      );
      updateFragmentExpressionsMutable(draft, input.fragmentId, {
        expression: (expression) => expression.replace(pattern, replacement),
      });
    }
    // changing the type keeps every copy's value; mismatches show an error
    if (input.type !== undefined) {
      nextField.type = input.type;
      if (input.type === "choice") {
        nextField.choices ??= [];
      }
    }
    // removing a choice keeps the copies using it; they show an error
    if (input.choices !== undefined) {
      nextField.choices = input.choices;
    }
    if (input.defaultValue === null) {
      delete nextField.defaultValue;
    } else if (input.defaultValue !== undefined) {
      nextField.defaultValue = input.defaultValue as BuilderComponentFieldValue;
    }
    requireValidFieldValue(nextField, nextField.defaultValue);
    writeBuilderComponentFields(
      draft,
      schema,
      fields.map((item) => (item.id === field.id ? nextField : item))
    );
  });
  return createRuntimeMutation({
    payload,
    result: { fieldId: input.fieldId },
    invalidatesNamespaces: builderComponentSchemaNamespaces,
  });
};

export const deleteBuilderComponentFieldInput = z.object({
  fragmentId: z.string().min(1),
  fieldId: z.string().min(1),
});

export const deleteBuilderComponentField = (
  state: BuilderComponentSchemaState,
  input: z.infer<typeof deleteBuilderComponentFieldInput>
) => {
  const before = getRequiredState(state, builderComponentSchemaNamespaces);
  const { payload } = produceWebstudioDataMutation(before, (draft) => {
    const { schema } = getBuilderComponentSchemaDataSource(
      draft,
      input.fragmentId
    );
    const fields = readBuilderComponentFields(schema);
    const field = fields.find((field) => field.id === input.fieldId);
    if (field === undefined) {
      return throwBuilderRuntimeError("NOT_FOUND", "Property not found");
    }
    writeBuilderComponentFields(
      draft,
      schema,
      fields.filter((item) => item.id !== field.id)
    );
    if (field.type === "choice") {
      removeChoiceStylesMutable(draft, field.id);
    }
    // copies keep their values and connected settings keep pointing at the
    // property, showing an error until they are connected to another one
  });
  return createRuntimeMutation({
    payload,
    result: { fieldId: input.fieldId },
    invalidatesNamespaces: builderComponentSchemaNamespaces,
  });
};

export const setBuilderComponentFieldValueInput = z.object({
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

export const setBuilderComponentFieldValue = (
  state: BuilderComponentFieldState,
  input: z.infer<typeof setBuilderComponentFieldValueInput>,
  context: BuilderRuntimeContext
) => {
  const before = getRequiredState(state, builderComponentFieldNamespaces);
  const { payload } = produceWebstudioDataMutation(before, (draft) => {
    if (draft.instances.get(input.slotId)?.component !== builderComponent) {
      return throwBuilderRuntimeError(
        "NOT_FOUND",
        "Builder component not found"
      );
    }
    const fragmentId = getBuilderComponentContentRootId(
      draft.instances,
      input.slotId
    );
    const schema =
      fragmentId === undefined
        ? undefined
        : findBuilderComponentDataSource(
            draft.dataSources,
            fragmentId,
            builderComponentSchemaVariable
          );
    requireValidFieldValue(
      schema === undefined
        ? undefined
        : readBuilderComponentFields(schema).find(
            (field) => field.id === input.fieldId
          ),
      input.value as null | BuilderComponentFieldValue
    );
    if (input.override !== undefined) {
      const { ownerSlotId, key } = input.override;
      if (draft.instances.get(ownerSlotId)?.component !== builderComponent) {
        return throwBuilderRuntimeError("NOT_FOUND", "Parent copy not found");
      }
      const existing = findBuilderComponentDataSource(
        draft.dataSources,
        ownerSlotId,
        builderComponentOverridesVariable
      );
      const overrides = parseBuilderComponentOverrides(
        existing?.type === "variable" && existing.value.type === "json"
          ? existing.value.value
          : undefined
      );
      const nested = { ...overrides[key] };
      if (input.value === null) {
        delete nested[input.fieldId];
      } else {
        nested[input.fieldId] = input.value as BuilderComponentFieldValue;
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
        name: builderComponentOverridesVariable,
        value: { type: "json", value: overrides },
      });
      return;
    }
    const values = findBuilderComponentDataSource(
      draft.dataSources,
      input.slotId,
      builderComponentValuesVariable
    );
    const localValues = parseBuilderComponentFieldValues(
      values?.type === "variable" && values.value.type === "json"
        ? values.value.value
        : undefined
    );
    if (input.value === null) {
      delete localValues[input.fieldId];
    } else {
      localValues[input.fieldId] = input.value as BuilderComponentFieldValue;
    }
    const id = values?.id ?? context.createId();
    draft.dataSources.set(id, {
      type: "variable",
      id,
      scopeInstanceId: input.slotId,
      name: builderComponentValuesVariable,
      value: { type: "json", value: localValues },
    });
  });
  return createRuntimeMutation({
    payload,
    result: { slotId: input.slotId, fieldId: input.fieldId },
    invalidatesNamespaces: builderComponentFieldNamespaces,
  });
};

export type BuilderComponentProperty = {
  field: BuilderComponentField;
  /** this copy's own value, undefined when it uses the default */
  localValue?: BuilderComponentFieldValue;
};

/** Reads the properties shown when a Builder component copy is selected. */
export const getBuilderComponentProperties = ({
  instances,
  dataSources,
  slotId,
}: Pick<WebstudioData, "instances" | "dataSources"> & {
  slotId: Instance["id"];
}) => {
  const fragmentId = getBuilderComponentContentRootId(instances, slotId);
  if (fragmentId === undefined) {
    return;
  }
  const schema = findBuilderComponentDataSource(
    dataSources,
    fragmentId,
    builderComponentSchemaVariable
  );
  const values = findBuilderComponentDataSource(
    dataSources,
    slotId,
    builderComponentValuesVariable
  );
  const localValues = parseBuilderComponentFieldValues(
    values?.type === "variable" && values.value.type === "json"
      ? values.value.value
      : undefined
  );
  return {
    fragmentId,
    properties: (schema === undefined
      ? []
      : readBuilderComponentFields(schema)
    ).map(
      (field): BuilderComponentProperty => ({
        field,
        localValue: localValues[field.id],
      })
    ),
  };
};

/**
 * Finds the Builder component whose properties an element can connect to, from the
 * data source ids available in the element's binding scope.
 */
export const findBuilderComponentConnection = ({
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
      component.name !== builderComponentParameterVariable ||
      component.scopeInstanceId === undefined ||
      component.scopeInstanceId === excludeFragmentId
    ) {
      continue;
    }
    const schema = findBuilderComponentDataSource(
      dataSources,
      component.scopeInstanceId,
      builderComponentSchemaVariable
    );
    if (schema === undefined) {
      continue;
    }
    return {
      fragmentId: component.scopeInstanceId,
      fields: readBuilderComponentFields(schema),
      getExpression: (name: string) =>
        getBuilderComponentFieldReference(component.id, name),
    };
  }
};

/** Internal Builder component storage that should not appear as user variables. */
export const isBuilderComponentInternalVariable = (dataSource: DataSource) =>
  dataSource.name === builderComponentSchemaVariable ||
  dataSource.name === builderComponentValuesVariable ||
  dataSource.name === builderComponentOverridesVariable;

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
      instances.get(slotId)?.component === builderComponent
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
 * Conditions an element offers for the choice properties of the component
 * it is inside, shown as `size: large`, so a value can be styled in the
 * native Style panel. Styling a value is how variants are made.
 */
export const getBuilderComponentChoiceStates = ({
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
  const schema = findBuilderComponentDataSource(
    dataSources,
    copy.fragmentId,
    builderComponentSchemaVariable
  );
  return (
    schema === undefined ? [] : readBuilderComponentFields(schema)
  ).flatMap((field) =>
    field.type === "choice"
      ? (field.choices ?? []).map((choice) => ({
          label: `${field.name}: ${choice}`,
          selector: getBuilderComponentChoiceState(field.id, choice),
        }))
      : []
  );
};

/**
 * The condition to edit for an element inside a copy, so styling inside a
 * copy set to `size: large` edits large, like Webflow variants. Undefined
 * when the copy uses the default of every choice, which edits the base
 * styles every value starts from.
 */
export const getBuilderComponentActiveChoiceState = ({
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
  // a nested copy uses the values its parent copy picked for it
  const copy = getBuilderComponentCopy({
    instances,
    dataSources,
    slotId: enclosing.slotId,
    enclosingCopyIds: getBuilderComponentEnclosingCopies(
      instances,
      enclosing.copySelector
    ),
  });
  for (const field of copy?.fields ?? []) {
    const value = copy?.values[field.id];
    if (
      field.type === "choice" &&
      value?.type === "literal" &&
      typeof value.value === "string" &&
      field.choices?.includes(value.value) &&
      (field.defaultValue?.type !== "literal" ||
        field.defaultValue.value !== value.value)
    ) {
      return getBuilderComponentChoiceState(field.id, value.value);
    }
  }
};

export type BrokenBuilderComponentReference = {
  instanceId: Instance["id"];
  /** setting name, or undefined for text content */
  propName?: string;
  /** the missing property */
  name: string;
};

/**
 * Settings inside a component still connected to a property that was deleted
 * or renamed elsewhere. They stay visible as errors until connected to
 * another property or removed.
 */
export const findBrokenBuilderComponentReferences = ({
  instances,
  props,
  dataSources,
  fragmentId,
}: Pick<WebstudioData, "instances" | "props" | "dataSources"> & {
  fragmentId: Instance["id"];
}): BrokenBuilderComponentReference[] => {
  const component = findBuilderComponentDataSource(
    dataSources,
    fragmentId,
    builderComponentParameterVariable
  );
  const schema = findBuilderComponentDataSource(
    dataSources,
    fragmentId,
    builderComponentSchemaVariable
  );
  if (component === undefined || schema === undefined) {
    return [];
  }
  const names = new Set(
    readBuilderComponentFields(schema).map((field) => field.name)
  );
  const pattern = new RegExp(
    `${escapeRegExp(encodeDataVariableId(component.id))}\\.([A-Za-z_$][\\w$]*)`,
    "g"
  );
  const broken: BrokenBuilderComponentReference[] = [];
  const check = (
    expression: string,
    instanceId: Instance["id"],
    propName?: string
  ) => {
    for (const [, name] of expression.matchAll(pattern)) {
      if (names.has(name) === false) {
        broken.push({ instanceId, propName, name });
      }
    }
  };
  const instanceIds = findTreeInstanceIds(instances, fragmentId);
  for (const instanceId of instanceIds) {
    for (const child of instances.get(instanceId)?.children ?? []) {
      if (child.type === "expression") {
        check(child.value, instanceId);
      }
    }
  }
  for (const prop of props.values()) {
    if (instanceIds.has(prop.instanceId) === false) {
      continue;
    }
    if (prop.type === "expression") {
      check(prop.value, prop.instanceId, prop.name);
    }
    if (prop.type === "action") {
      for (const action of prop.value) {
        check(action.code, prop.instanceId, prop.name);
      }
    }
  }
  return broken;
};
