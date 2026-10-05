import { expect, test } from "vitest";
import {
  ROOT_INSTANCE_ID,
  builderComponent,
  builderComponentParameterVariable,
  builderComponentValuesVariable,
  encodeDataVariableId,
  findBuilderComponentDataSource,
  getBuilderComponentContentRootId,
  type WebstudioData,
} from "@webstudio-is/sdk";
import { applyBuilderPatchTransactions } from "../state/patch";
import type { BuilderState } from "../state/builder-state";
import type { BuilderRuntimeMutation } from "./mutation";
import { getBuilderComponentProperties } from "./builder-component-fields";
import { createComponentFromInstance } from "./builder-component-create";

const createIdFactory = () => {
  let index = 0;
  return () => `id-${index++}`;
};

const apply = (state: BuilderState, mutation: BuilderRuntimeMutation) =>
  applyBuilderPatchTransactions(state, [
    { id: "test", payload: mutation.payload },
  ]).state;

/** A page with a card between two other elements. */
const createPage = () => {
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
          children: [
            { type: "id", value: "before" },
            { type: "id", value: "card" },
            { type: "id", value: "after" },
          ],
        },
      ],
      [
        "before",
        { type: "instance", id: "before", component: "Box", children: [] },
      ],
      [
        "card",
        {
          type: "instance",
          id: "card",
          component: "Box",
          label: "Card",
          children: [{ type: "id", value: "heading" }],
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
        "after",
        { type: "instance", id: "after", component: "Box", children: [] },
      ],
    ]),
    props: new Map([
      [
        "heading-id",
        {
          id: "heading-id",
          instanceId: "heading",
          name: "id",
          type: "string",
          value: "title",
        },
      ],
    ]),
    dataSources: new Map(),
    resources: new Map(),
  };
  return {
    state: data as BuilderState,
    context: { createId: createIdFactory() },
  };
};

test("turns an element into a component and leaves a copy in its place", () => {
  const { state, context } = createPage();
  const mutation = createComponentFromInstance(
    state,
    { instanceSelector: ["card", "body"] },
    context
  );
  const next = apply(state, mutation);
  const { instanceSelector, fragmentId, name } = mutation.result;
  const [copyId] = instanceSelector;
  expect(name).toEqual("Card");
  expect(instanceSelector).toEqual([copyId, "body"]);
  // the copy sits exactly where the card was
  expect(next.instances?.get("body")?.children).toEqual([
    { type: "id", value: "before" },
    { type: "id", value: copyId },
    { type: "id", value: "after" },
  ]);
  expect(next.instances?.get(copyId)?.component).toEqual(builderComponent);
  expect(
    getBuilderComponentContentRootId(next.instances ?? new Map(), copyId)
  ).toEqual(fragmentId);
  // the card itself, its children and settings are kept unchanged
  expect(next.instances?.get(fragmentId)).toMatchObject({
    component: "Fragment",
    label: "Card",
    children: [{ type: "id", value: "card" }],
  });
  expect(next.instances?.get("card")).toEqual(state.instances?.get("card"));
  expect(next.props?.get("heading-id")).toEqual(state.props?.get("heading-id"));
  expect(
    getBuilderComponentProperties({
      instances: next.instances ?? new Map(),
      dataSources: next.dataSources ?? new Map(),
      slotId: copyId,
    })?.properties
  ).toEqual([]);
});

test("component names are unique", () => {
  const page = createPage();
  let state = apply(
    page.state,
    createComponentFromInstance(
      page.state,
      { instanceSelector: ["card", "body"] },
      page.context
    )
  );
  const second = createComponentFromInstance(
    state,
    { instanceSelector: ["after", "body"], name: "Card" },
    page.context
  );
  state = apply(state, second);
  expect(second.result.name).toEqual("Card 2");
});

test("variables from the page become properties the copy keeps filling", () => {
  const { state, context } = createPage();
  state.dataSources?.set("page-title", {
    type: "variable",
    id: "page-title",
    scopeInstanceId: "body",
    name: "Page Title",
    value: { type: "string", value: "Hello" },
  });
  state.dataSources?.set("global-brand", {
    type: "variable",
    id: "global-brand",
    scopeInstanceId: ROOT_INSTANCE_ID,
    name: "brand",
    value: { type: "string", value: "Acme" },
  });
  const pageTitle = encodeDataVariableId("page-title");
  const brand = encodeDataVariableId("global-brand");
  state.instances?.set("heading", {
    type: "instance",
    id: "heading",
    component: "Heading",
    children: [{ type: "expression", value: `${pageTitle} + ${brand}` }],
  });
  const mutation = createComponentFromInstance(
    state,
    { instanceSelector: ["card", "body"] },
    context
  );
  const next = apply(state, mutation);
  const [copyId] = mutation.result.instanceSelector;
  const component = findBuilderComponentDataSource(
    next.dataSources ?? new Map(),
    mutation.result.fragmentId,
    builderComponentParameterVariable
  );
  const componentRef = encodeDataVariableId(component?.id ?? "");
  // global variables stay, page variables are read through a property
  expect(next.instances?.get("heading")?.children).toEqual([
    { type: "expression", value: `${componentRef}.pageTitle + ${brand}` },
  ]);
  const properties = getBuilderComponentProperties({
    instances: next.instances ?? new Map(),
    dataSources: next.dataSources ?? new Map(),
    slotId: copyId,
  })?.properties;
  expect(properties).toEqual([
    {
      field: { id: expect.any(String), name: "pageTitle", type: "text" },
      localValue: { type: "expression", value: pageTitle },
    },
  ]);
  expect(
    findBuilderComponentDataSource(
      next.dataSources ?? new Map(),
      copyId,
      builderComponentValuesVariable
    )?.scopeInstanceId
  ).toEqual(copyId);
});

test("refuses actions that change a page variable", () => {
  const { state, context } = createPage();
  state.dataSources?.set("count", {
    type: "variable",
    id: "count",
    scopeInstanceId: "body",
    name: "count",
    value: { type: "number", value: 0 },
  });
  const count = encodeDataVariableId("count");
  state.props?.set("click", {
    id: "click",
    instanceId: "heading",
    name: "onClick",
    type: "action",
    value: [{ type: "execute", args: [], code: `${count} = ${count} + 1` }],
  });
  expect(() =>
    createComponentFromInstance(
      state,
      { instanceSelector: ["card", "body"] },
      context
    )
  ).toThrow('changes "count", which belongs to the page');
});

test("rejects a selector whose parent is wrong", () => {
  const { state, context } = createPage();
  expect(() =>
    createComponentFromInstance(
      state,
      { instanceSelector: ["heading", "body"] },
      context
    )
  ).toThrow("direct parent");
});
