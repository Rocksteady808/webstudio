import { expect, test } from "vitest";
import {
  createBuilderComponentFragment,
  builderComponentParameterVariable,
  builderComponentOverridesVariable,
  builderComponentSchemaVariable,
  builderComponentValuesVariable,
  encodeDataVariableId,
  findBuilderComponentDataSource,
  getBuilderComponentContentRootId,
  getBuilderComponentChoiceState,
  getStyleDeclKey,
  parseBuilderComponentFields,
  type Instance,
  type WebstudioData,
} from "@webstudio-is/sdk";
import { applyBuilderPatchTransactions } from "../state/patch";
import type { BuilderState } from "../state/builder-state";
import type { BuilderRuntimeMutation } from "./mutation";
import { insertWebstudioFragmentCopy } from "./fragment";
import { duplicateInstanceAfterItselfMutable } from "./instance-duplicate";
import { styleUpdateInput } from "./styles";
import {
  createBuilderComponentField,
  deleteBuilderComponentField,
  findBrokenBuilderComponentReferences,
  findBuilderComponentConnection,
  getBuilderComponentProperties,
  getBuilderComponentChoiceStates,
  getBuilderComponentActiveChoiceState,
  setBuilderComponentFieldValue,
  toBuilderComponentFieldName,
  updateBuilderComponentField,
} from "./builder-component-fields";

const createIdFactory = () => {
  let index = 0;
  return () => `id-${index++}`;
};

/** Two copies of one Builder component whose Fragment holds a link button. */
const createCards = () => {
  const createId = createIdFactory();
  const data: Omit<WebstudioData, "pages"> = {
    instances: new Map([
      [
        "body",
        { type: "instance", id: "body", component: "Body", children: [] },
      ],
    ]),
    props: new Map(),
    dataSources: new Map(),
    resources: new Map(),
    styleSources: new Map(),
    styleSourceSelections: new Map(),
    styles: new Map(),
    breakpoints: new Map(),
    assets: new Map(),
  };
  const fragment = createBuilderComponentFragment({ createId });
  const { newInstanceIds } = insertWebstudioFragmentCopy({
    data,
    fragment,
    availableVariables: [],
    projectId: "project",
    createId,
  });
  const first = newInstanceIds.get(fragment.children[0].value as string) ?? "";
  data.instances.get("body")?.children.push({ type: "id", value: first });
  const second =
    duplicateInstanceAfterItselfMutable({
      data,
      sourceInstanceId: first,
      parentInstanceId: "body",
      projectId: "project",
      createId,
    }) ?? "";
  const fragmentId =
    getBuilderComponentContentRootId(data.instances, first) ?? "";
  // replace the default heading with a link button
  data.instances.set(fragmentId, {
    type: "instance",
    id: fragmentId,
    component: "Fragment",
    children: [{ type: "id", value: "button" }],
  });
  data.instances.set("button", {
    type: "instance",
    id: "button",
    component: "ws:element",
    tag: "a",
    children: [{ type: "text", value: "Button" }],
  });
  data.props.set("href", {
    id: "href",
    instanceId: "button",
    name: "href",
    type: "string",
    value: "https://flexflow.com/",
  });
  const component = findBuilderComponentDataSource(
    data.dataSources,
    fragmentId,
    builderComponentParameterVariable
  );
  return {
    state: data as BuilderState,
    first,
    second,
    fragmentId,
    componentRef: encodeDataVariableId(component?.id ?? ""),
    context: { createId },
  };
};

const apply = (state: BuilderState, mutation: BuilderRuntimeMutation) =>
  applyBuilderPatchTransactions(state, [
    { id: "test", payload: mutation.payload },
  ]).state;

const getFields = (state: BuilderState, fragmentId: string) => {
  const schema = findBuilderComponentDataSource(
    state.dataSources ?? new Map(),
    fragmentId,
    builderComponentSchemaVariable
  );
  return parseBuilderComponentFields(
    schema?.type === "variable" ? schema.value.value : undefined
  );
};

const getValues = (state: BuilderState, slotId: string) => {
  const values = findBuilderComponentDataSource(
    state.dataSources ?? new Map(),
    slotId,
    builderComponentValuesVariable
  );
  return values?.type === "variable" ? values.value.value : undefined;
};

test("turns property labels into bindable names", () => {
  expect(toBuilderComponentFieldName("Button Link")).toEqual("buttonLink");
  expect(toBuilderComponentFieldName("  url ")).toEqual("url");
  expect(toBuilderComponentFieldName("2nd label")).toEqual("_2ndLabel");
});

test("gives two copies of a link button their own link and label", () => {
  const cards = createCards();
  let state = cards.state;

  const link = createBuilderComponentField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "link",
      defaultValue: { type: "literal", value: "https://flexflow.com/" },
    },
    cards.context
  );
  expect(link.result.expression).toEqual(`${cards.componentRef}.link`);
  state = apply(state, link);

  const label = createBuilderComponentField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "label",
      defaultValue: { type: "literal", value: "Button" },
    },
    cards.context
  );
  state = apply(state, label);
  expect(getFields(state, cards.fragmentId).map((field) => field.name)).toEqual(
    ["link", "label"]
  );

  state = apply(
    state,
    setBuilderComponentFieldValue(
      state,
      {
        slotId: cards.first,
        fieldId: link.result.fieldId,
        value: { type: "literal", value: "https://one.com" },
      },
      cards.context
    )
  );
  state = apply(
    state,
    setBuilderComponentFieldValue(
      state,
      {
        slotId: cards.second,
        fieldId: link.result.fieldId,
        value: { type: "literal", value: "https://two.com" },
      },
      cards.context
    )
  );
  expect(getValues(state, cards.first)).toEqual({
    [link.result.fieldId]: { type: "literal", value: "https://one.com" },
  });
  expect(getValues(state, cards.second)).toEqual({
    [link.result.fieldId]: { type: "literal", value: "https://two.com" },
  });

  // reset the second copy to the default
  state = apply(
    state,
    setBuilderComponentFieldValue(
      state,
      { slotId: cards.second, fieldId: link.result.fieldId, value: null },
      cards.context
    )
  );
  expect(getValues(state, cards.second)).toEqual({});
  expect(getValues(state, cards.first)).toEqual({
    [link.result.fieldId]: { type: "literal", value: "https://one.com" },
  });
});

test("rejects duplicate and invalid property names", () => {
  const cards = createCards();
  const state = apply(
    cards.state,
    createBuilderComponentField(
      cards.state,
      { fragmentId: cards.fragmentId, name: "link" },
      cards.context
    )
  );
  expect(() =>
    createBuilderComponentField(
      state,
      { fragmentId: cards.fragmentId, name: "link" },
      cards.context
    )
  ).toThrow('Property "link" already exists');
});

test("renaming a property keeps connected settings working", () => {
  const cards = createCards();
  let state = cards.state;
  const link = createBuilderComponentField(
    state,
    { fragmentId: cards.fragmentId, name: "link" },
    cards.context
  );
  state = apply(state, link);
  // connect the button href and text to properties
  state = {
    ...state,
    props: new Map(state.props).set("href", {
      id: "href",
      instanceId: "button",
      name: "href",
      type: "expression",
      value: `${cards.componentRef}.link`,
    }),
  };
  state = {
    ...state,
    instances: new Map(state.instances).set("button", {
      type: "instance",
      id: "button",
      component: "ws:element",
      tag: "a",
      children: [
        { type: "expression", value: `${cards.componentRef}.linkText` },
      ],
    }),
  };

  state = apply(
    state,
    updateBuilderComponentField(state, {
      fragmentId: cards.fragmentId,
      fieldId: link.result.fieldId,
      name: "url",
    })
  );
  expect(state.props?.get("href")).toEqual(
    expect.objectContaining({ value: `${cards.componentRef}.url` })
  );
  // a different property that only shares a prefix is untouched
  expect(state.instances?.get("button")?.children).toEqual([
    { type: "expression", value: `${cards.componentRef}.linkText` },
  ]);
});

test("deleting a property keeps copy values and reports connected settings", () => {
  const cards = createCards();
  let state = cards.state;
  const link = createBuilderComponentField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "link",
      defaultValue: { type: "literal", value: "https://flexflow.com/" },
    },
    cards.context
  );
  state = apply(state, link);
  state = {
    ...state,
    props: new Map(state.props).set("href", {
      id: "href",
      instanceId: "button",
      name: "href",
      type: "expression",
      value: `${cards.componentRef}.link`,
    }),
  };
  state = apply(
    state,
    setBuilderComponentFieldValue(
      state,
      {
        slotId: cards.first,
        fieldId: link.result.fieldId,
        value: { type: "literal", value: "https://one.com" },
      },
      cards.context
    )
  );

  state = apply(
    state,
    deleteBuilderComponentField(state, {
      fragmentId: cards.fragmentId,
      fieldId: link.result.fieldId,
    })
  );
  expect(getFields(state, cards.fragmentId).map((field) => field.name)).toEqual(
    []
  );
  // the setting keeps pointing at the property and shows an error
  expect(state.props?.get("href")).toMatchObject({
    type: "expression",
    value: `${cards.componentRef}.link`,
  });
  expect(
    findBrokenBuilderComponentReferences({
      instances: state.instances ?? new Map(),
      props: state.props ?? new Map(),
      dataSources: state.dataSources ?? new Map(),
      fragmentId: cards.fragmentId,
    })
  ).toEqual([{ instanceId: "button", propName: "href", name: "link" }]);
  // copies keep their values
  expect(getValues(state, cards.first)).toEqual({
    [link.result.fieldId]: { type: "literal", value: "https://one.com" },
  });
});

test("reads properties for a selected copy and connections for elements", () => {
  const cards = createCards();
  let state = cards.state;
  const link = createBuilderComponentField(
    state,
    { fragmentId: cards.fragmentId, name: "link" },
    cards.context
  );
  state = apply(state, link);
  state = apply(
    state,
    setBuilderComponentFieldValue(
      state,
      {
        slotId: cards.first,
        fieldId: link.result.fieldId,
        value: { type: "literal", value: "https://one.com" },
      },
      cards.context
    )
  );
  const data = state as Pick<WebstudioData, "instances" | "dataSources">;

  const first = getBuilderComponentProperties({ ...data, slotId: cards.first });
  expect(first?.fragmentId).toEqual(cards.fragmentId);
  expect(
    first?.properties.map(({ field, localValue }) => [field.name, localValue])
  ).toEqual([["link", { type: "literal", value: "https://one.com" }]]);
  expect(
    getBuilderComponentProperties({ ...data, slotId: cards.second })
      ?.properties[0].localValue
  ).toBeUndefined();

  const componentId = findBuilderComponentDataSource(
    data.dataSources,
    cards.fragmentId,
    builderComponentParameterVariable
  )?.id;
  const connection = findBuilderComponentConnection({
    dataSources: data.dataSources,
    availableDataSourceIds: ["unrelated", componentId ?? ""],
  });
  expect(connection?.fragmentId).toEqual(cards.fragmentId);
  expect(connection?.fields.map((field) => field.name)).toEqual(["link"]);
  expect(connection?.getExpression("link")).toEqual(
    `${cards.componentRef}.link`
  );
  expect(
    findBuilderComponentConnection({
      dataSources: data.dataSources,
      availableDataSourceIds: ["unrelated"],
    })
  ).toBeUndefined();
});

test("stores link properties with page values", () => {
  const cards = createCards();
  let state = cards.state;
  const link = createBuilderComponentField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "link",
      type: "link",
      defaultValue: { type: "page", value: "home" },
    },
    cards.context
  );
  state = apply(state, link);
  expect(getFields(state, cards.fragmentId)[0]).toEqual({
    id: link.result.fieldId,
    name: "link",
    type: "link",
    defaultValue: { type: "page", value: "home" },
  });
  state = apply(
    state,
    setBuilderComponentFieldValue(
      state,
      {
        slotId: cards.first,
        fieldId: link.result.fieldId,
        value: { type: "page", value: { pageId: "about", instanceId: "faq" } },
      },
      cards.context
    )
  );
  expect(getValues(state, cards.first)).toEqual({
    [link.result.fieldId]: {
      type: "page",
      value: { pageId: "about", instanceId: "faq" },
    },
  });
});

test("elements inside a component offer its choice values as conditions", () => {
  const cards = createCards();
  const size = createBuilderComponentField(
    cards.state,
    {
      fragmentId: cards.fragmentId,
      name: "buttonSize",
      type: "choice",
      choices: ["small", "large"],
    },
    cards.context
  );
  const state = apply(cards.state, size) as Pick<
    WebstudioData,
    "instances" | "dataSources"
  >;
  const { fieldId } = size.result;
  expect(
    getBuilderComponentChoiceStates({
      ...state,
      instanceSelector: ["button", cards.fragmentId, cards.first, "body"],
    })
  ).toEqual([
    {
      label: "buttonSize: small",
      selector: getBuilderComponentChoiceState(fieldId, "small"),
    },
    {
      label: "buttonSize: large",
      selector: getBuilderComponentChoiceState(fieldId, "large"),
    },
  ]);
  // the copy itself and elements outside the component have none
  expect(
    getBuilderComponentChoiceStates({
      ...state,
      instanceSelector: [cards.first, "body"],
    })
  ).toEqual([]);
});

test("choice conditions pass Webstudio style validation", () => {
  expect(
    styleUpdateInput.safeParse({
      instanceId: "button",
      property: "backgroundColor",
      value: { type: "keyword", value: "red" },
      state: getBuilderComponentChoiceState("size-id", "extra large"),
    }).success
  ).toBe(true);
});

test("styling inside a copy edits the choice value that copy uses", () => {
  const cards = createCards();
  let state = cards.state;
  const size = createBuilderComponentField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "size",
      type: "choice",
      choices: ["small", "large"],
      defaultValue: { type: "literal", value: "small" },
    },
    cards.context
  );
  state = apply(state, size);
  state = apply(
    state,
    setBuilderComponentFieldValue(
      state,
      {
        slotId: cards.first,
        fieldId: size.result.fieldId,
        value: { type: "literal", value: "large" },
      },
      cards.context
    )
  );
  const data = state as Pick<WebstudioData, "instances" | "dataSources">;
  expect(
    getBuilderComponentActiveChoiceState({
      ...data,
      instanceSelector: ["button", cards.fragmentId, cards.first, "body"],
    })
  ).toEqual(getBuilderComponentChoiceState(size.result.fieldId, "large"));
  // a copy using the default edits the base styles
  expect(
    getBuilderComponentActiveChoiceState({
      ...data,
      instanceSelector: ["button", cards.fragmentId, cards.second, "body"],
    })
  ).toBeUndefined();
  // selecting the copy itself is not inside the component
  expect(
    getBuilderComponentActiveChoiceState({
      ...data,
      instanceSelector: [cards.first, "body"],
    })
  ).toBeUndefined();
});

test("a property can be created with a known id", () => {
  const cards = createCards();
  const field = createBuilderComponentField(
    cards.state,
    { fragmentId: cards.fragmentId, fieldId: "chosen-id", name: "variant" },
    cards.context
  );
  expect(field.result.fieldId).toEqual("chosen-id");
});

test("boolean properties store real booleans per copy", () => {
  const cards = createCards();
  let state = cards.state;
  const showIcon = createBuilderComponentField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "showIcon",
      type: "boolean",
      defaultValue: { type: "literal", value: true },
    },
    cards.context
  );
  state = apply(state, showIcon);
  state = apply(
    state,
    setBuilderComponentFieldValue(
      state,
      {
        slotId: cards.second,
        fieldId: showIcon.result.fieldId,
        value: { type: "literal", value: false },
      },
      cards.context
    )
  );
  expect(getValues(state, cards.second)).toEqual({
    [showIcon.result.fieldId]: { type: "literal", value: false },
  });
});

test("a nested copy connects to its parent component, not to itself", () => {
  const cards = createCards();
  const data = cards.state as Pick<WebstudioData, "instances" | "dataSources">;
  const outerComponentId = findBuilderComponentDataSource(
    data.dataSources,
    cards.fragmentId,
    builderComponentParameterVariable
  )?.id;
  // a nested component's own parameter is also in scope of its copy
  const innerDataSources = new Map(data.dataSources)
    .set("inner-component", {
      type: "parameter",
      id: "inner-component",
      scopeInstanceId: "inner-fragment",
      name: builderComponentParameterVariable,
    })
    .set("inner-schema", {
      type: "variable",
      id: "inner-schema",
      scopeInstanceId: "inner-fragment",
      name: builderComponentSchemaVariable,
      value: { type: "json", value: [] },
    });
  expect(
    findBuilderComponentConnection({
      dataSources: innerDataSources,
      availableDataSourceIds: ["inner-component", outerComponentId ?? ""],
      excludeFragmentId: "inner-fragment",
    })?.fragmentId
  ).toEqual(cards.fragmentId);
  expect(
    findBuilderComponentConnection({
      dataSources: innerDataSources,
      availableDataSourceIds: ["inner-component"],
      excludeFragmentId: "inner-fragment",
    })
  ).toBeUndefined();
});

test("edits to a nested copy are saved as overrides on its parent copy", () => {
  const cards = createCards();
  let state = cards.state;
  const label = createBuilderComponentField(
    state,
    { fragmentId: cards.fragmentId, name: "label" },
    cards.context
  );
  state = apply(state, label);
  // cards.first stands in for a nested button shown inside "card-a"
  state = {
    ...state,
    instances: new Map(state.instances).set("card-a", {
      type: "instance",
      id: "card-a",
      component: "ws:builderComponent",
      children: [],
    }),
  };
  state = apply(
    state,
    setBuilderComponentFieldValue(
      state,
      {
        slotId: cards.first,
        fieldId: label.result.fieldId,
        value: { type: "literal", value: "Read more" },
        override: { ownerSlotId: "card-a", key: cards.first },
      },
      cards.context
    )
  );
  // the nested copy's shared values are untouched
  expect(getValues(state, cards.first)).toEqual({});
  const overrides = findBuilderComponentDataSource(
    state.dataSources ?? new Map(),
    "card-a",
    "__builderComponentOverrides"
  );
  expect(overrides?.type === "variable" && overrides.value.value).toEqual({
    [cards.first]: {
      [label.result.fieldId]: { type: "literal", value: "Read more" },
    },
  });
  // resetting removes the override
  state = apply(
    state,
    setBuilderComponentFieldValue(
      state,
      {
        slotId: cards.first,
        fieldId: label.result.fieldId,
        value: null,
        override: { ownerSlotId: "card-a", key: cards.first },
      },
      cards.context
    )
  );
  const cleared = findBuilderComponentDataSource(
    state.dataSources ?? new Map(),
    "card-a",
    "__builderComponentOverrides"
  );
  expect(cleared?.type === "variable" && cleared.value.value).toEqual({});
});

test("styling inside a nested copy edits the value its parent copy picked", () => {
  const cards = createCards();
  let state = cards.state;
  const style = createBuilderComponentField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "style",
      type: "choice",
      choices: ["filled", "outline"],
      defaultValue: { type: "literal", value: "filled" },
    },
    cards.context
  );
  state = apply(state, style);
  // cards.first is a nested button shown inside "card-a" > "card-fragment"
  state = {
    ...state,
    instances: new Map(state.instances)
      .set("card-a", {
        type: "instance",
        id: "card-a",
        component: "ws:builderComponent",
        children: [{ type: "id", value: "card-fragment" }],
      })
      .set("card-fragment", {
        type: "instance",
        id: "card-fragment",
        component: "Fragment",
        children: [{ type: "id", value: cards.first }],
      }),
  };
  state = apply(
    state,
    setBuilderComponentFieldValue(
      state,
      {
        slotId: cards.first,
        fieldId: style.result.fieldId,
        value: { type: "literal", value: "outline" },
        override: { ownerSlotId: "card-a", key: cards.first },
      },
      cards.context
    )
  );
  const data = state as Pick<WebstudioData, "instances" | "dataSources">;
  expect(
    getBuilderComponentActiveChoiceState({
      ...data,
      instanceSelector: [
        "button",
        cards.fragmentId,
        cards.first,
        "card-fragment",
        "card-a",
        "body",
      ],
    })
  ).toEqual(getBuilderComponentChoiceState(style.result.fieldId, "outline"));
});

test("HTML Embed property values are validated like an HTML Embed", () => {
  const cards = createCards();
  let state = cards.state;
  const icon = createBuilderComponentField(
    state,
    { fragmentId: cards.fragmentId, name: "icon", type: "html" },
    cards.context
  );
  state = apply(state, icon);
  const setIcon = (
    value: string,
    override?: { ownerSlotId: string; key: string }
  ) =>
    setBuilderComponentFieldValue(
      state,
      {
        slotId: cards.first,
        fieldId: icon.result.fieldId,
        value: { type: "literal", value },
        override,
      },
      cards.context
    );
  // valid HTML is saved
  expect(setIcon("<svg><path d='M0 0'/></svg>").payload.length).toBeGreaterThan(
    0
  );
  // broken HTML is rejected for a copy and for a parent override
  expect(() => setIcon("<div><span></div>")).toThrow(
    "Entered HTML has a validation error."
  );
  state = {
    ...state,
    instances: new Map(state.instances).set("card-a", {
      type: "instance",
      id: "card-a",
      component: "ws:builderComponent",
      children: [],
    }),
  };
  expect(() =>
    setIcon("<div><span></div>", { ownerSlotId: "card-a", key: cards.first })
  ).toThrow("Entered HTML has a validation error.");
  // defaults are validated too
  expect(() =>
    createBuilderComponentField(
      state,
      {
        fragmentId: cards.fragmentId,
        name: "badge",
        type: "html",
        defaultValue: { type: "literal", value: "<b>open" },
      },
      cards.context
    )
  ).toThrow("Entered HTML has a validation error.");
});

test("deleting a choice property removes the styles of its values", () => {
  const cards = createCards();
  let state: BuilderState = { ...cards.state, styles: new Map() };
  const size = createBuilderComponentField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "size",
      type: "choice",
      choices: ["small", "large"],
    },
    cards.context
  );
  state = apply(state, size);
  const styleDecl = (state: undefined | string) => ({
    styleSourceId: "button-local",
    breakpointId: "base",
    property: "fontSize" as const,
    value: { type: "unit" as const, unit: "px" as const, value: 20 },
    state,
  });
  const base = styleDecl(undefined);
  const large = styleDecl(
    `${getBuilderComponentChoiceState(size.result.fieldId, "large")}:hover`
  );
  state.styles = new Map([
    [getStyleDeclKey(base), base],
    [getStyleDeclKey(large), large],
  ]);
  // removing a choice keeps its styles, so adding it back restores them
  state = apply(
    state,
    updateBuilderComponentField(state, {
      fragmentId: cards.fragmentId,
      fieldId: size.result.fieldId,
      choices: ["small"],
    })
  );
  expect(state.styles?.size).toEqual(2);
  state = apply(
    state,
    deleteBuilderComponentField(state, {
      fragmentId: cards.fragmentId,
      fieldId: size.result.fieldId,
    })
  );
  expect(Array.from(state.styles?.values() ?? [])).toEqual([base]);
});

test("deleting a property keeps parent copy overrides", () => {
  const cards = createCards();
  let state: BuilderState = { ...cards.state, styles: new Map() };
  const label = createBuilderComponentField(
    state,
    { fragmentId: cards.fragmentId, name: "label" },
    cards.context
  );
  state = apply(state, label);
  // a parent copy overriding the label of the second copy
  state = { ...state, dataSources: new Map(state.dataSources) };
  state.dataSources?.set("parent-overrides", {
    type: "variable",
    id: "parent-overrides",
    scopeInstanceId: "parent-card",
    name: builderComponentOverridesVariable,
    value: {
      type: "json",
      value: {
        [cards.second]: {
          [label.result.fieldId]: { type: "literal", value: "Buy" },
        },
      },
    },
  });
  state = apply(
    state,
    deleteBuilderComponentField(state, {
      fragmentId: cards.fragmentId,
      fieldId: label.result.fieldId,
    })
  );
  const overrides = state.dataSources?.get("parent-overrides");
  expect(overrides?.type === "variable" && overrides.value.value).toEqual({
    [cards.second]: {
      [label.result.fieldId]: { type: "literal", value: "Buy" },
    },
  });
});

test("defaults are fixed values and names cannot reuse a component variable", () => {
  const cards = createCards();
  let state = cards.state;
  expect(() =>
    createBuilderComponentField(
      state,
      {
        fragmentId: cards.fragmentId,
        name: "title",
        defaultValue: { type: "expression", value: "1 + 1" },
      },
      cards.context
    )
  ).toThrow("A default must be a fixed value");
  state = { ...state, dataSources: new Map(state.dataSources) };
  state.dataSources?.set("count", {
    type: "variable",
    id: "count",
    scopeInstanceId: "button",
    name: "count",
    value: { type: "number", value: 0 },
  });
  expect(() =>
    createBuilderComponentField(
      state,
      { fragmentId: cards.fragmentId, name: "count" },
      cards.context
    )
  ).toThrow('A variable inside this component is already named "count"');
});

test("changing a type or removing a choice keeps copy values", () => {
  const cards = createCards();
  let state: BuilderState = { ...cards.state, styles: new Map() };
  const size = createBuilderComponentField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "size",
      type: "choice",
      choices: ["small", "large"],
      defaultValue: { type: "literal", value: "small" },
    },
    cards.context
  );
  state = apply(state, size);
  state = apply(
    state,
    setBuilderComponentFieldValue(
      state,
      {
        slotId: cards.first,
        fieldId: size.result.fieldId,
        value: { type: "literal", value: "large" },
      },
      cards.context
    )
  );
  state = apply(
    state,
    updateBuilderComponentField(state, {
      fragmentId: cards.fragmentId,
      fieldId: size.result.fieldId,
      choices: ["small"],
    })
  );
  expect(getFields(state, cards.fragmentId)[0]).toMatchObject({
    type: "choice",
    choices: ["small"],
  });
  expect(getValues(state, cards.first)).toEqual({
    [size.result.fieldId]: { type: "literal", value: "large" },
  });
  state = apply(
    state,
    updateBuilderComponentField(state, {
      fragmentId: cards.fragmentId,
      fieldId: size.result.fieldId,
      type: "number",
    })
  );
  expect(getValues(state, cards.first)).toEqual({
    [size.result.fieldId]: { type: "literal", value: "large" },
  });
});

test("renaming a property updates nested copies filled from it", () => {
  const cards = createCards();
  let state = cards.state;
  const title = createBuilderComponentField(
    state,
    { fragmentId: cards.fragmentId, name: "title" },
    cards.context
  );
  state = apply(state, title);
  // a nested copy inside the component filling its label from the title
  state = {
    ...state,
    instances: new Map(state.instances),
    dataSources: new Map(state.dataSources),
  };
  state.instances?.set("nested", {
    type: "instance",
    id: "nested",
    component: "ws:builderComponent",
    children: [],
  });
  state.instances?.set("button", {
    ...(state.instances?.get("button") as Instance),
    children: [{ type: "id", value: "nested" }],
  });
  state.dataSources?.set("nested-values", {
    type: "variable",
    id: "nested-values",
    scopeInstanceId: "nested",
    name: builderComponentValuesVariable,
    value: {
      type: "json",
      value: {
        label: { type: "expression", value: `${cards.componentRef}.title` },
      },
    },
  });
  state = apply(
    state,
    updateBuilderComponentField(
      { ...state, styles: new Map() },
      {
        fragmentId: cards.fragmentId,
        fieldId: title.result.fieldId,
        name: "heading",
      }
    )
  );
  const nested = state.dataSources?.get("nested-values");
  expect(nested?.type === "variable" && nested.value.value).toEqual({
    label: { type: "expression", value: `${cards.componentRef}.heading` },
  });
});
