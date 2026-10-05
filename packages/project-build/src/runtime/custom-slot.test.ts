import { expect, test } from "vitest";
import {
  customSlotComponent,
  customSlotValuesVariable,
  findCustomSlotDataSource,
  getCustomSlotContentRootId,
  type Instance,
  type WebstudioData,
} from "@webstudio-is/sdk";
import { createComponentTemplateFragment } from "./component-template";
import { insertWebstudioFragmentCopy } from "./fragment";
import { duplicateInstanceAfterItselfMutable } from "./instance-duplicate";
import { getSlotFragmentDropTargetMutable } from "./slot";
import { insertComponent } from "./components";
import { deleteInstances } from "./instances";
import { applyBuilderPatchTransactions } from "../state/patch";

const createData = (): Omit<WebstudioData, "pages"> => ({
  instances: new Map([
    ["body", { type: "instance", id: "body", component: "Body", children: [] }],
  ]),
  props: new Map(),
  dataSources: new Map(),
  resources: new Map(),
  styleSources: new Map(),
  styleSourceSelections: new Map(),
  styles: new Map(),
  breakpoints: new Map(),
  assets: new Map(),
});

const createIdFactory = () => {
  let index = 0;
  return () => `id-${index++}`;
};

const insertCustomSlot = (
  data: Omit<WebstudioData, "pages">,
  createId: () => string
) => {
  const fragment = createComponentTemplateFragment({
    component: customSlotComponent,
    templates: new Map(),
    createId,
  });
  const { newInstanceIds } = insertWebstudioFragmentCopy({
    data,
    fragment,
    availableVariables: [],
    projectId: "project",
    createId,
  });
  const [root] = fragment.children;
  const slotId = newInstanceIds.get(root.value as string) ?? "";
  data.instances.get("body")?.children.push({ type: "id", value: slotId });
  return slotId;
};

const setLocalHeading = (
  data: Omit<WebstudioData, "pages">,
  slotId: Instance["id"],
  fieldId: string,
  heading: string
) => {
  const values = findCustomSlotDataSource(
    data.dataSources,
    slotId,
    customSlotValuesVariable
  );
  if (values?.type !== "variable") {
    throw new Error("Custom Slot values are missing");
  }
  data.dataSources.set(values.id, {
    ...values,
    value: {
      type: "json",
      value: { [fieldId]: { type: "literal", value: heading } },
    },
  });
};

const getLocalValues = (
  data: Omit<WebstudioData, "pages">,
  slotId: Instance["id"]
) => {
  const values = findCustomSlotDataSource(
    data.dataSources,
    slotId,
    customSlotValuesVariable
  );
  return values?.type === "variable" ? values.value.value : undefined;
};

test("independently inserted Custom Slots get their own Fragment", () => {
  const data = createData();
  const createId = createIdFactory();
  const first = insertCustomSlot(data, createId);
  const second = insertCustomSlot(data, createId);

  const firstRoot = getCustomSlotContentRootId(data.instances, first);
  const secondRoot = getCustomSlotContentRootId(data.instances, second);
  expect(firstRoot).toBeDefined();
  expect(secondRoot).toBeDefined();
  expect(firstRoot).not.toEqual(secondRoot);
});

test("duplicated Custom Slot shares structure and keeps its own heading", () => {
  const data = createData();
  const createId = createIdFactory();
  const first = insertCustomSlot(data, createId);
  const second = duplicateInstanceAfterItselfMutable({
    data,
    sourceInstanceId: first,
    parentInstanceId: "body",
    projectId: "project",
    createId,
  });
  expect(second).toBeDefined();
  if (second === undefined) {
    return;
  }

  const rootId = getCustomSlotContentRootId(data.instances, first);
  expect(rootId).toBeDefined();
  expect(getCustomSlotContentRootId(data.instances, second)).toEqual(rootId);
  // the duplicate owns separate local values
  expect(
    findCustomSlotDataSource(data.dataSources, second, customSlotValuesVariable)
      ?.id
  ).not.toEqual(
    findCustomSlotDataSource(data.dataSources, first, customSlotValuesVariable)
      ?.id
  );

  setLocalHeading(data, first, "heading-field", "First card");
  setLocalHeading(data, second, "heading-field", "Second card");

  // shared source edit: add a description element to the shared Fragment
  const root = data.instances.get(rootId ?? "");
  data.instances.set("description", {
    type: "instance",
    id: "description",
    component: "ws:element",
    tag: "p",
    children: [{ type: "text", value: "Shared description" }],
  });
  root?.children.push({ type: "id", value: "description" });

  expect(data.instances.get(rootId ?? "")?.children).toHaveLength(1);
  expect(getCustomSlotContentRootId(data.instances, first)).toEqual(rootId);
  expect(getCustomSlotContentRootId(data.instances, second)).toEqual(rootId);
  expect(getLocalValues(data, first)).toEqual({
    "heading-field": { type: "literal", value: "First card" },
  });
  expect(getLocalValues(data, second)).toEqual({
    "heading-field": { type: "literal", value: "Second card" },
  });
});

test("drops into a Custom Slot target its shared Fragment", () => {
  const data = createData();
  const createId = createIdFactory();
  const slotId = insertCustomSlot(data, createId);
  const rootId = getCustomSlotContentRootId(data.instances, slotId);
  const instanceCount = data.instances.size;

  expect(
    getSlotFragmentDropTargetMutable(
      data.instances,
      { parentSelector: [slotId, "body"], position: "end" },
      createId
    )
  ).toEqual({ parentSelector: [rootId, slotId, "body"], position: "end" });
  // never creates or reuses a Fragment for a Custom Slot
  expect(data.instances.size).toEqual(instanceCount);
});

test("does not give a malformed Custom Slot another Fragment", () => {
  const data = createData();
  data.instances.set("broken", {
    type: "instance",
    id: "broken",
    component: customSlotComponent,
    children: [],
  });
  expect(
    getSlotFragmentDropTargetMutable(
      data.instances,
      { parentSelector: ["broken", "body"], position: "end" },
      createIdFactory()
    )
  ).toBeUndefined();
  expect(data.instances.get("broken")?.children).toEqual([]);
});

test("inserts a Custom Slot through the component insert mutation", () => {
  const data = createData();
  const mutation = insertComponent(
    {
      ...data,
      pages: {
        homePageId: "page",
        rootFolderId: "root",
        pages: new Map([
          [
            "page",
            {
              id: "page",
              name: "Page",
              path: "",
              title: "Page",
              rootInstanceId: "body",
              meta: {},
            },
          ],
        ]),
        folders: new Map([
          ["root", { id: "root", name: "Root", slug: "", children: ["page"] }],
        ]),
      },
    },
    { parentInstanceId: "body", component: customSlotComponent },
    { createId: createIdFactory() }
  );
  expect(mutation.result.rootInstanceIds).toHaveLength(1);
});

test("deleting one copy keeps the shared Fragment for the other copies", () => {
  const data = createData();
  const createId = createIdFactory();
  const first = insertCustomSlot(data, createId);
  const second = duplicateInstanceAfterItselfMutable({
    data,
    sourceInstanceId: first,
    parentInstanceId: "body",
    projectId: "project",
    createId,
  });
  const rootId = getCustomSlotContentRootId(data.instances, first);
  const state = {
    ...data,
    pages: {
      homePageId: "page",
      rootFolderId: "root",
      pages: new Map([
        [
          "page",
          {
            id: "page",
            name: "Page",
            path: "",
            title: "Page",
            rootInstanceId: "body",
            meta: {},
          },
        ],
      ]),
      folders: new Map([
        ["root", { id: "root", name: "Root", slug: "", children: ["page"] }],
      ]),
    },
  };
  const mutation = deleteInstances(state, { instanceIds: [first] });
  const after = applyBuilderPatchTransactions(state, [
    { id: "test", payload: mutation.payload },
  ]).state;
  expect(after.instances?.has(first)).toBe(false);
  expect(after.instances?.has(rootId ?? "")).toBe(true);
  expect(
    getCustomSlotContentRootId(after.instances ?? new Map(), second ?? "")
  ).toEqual(rootId);
});

test("deleting the last copy removes its shared Fragment and data", () => {
  const data = createData();
  const createId = createIdFactory();
  const only = insertCustomSlot(data, createId);
  const rootId = getCustomSlotContentRootId(data.instances, only) ?? "";
  const state = {
    ...data,
    pages: {
      homePageId: "page",
      rootFolderId: "root",
      pages: new Map([
        [
          "page",
          {
            id: "page",
            name: "Page",
            path: "",
            title: "Page",
            rootInstanceId: "body",
            meta: {},
          },
        ],
      ]),
      folders: new Map([
        ["root", { id: "root", name: "Root", slug: "", children: ["page"] }],
      ]),
    },
  };
  const mutation = deleteInstances(state, { instanceIds: [only] });
  const after = applyBuilderPatchTransactions(state, [
    { id: "test", payload: mutation.payload },
  ]).state;
  expect(after.instances?.has(rootId)).toBe(false);
  expect(
    Array.from(after.dataSources?.values() ?? []).filter(
      (dataSource) =>
        dataSource.scopeInstanceId === rootId ||
        dataSource.scopeInstanceId === only
    )
  ).toEqual([]);
});

test("a new Custom Slot starts empty with no properties", () => {
  const data = createData();
  const slotId = insertCustomSlot(data, createIdFactory());
  const rootId = getCustomSlotContentRootId(data.instances, slotId) ?? "";
  expect(data.instances.get(rootId)?.children).toEqual([]);
  const schema = findCustomSlotDataSource(
    data.dataSources,
    rootId,
    "__customSlotSchema"
  );
  expect(schema?.type === "variable" && schema.value.value).toEqual([]);
});
