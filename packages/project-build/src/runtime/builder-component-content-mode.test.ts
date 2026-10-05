import { expect, test } from "vitest";
import {
  blockComponent,
  createBuilderComponentFragment,
  getBuilderComponentContentRootId,
  type WebstudioData,
} from "@webstudio-is/sdk";
import { applyBuilderPatchTransactions } from "../state/patch";
import type { BuilderState } from "../state/builder-state";
import type { BuilderRuntimeMutation } from "./mutation";
import { insertWebstudioFragmentCopy } from "./fragment";
import {
  applyContentModeTransaction,
  getContentModeCapabilities,
  getContentModeEditableInstanceIds,
} from "./content-mode-permissions";
import {
  createBuilderComponentField,
  setBuilderComponentFieldValue,
} from "./builder-component-fields";

const createIdFactory = () => {
  let index = 0;
  return () => `id-${index++}`;
};

const apply = (state: BuilderState, mutation: BuilderRuntimeMutation) =>
  applyBuilderPatchTransactions(state, [
    { id: "test", payload: mutation.payload },
  ]).state;

/**
 * A card copy inside a Content Block, which content editors can edit, and a
 * card copy outside of it, which they cannot.
 */
const createCards = () => {
  const createId = createIdFactory();
  const data: Omit<WebstudioData, "pages"> = {
    instances: new Map([
      [
        "body",
        {
          type: "instance",
          id: "body",
          component: "Body",
          children: [{ type: "id", value: "block" }],
        },
      ],
      [
        "block",
        {
          type: "instance",
          id: "block",
          component: blockComponent,
          children: [],
        },
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
  const insertCopy = (parentId: string) => {
    const fragment = createBuilderComponentFragment({ createId });
    const { newInstanceIds } = insertWebstudioFragmentCopy({
      data,
      fragment,
      availableVariables: [],
      projectId: "project",
      createId,
    });
    const id = newInstanceIds.get(fragment.children[0].value as string) ?? "";
    data.instances.get(parentId)?.children.push({ type: "id", value: id });
    return id;
  };
  const inBlock = insertCopy("block");
  const onPage = insertCopy("body");
  const fragmentId =
    getBuilderComponentContentRootId(data.instances, inBlock) ?? "";
  data.instances.get(fragmentId)?.children.push({ type: "id", value: "title" });
  data.instances.set("title", {
    type: "instance",
    id: "title",
    component: "ws:element",
    tag: "h2",
    children: [{ type: "text", value: "Title" }],
  });
  let state = data as BuilderState;
  const context = { createId };
  const addField = (
    input: Parameters<typeof createBuilderComponentField>[1]
  ) => {
    const mutation = createBuilderComponentField(state, input, context);
    state = apply(state, mutation);
    return mutation.result.fieldId;
  };
  const heading = addField({ fragmentId, name: "heading" });
  const code = addField({ fragmentId, name: "code", type: "html" });
  const variant = addField({
    fragmentId,
    name: "variant",
    type: "choice",
    choices: ["default", "reverse"],
  });
  return {
    state,
    context,
    inBlock,
    onPage,
    fragmentId,
    fields: { heading, code, variant },
  };
};

type Cards = ReturnType<typeof createCards>;

const getCapabilities = (state: BuilderState) =>
  getContentModeCapabilities({
    instances: state.instances ?? new Map(),
    metas: new Map(),
    props: state.props ?? new Map(),
    styleSources: state.styleSources ?? new Map(),
    dataSources: state.dataSources,
  });

/** Sends a Builder mutation through the content editor checks. */
const asContentEditor = (
  state: BuilderState,
  mutation: BuilderRuntimeMutation
) =>
  applyContentModeTransaction({
    capabilities: getCapabilities(state),
    transaction: { id: "content-editor", payload: mutation.payload },
  });

const setValue = (
  cards: Cards,
  input: Parameters<typeof setBuilderComponentFieldValue>[1]
) => setBuilderComponentFieldValue(cards.state, input, cards.context);

test("content editors fill in text values of a copy in editable content", () => {
  const cards = createCards();
  const result = asContentEditor(
    cards.state,
    setValue(cards, {
      slotId: cards.inBlock,
      fieldId: cards.fields.heading,
      value: { type: "literal", value: "Pricing" },
    })
  );
  expect(result.success).toBe(true);
  // and can go back to the shared default
  const reset = asContentEditor(
    apply(
      cards.state,
      setValue(cards, {
        slotId: cards.inBlock,
        fieldId: cards.fields.heading,
        value: { type: "literal", value: "Pricing" },
      })
    ),
    setValue(cards, {
      slotId: cards.inBlock,
      fieldId: cards.fields.heading,
      value: null,
    })
  );
  expect(reset.success).toBe(true);
});

test("content editors pick one of the existing choices", () => {
  const cards = createCards();
  expect(
    asContentEditor(
      cards.state,
      setValue(cards, {
        slotId: cards.inBlock,
        fieldId: cards.fields.variant,
        value: { type: "literal", value: "reverse" },
      })
    ).success
  ).toBe(true);
  expect(
    asContentEditor(
      cards.state,
      setValue(cards, {
        slotId: cards.inBlock,
        fieldId: cards.fields.variant,
        value: { type: "literal", value: "made-up" },
      })
    ).success
  ).toBe(false);
});

test("HTML Embed code and data bindings stay with designers", () => {
  const cards = createCards();
  expect(
    asContentEditor(
      cards.state,
      setValue(cards, {
        slotId: cards.inBlock,
        fieldId: cards.fields.code,
        value: { type: "literal", value: "<b>hi</b>" },
      })
    ).success
  ).toBe(false);
  expect(
    asContentEditor(
      cards.state,
      setValue(cards, {
        slotId: cards.inBlock,
        fieldId: cards.fields.heading,
        value: { type: "expression", value: "1 + 1" },
      })
    ).success
  ).toBe(false);
});

test("a value bound to data by a designer cannot be replaced", () => {
  const cards = createCards();
  const bound = apply(
    cards.state,
    setValue(cards, {
      slotId: cards.inBlock,
      fieldId: cards.fields.heading,
      value: { type: "expression", value: `"from data"` },
    })
  );
  expect(
    asContentEditor(
      bound,
      setBuilderComponentFieldValue(
        bound,
        {
          slotId: cards.inBlock,
          fieldId: cards.fields.heading,
          value: { type: "literal", value: "typed" },
        },
        cards.context
      )
    ).success
  ).toBe(false);
});

test("content editors cannot change properties or copies outside content", () => {
  const cards = createCards();
  expect(
    asContentEditor(
      cards.state,
      createBuilderComponentField(
        cards.state,
        { fragmentId: cards.fragmentId, name: "extra" },
        cards.context
      )
    ).success
  ).toBe(false);
  expect(
    asContentEditor(
      cards.state,
      setValue(cards, {
        slotId: cards.onPage,
        fieldId: cards.fields.heading,
        value: { type: "literal", value: "Pricing" },
      })
    )
  ).toEqual({
    success: false,
    error: "This copy is not editable in content mode.",
  });
});

test("the shared design inside a copy is not content-editable", () => {
  const cards = createCards();
  const editable = getContentModeEditableInstanceIds({
    instances: cards.state.instances ?? new Map(),
  });
  expect(editable.has(cards.inBlock)).toBe(true);
  expect(editable.has(cards.fragmentId)).toBe(false);
  expect(editable.has("title")).toBe(false);
});
