import { expect, test } from "vitest";
import { showAttribute, textContentAttribute } from "@webstudio-is/react-sdk";
import {
  ROOT_INSTANCE_ID,
  customSlotComponentVariable,
  encodeDataVariableId,
  findCustomSlotDataSource,
  type WebstudioData,
} from "@webstudio-is/sdk";
import { applyBuilderPatchTransactions } from "../state/patch";
import type { BuilderState } from "../state/builder-state";
import type { BuilderRuntimeMutation } from "./mutation";
import { getCustomSlotProperties } from "./custom-slot-fields";
import { createComponentFromInstance } from "./custom-slot-create";
import { exposeCustomSlotProperties } from "./custom-slot-expose";

const createIdFactory = () => {
  let index = 0;
  return () => `id-${index++}`;
};

const apply = (state: BuilderState, mutation: BuilderRuntimeMutation) =>
  applyBuilderPatchTransactions(state, [
    { id: "test", payload: mutation.payload },
  ]).state;

/** A card component holding a heading and a link. */
const createCard = () => {
  const data: Pick<
    WebstudioData,
    "instances" | "props" | "dataSources" | "resources"
  > = {
    instances: new Map([
      [
        "body",
        {
          type: "instance",
          id: "body",
          component: "Body",
          children: [{ type: "id", value: "card" }],
        },
      ],
      [
        "card",
        {
          type: "instance",
          id: "card",
          component: "Box",
          children: [
            { type: "id", value: "heading" },
            { type: "id", value: "link" },
          ],
        },
      ],
      [
        "heading",
        {
          type: "instance",
          id: "heading",
          component: "Heading",
          children: [{ type: "text", value: "Title" }],
        },
      ],
      [
        "link",
        {
          type: "instance",
          id: "link",
          component: "Link",
          children: [{ type: "text", value: "More" }],
        },
      ],
    ]),
    props: new Map([
      [
        "href",
        {
          id: "href",
          instanceId: "link",
          name: "href",
          type: "string",
          value: "https://example.com",
        },
      ],
    ]),
    dataSources: new Map([
      [
        "brand",
        {
          type: "variable",
          id: "brand",
          scopeInstanceId: ROOT_INSTANCE_ID,
          name: "brand",
          value: { type: "string", value: "Acme" },
        },
      ],
    ]),
    resources: new Map(),
  };
  const context = { createId: createIdFactory() };
  const created = createComponentFromInstance(
    data as BuilderState,
    { instanceSelector: ["card", "body"] },
    context
  );
  const state = apply(data as BuilderState, created);
  const { fragmentId } = created.result;
  const [copyId] = created.result.instanceSelector;
  const component = findCustomSlotDataSource(
    state.dataSources ?? new Map(),
    fragmentId,
    customSlotComponentVariable
  );
  return {
    state,
    context,
    fragmentId,
    copyId,
    componentRef: encodeDataVariableId(component?.id ?? ""),
  };
};

const readProperties = (state: BuilderState, copyId: string) =>
  getCustomSlotProperties({
    instances: state.instances ?? new Map(),
    dataSources: state.dataSources ?? new Map(),
    slotId: copyId,
  })?.properties;

test("exposes text and settings with their current values as defaults", () => {
  const card = createCard();
  const mutation = exposeCustomSlotProperties(
    card.state,
    {
      fragmentId: card.fragmentId,
      instanceId: "link",
      properties: [
        { propName: textContentAttribute, name: "label" },
        { propName: "href", name: "url" },
        { propName: showAttribute, name: "showLink" },
        { propName: "target", name: "target", type: "text" },
      ],
    },
    card.context
  );
  const state = apply(card.state, mutation);
  expect(readProperties(state, card.copyId)?.map(({ field }) => field)).toEqual(
    [
      {
        id: expect.any(String),
        name: "label",
        type: "text",
        defaultValue: { type: "literal", value: "More" },
      },
      {
        id: expect.any(String),
        name: "url",
        type: "link",
        defaultValue: { type: "literal", value: "https://example.com" },
      },
      {
        id: expect.any(String),
        name: "showLink",
        type: "boolean",
        defaultValue: { type: "literal", value: true },
      },
      // no value yet: required
      { id: expect.any(String), name: "target", type: "text" },
    ]
  );
  expect(state.instances?.get("link")?.children).toEqual([
    { type: "expression", value: `${card.componentRef}.label` },
  ]);
  expect(state.props?.get("href")).toEqual({
    id: "href",
    instanceId: "link",
    name: "href",
    type: "expression",
    value: `${card.componentRef}.url`,
  });
});

test("data a setting was bound to moves to every copy", () => {
  const card = createCard();
  const brand = encodeDataVariableId("brand");
  const state: BuilderState = {
    ...card.state,
    instances: new Map(card.state.instances).set("heading", {
      type: "instance",
      id: "heading",
      component: "Heading",
      children: [{ type: "expression", value: brand }],
    }),
  };
  const next = apply(
    state,
    exposeCustomSlotProperties(
      state,
      {
        fragmentId: card.fragmentId,
        instanceId: "heading",
        properties: [{ propName: textContentAttribute, name: "title" }],
      },
      card.context
    )
  );
  expect(readProperties(next, card.copyId)).toEqual([
    {
      field: { id: expect.any(String), name: "title", type: "text" },
      localValue: { type: "expression", value: brand },
    },
  ]);
});

test("refuses settings bound to data from inside the component", () => {
  const card = createCard();
  const state: BuilderState = {
    ...card.state,
    dataSources: new Map(card.state.dataSources).set("inner", {
      type: "variable",
      id: "inner",
      scopeInstanceId: "card",
      name: "inner",
      value: { type: "string", value: "x" },
    }),
    props: new Map(card.state.props).set("href", {
      id: "href",
      instanceId: "link",
      name: "href",
      type: "expression",
      value: encodeDataVariableId("inner"),
    }),
  };
  expect(() =>
    exposeCustomSlotProperties(
      state,
      {
        fragmentId: card.fragmentId,
        instanceId: "link",
        properties: [{ propName: "href", name: "url" }],
      },
      card.context
    )
  ).toThrow("uses data from inside the component");
});
