import type { Instance } from "./schema/instances";
import type { WebstudioFragment } from "./schema/webstudio";
import {
  builderComponent,
  builderComponentParameterVariable,
  builderComponentSchemaVariable,
  builderComponentValuesVariable,
} from "./builder-component";
import type {
  BuilderComponentField,
  BuilderComponentFieldValues,
} from "./builder-component-fields";

/**
 * Creates a new Builder component with its own shared Fragment.
 *
 * Every id is generated, so independently inserted Builder components never share a
 * Fragment. Copies of an occurrence keep the Fragment id and therefore share
 * structure while keeping their own values.
 */
export const createBuilderComponentFragment = ({
  createId,
}: {
  createId: () => string;
}): WebstudioFragment => {
  const slotId = createId();
  const rootId = createId();
  const componentId = createId();
  // starts empty like a Slot: users build the content and add properties
  const fields: BuilderComponentField[] = [];
  const values: BuilderComponentFieldValues = {};
  const instances: Instance[] = [
    {
      type: "instance",
      id: slotId,
      component: builderComponent,
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
        name: builderComponentParameterVariable,
      },
      {
        type: "variable",
        id: createId(),
        scopeInstanceId: rootId,
        name: builderComponentSchemaVariable,
        value: { type: "json", value: fields },
      },
      {
        type: "variable",
        id: createId(),
        scopeInstanceId: slotId,
        name: builderComponentValuesVariable,
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
