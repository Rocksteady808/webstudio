import { applyPatches, type Patch } from "immer";
import "../state/immer";
import {
  builderComponent,
  builderComponentOverridesVariable,
  builderComponentValuesVariable,
  getBuilderComponentCopy,
  parseBuilderComponentFieldValues,
  parseBuilderComponentOverrides,
  type BuilderComponentField,
  type BuilderComponentFieldValue,
  type BuilderComponentFieldValues,
  type DataSource,
  type DataSources,
  type Instance,
} from "@webstudio-is/sdk";

type Result = { success: true } | { success: false; error: string };

const fail = (error: string): Result => ({ success: false, error });

const isEqual = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * Content editors fill in a copy's values like Figma instance properties.
 * HTML Embed code, data bindings and everything about the shared design
 * (properties, defaults, choices, tag, structure) stay with designers.
 */
const contentEditableFieldTypes = new Set<BuilderComponentField["type"]>([
  "text",
  "richText",
  "link",
  "boolean",
  "image",
  "choice",
]);

const isContentEditableValue = (
  field: BuilderComponentField,
  value: BuilderComponentFieldValue
) => {
  const type = field.type ?? "text";
  if (value.type === "page") {
    return type === "link";
  }
  if (value.type === "asset") {
    return type === "image";
  }
  if (value.type !== "literal") {
    return false;
  }
  if (type === "boolean") {
    return typeof value.value === "boolean";
  }
  if (type === "choice") {
    return field.choices?.includes(value.value as string) ?? false;
  }
  return typeof value.value === "string";
};

export const isBuilderComponentFieldContentEditable = (
  field: BuilderComponentField,
  localValue: undefined | BuilderComponentFieldValue
) =>
  contentEditableFieldTypes.has(field.type ?? "text") &&
  localValue?.type !== "expression";

const validateFieldChanges = ({
  fields,
  before,
  after,
}: {
  fields: BuilderComponentField[];
  before: BuilderComponentFieldValues;
  after: BuilderComponentFieldValues;
}): Result => {
  for (const fieldId of new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])) {
    if (isEqual(before[fieldId], after[fieldId])) {
      continue;
    }
    const field = fields.find((item) => item.id === fieldId);
    if (
      field === undefined ||
      isBuilderComponentFieldContentEditable(field, before[fieldId]) === false
    ) {
      return fail("This property can only be changed in design mode.");
    }
    const value = after[fieldId];
    if (value !== undefined && isContentEditableValue(field, value) === false) {
      return fail(`Invalid value for "${field.name}".`);
    }
  }
  return { success: true };
};

const getCopyFields = (
  instances: Map<Instance["id"], Instance>,
  dataSources: DataSources,
  slotId: Instance["id"]
) =>
  instances.get(slotId)?.component === builderComponent
    ? (getBuilderComponentCopy({ instances, dataSources, slotId })?.fields ??
      [])
    : undefined;

const readJson = (dataSource: undefined | DataSource) =>
  dataSource?.type === "variable" && dataSource.value.type === "json"
    ? dataSource.value.value
    : undefined;

const validateDataSourceChange = ({
  instances,
  editableInstanceIds,
  dataSources,
  before,
  after,
}: {
  instances: Map<Instance["id"], Instance>;
  editableInstanceIds: ReadonlySet<Instance["id"]>;
  dataSources: DataSources;
  before: undefined | DataSource;
  after: undefined | DataSource;
}): Result => {
  const source = after ?? before;
  if (
    source === undefined ||
    source.type !== "variable" ||
    (source.name !== builderComponentValuesVariable &&
      source.name !== builderComponentOverridesVariable)
  ) {
    return fail(`Data sources are not editable in content mode.`);
  }
  if (after === undefined) {
    // values go away together with a copy removed in content mode
    return instances.has(source.scopeInstanceId ?? "")
      ? fail("Copy values can only be removed with the copy.")
      : { success: true };
  }
  if (
    after.type !== "variable" ||
    after.value.type !== "json" ||
    (before !== undefined &&
      (before.type !== "variable" ||
        before.name !== after.name ||
        before.scopeInstanceId !== after.scopeInstanceId))
  ) {
    return fail("Only copy values are editable in content mode.");
  }
  const slotId = after.scopeInstanceId ?? "";
  if (
    instances.get(slotId)?.component !== builderComponent ||
    editableInstanceIds.has(slotId) === false
  ) {
    return fail("This copy is not editable in content mode.");
  }
  if (after.name === builderComponentValuesVariable) {
    const values = parseBuilderComponentFieldValues(after.value.value);
    if (isEqual(values, after.value.value) === false) {
      return fail("Invalid copy values.");
    }
    return validateFieldChanges({
      fields: getCopyFields(instances, dataSources, slotId) ?? [],
      before: parseBuilderComponentFieldValues(readJson(before)),
      after: values,
    });
  }
  const overrides = parseBuilderComponentOverrides(after.value.value);
  if (isEqual(overrides, after.value.value) === false) {
    return fail("Invalid copy values.");
  }
  const previous = parseBuilderComponentOverrides(readJson(before));
  for (const key of new Set([
    ...Object.keys(previous),
    ...Object.keys(overrides),
  ])) {
    const path = key.split("/");
    const nestedSlotId = path[path.length - 1];
    const fields = path.every(
      (id) => instances.get(id)?.component === builderComponent
    )
      ? getCopyFields(instances, dataSources, nestedSlotId)
      : undefined;
    if (fields === undefined) {
      return fail("Invalid nested copy.");
    }
    const result = validateFieldChanges({
      fields,
      before: previous[key] ?? {},
      after: overrides[key] ?? {},
    });
    if (result.success === false) {
      return result;
    }
  }
  return { success: true };
};

/**
 * Checks data source patches sent in content mode: only Builder component copy
 * values and nested copy overrides inside editable content may change.
 */
export const applyBuilderComponentContentModeDataSourcePatches = ({
  instances,
  editableInstanceIds,
  dataSources,
  patches,
}: {
  instances: Map<Instance["id"], Instance>;
  editableInstanceIds: ReadonlySet<Instance["id"]>;
  dataSources: undefined | DataSources;
  patches: Patch[];
}): Result & { dataSources?: DataSources } => {
  if (dataSources === undefined) {
    return fail(`Namespace "dataSources" is not editable in content mode.`);
  }
  let next: DataSources;
  try {
    next = applyPatches(dataSources, patches);
  } catch {
    return fail("Invalid data source patch.");
  }
  const changedIds = new Set(
    patches.map((patch) => String(patch.path[0] ?? ""))
  );
  for (const id of changedIds) {
    const after = next.get(id);
    if (after !== undefined && after.id !== id) {
      return fail("Invalid data source patch.");
    }
    const result = validateDataSourceChange({
      instances,
      editableInstanceIds,
      dataSources: next,
      before: dataSources.get(id),
      after,
    });
    if (result.success === false) {
      return result;
    }
  }
  return { success: true, dataSources: next };
};
