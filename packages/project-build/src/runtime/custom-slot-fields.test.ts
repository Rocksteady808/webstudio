import { expect, test } from "vitest";
import {
  createCustomSlotFragment,
  customSlotComponentVariable,
  customSlotOverridesVariable,
  customSlotSchemaVariable,
  customSlotValuesVariable,
  encodeDataVariableId,
  findCustomSlotDataSource,
  getCustomSlotContentRootId,
  getCustomSlotVariantState,
  getStyleDeclKey,
  parseCustomSlotFields,
  type WebstudioData,
} from "@webstudio-is/sdk";
import { applyBuilderPatchTransactions } from "../state/patch";
import type { BuilderState } from "../state/builder-state";
import type { BuilderRuntimeMutation } from "./mutation";
import { insertWebstudioFragmentCopy } from "./fragment";
import { duplicateInstanceAfterItselfMutable } from "./instance-duplicate";
import { styleUpdateInput } from "./styles";
import {
  createCustomSlotField,
  deleteCustomSlotField,
  findCustomSlotConnection,
  getCustomSlotProperties,
  getCustomSlotVariantStates,
  getCustomSlotActiveVariantState,
  setCustomSlotFieldValue,
  toCustomSlotFieldName,
  updateCustomSlotField,
} from "./custom-slot-fields";

const createIdFactory = () => {
  let index = 0;
  return () => `id-${index++}`;
};

/** Two copies of one Custom Slot whose Fragment holds a link button. */
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
  const fragment = createCustomSlotFragment({ createId });
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
  const fragmentId = getCustomSlotContentRootId(data.instances, first) ?? "";
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
  const component = findCustomSlotDataSource(
    data.dataSources,
    fragmentId,
    customSlotComponentVariable
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
  const schema = findCustomSlotDataSource(
    state.dataSources ?? new Map(),
    fragmentId,
    customSlotSchemaVariable
  );
  return parseCustomSlotFields(
    schema?.type === "variable" ? schema.value.value : undefined
  );
};

const getValues = (state: BuilderState, slotId: string) => {
  const values = findCustomSlotDataSource(
    state.dataSources ?? new Map(),
    slotId,
    customSlotValuesVariable
  );
  return values?.type === "variable" ? values.value.value : undefined;
};

test("turns property labels into bindable names", () => {
  expect(toCustomSlotFieldName("Button Link")).toEqual("buttonLink");
  expect(toCustomSlotFieldName("  url ")).toEqual("url");
  expect(toCustomSlotFieldName("2nd label")).toEqual("_2ndLabel");
});

test("gives two copies of a link button their own link and label", () => {
  const cards = createCards();
  let state = cards.state;

  const link = createCustomSlotField(
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

  const label = createCustomSlotField(
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
    setCustomSlotFieldValue(
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
    setCustomSlotFieldValue(
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
    setCustomSlotFieldValue(
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
    createCustomSlotField(
      cards.state,
      { fragmentId: cards.fragmentId, name: "link" },
      cards.context
    )
  );
  expect(() =>
    createCustomSlotField(
      state,
      { fragmentId: cards.fragmentId, name: "link" },
      cards.context
    )
  ).toThrow('Property "link" already exists');
});

test("renaming a property keeps connected settings working", () => {
  const cards = createCards();
  let state = cards.state;
  const link = createCustomSlotField(
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
    updateCustomSlotField(state, {
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

test("deleting a property detaches settings and clears copy values", () => {
  const cards = createCards();
  let state = cards.state;
  const link = createCustomSlotField(
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
    setCustomSlotFieldValue(
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
    deleteCustomSlotField(state, {
      fragmentId: cards.fragmentId,
      fieldId: link.result.fieldId,
    })
  );
  expect(getFields(state, cards.fragmentId).map((field) => field.name)).toEqual(
    []
  );
  expect(state.props?.get("href")).toEqual({
    id: "href",
    instanceId: "button",
    name: "href",
    type: "string",
    value: "https://flexflow.com/",
  });
  expect(getValues(state, cards.first)).toEqual({});
});

test("reads properties for a selected copy and connections for elements", () => {
  const cards = createCards();
  let state = cards.state;
  const link = createCustomSlotField(
    state,
    { fragmentId: cards.fragmentId, name: "link" },
    cards.context
  );
  state = apply(state, link);
  state = apply(
    state,
    setCustomSlotFieldValue(
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

  const first = getCustomSlotProperties({ ...data, slotId: cards.first });
  expect(first?.fragmentId).toEqual(cards.fragmentId);
  expect(
    first?.properties.map(({ field, localValue }) => [field.name, localValue])
  ).toEqual([["link", { type: "literal", value: "https://one.com" }]]);
  expect(
    getCustomSlotProperties({ ...data, slotId: cards.second })?.properties[0]
      .localValue
  ).toBeUndefined();

  const componentId = findCustomSlotDataSource(
    data.dataSources,
    cards.fragmentId,
    customSlotComponentVariable
  )?.id;
  const connection = findCustomSlotConnection({
    dataSources: data.dataSources,
    availableDataSourceIds: ["unrelated", componentId ?? ""],
  });
  expect(connection?.fragmentId).toEqual(cards.fragmentId);
  expect(connection?.fields.map((field) => field.name)).toEqual(["link"]);
  expect(connection?.getExpression("link")).toEqual(
    `${cards.componentRef}.link`
  );
  expect(
    findCustomSlotConnection({
      dataSources: data.dataSources,
      availableDataSourceIds: ["unrelated"],
    })
  ).toBeUndefined();
});

test("stores link properties with page values", () => {
  const cards = createCards();
  let state = cards.state;
  const link = createCustomSlotField(
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
    setCustomSlotFieldValue(
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

  // deleting a page link property keeps the button linked to the page
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
    deleteCustomSlotField(state, {
      fragmentId: cards.fragmentId,
      fieldId: link.result.fieldId,
    })
  );
  expect(state.props?.get("href")).toEqual({
    id: "href",
    instanceId: "button",
    name: "href",
    type: "page",
    value: "home",
  });
});

test("variant properties keep their options and each copy picks one", () => {
  const cards = createCards();
  let state = cards.state;
  const size = createCustomSlotField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "size",
      type: "variant",
      options: [
        { id: "small", name: "Small" },
        { id: "large", name: "Large" },
      ],
      defaultValue: { type: "literal", value: "large" },
    },
    cards.context
  );
  state = apply(state, size);
  state = apply(
    state,
    updateCustomSlotField(state, {
      fragmentId: cards.fragmentId,
      fieldId: size.result.fieldId,
      options: [
        { id: "small", name: "Compact" },
        { id: "large", name: "Large" },
        { id: "huge", name: "Huge" },
      ],
    })
  );
  expect(getFields(state, cards.fragmentId)[0]).toEqual({
    id: size.result.fieldId,
    name: "size",
    type: "variant",
    options: [
      { id: "small", name: "Compact" },
      { id: "large", name: "Large" },
      { id: "huge", name: "Huge" },
    ],
    defaultValue: { type: "literal", value: "large" },
  });
  state = apply(
    state,
    setCustomSlotFieldValue(
      state,
      {
        slotId: cards.second,
        fieldId: size.result.fieldId,
        value: { type: "literal", value: "small" },
      },
      cards.context
    )
  );
  expect(getValues(state, cards.second)).toEqual({
    [size.result.fieldId]: { type: "literal", value: "small" },
  });
});

test("elements inside a component offer its variants as style states", () => {
  const cards = createCards();
  const size = createCustomSlotField(
    cards.state,
    {
      fragmentId: cards.fragmentId,
      name: "buttonSize",
      type: "variant",
      options: [
        { id: "small", name: "Small" },
        { id: "large", name: "Large" },
      ],
    },
    cards.context
  );
  const state = apply(cards.state, size) as Pick<
    WebstudioData,
    "instances" | "dataSources"
  >;
  expect(
    getCustomSlotVariantStates({
      ...state,
      instanceSelector: ["button", cards.fragmentId, cards.first, "body"],
    })
  ).toEqual([
    {
      label: "Button Size: Small",
      selector: ':is([data-ws-variant~="small"] *)',
    },
    {
      label: "Button Size: Large",
      selector: ':is([data-ws-variant~="large"] *)',
    },
  ]);
  // the copy itself and elements outside the component have none
  expect(
    getCustomSlotVariantStates({
      ...state,
      instanceSelector: [cards.first, "body"],
    })
  ).toEqual([]);
});

test("variant style states pass Webstudio style validation", () => {
  expect(
    styleUpdateInput.safeParse({
      instanceId: "button",
      property: "backgroundColor",
      value: { type: "keyword", value: "red" },
      state: ':is([data-ws-variant~="small"] *)',
    }).success
  ).toBe(true);
});

test("styling inside a copy edits the variant that copy uses", () => {
  const cards = createCards();
  let state = cards.state;
  const variant = createCustomSlotField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "variant",
      type: "variant",
      options: [{ id: "small", name: "Small" }],
    },
    cards.context
  );
  state = apply(state, variant);
  state = apply(
    state,
    setCustomSlotFieldValue(
      state,
      {
        slotId: cards.first,
        fieldId: variant.result.fieldId,
        value: { type: "literal", value: "small" },
      },
      cards.context
    )
  );
  const data = state as Pick<WebstudioData, "instances" | "dataSources">;
  expect(
    getCustomSlotActiveVariantState({
      ...data,
      instanceSelector: ["button", cards.fragmentId, cards.first, "body"],
    })
  ).toEqual(':is([data-ws-variant~="small"] *)');
  // a copy on the base design edits base styles
  expect(
    getCustomSlotActiveVariantState({
      ...data,
      instanceSelector: ["button", cards.fragmentId, cards.second, "body"],
    })
  ).toBeUndefined();
  // selecting the copy itself is not inside the component
  expect(
    getCustomSlotActiveVariantState({
      ...data,
      instanceSelector: [cards.first, "body"],
    })
  ).toBeUndefined();
});

test("a property can be created with a known id", () => {
  const cards = createCards();
  const field = createCustomSlotField(
    cards.state,
    { fragmentId: cards.fragmentId, fieldId: "chosen-id", name: "variant" },
    cards.context
  );
  expect(field.result.fieldId).toEqual("chosen-id");
});

test("boolean properties store real booleans per copy", () => {
  const cards = createCards();
  let state = cards.state;
  const showIcon = createCustomSlotField(
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
    setCustomSlotFieldValue(
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
  const outerComponentId = findCustomSlotDataSource(
    data.dataSources,
    cards.fragmentId,
    customSlotComponentVariable
  )?.id;
  // a nested component's own parameter is also in scope of its copy
  const innerDataSources = new Map(data.dataSources)
    .set("inner-component", {
      type: "parameter",
      id: "inner-component",
      scopeInstanceId: "inner-fragment",
      name: customSlotComponentVariable,
    })
    .set("inner-schema", {
      type: "variable",
      id: "inner-schema",
      scopeInstanceId: "inner-fragment",
      name: customSlotSchemaVariable,
      value: { type: "json", value: [] },
    });
  expect(
    findCustomSlotConnection({
      dataSources: innerDataSources,
      availableDataSourceIds: ["inner-component", outerComponentId ?? ""],
      excludeFragmentId: "inner-fragment",
    })?.fragmentId
  ).toEqual(cards.fragmentId);
  expect(
    findCustomSlotConnection({
      dataSources: innerDataSources,
      availableDataSourceIds: ["inner-component"],
      excludeFragmentId: "inner-fragment",
    })
  ).toBeUndefined();
});

test("edits to a nested copy are saved as overrides on its parent copy", () => {
  const cards = createCards();
  let state = cards.state;
  const label = createCustomSlotField(
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
      component: "ws:customSlot",
      children: [],
    }),
  };
  state = apply(
    state,
    setCustomSlotFieldValue(
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
  const overrides = findCustomSlotDataSource(
    state.dataSources ?? new Map(),
    "card-a",
    "__customSlotOverrides"
  );
  expect(overrides?.type === "variable" && overrides.value.value).toEqual({
    [cards.first]: {
      [label.result.fieldId]: { type: "literal", value: "Read more" },
    },
  });
  // resetting removes the override
  state = apply(
    state,
    setCustomSlotFieldValue(
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
  const cleared = findCustomSlotDataSource(
    state.dataSources ?? new Map(),
    "card-a",
    "__customSlotOverrides"
  );
  expect(cleared?.type === "variable" && cleared.value.value).toEqual({});
});

test("styling inside a nested copy edits the variant its parent copy picked", () => {
  const cards = createCards();
  let state = cards.state;
  const variant = createCustomSlotField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "variant",
      type: "variant",
      options: [{ id: "outline", name: "Outline" }],
    },
    cards.context
  );
  state = apply(state, variant);
  // cards.first is a nested button shown inside "card-a" > "card-fragment"
  state = {
    ...state,
    instances: new Map(state.instances)
      .set("card-a", {
        type: "instance",
        id: "card-a",
        component: "ws:customSlot",
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
    setCustomSlotFieldValue(
      state,
      {
        slotId: cards.first,
        fieldId: variant.result.fieldId,
        value: { type: "literal", value: "outline" },
        override: { ownerSlotId: "card-a", key: cards.first },
      },
      cards.context
    )
  );
  const data = state as Pick<WebstudioData, "instances" | "dataSources">;
  expect(
    getCustomSlotActiveVariantState({
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
  ).toEqual(':is([data-ws-variant~="outline"] *)');
});

test("HTML Embed property values are validated like an HTML Embed", () => {
  const cards = createCards();
  let state = cards.state;
  const icon = createCustomSlotField(
    state,
    { fragmentId: cards.fragmentId, name: "icon", type: "html" },
    cards.context
  );
  state = apply(state, icon);
  const setIcon = (
    value: string,
    override?: { ownerSlotId: string; key: string }
  ) =>
    setCustomSlotFieldValue(
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
      component: "ws:customSlot",
      children: [],
    }),
  };
  expect(() =>
    setIcon("<div><span></div>", { ownerSlotId: "card-a", key: cards.first })
  ).toThrow("Entered HTML has a validation error.");
  // defaults are validated too
  expect(() =>
    createCustomSlotField(
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

test("the base variant can be renamed and reset", () => {
  const cards = createCards();
  let state = cards.state;
  const variant = createCustomSlotField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "variant",
      type: "variant",
      options: [],
      baseName: "Primary",
    },
    cards.context
  );
  state = apply(state, variant);
  expect(getFields(state, cards.fragmentId)[0]?.baseName).toEqual("Primary");
  state = apply(
    state,
    updateCustomSlotField(state, {
      fragmentId: cards.fragmentId,
      fieldId: variant.result.fieldId,
      baseName: "Default",
    })
  );
  expect(getFields(state, cards.fragmentId)[0]?.baseName).toEqual("Default");
  // an empty name goes back to "Base"
  state = apply(
    state,
    updateCustomSlotField(state, {
      fragmentId: cards.fragmentId,
      fieldId: variant.result.fieldId,
      baseName: "",
    })
  );
  expect(getFields(state, cards.fragmentId)[0]?.baseName).toBeUndefined();
});

test("deleting a variant removes its styles and resets copies using it", () => {
  const cards = createCards();
  let state: BuilderState = { ...cards.state, styles: new Map() };
  const variant = createCustomSlotField(
    state,
    {
      fragmentId: cards.fragmentId,
      name: "variant",
      type: "variant",
      options: [
        { id: "small", name: "Small" },
        { id: "large", name: "Large" },
      ],
    },
    cards.context
  );
  state = apply(state, variant);
  state = apply(
    state,
    setCustomSlotFieldValue(
      state,
      {
        slotId: cards.second,
        fieldId: variant.result.fieldId,
        value: { type: "literal", value: "large" },
      },
      cards.context
    )
  );
  const styleDecl = (state: string) => ({
    styleSourceId: "button-local",
    breakpointId: "base",
    property: "fontSize" as const,
    value: { type: "unit" as const, unit: "px" as const, value: 20 },
    state,
  });
  const small = styleDecl(getCustomSlotVariantState("small"));
  const large = styleDecl(getCustomSlotVariantState("large"));
  state.styles = new Map([
    [getStyleDeclKey(small), small],
    [getStyleDeclKey(large), large],
  ]);

  state = apply(
    state,
    updateCustomSlotField(state, {
      fragmentId: cards.fragmentId,
      fieldId: variant.result.fieldId,
      options: [{ id: "small", name: "Small" }],
    })
  );
  expect(Array.from(state.styles?.values() ?? [])).toEqual([small]);
  expect(getValues(state, cards.second)).toEqual({});
});

test("deleting a property clears it from parent copy overrides", () => {
  const cards = createCards();
  let state: BuilderState = { ...cards.state, styles: new Map() };
  const label = createCustomSlotField(
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
    name: customSlotOverridesVariable,
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
    deleteCustomSlotField(state, {
      fragmentId: cards.fragmentId,
      fieldId: label.result.fieldId,
    })
  );
  const overrides = state.dataSources?.get("parent-overrides");
  expect(overrides?.type === "variable" && overrides.value.value).toEqual({});
});
