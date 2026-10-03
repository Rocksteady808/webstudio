/**
 * Field identities belong to the shared definition while field values belong to
 * each occurrence. This follows the model introduced in Webstudio PR #5677.
 */
export type CustomSlotFieldValue =
  | { type: "literal"; value: unknown }
  | { type: "expression"; value: string };

export type CustomSlotField = {
  id: string;
  name: string;
  defaultValue?: CustomSlotFieldValue;
};

export type CustomSlotFieldValues = Record<string, CustomSlotFieldValue>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

export const parseCustomSlotFieldValue = (
  value: unknown
): CustomSlotFieldValue | undefined => {
  if (isRecord(value) === false) {
    return;
  }
  if (value.type === "literal" && "value" in value) {
    return { type: "literal", value: value.value };
  }
  if (value.type === "expression" && typeof value.value === "string") {
    return { type: "expression", value: value.value };
  }
};

export const parseCustomSlotFields = (value: unknown): CustomSlotField[] => {
  if (Array.isArray(value) === false) {
    return [];
  }
  const fields: CustomSlotField[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of value) {
    if (
      isRecord(item) === false ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      item.id.length === 0 ||
      item.name.length === 0 ||
      ids.has(item.id) ||
      names.has(item.name)
    ) {
      continue;
    }
    const field: CustomSlotField = { id: item.id, name: item.name };
    const defaultValue = parseCustomSlotFieldValue(item.defaultValue);
    if (defaultValue !== undefined) {
      field.defaultValue = defaultValue;
    }
    fields.push(field);
    ids.add(field.id);
    names.add(field.name);
  }
  return fields;
};

export const parseCustomSlotFieldValues = (
  value: unknown
): CustomSlotFieldValues => {
  if (isRecord(value) === false) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, rawValue]) => {
      const fieldValue = parseCustomSlotFieldValue(rawValue);
      return fieldValue === undefined ? [] : [[id, fieldValue]];
    })
  );
};

/** Resolve a single occurrence without mutating its persisted values. */
export const resolveCustomSlotFields = async ({
  fields,
  values,
  evaluateExpression,
}: {
  fields: readonly CustomSlotField[];
  values: CustomSlotFieldValues;
  evaluateExpression: (expression: string) => unknown | Promise<unknown>;
}): Promise<Record<string, unknown>> => {
  const entries: Array<[string, unknown]> = [];
  for (const field of fields) {
    const value = values[field.id] ?? field.defaultValue;
    entries.push([
      field.name,
      value?.type === "expression"
        ? await evaluateExpression(value.value)
        : value?.value,
    ]);
  }
  return Object.fromEntries(entries);
};
