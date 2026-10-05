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

test("published copies carry the variant they use", () => {
  const instances: Instances = new Map([
    [
      "body",
      {
        type: "instance",
        id: "body",
        component: "Body",
        children: [
          { type: "id", value: "small-button" },
          { type: "id", value: "default-button" },
        ],
      },
    ],
    [
      "source",
      {
        type: "instance",
        id: "source",
        component: "Fragment",
        children: [{ type: "id", value: "label" }],
      },
    ],
    [
      "label",
      {
        type: "instance",
        id: "label",
        component: "div",
        children: [{ type: "text", value: "Button" }],
      },
    ],
  ]);
  for (const id of ["small-button", "default-button"]) {
    instances.set(id, {
      type: "instance",
      id,
      component: customSlotComponent,
      children: [{ type: "id", value: "source" }],
    });
  }
  const dataSources: DataSources = new Map([
    [
      "component-parameter",
      {
        type: "parameter",
        id: "component-parameter",
        scopeInstanceId: "source",
        name: customSlotComponentVariable,
      },
    ],
    [
      "schema",
      {
        type: "variable",
        id: "schema",
        scopeInstanceId: "source",
        name: customSlotSchemaVariable,
        value: {
          type: "json",
          value: [
            {
              id: "size",
              name: "size",
              type: "variant",
              options: [
                { id: "small", name: "Small" },
                { id: "large", name: "Large" },
              ],
              defaultValue: { type: "literal", value: "large" },
            },
          ],
        },
      },
    ],
    [
      "values-small",
      {
        type: "variable",
        id: "values-small",
        scopeInstanceId: "small-button",
        name: customSlotValuesVariable,
        value: {
          type: "json",
          value: { size: { type: "literal", value: "small" } },
        },
      },
    ],
  ]);
  const generated = generateWebstudioComponent({
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
  expect(generated).toContain(`data-ws-variant={"small"}`);
  // the other copy falls back to the default option
  expect(generated).toContain(`data-ws-variant={"large"}`);
});

test("published nested copies read values from their parent copy", () => {
  const cardComponent = encodeDataSourceVariable("card-component");
  const buttonComponent = encodeDataSourceVariable("button-component");
  const instances: Instances = new Map();
  instances.set("body", {
    type: "instance",
    id: "body",
    component: "Body",
    children: [
      { type: "id", value: "card-a" },
      { type: "id", value: "card-b" },
    ],
  });
  for (const id of ["card-a", "card-b"]) {
    instances.set(id, {
      type: "instance",
      id,
      component: customSlotComponent,
      children: [{ type: "id", value: "card-fragment" }],
    });
  }
  instances.set("card-fragment", {
    type: "instance",
    id: "card-fragment",
    component: "Fragment",
    children: [{ type: "id", value: "nested-button" }],
  });
  instances.set("nested-button", {
    type: "instance",
    id: "nested-button",
    component: customSlotComponent,
    children: [{ type: "id", value: "button-fragment" }],
  });
  instances.set("button-fragment", {
    type: "instance",
    id: "button-fragment",
    component: "Fragment",
    children: [{ type: "id", value: "label" }],
  });
  instances.set("label", {
    type: "instance",
    id: "label",
    component: "div",
    children: [{ type: "expression", value: `${buttonComponent}.label` }],
  });
  const dataSources: DataSources = new Map();
  dataSources.set("card-component", {
    type: "parameter",
    id: "card-component",
    scopeInstanceId: "card-fragment",
    name: customSlotComponentVariable,
  });
  dataSources.set("card-schema", {
    type: "variable",
    id: "card-schema",
    scopeInstanceId: "card-fragment",
    name: customSlotSchemaVariable,
    value: {
      type: "json",
      value: [{ id: "button-label", name: "buttonLabel" }],
    },
  });
  for (const [id, label] of [
    ["card-a", "Read more"],
    ["card-b", "Buy now"],
  ]) {
    dataSources.set(`values-${id}`, {
      type: "variable",
      id: `values-${id}`,
      scopeInstanceId: id,
      name: customSlotValuesVariable,
      value: {
        type: "json",
        value: { "button-label": { type: "literal", value: label } },
      },
    });
  }
  dataSources.set("button-component", {
    type: "parameter",
    id: "button-component",
    scopeInstanceId: "button-fragment",
    name: customSlotComponentVariable,
  });
  dataSources.set("button-schema", {
    type: "variable",
    id: "button-schema",
    scopeInstanceId: "button-fragment",
    name: customSlotSchemaVariable,
    value: { type: "json", value: [{ id: "label", name: "label" }] },
  });
  dataSources.set("button-values", {
    type: "variable",
    id: "button-values",
    scopeInstanceId: "nested-button",
    name: customSlotValuesVariable,
    value: {
      type: "json",
      value: {
        label: { type: "expression", value: `${cardComponent}.buttonLabel` },
      },
    },
  });
  const generated = generateWebstudioComponent({
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
  expect(generated).toContain(`"Read more"`);
  expect(generated).toContain(`"Buy now"`);
  // the nested label reads the card's value, inside each card's own scope
  expect(
    generated.match(/\{"label": component\?\.buttonLabel\}/g)
  ).toHaveLength(2);
});

test("published overrides change only the parent copy that set them", () => {
  const buttonComponent = encodeDataSourceVariable("button-component");
  const instances: Instances = new Map();
  instances.set("body", {
    type: "instance",
    id: "body",
    component: "Body",
    children: [
      { type: "id", value: "card-a" },
      { type: "id", value: "card-b" },
    ],
  });
  for (const id of ["card-a", "card-b"]) {
    instances.set(id, {
      type: "instance",
      id,
      component: customSlotComponent,
      children: [{ type: "id", value: "card-fragment" }],
    });
  }
  instances.set("card-fragment", {
    type: "instance",
    id: "card-fragment",
    component: "Fragment",
    children: [{ type: "id", value: "nested-button" }],
  });
  instances.set("nested-button", {
    type: "instance",
    id: "nested-button",
    component: customSlotComponent,
    children: [{ type: "id", value: "button-fragment" }],
  });
  instances.set("button-fragment", {
    type: "instance",
    id: "button-fragment",
    component: "Fragment",
    children: [{ type: "id", value: "label" }],
  });
  instances.set("label", {
    type: "instance",
    id: "label",
    component: "div",
    children: [{ type: "expression", value: `${buttonComponent}.label` }],
  });
  const dataSources: DataSources = new Map();
  dataSources.set("card-component", {
    type: "parameter",
    id: "card-component",
    scopeInstanceId: "card-fragment",
    name: customSlotComponentVariable,
  });
  dataSources.set("button-component", {
    type: "parameter",
    id: "button-component",
    scopeInstanceId: "button-fragment",
    name: customSlotComponentVariable,
  });
  dataSources.set("button-schema", {
    type: "variable",
    id: "button-schema",
    scopeInstanceId: "button-fragment",
    name: customSlotSchemaVariable,
    value: { type: "json", value: [{ id: "label", name: "label" }] },
  });
  dataSources.set("button-values", {
    type: "variable",
    id: "button-values",
    scopeInstanceId: "nested-button",
    name: customSlotValuesVariable,
    value: {
      type: "json",
      value: { label: { type: "literal", value: "Shared" } },
    },
  });
  dataSources.set("card-a-overrides", {
    type: "variable",
    id: "card-a-overrides",
    scopeInstanceId: "card-a",
    name: "__customSlotOverrides",
    value: {
      type: "json",
      value: {
        "nested-button": { label: { type: "literal", value: "Read more" } },
      },
    },
  });
  const generated = generateWebstudioComponent({
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
  const cardA = generated.indexOf(`{"label": "Read more"}`);
  const cardB = generated.indexOf(`{"label": "Shared"}`);
  expect(cardA).toBeGreaterThan(-1);
  expect(cardB).toBeGreaterThan(cardA);
  expect(generated.match(/"Read more"/g)).toHaveLength(1);
});

test("published copies render as their chosen tag", () => {
  const instances: Instances = new Map();
  instances.set("list", {
    type: "instance",
    id: "list",
    component: "ws:element",
    tag: "ul",
    children: [{ type: "id", value: "item" }],
  });
  instances.set("item", {
    type: "instance",
    id: "item",
    component: customSlotComponent,
    tag: "li",
    children: [{ type: "id", value: "source" }],
  });
  instances.set("source", {
    type: "instance",
    id: "source",
    component: "Fragment",
    children: [{ type: "text", value: "Item" }],
  });
  const dataSources: DataSources = new Map();
  dataSources.set("component-parameter", {
    type: "parameter",
    id: "component-parameter",
    scopeInstanceId: "source",
    name: customSlotComponentVariable,
  });
  const generated = generateWebstudioComponent({
    scope: createScope(),
    name: "Page",
    rootInstanceId: "list",
    parameters: [],
    instances,
    props: new Map(),
    resources: new Map(),
    dataSources,
    metas: new Map(),
    classesMap: new Map(),
  });
  expect(generated).toContain("<li");
  expect(generated).toContain("</li>");
  expect(generated).not.toContain("data-ws-tag");
  expect(generated).not.toMatch(/<div[\s>]/);
});
