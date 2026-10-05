import type { DataSource, DataSources } from "./schema/data-sources";
import type { Pages } from "./schema/pages";
import type { Prop } from "./schema/props";
import { findPageByIdOrPath, getPagePath } from "./page-utils";
import type { Instance, Instances } from "./schema/instances";
import {
  customSlotComponentVariable,
  customSlotSchemaVariable,
  customSlotValuesVariable,
  findCustomSlotDataSource,
  getCustomSlotContentRootId,
} from "./custom-slot";

/**
 * Field identities belong to the shared definition while field values belong to
 * each occurrence. This follows the model introduced in Webstudio PR #5677.
 */
export type CustomSlotPageLink =
  | string
  | { pageId: string; instanceId: string };

export type CustomSlotFieldValue =
  | { type: "literal"; value: unknown }
  | { type: "expression"; value: string }
  | { type: "page"; value: CustomSlotPageLink }
  | { type: "asset"; value: string };

/**
 * Text, number, link, HTML, boolean, image, JSON and choice values live in
 * the component value. A variant picks which variant styles apply to a copy.
 */
export type CustomSlotFieldType =
  | "text"
  | "number"
  | "link"
  | "html"
  | "boolean"
  | "image"
  | "json"
  | "choice"
  | "variant";

const valueFieldTypes = new Set<string>([
  "text",
  "number",
  "link",
  "html",
  "boolean",
  "image",
  "json",
  "choice",
]);

/** One choice of a variant property, e.g. Small in Size: Small / Large. */
export type CustomSlotVariantOption = { id: string; name: string };

export type CustomSlotField = {
  id: string;
  name: string;
  type?: CustomSlotFieldType;
  /** choices of a variant property; a copy stores the chosen option id */
  options?: CustomSlotVariantOption[];
  /** display name of the design a copy has without a variant, e.g. Primary */
  baseName?: string;
  /** values of a choice property; each value is also its label */
  choices?: string[];
  /** a property without a default is required */
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
  if (value.type === "asset" && typeof value.value === "string") {
    return { type: "asset", value: value.value };
  }
  if (value.type === "page") {
    if (typeof value.value === "string") {
      return { type: "page", value: value.value };
    }
    if (
      isRecord(value.value) &&
      typeof value.value.pageId === "string" &&
      typeof value.value.instanceId === "string"
    ) {
      return {
        type: "page",
        value: {
          pageId: value.value.pageId,
          instanceId: value.value.instanceId,
        },
      };
    }
  }
};

// option ids end up in CSS selectors and HTML attributes
const variantOptionIdPattern = /^[A-Za-z0-9_-]+$/;

const parseVariantOptions = (value: unknown): CustomSlotVariantOption[] => {
  if (Array.isArray(value) === false) {
    return [];
  }
  const options: CustomSlotVariantOption[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (
      isRecord(item) &&
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      variantOptionIdPattern.test(item.id) &&
      ids.has(item.id) === false
    ) {
      options.push({ id: item.id, name: item.name });
      ids.add(item.id);
    }
  }
  return options;
};

const parseChoices = (value: unknown) =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value.filter(
            (item): item is string => typeof item === "string" && item !== ""
          )
        )
      )
    : [];

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
    if (typeof item.type === "string" && valueFieldTypes.has(item.type)) {
      field.type = item.type as CustomSlotFieldType;
    }
    if (item.type === "choice") {
      field.choices = parseChoices(item.choices);
    }
    if (item.type === "variant") {
      field.type = "variant";
      field.options = parseVariantOptions(item.options);
      if (typeof item.baseName === "string" && item.baseName.length > 0) {
        field.baseName = item.baseName;
      }
    }
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
  resolvePage = () => undefined,
  resolveAsset = () => undefined,
}: {
  fields: readonly CustomSlotField[];
  values: CustomSlotFieldValues;
  evaluateExpression: (expression: string) => unknown | Promise<unknown>;
  resolvePage?: (value: CustomSlotPageLink) => unknown;
  /** URL of an image asset, the same one a regular Image uses */
  resolveAsset?: (assetId: string) => unknown;
}): Promise<Record<string, unknown>> => {
  const entries: Array<[string, unknown]> = [];
  for (const field of fields) {
    // variants are applied through CSS, not the component value
    if (field.type === "variant") {
      continue;
    }
    const value = values[field.id] ?? field.defaultValue;
    let resolved: unknown;
    if (value?.type === "expression") {
      resolved = await evaluateExpression(value.value);
    } else if (value?.type === "page") {
      resolved = resolvePage(value.value);
    } else if (value?.type === "asset") {
      resolved = resolveAsset(value.value);
    } else {
      resolved = value?.value;
    }
    entries.push([field.name, resolved]);
  }
  return Object.fromEntries(entries);
};

export type CustomSlotFieldIssue = {
  type: "missing" | "type" | "choice";
  message: string;
};

const isJsonContainer = (value: unknown) =>
  typeof value === "object" && value !== null;

const matchesFieldType = (
  type: CustomSlotFieldType,
  value: CustomSlotFieldValue
) => {
  if (value.type === "page") {
    return type === "link";
  }
  if (value.type === "asset") {
    return type === "image";
  }
  if (value.type !== "literal") {
    return true;
  }
  switch (type) {
    case "number":
      return typeof value.value === "number" && Number.isFinite(value.value);
    case "boolean":
      return typeof value.value === "boolean";
    case "json":
      return isJsonContainer(value.value);
    default:
      return typeof value.value === "string";
  }
};

const fieldTypeLabels: Record<CustomSlotFieldType, string> = {
  text: "text",
  number: "a number",
  link: "a link",
  html: "HTML",
  boolean: "true or false",
  image: "an image",
  json: "an object or array",
  choice: "one of the choices",
  variant: "a variant",
};

/**
 * Why a copy's value cannot be used, if it cannot. Values are never removed
 * when a property changes; they stay and show this error until fixed.
 * Expressions are checked when they run, not here.
 */
export const getCustomSlotFieldIssue = (
  field: CustomSlotField,
  localValue: undefined | CustomSlotFieldValue
): undefined | CustomSlotFieldIssue => {
  if (field.type === "variant") {
    return;
  }
  const value = localValue ?? field.defaultValue;
  if (
    value === undefined ||
    (value.type === "literal" &&
      (value.value === undefined || value.value === null))
  ) {
    return { type: "missing", message: "Required. Enter a value." };
  }
  const type = field.type ?? "text";
  if (matchesFieldType(type, value) === false) {
    return {
      type: "type",
      message: `Must be ${fieldTypeLabels[type]}. Enter a new value.`,
    };
  }
  if (
    type === "choice" &&
    value.type === "literal" &&
    field.choices?.includes(value.value as string) !== true
  ) {
    return {
      type: "choice",
      message: `"${String(value.value)}" is no longer a choice. Pick another one.`,
    };
  }
};

/** Builds the same href a regular Link builds for a page or page section. */
export const getCustomSlotPageHref = ({
  value,
  pages,
  props,
}: {
  value: CustomSlotPageLink;
  pages: Pages;
  props: Iterable<Prop>;
}): string | undefined => {
  const pageId = typeof value === "string" ? value : value.pageId;
  const page = findPageByIdOrPath(pageId, pages);
  if (page === undefined) {
    return;
  }
  const url = new URL(getPagePath(page.id, pages), "https://any-valid.url");
  if (typeof value === "string") {
    return url.pathname;
  }
  for (const prop of props) {
    if (
      prop.instanceId === value.instanceId &&
      prop.name === "id" &&
      prop.type === "string"
    ) {
      url.hash = encodeURIComponent(prop.value);
      return `${url.pathname}${url.hash}`;
    }
  }
  return url.pathname;
};

const resolvePageValue = (
  value: CustomSlotFieldValue | undefined,
  resolve: (value: CustomSlotPageLink) => string | undefined,
  resolveAsset: (assetId: string) => string | undefined
): CustomSlotFieldValue | undefined => {
  if (value?.type === "page") {
    return { type: "literal", value: resolve(value.value) };
  }
  if (value?.type === "asset") {
    return { type: "literal", value: resolveAsset(value.value) };
  }
  return value;
};

/**
 * Replaces page links with their paths so generated code never needs pages.
 * Returns a copy and leaves the given data sources untouched.
 */
export const resolveCustomSlotPageValues = ({
  dataSources,
  pages,
  props,
  resolveAsset = () => undefined,
}: {
  dataSources: DataSources;
  pages: Pages;
  props: Iterable<Prop>;
  resolveAsset?: (assetId: string) => string | undefined;
}): DataSources => {
  const propsList = Array.from(props);
  const resolve = (value: CustomSlotPageLink) =>
    getCustomSlotPageHref({ value, pages, props: propsList });
  const resolveValues = (values: CustomSlotFieldValues) =>
    Object.fromEntries(
      Object.entries(values).map(([id, fieldValue]) => [
        id,
        resolvePageValue(fieldValue, resolve, resolveAsset),
      ])
    );
  // copy the map only once a Custom Slot value needs resolving
  let resolved: undefined | DataSources;
  for (const dataSource of dataSources.values()) {
    if (dataSource.type !== "variable" || dataSource.value.type !== "json") {
      continue;
    }
    let value: object;
    if (dataSource.name === customSlotSchemaVariable) {
      value = parseCustomSlotFields(dataSource.value.value).map((field) => {
        const defaultValue = resolvePageValue(
          field.defaultValue,
          resolve,
          resolveAsset
        );
        return defaultValue === undefined ? field : { ...field, defaultValue };
      });
    } else if (dataSource.name === customSlotValuesVariable) {
      value = resolveValues(parseCustomSlotFieldValues(dataSource.value.value));
    } else if (dataSource.name === customSlotOverridesVariable) {
      value = Object.fromEntries(
        Object.entries(parseCustomSlotOverrides(dataSource.value.value)).map(
          ([key, values]) => [key, resolveValues(values)]
        )
      );
    } else {
      continue;
    }
    const next: DataSource = {
      ...dataSource,
      value: { type: "json", value },
    };
    resolved ??= new Map(dataSources);
    resolved.set(dataSource.id, next);
  }
  return resolved ?? dataSources;
};

/** Attribute a copy carries so its variant styles apply. */
export const customSlotVariantAttribute = "data-ws-variant";

/**
 * Style state for an element inside the component that only applies when its
 * copy uses the option, e.g. `.button:is([data-ws-variant~="small"] *)`.
 */
export const getCustomSlotVariantState = (optionId: string) =>
  `:is([${customSlotVariantAttribute}~="${optionId}"] *)`;

const variantStatePattern = new RegExp(
  `^(:is\\(\\[${customSlotVariantAttribute}~="([A-Za-z0-9_-]+)"\\] \\*\\))(.*)$`
);

/**
 * Splits a variant state combined with another state, like a variant's
 * hover `:is([data-ws-variant~="small"] *):hover`, into its parts.
 */
export const splitCustomSlotVariantState = (state: undefined | string) => {
  const match = state?.match(variantStatePattern);
  if (match === null || match === undefined) {
    return;
  }
  return { variantState: match[1], optionId: match[2], state: match[3] };
};

/** Option ids a copy uses, joined for the variant attribute. */
export const getCustomSlotVariantAttribute = (
  fields: readonly CustomSlotField[],
  values: CustomSlotFieldValues
) => {
  const optionIds: string[] = [];
  for (const field of fields) {
    if (field.type !== "variant") {
      continue;
    }
    const value = values[field.id] ?? field.defaultValue;
    const optionId = value?.type === "literal" ? value.value : undefined;
    if (field.options?.some((option) => option.id === optionId)) {
      optionIds.push(optionId as string);
    }
  }
  return optionIds.join(" ");
};

/**
 * Figma-like overrides: a value set on a nested copy while it is shown inside
 * a parent copy belongs to that parent copy only. The outermost copy stores
 * them by the path of nested copies, e.g. { "button": { label: ... } }.
 */
export const customSlotOverridesVariable = "__customSlotOverrides";

export type CustomSlotOverrides = Record<string, CustomSlotFieldValues>;

export const parseCustomSlotOverrides = (
  value: unknown
): CustomSlotOverrides => {
  if (isRecord(value) === false) {
    return {};
  }
  const overrides: CustomSlotOverrides = {};
  for (const [key, values] of Object.entries(value)) {
    if (isRecord(values)) {
      overrides[key] = parseCustomSlotFieldValues(values);
    }
  }
  return overrides;
};

/**
 * Copies whose shared content the copy at the start of the selector is shown
 * in, innermost first. Empty for a copy placed directly on a page.
 */
export const getCustomSlotEnclosingCopies = (
  instances: Instances,
  instanceSelector: readonly Instance["id"][]
) => {
  const copyIds: Instance["id"][] = [];
  for (let index = 2; index < instanceSelector.length; index += 1) {
    const copyId = instanceSelector[index];
    if (
      getCustomSlotContentRootId(instances, copyId) ===
      instanceSelector[index - 1]
    ) {
      copyIds.push(copyId);
    }
  }
  return copyIds;
};

const getOverrideKey = (
  enclosingCopyIds: readonly Instance["id"][],
  ownerIndex: number,
  slotId: Instance["id"]
) => [...enclosingCopyIds.slice(0, ownerIndex).reverse(), slotId].join("/");

/** Where edits to a nested copy are stored: on the outermost parent copy. */
export const getCustomSlotOverrideTarget = (
  enclosingCopyIds: readonly Instance["id"][],
  slotId: Instance["id"]
) => {
  const ownerIndex = enclosingCopyIds.length - 1;
  if (ownerIndex < 0) {
    return;
  }
  return {
    ownerSlotId: enclosingCopyIds[ownerIndex],
    key: getOverrideKey(enclosingCopyIds, ownerIndex, slotId),
  };
};

/** A nested copy's values with its parent copies' overrides applied. */
export const applyCustomSlotOverrides = ({
  values,
  slotId,
  enclosingCopyIds,
  getOverrides,
}: {
  values: CustomSlotFieldValues;
  slotId: Instance["id"];
  enclosingCopyIds: readonly Instance["id"][];
  getOverrides: (copyId: Instance["id"]) => CustomSlotOverrides;
}): CustomSlotFieldValues => {
  let result = values;
  // apply from the innermost parent so the outermost copy wins
  for (let index = 0; index < enclosingCopyIds.length; index += 1) {
    const overrides = getOverrides(enclosingCopyIds[index])[
      getOverrideKey(enclosingCopyIds, index, slotId)
    ];
    if (overrides !== undefined) {
      result = { ...result, ...overrides };
    }
  }
  return result;
};

/** Reads a copy's overrides from its data sources. */
export const getCustomSlotCopyOverrides = (
  dataSources: DataSources,
  copyId: Instance["id"]
): CustomSlotOverrides => {
  const dataSource = findCustomSlotDataSource(
    dataSources,
    copyId,
    customSlotOverridesVariable
  );
  return dataSource?.type === "variable" && dataSource.value.type === "json"
    ? parseCustomSlotOverrides(dataSource.value.value)
    : {};
};

const readJsonVariable = (dataSource: undefined | DataSource) =>
  dataSource?.type === "variable" && dataSource.value.type === "json"
    ? dataSource.value.value
    : undefined;

/**
 * What a copy renders: its shared Fragment and properties, and its own
 * values with the overrides its parent copies set for it.
 */
export const getCustomSlotCopy = ({
  instances,
  dataSources,
  slotId,
  enclosingCopyIds = [],
}: {
  instances: Instances;
  dataSources: DataSources;
  slotId: Instance["id"];
  /** parent copies this copy is shown inside, innermost first */
  enclosingCopyIds?: readonly Instance["id"][];
}) => {
  const fragmentId = getCustomSlotContentRootId(instances, slotId);
  const fragment = instances.get(fragmentId ?? "");
  const component =
    fragmentId === undefined
      ? undefined
      : findCustomSlotDataSource(
          dataSources,
          fragmentId,
          customSlotComponentVariable
        );
  if (fragment === undefined || component?.type !== "parameter") {
    return;
  }
  return {
    fragment,
    component,
    fields: parseCustomSlotFields(
      readJsonVariable(
        findCustomSlotDataSource(
          dataSources,
          fragment.id,
          customSlotSchemaVariable
        )
      )
    ),
    values: applyCustomSlotOverrides({
      values: parseCustomSlotFieldValues(
        readJsonVariable(
          findCustomSlotDataSource(
            dataSources,
            slotId,
            customSlotValuesVariable
          )
        )
      ),
      slotId,
      enclosingCopyIds,
      getOverrides: (copyId) => getCustomSlotCopyOverrides(dataSources, copyId),
    }),
  };
};
