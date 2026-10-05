import {
  builderComponent,
  builderComponentOverridesVariable,
  builderComponentSchemaVariable,
  builderComponentValuesVariable,
  getBuilderComponentChoiceState,
  getStyleDeclKey,
  type WebstudioData,
} from "@webstudio-is/sdk";

// names used while Builder components were called Custom Slots
const legacyComponent = "ws:customSlot";
const legacyVariableNames = new Map([
  ["__customSlotSchema", builderComponentSchemaVariable],
  ["__customSlotValues", builderComponentValuesVariable],
  ["__customSlotOverrides", builderComponentOverridesVariable],
]);

export const migrateBuilderComponentsMutable = (
  data: Pick<WebstudioData, "instances" | "dataSources">
) => {
  for (const instance of data.instances.values()) {
    if (instance.component === legacyComponent) {
      instance.component = builderComponent;
    }
  }
  for (const dataSource of data.dataSources.values()) {
    const name = legacyVariableNames.get(dataSource.name);
    if (name !== undefined) {
      dataSource.name = name;
    }
  }
};

type LegacyVariantField = {
  fieldId: string;
  valueByOptionId: Map<string, string>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

const legacyVariantStatePattern =
  /^:is\(\[data-ws-variant~="([A-Za-z0-9_-]+)"\] \*\)(.*)$/;

const getUniqueChoice = (name: string, taken: Set<string>) => {
  let choice = name;
  let index = 2;
  while (taken.has(choice)) {
    choice = `${name} ${index}`;
    index += 1;
  }
  taken.add(choice);
  return choice;
};

/**
 * Variants used to be a special property whose options had ids. A variant is
 * now a choice property: each option becomes a choice named like it, the
 * base design becomes the default choice, and styles and picks follow.
 */
export const migrateBuilderComponentVariantsMutable = (
  data: Pick<WebstudioData, "dataSources" | "styles">
) => {
  const variantFields: LegacyVariantField[] = [];
  for (const dataSource of data.dataSources.values()) {
    if (
      dataSource.name !== builderComponentSchemaVariable ||
      dataSource.type !== "variable" ||
      dataSource.value.type !== "json" ||
      Array.isArray(dataSource.value.value) === false
    ) {
      continue;
    }
    let changed = false;
    const fields = (dataSource.value.value as unknown[]).map((item) => {
      if (isRecord(item) === false || item.type !== "variant") {
        return item;
      }
      changed = true;
      const taken = new Set<string>();
      const base = getUniqueChoice(
        typeof item.baseName === "string" && item.baseName.trim() !== ""
          ? item.baseName.trim()
          : "Base",
        taken
      );
      const valueByOptionId = new Map<string, string>();
      for (const option of Array.isArray(item.options) ? item.options : []) {
        if (
          isRecord(option) &&
          typeof option.id === "string" &&
          typeof option.name === "string" &&
          valueByOptionId.has(option.id) === false
        ) {
          valueByOptionId.set(option.id, getUniqueChoice(option.name, taken));
        }
      }
      variantFields.push({ fieldId: String(item.id), valueByOptionId });
      const defaultOption =
        isRecord(item.defaultValue) && item.defaultValue.type === "literal"
          ? valueByOptionId.get(String(item.defaultValue.value))
          : undefined;
      return {
        id: item.id,
        name: item.name,
        type: "choice",
        choices: [base, ...valueByOptionId.values()],
        defaultValue: { type: "literal", value: defaultOption ?? base },
      };
    });
    if (changed) {
      dataSource.value = { type: "json", value: fields };
    }
  }
  if (variantFields.length === 0) {
    return;
  }

  // picks stored an option id; they now store the choice value
  const updateValues = (values: Record<string, unknown>) => {
    for (const { fieldId, valueByOptionId } of variantFields) {
      const value = values[fieldId];
      if (isRecord(value) && value.type === "literal") {
        const choice = valueByOptionId.get(String(value.value));
        if (choice !== undefined) {
          values[fieldId] = { type: "literal", value: choice };
        }
      }
    }
  };
  for (const dataSource of data.dataSources.values()) {
    const stored =
      dataSource.type === "variable" && dataSource.value.type === "json"
        ? dataSource.value.value
        : undefined;
    if (dataSource.type !== "variable" || isRecord(stored) === false) {
      continue;
    }
    if (dataSource.name === builderComponentValuesVariable) {
      const values = { ...stored };
      updateValues(values);
      dataSource.value = { type: "json", value: values };
    }
    if (dataSource.name === builderComponentOverridesVariable) {
      const overrides: Record<string, unknown> = {};
      for (const [key, values] of Object.entries(stored)) {
        if (isRecord(values)) {
          const next = { ...values };
          updateValues(next);
          overrides[key] = next;
        } else {
          overrides[key] = values;
        }
      }
      dataSource.value = { type: "json", value: overrides };
    }
  }

  // styles keyed by the old option state move to the choice condition
  const conditionByOptionId = new Map<string, string>();
  for (const { fieldId, valueByOptionId } of variantFields) {
    for (const [optionId, choice] of valueByOptionId) {
      conditionByOptionId.set(
        optionId,
        getBuilderComponentChoiceState(fieldId, choice)
      );
    }
  }
  for (const [key, styleDecl] of Array.from(data.styles)) {
    const match = styleDecl.state?.match(legacyVariantStatePattern);
    const condition =
      match === null || match === undefined
        ? undefined
        : conditionByOptionId.get(match[1]);
    if (match === null || match === undefined || condition === undefined) {
      continue;
    }
    const next = { ...styleDecl, state: `${condition}${match[2]}` };
    data.styles.delete(key);
    data.styles.set(getStyleDeclKey(next), next);
  }
};
