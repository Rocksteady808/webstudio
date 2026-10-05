import { expect, test } from "vitest";
import {
  applyBuilderComponentOverrides,
  builderComponent,
  builderComponentParameterVariable,
  builderComponentOverridesVariable,
  builderComponentSchemaVariable,
  builderComponentValuesVariable,
  encodeDataVariableId,
  findBuilderComponentDataSource,
  getBuilderComponentContentRootId,
  getBuilderComponentCopyOverrides,
  getBuilderComponentEnclosingCopies,
  parseBuilderComponentFieldValues,
  type DataSource,
  type Instance,
  type WebstudioData,
} from "@webstudio-is/sdk";
import {
  extractWebstudioFragment,
  insertWebstudioFragmentCopy,
} from "./fragment";
import { insertPageCopyMutable } from "./page-copy";
import { insertFragment } from "./components";
import { applyBuilderPatchTransactions } from "../state/patch";

const createIdFactory = () => {
  let index = 0;
  return () => `new-${index++}`;
};

/**
 * Page "home": body > card (copy) > card-fragment > heading + nested-button
 * (copy) > button-fragment > label. The card has its own heading value and
 * overrides the nested button's label, like a Figma nested instance.
 */
const createProject = (): WebstudioData => {
  const cardComponent = encodeDataVariableId("card-component");
  const buttonComponent = encodeDataVariableId("button-component");
  const instances: Instance[] = [
    {
      type: "instance",
      id: "home-body",
      component: "Body",
      children: [{ type: "id", value: "card" }],
    },
    {
      type: "instance",
      id: "about-body",
      component: "Body",
      children: [],
    },
    {
      type: "instance",
      id: "card",
      component: builderComponent,
      tag: "article",
      children: [{ type: "id", value: "card-fragment" }],
    },
    {
      type: "instance",
      id: "card-fragment",
      component: "Fragment",
      children: [
        { type: "id", value: "heading" },
        { type: "id", value: "nested-button" },
      ],
    },
    {
      type: "instance",
      id: "heading",
      component: "ws:element",
      tag: "h2",
      children: [{ type: "expression", value: `${cardComponent}.heading` }],
    },
    {
      type: "instance",
      id: "nested-button",
      component: builderComponent,
      children: [{ type: "id", value: "button-fragment" }],
    },
    {
      type: "instance",
      id: "button-fragment",
      component: "Fragment",
      children: [{ type: "id", value: "label" }],
    },
    {
      type: "instance",
      id: "label",
      component: "ws:element",
      tag: "span",
      children: [{ type: "expression", value: `${buttonComponent}.label` }],
    },
  ];
  const dataSources: DataSource[] = [
    {
      type: "parameter",
      id: "card-component",
      scopeInstanceId: "card-fragment",
      name: builderComponentParameterVariable,
    },
    {
      type: "variable",
      id: "card-schema",
      scopeInstanceId: "card-fragment",
      name: builderComponentSchemaVariable,
      value: { type: "json", value: [{ id: "heading-id", name: "heading" }] },
    },
    {
      type: "variable",
      id: "card-values",
      scopeInstanceId: "card",
      name: builderComponentValuesVariable,
      value: {
        type: "json",
        value: { "heading-id": { type: "literal", value: "First card" } },
      },
    },
    {
      type: "variable",
      id: "card-overrides",
      scopeInstanceId: "card",
      name: builderComponentOverridesVariable,
      value: {
        type: "json",
        value: {
          "nested-button": {
            "label-id": { type: "literal", value: "Read more" },
          },
        },
      },
    },
    {
      type: "parameter",
      id: "button-component",
      scopeInstanceId: "button-fragment",
      name: builderComponentParameterVariable,
    },
    {
      type: "variable",
      id: "button-schema",
      scopeInstanceId: "button-fragment",
      name: builderComponentSchemaVariable,
      value: { type: "json", value: [{ id: "label-id", name: "label" }] },
    },
    {
      type: "variable",
      id: "button-values",
      scopeInstanceId: "nested-button",
      name: builderComponentValuesVariable,
      value: {
        type: "json",
        value: { "label-id": { type: "literal", value: "Shared" } },
      },
    },
  ];
  return {
    pages: {
      homePageId: "home",
      rootFolderId: "root",
      pages: new Map([
        [
          "home",
          {
            id: "home",
            name: "Home",
            path: "",
            title: "Home",
            rootInstanceId: "home-body",
            meta: {},
          },
        ],
        [
          "about",
          {
            id: "about",
            name: "About",
            path: "/about",
            title: "About",
            rootInstanceId: "about-body",
            meta: {},
          },
        ],
      ]),
      folders: new Map([
        [
          "root",
          { id: "root", name: "Root", slug: "", children: ["home", "about"] },
        ],
      ]),
    },
    instances: new Map(instances.map((instance) => [instance.id, instance])),
    dataSources: new Map(
      dataSources.map((dataSource) => [dataSource.id, dataSource])
    ),
    props: new Map(),
    resources: new Map(),
    styleSources: new Map(),
    styleSourceSelections: new Map(),
    styles: new Map(),
    breakpoints: new Map(),
    assets: new Map(),
  };
};

const createEmptyProject = (): WebstudioData => {
  const project = createProject();
  return {
    ...project,
    instances: new Map([
      [
        "other-body",
        {
          type: "instance",
          id: "other-body",
          component: "Body",
          children: [],
        },
      ],
    ]),
    dataSources: new Map(),
  };
};

/** Values a card shows, and the label its nested button shows inside it. */
const readCard = (data: WebstudioData, cardId: Instance["id"]) => {
  const values = findBuilderComponentDataSource(
    data.dataSources,
    cardId,
    builderComponentValuesVariable
  );
  const cardFragmentId = getBuilderComponentContentRootId(
    data.instances,
    cardId
  );
  const nestedButtonId = data.instances
    .get(cardFragmentId ?? "")
    ?.children.flatMap((child) =>
      child.type === "id" &&
      data.instances.get(child.value)?.component === builderComponent
        ? [child.value]
        : []
    )[0];
  const buttonValues = findBuilderComponentDataSource(
    data.dataSources,
    nestedButtonId ?? "",
    builderComponentValuesVariable
  );
  const label = applyBuilderComponentOverrides({
    values: parseBuilderComponentFieldValues(
      buttonValues?.type === "variable" ? buttonValues.value.value : undefined
    ),
    slotId: nestedButtonId ?? "",
    enclosingCopyIds: getBuilderComponentEnclosingCopies(data.instances, [
      nestedButtonId ?? "",
      cardFragmentId ?? "",
      cardId,
    ]),
    getOverrides: (copyId) =>
      getBuilderComponentCopyOverrides(data.dataSources, copyId),
  })["label-id"];
  return {
    tag: data.instances.get(cardId)?.tag,
    cardFragmentId,
    nestedButtonId,
    heading: parseBuilderComponentFieldValues(
      values?.type === "variable" ? values.value.value : undefined
    )["heading-id"],
    label,
  };
};

const pasteCard = (
  source: WebstudioData,
  target: WebstudioData,
  parentId: Instance["id"]
) => {
  const fragment = extractWebstudioFragment(source, "card");
  const { newInstanceIds } = insertWebstudioFragmentCopy({
    data: target,
    fragment,
    availableVariables: [],
    projectId: "project",
    createId: createIdFactory(),
  });
  const pastedId = newInstanceIds.get("card") ?? "";
  target.instances
    .get(parentId)
    ?.children.push({ type: "id", value: pastedId });
  return pastedId;
};

test("pasting a card on another page shares its design and keeps its values", () => {
  const data = createProject();
  const pasted = pasteCard(data, data, "about-body");
  expect(pasted).not.toEqual("card");

  const original = readCard(data, "card");
  const copy = readCard(data, pasted);
  // same shared design, so source edits reach both pages
  expect(copy.cardFragmentId).toEqual(original.cardFragmentId);
  expect(copy.nestedButtonId).toEqual(original.nestedButtonId);
  // the copy keeps its own values, tag and nested override
  expect(copy).toEqual({
    ...original,
    heading: { type: "literal", value: "First card" },
    label: { type: "literal", value: "Read more" },
  });
  // and they are its own data, not the original card's
  expect(
    findBuilderComponentDataSource(
      data.dataSources,
      pasted,
      builderComponentValuesVariable
    )?.id
  ).not.toEqual("card-values");
  expect(
    findBuilderComponentDataSource(
      data.dataSources,
      pasted,
      builderComponentOverridesVariable
    )?.id
  ).not.toEqual("card-overrides");
});

test("pasting a card into another project brings its whole design", () => {
  const source = createProject();
  const target = createEmptyProject();
  const pasted = pasteCard(source, target, "other-body");
  const copy = readCard(target, pasted);

  expect(copy.tag).toEqual("article");
  expect(copy.heading).toEqual({ type: "literal", value: "First card" });
  expect(copy.label).toEqual({ type: "literal", value: "Read more" });
  // the shared design, its properties and the nested button come along
  for (const [scope, name] of [
    ["card-fragment", builderComponentParameterVariable],
    ["card-fragment", builderComponentSchemaVariable],
    ["button-fragment", builderComponentParameterVariable],
    ["button-fragment", builderComponentSchemaVariable],
  ] as const) {
    expect(
      findBuilderComponentDataSource(target.dataSources, scope, name)
    ).toBeDefined();
  }
  // the heading still reads this card's component value
  expect(target.instances.get("heading")?.children).toEqual([
    {
      type: "expression",
      value: `${encodeDataVariableId("card-component")}.heading`,
    },
  ]);
});

test("duplicating a page keeps each card's values and shared design", () => {
  const data = createProject();
  const pageId = insertPageCopyMutable({
    source: { data, pageId: "home" },
    target: { data, folderId: "root" },
    projectId: "project",
    createId: createIdFactory(),
  });
  const page = data.pages.pages.get(pageId ?? "");
  expect(page).toBeDefined();
  const body = data.instances.get(page?.rootInstanceId ?? "");
  const copiedCardId =
    body?.children[0]?.type === "id" ? body.children[0].value : "";
  expect(copiedCardId).not.toEqual("card");
  expect(data.instances.get(copiedCardId)?.component).toEqual(builderComponent);
  const original = readCard(data, "card");
  const copy = readCard(data, copiedCardId);
  expect(copy.cardFragmentId).toEqual(original.cardFragmentId);
  expect(copy.heading).toEqual({ type: "literal", value: "First card" });
  expect(copy.label).toEqual({ type: "literal", value: "Read more" });
});

test("pasting through the Builder's paste operation keeps the card intact", () => {
  const data = createProject();
  // the clipboard carries the fragment as JSON
  const clipboard = JSON.parse(
    JSON.stringify(extractWebstudioFragment(data, "card"))
  );
  const mutation = insertFragment(
    data,
    { parentInstanceId: "about-body", fragment: clipboard },
    { createId: createIdFactory(), allowLegacyContentModelWarnings: true }
  );
  const after = applyBuilderPatchTransactions(data, [
    { id: "paste", payload: mutation.payload },
  ]).state as WebstudioData;
  const [pasted] = mutation.result.rootInstanceIds;
  expect(after.instances.get(pasted)?.component).toEqual(builderComponent);
  const copy = readCard(after, pasted);
  expect(copy.cardFragmentId).toEqual("card-fragment");
  expect(copy.heading).toEqual({ type: "literal", value: "First card" });
  expect(copy.label).toEqual({ type: "literal", value: "Read more" });
});

test("strict paste without legacy content warnings also accepts a card", () => {
  const data = createProject();
  const clipboard = JSON.parse(
    JSON.stringify(extractWebstudioFragment(data, "card"))
  );
  expect(() =>
    insertFragment(
      data,
      { parentInstanceId: "about-body", fragment: clipboard },
      { createId: createIdFactory() }
    )
  ).not.toThrow();
});
