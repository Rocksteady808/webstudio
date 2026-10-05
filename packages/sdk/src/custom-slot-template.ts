import type { Instance } from "./schema/instances";
import type { WebstudioFragment } from "./schema/webstudio";
import {
  customSlotComponent,
  customSlotComponentVariable,
  customSlotSchemaVariable,
  customSlotValuesVariable,
} from "./custom-slot";
import type {
  CustomSlotField,
  CustomSlotFieldValues,
} from "./custom-slot-fields";

/**
 * Creates a new Custom Slot with its own shared Fragment.
 *
 * Every id is generated, so independently inserted Custom Slots never share a
 * Fragment. Copies of an occurrence keep the Fragment id and therefore share
 * structure while keeping their own values.
 */
export const createCustomSlotFragment = ({
  createId,
}: {
  createId: () => string;
}): WebstudioFragment => {
  const slotId = createId();
  const rootId = createId();
  const componentId = createId();
  // starts empty like a Slot: users build the content and add properties
  const fields: CustomSlotField[] = [];
  const values: CustomSlotFieldValues = {};
  const instances: Instance[] = [
    {
      type: "instance",
      id: slotId,
      component: customSlotComponent,
      children: [{ type: "id", value: rootId }],
    },
    {
      type: "instance",
      id: rootId,
      component: "Fragment",
      children: [],
    },
  ];
  return {
    children: [{ type: "id", value: slotId }],
    instances,
    dataSources: [
      {
        type: "parameter",
        id: componentId,
        scopeInstanceId: rootId,
        name: customSlotComponentVariable,
      },
      {
        type: "variable",
        id: createId(),
        scopeInstanceId: rootId,
        name: customSlotSchemaVariable,
        value: { type: "json", value: fields },
      },
      {
        type: "variable",
        id: createId(),
        scopeInstanceId: slotId,
        name: customSlotValuesVariable,
        value: { type: "json", value: values },
      },
    ],
    props: [],
    assets: [],
    resources: [],
    breakpoints: [],
    styleSourceSelections: [],
    styleSources: [],
    styles: [],
  };
};
