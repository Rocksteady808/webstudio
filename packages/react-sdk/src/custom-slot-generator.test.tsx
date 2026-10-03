import { expect, test } from "vitest";
import {
  createScope,
  customSlotComponent,
  customSlotComponentVariable,
  customSlotSchemaVariable,
  customSlotValuesVariable,
  encodeDataSourceVariable,
  type DataSources,
  type Instances,
} from "@webstudio-is/sdk";
import { generateWebstudioComponent } from "./component-generator";

test("published JSX keeps local values across shared Card structure edits", () => {
  const componentVariable = encodeDataSourceVariable("component-parameter");
  const instances: Instances = new Map();
  instances.set("body", {
    type: "instance",
    id: "body",
    component: "Body",
    children: [
      { type: "id", value: "card-a" },
      { type: "id", value: "card-b" },
      { type: "id", value: "card-c" },
      { type: "id", value: "card-d" },
    ],
  });
  instances.set("card-source", {
    type: "instance",
    id: "card-source",
    component: "Fragment",
    children: [
      { type: "id", value: "image" },
      { type: "id", value: "heading" },
      { type: "id", value: "description" },
      { type: "id", value: "button" },
    ],
  });
  for (const id of ["image", "heading", "description", "button"]) {
    instances.set(id, {
      type: "instance",
      id,
      component: "div",
      children: [{ type: "expression", value: `${componentVariable}.${id}` }],
    });
  }
  for (const id of ["card-a", "card-b", "card-c", "card-d"]) {
    instances.set(id, {
      type: "instance",
      id,
      component: customSlotComponent,
      children: [{ type: "id", value: "card-source" }],
    });
  }
  const dataSources: DataSources = new Map();
  dataSources.set("component-parameter", {
    type: "parameter",
    id: "component-parameter",
    scopeInstanceId: "card-source",
    name: customSlotComponentVariable,
  });
  dataSources.set("schema", {
    type: "variable",
    id: "schema",
    scopeInstanceId: "card-source",
    name: customSlotSchemaVariable,
    value: {
      type: "json",
      value: ["image", "heading", "description", "button"].map((name) => ({
        id: name,
        name,
      })),
    },
  });
  for (const [index, id] of [
    "card-a",
    "card-b",
    "card-c",
    "card-d",
  ].entries()) {
    dataSources.set(`values-${id}`, {
      type: "variable",
      id: `values-${id}`,
      scopeInstanceId: id,
      name: customSlotValuesVariable,
      value: {
        type: "json",
        value: Object.fromEntries(
          ["image", "heading", "description", "button"].map((name) => [
            name,
            { type: "literal", value: `${name}-${index}` },
          ])
        ),
      },
    });
  }
  const generate = () =>
    generateWebstudioComponent({
      scope: createScope(),
      name: "Page",
      rootInstanceId: "body",
      parameters: [],
      instances,
      props: new Map(),
      resources: new Map(),
      dataSources,
      metas: new Map(),
      classesMap: new Map(),
    });
  const before = generate();
  for (let index = 0; index < 4; index += 1) {
    expect(before).toContain(`heading-${index}`);
    expect(before).toContain(`image-${index}`);
  }
  instances.set("category", {
    type: "instance",
    id: "category",
    component: "div",
    children: [{ type: "expression", value: `${componentVariable}.category` }],
  });
  instances.get("card-source")!.children.splice(1, 0, {
    type: "id",
    value: "category",
  });
  dataSources.set("schema", {
    ...dataSources.get("schema")!,
    type: "variable",
    value: {
      type: "json",
      value: ["image", "category", "heading", "description", "button"].map(
        (name) => ({
          id: name,
          name,
          defaultValue:
            name === "category"
              ? { type: "literal", value: "Featured" }
              : undefined,
        })
      ),
    },
  });
  const after = generate();
  expect(after.match(/"category": "Featured"/g)).toHaveLength(4);
  for (let index = 0; index < 4; index += 1) {
    expect(after).toContain(`heading-${index}`);
    expect(after).toContain(`image-${index}`);
  }
});
