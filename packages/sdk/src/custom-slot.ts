import type { Instance, Instances } from "./schema/instances";
import type { DataSource, DataSources } from "./schema/data-sources";

export const customSlotComponent = "ws:customSlot";
export const customSlotSchemaVariable = "__customSlotSchema";
export const customSlotValuesVariable = "__customSlotValues";
export const customSlotComponentVariable = "component";

/**
 * Tags a copy can render as, so it can be the list item, article or section
 * itself. Without a tag a copy adds no element, so turning elements into a
 * component keeps the page structure. Written into generated code, so only
 * known tags are allowed.
 */
export const customSlotTags = [
  "div",
  "article",
  "section",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "li",
  "figure",
  "span",
] as const;

export type CustomSlotTag = (typeof customSlotTags)[number];

/** undefined when the copy renders no element of its own */
export const getCustomSlotTag = (
  tag: undefined | string
): undefined | CustomSlotTag => customSlotTags.find((item) => item === tag);

export const defaultComponentName = "Component";

/** A component's name is the label of its shared Fragment. */
export const getComponentName = (
  instances: Instances,
  fragmentId: undefined | Instance["id"]
) => instances.get(fragmentId ?? "")?.label || defaultComponentName;

/** A Custom Slot occurrence points at one shared Fragment root. */
export const getCustomSlotContentRootId = (
  instances: Instances,
  slotId: Instance["id"]
): Instance["id"] | undefined => {
  const slot = instances.get(slotId);
  if (
    slot?.component !== customSlotComponent ||
    slot.children.length !== 1 ||
    slot.children[0]?.type !== "id"
  ) {
    return;
  }
  const rootId = slot.children[0].value;
  if (instances.get(rootId)?.component !== "Fragment") {
    return;
  }
  return rootId;
};

type DataSourceIndex = {
  size: number;
  ids: Map<string, DataSource["id"]>;
};

// one index per data sources map, so rendering many copies does not
// rescan every data source in the project for each copy
const dataSourceIndexes = new WeakMap<DataSources, DataSourceIndex>();

const getIndexKey = (
  scopeInstanceId: undefined | Instance["id"],
  name: DataSource["name"]
) => `${scopeInstanceId ?? ""}\u0000${name}`;

const buildDataSourceIndex = (dataSources: DataSources) => {
  const index: DataSourceIndex = { size: dataSources.size, ids: new Map() };
  for (const dataSource of dataSources.values()) {
    index.ids.set(
      getIndexKey(dataSource.scopeInstanceId, dataSource.name),
      dataSource.id
    );
  }
  dataSourceIndexes.set(dataSources, index);
  return index;
};

/**
 * Builder stores replace the data sources map on every change. Maps edited in
 * place (runtime drafts, tests) rebuild the index when their size changes or
 * when an indexed entry no longer matches.
 */
export const findCustomSlotDataSource = (
  dataSources: DataSources,
  scopeInstanceId: Instance["id"],
  name: DataSource["name"]
): DataSource | undefined => {
  const key = getIndexKey(scopeInstanceId, name);
  let index = dataSourceIndexes.get(dataSources);
  if (index === undefined || index.size !== dataSources.size) {
    index = buildDataSourceIndex(dataSources);
  }
  const id = index.ids.get(key);
  if (id === undefined) {
    return;
  }
  const dataSource = dataSources.get(id);
  if (
    dataSource?.scopeInstanceId === scopeInstanceId &&
    dataSource.name === name
  ) {
    return dataSource;
  }
  // the map changed in place without changing size
  const rebuiltId = buildDataSourceIndex(dataSources).ids.get(key);
  return rebuiltId === undefined ? undefined : dataSources.get(rebuiltId);
};
