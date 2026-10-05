import type { DataSource, DataSources } from "./schema/data-sources";
import type { Pages } from "./schema/pages";
import type { Prop } from "./schema/props";
import { findPageByIdOrPath, getPagePath } from "./page-utils";
import type { Instance, Instances } from "./schema/instances";
import {
  builderComponentParameterVariable,
  builderComponentSchemaVariable,
  builderComponentValuesVariable,
  findBuilderComponentDataSource,
  getBuilderComponentContentRootId,
} from "./builder-component";

/**
 * Field identities belong to the shared definition while field values belong to
 * each occurrence. This follows the model introduced in Webstudio PR #5677.
 */
export type BuilderComponentPageLink =
  | string
  | { pageId: string; instanceId: string };

export type BuilderComponentFieldValue =
  | { type: "literal"; value: unknown }
  | { type: "expression"; value: string }
  | { type: "page"; value: BuilderComponentPageLink }
  | { type: "asset"; value: string };

/**
 * Text, number, link, HTML, boolean, image, JSON and choice values live in
 * the component value. Choice values also work as style conditions, which is
 * how variants are made: a variant is a choice value styled differently.
 */
export type BuilderComponentFieldType =
  | "text"
  | "richText"
  | "number"
  | "link"
  | "html"
  | "boolean"
  | "image"
  | "json"
  | "choice";

const valueFieldTypes = new Set<string>([
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

export type BuilderComponentField = {
  id: string;
  name: string;
  type?: BuilderComponentFieldType;
  /** values of a choice property; each value is also its label */
  choices?: string[];
  /** a property without a default is required */
  defaultValue?: BuilderComponentFieldValue;
};

export type BuilderComponentFieldValues = Record<
  string,
  BuilderComponentFieldValue
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

export const parseBuilderComponentFieldValue = (
  value: unknown
): BuilderComponentFieldValue | undefined => {
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

export const parseBuilderComponentFields = (
  value: unknown
): BuilderComponentField[] => {
  if (Array.isArray(value) === false) {
    return [];
  }
  const fields: BuilderComponentField[] = [];
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
    const field: BuilderComponentField = { id: item.id, name: item.name };
    if (typeof item.type === "string" && valueFieldTypes.has(item.type)) {
      field.type = item.type as BuilderComponentFieldType;
    }
    if (item.type === "choice") {
      field.choices = parseChoices(item.choices);
    }
    const defaultValue = parseBuilderComponentFieldValue(item.defaultValue);
    if (defaultValue !== undefined) {
      field.defaultValue = defaultValue;
    }
    fields.push(field);
    ids.add(field.id);
    names.add(field.name);
  }
  return fields;
};

export const parseBuilderComponentFieldValues = (
  value: unknown
): BuilderComponentFieldValues => {
  if (isRecord(value) === false) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, rawValue]) => {
      const fieldValue = parseBuilderComponentFieldValue(rawValue);
      return fieldValue === undefined ? [] : [[id, fieldValue]];
    })
  );
};

/** Resolve a single occurrence without mutating its persisted values. */
export const resolveBuilderComponentFields = async ({
  fields,
  values,
  evaluateExpression,
  resolvePage = () => undefined,
  resolveAsset = () => undefined,
}: {
  fields: readonly BuilderComponentField[];
  values: BuilderComponentFieldValues;
  evaluateExpression: (expression: string) => unknown | Promise<unknown>;
  resolvePage?: (value: BuilderComponentPageLink) => unknown;
  /** URL of an image asset, the same one a regular Image uses */
  resolveAsset?: (assetId: string) => unknown;
}): Promise<Record<string, unknown>> => {
  const entries: Array<[string, unknown]> = [];
  for (const field of fields) {
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

export type BuilderComponentFieldIssue = {
  type: "missing" | "type" | "choice";
  message: string;
};

const isJsonContainer = (value: unknown) =>
  typeof value === "object" && value !== null;

const matchesFieldType = (
  type: BuilderComponentFieldType,
  value: BuilderComponentFieldValue
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

const fieldTypeLabels: Record<BuilderComponentFieldType, string> = {
  text: "text",
  richText: "text",
  number: "a number",
  link: "a link",
  html: "HTML",
  boolean: "true or false",
  image: "an image",
  json: "an object or array",
  choice: "one of the choices",
};

/**
 * Why a copy's value cannot be used, if it cannot. Values are never removed
 * when a property changes; they stay and show this error until fixed.
 * Expressions are checked when they run, not here.
 */
export const getBuilderComponentFieldIssue = (
  field: BuilderComponentField,
  localValue: undefined | BuilderComponentFieldValue
): undefined | BuilderComponentFieldIssue => {
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
export const getBuilderComponentPageHref = ({
  value,
  pages,
  props,
}: {
  value: BuilderComponentPageLink;
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
  value: BuilderComponentFieldValue | undefined,
  resolve: (value: BuilderComponentPageLink) => string | undefined,
  resolveAsset: (assetId: string) => string | undefined
): BuilderComponentFieldValue | undefined => {
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
export const resolveBuilderComponentPageValues = ({
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
  const resolve = (value: BuilderComponentPageLink) =>
    getBuilderComponentPageHref({ value, pages, props: propsList });
  const resolveValues = (values: BuilderComponentFieldValues) =>
    Object.fromEntries(
      Object.entries(values).map(([id, fieldValue]) => [
        id,
        resolvePageValue(fieldValue, resolve, resolveAsset),
      ])
    );
  // copy the map only once a Builder component value needs resolving
  let resolved: undefined | DataSources;
  for (const dataSource of dataSources.values()) {
    if (dataSource.type !== "variable" || dataSource.value.type !== "json") {
      continue;
    }
    let value: object;
    if (dataSource.name === builderComponentSchemaVariable) {
      value = parseBuilderComponentFields(dataSource.value.value).map(
        (field) => {
          const defaultValue = resolvePageValue(
            field.defaultValue,
            resolve,
            resolveAsset
          );
          return defaultValue === undefined
            ? field
            : { ...field, defaultValue };
        }
      );
    } else if (dataSource.name === builderComponentValuesVariable) {
      value = resolveValues(
        parseBuilderComponentFieldValues(dataSource.value.value)
      );
    } else if (dataSource.name === builderComponentOverridesVariable) {
      value = Object.fromEntries(
        Object.entries(
          parseBuilderComponentOverrides(dataSource.value.value)
        ).map(([key, values]) => [key, resolveValues(values)])
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

/**
 * Attribute a copy carries with its choice values, so styles conditioned on
 * a value apply inside copies using it, e.g. `size: large`.
 */
export const builderComponentChoiceAttribute = "data-ws-props";

/** One value of a choice property inside the copy attribute. */
export const getBuilderComponentChoiceToken = (
  fieldId: string,
  value: string
) => `${fieldId}=${encodeURIComponent(value)}`;

/**
 * Style condition for an element inside the component that only applies when
 * its copy uses the value, e.g. `.button:is([data-ws-props~="id=large"] *)`.
 */
export const getBuilderComponentChoiceState = (
  fieldId: string,
  value: string
) =>
  `:is([${builderComponentChoiceAttribute}~="${getBuilderComponentChoiceToken(fieldId, value)}"] *)`;

const choiceStatePattern = new RegExp(
  `^(:is\\(\\[${builderComponentChoiceAttribute}~="(([A-Za-z0-9_-]+)=([^"\\s]*))"\\] \\*\\))(.*)$`
);

/**
 * Splits a choice condition combined with another state, like the hover of
 * `size: large` `:is([data-ws-props~="id=large"] *):hover`, into its parts.
 */
export const splitBuilderComponentChoiceState = (state: undefined | string) => {
  const match = state?.match(choiceStatePattern);
  if (match === null || match === undefined) {
    return;
  }
  let value = match[4];
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep the raw value of a hand written selector
  }
  return {
    choiceState: match[1],
    token: match[2],
    fieldId: match[3],
    value,
    state: match[5],
  };
};

/** Choice values a copy uses, joined for the choice attribute. */
export const getBuilderComponentChoiceAttribute = (
  fields: readonly BuilderComponentField[],
  values: BuilderComponentFieldValues
) => {
  const tokens: string[] = [];
  for (const field of fields) {
    if (field.type !== "choice") {
      continue;
    }
    const value = values[field.id] ?? field.defaultValue;
    if (
      value?.type === "literal" &&
      typeof value.value === "string" &&
      field.choices?.includes(value.value)
    ) {
      tokens.push(getBuilderComponentChoiceToken(field.id, value.value));
    }
  }
  return tokens.join(" ");
};

/**
 * Figma-like overrides: a value set on a nested copy while it is shown inside
 * a parent copy belongs to that parent copy only. The outermost copy stores
 * them by the path of nested copies, e.g. { "button": { label: ... } }.
 */
export const builderComponentOverridesVariable = "__builderComponentOverrides";

export type BuilderComponentOverrides = Record<
  string,
  BuilderComponentFieldValues
>;

export const parseBuilderComponentOverrides = (
  value: unknown
): BuilderComponentOverrides => {
  if (isRecord(value) === false) {
    return {};
  }
  const overrides: BuilderComponentOverrides = {};
  for (const [key, values] of Object.entries(value)) {
    if (isRecord(values)) {
      overrides[key] = parseBuilderComponentFieldValues(values);
    }
  }
  return overrides;
};

/**
 * Copies whose shared content the copy at the start of the selector is shown
 * in, innermost first. Empty for a copy placed directly on a page.
 */
export const getBuilderComponentEnclosingCopies = (
  instances: Instances,
  instanceSelector: readonly Instance["id"][]
) => {
  const copyIds: Instance["id"][] = [];
  for (let index = 2; index < instanceSelector.length; index += 1) {
    const copyId = instanceSelector[index];
    if (
      getBuilderComponentContentRootId(instances, copyId) ===
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
export const getBuilderComponentOverrideTarget = (
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
export const applyBuilderComponentOverrides = ({
  values,
  slotId,
  enclosingCopyIds,
  getOverrides,
}: {
  values: BuilderComponentFieldValues;
  slotId: Instance["id"];
  enclosingCopyIds: readonly Instance["id"][];
  getOverrides: (copyId: Instance["id"]) => BuilderComponentOverrides;
}): BuilderComponentFieldValues => {
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
export const getBuilderComponentCopyOverrides = (
  dataSources: DataSources,
  copyId: Instance["id"]
): BuilderComponentOverrides => {
  const dataSource = findBuilderComponentDataSource(
    dataSources,
    copyId,
    builderComponentOverridesVariable
  );
  return dataSource?.type === "variable" && dataSource.value.type === "json"
    ? parseBuilderComponentOverrides(dataSource.value.value)
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
export const getBuilderComponentCopy = ({
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
  const fragmentId = getBuilderComponentContentRootId(instances, slotId);
  const fragment = instances.get(fragmentId ?? "");
  const component =
    fragmentId === undefined
      ? undefined
      : findBuilderComponentDataSource(
          dataSources,
          fragmentId,
          builderComponentParameterVariable
        );
  if (fragment === undefined || component?.type !== "parameter") {
    return;
  }
  return {
    fragment,
    component,
    fields: parseBuilderComponentFields(
      readJsonVariable(
        findBuilderComponentDataSource(
          dataSources,
          fragment.id,
          builderComponentSchemaVariable
        )
      )
    ),
    values: applyBuilderComponentOverrides({
      values: parseBuilderComponentFieldValues(
        readJsonVariable(
          findBuilderComponentDataSource(
            dataSources,
            slotId,
            builderComponentValuesVariable
          )
        )
      ),
      slotId,
      enclosingCopyIds,
      getOverrides: (copyId) =>
        getBuilderComponentCopyOverrides(dataSources, copyId),
    }),
  };
};
