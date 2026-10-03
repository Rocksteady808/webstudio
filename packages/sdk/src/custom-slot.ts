import type { Instance, Instances } from "./schema/instances";
import type { DataSource, DataSources } from "./schema/data-sources";

export const customSlotComponent = "ws:customSlot";
export const customSlotSchemaVariable = "__customSlotSchema";
export const customSlotValuesVariable = "__customSlotValues";
export const customSlotComponentVariable = "component";

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

export const findCustomSlotDataSource = (
  dataSources: DataSources,
  scopeInstanceId: Instance["id"],
  name: DataSource["name"]
): DataSource | undefined => {
  for (const dataSource of dataSources.values()) {
    if (
      dataSource.scopeInstanceId === scopeInstanceId &&
      dataSource.name === name
    ) {
      return dataSource;
    }
  }
};
