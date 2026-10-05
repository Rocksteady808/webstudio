import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createDefaultPages } from "@webstudio-is/project-build";
import { setEnv } from "@webstudio-is/feature-flags";
import {
  type DataSource,
  encodeDataSourceVariable,
  type Instance,
  ROOT_INSTANCE_ID,
  type Resource,
  SYSTEM_VARIABLE_ID,
  blockComponent,
  contentBlockDocumentProp,
  collectionComponent,
  builderComponent,
  builderComponentParameterVariable,
  builderComponentSchemaVariable,
  builderComponentValuesVariable,
} from "@webstudio-is/sdk";
import { showAttribute, textContentAttribute } from "@webstudio-is/react-sdk";
import {
  $instances,
  $pages,
  $assets,
  $dataSources,
  $props,
  $resources,
} from "../sync/data-stores";
import {
  $propValuesByInstanceSelector,
  $variableValuesByInstanceSelector,
  subscribeResourceRequestPlan,
  __testing__ as propsTesting,
} from "./props";
import { $dataSourceVariables } from "./variables";
import { $selectedPageId } from "./pages";
import { getInstanceKey } from "../nano-states";
import {
  createTemplateComponentFixture,
  expression,
  Parameter,
  renderData,
  ResourceValue,
  Variable,
  ws,
} from "@webstudio-is/template";
import { $systemDataByPage, updateCurrentSystem } from "../system";
import { registerContainers } from "../sync/sync-stores";
import { $resourcesCache, getResourceKey } from "../resources";
import { $externalContentRoots } from "../external-content-mutations";

const Body = createTemplateComponentFixture("Body");
const Box = createTemplateComponentFixture("Box");
const Fragment = createTemplateComponentFixture("Fragment");
const Slot = createTemplateComponentFixture("Slot");
const Text = createTemplateComponentFixture("Text");

const initialSystem = {
  origin: "https://undefined.wstd.work",
  params: {},
  pathname: "/",
  search: {},
};

const waitForStores = () => new Promise((resolve) => setTimeout(resolve, 20));

registerContainers();
setEnv("*");

const getIdValuePair = <T extends { id: string }>(item: T) =>
  [item.id, item] as const;

const toMap = <T extends { id: string }>(list: T[]) =>
  new Map(list.map(getIdValuePair));

test("Builder component fields remain local when shared content changes", async () => {
  const componentIdentifier = encodeDataSourceVariable("component-parameter");
  const instances = toMap<Instance>([
    {
      id: "body",
      type: "instance",
      component: "Body",
      children: [
        { type: "id", value: "card-a" },
        { type: "id", value: "card-b" },
      ],
    },
    {
      id: "card-a",
      type: "instance",
      component: builderComponent,
      children: [{ type: "id", value: "fragment" }],
    },
    {
      id: "card-b",
      type: "instance",
      component: builderComponent,
      children: [{ type: "id", value: "fragment" }],
    },
    {
      id: "fragment",
      type: "instance",
      component: "Fragment",
      children: [{ type: "id", value: "heading" }],
    },
    {
      id: "heading",
      type: "instance",
      component: "Text",
      children: [
        { type: "expression", value: `${componentIdentifier}.heading` },
      ],
    },
  ]);
  $instances.set(instances);
  const dataSources = toMap<DataSource>([
    {
      id: "component-parameter",
      type: "parameter",
      name: builderComponentParameterVariable,
      scopeInstanceId: "fragment",
    },
    {
      id: "schema",
      type: "variable",
      name: builderComponentSchemaVariable,
      scopeInstanceId: "fragment",
      value: {
        type: "json",
        value: [{ id: "heading-id", name: "heading" }],
      },
    },
    ...(["Alpha", "Beta"] as const).map((heading, index) => ({
      id: `values-${index}`,
      type: "variable" as const,
      name: builderComponentValuesVariable,
      scopeInstanceId: index === 0 ? "card-a" : "card-b",
      value: {
        type: "json" as const,
        value: { "heading-id": { type: "literal", value: heading } },
      },
    })),
  ]);
  $dataSources.set(dataSources);
  selectPageRoot("body");
  await vi.waitFor(() => {
    const values = $propValuesByInstanceSelector.get();
    expect(
      values
        .get(getInstanceKey(["heading", "fragment", "card-a", "body"]))
        ?.get(textContentAttribute)
    ).toBe("Alpha");
    expect(
      values
        .get(getInstanceKey(["heading", "fragment", "card-b", "body"]))
        ?.get(textContentAttribute)
    ).toBe("Beta");
  });
  instances
    .get("fragment")!
    .children.unshift({ type: "id", value: "category" });
  instances.set("category", {
    id: "category",
    type: "instance",
    component: "Text",
    children: [
      { type: "expression", value: `${componentIdentifier}.category` },
    ],
  });
  $instances.set(new Map(instances));
  dataSources.set("schema", {
    id: "schema",
    type: "variable",
    name: builderComponentSchemaVariable,
    scopeInstanceId: "fragment",
    value: {
      type: "json",
      value: [
        { id: "heading-id", name: "heading" },
        {
          id: "category-id",
          name: "category",
          defaultValue: { type: "literal", value: "Featured" },
        },
      ],
    },
  });
  $dataSources.set(new Map(dataSources));
  await vi.waitFor(() => {
    const values = $propValuesByInstanceSelector.get();
    for (const [slotId, heading] of [
      ["card-a", "Alpha"],
      ["card-b", "Beta"],
    ]) {
      expect(
        values
          .get(getInstanceKey(["heading", "fragment", slotId, "body"]))
          ?.get(textContentAttribute)
      ).toBe(heading);
      expect(
        values
          .get(getInstanceKey(["category", "fragment", slotId, "body"]))
          ?.get(textContentAttribute)
      ).toBe("Featured");
    }
  });
});

const setBoxInstance = (id: Instance["id"]) => {
  $instances.set(
    toMap([{ id, type: "instance", component: "Box", children: [] }])
  );
};

test("Builder component link properties use page links and global variables", async () => {
  const componentIdentifier = encodeDataSourceVariable("component-parameter");
  const globalIdentifier = encodeDataSourceVariable("global-link");
  $instances.set(
    toMap<Instance>([
      {
        id: "body",
        type: "instance",
        component: "Body",
        children: [
          { type: "id", value: "card-a" },
          { type: "id", value: "card-b" },
        ],
      },
      {
        id: "card-a",
        type: "instance",
        component: builderComponent,
        children: [{ type: "id", value: "fragment" }],
      },
      {
        id: "card-b",
        type: "instance",
        component: builderComponent,
        children: [{ type: "id", value: "fragment" }],
      },
      {
        id: "fragment",
        type: "instance",
        component: "Fragment",
        children: [{ type: "id", value: "button" }],
      },
      {
        id: "button",
        type: "instance",
        component: "ws:element",
        tag: "a",
        children: [],
      },
    ])
  );
  $props.set(
    toMap([
      {
        id: "href",
        instanceId: "button",
        name: "href",
        type: "expression" as const,
        value: `${componentIdentifier}.link`,
      },
    ])
  );
  $dataSources.set(
    toMap<DataSource>([
      {
        id: "global-link",
        type: "variable",
        name: "Contact URL",
        scopeInstanceId: ROOT_INSTANCE_ID,
        value: { type: "string", value: "https://example.com/contact" },
      },
      {
        id: "component-parameter",
        type: "parameter",
        name: builderComponentParameterVariable,
        scopeInstanceId: "fragment",
      },
      {
        id: "schema",
        type: "variable",
        name: builderComponentSchemaVariable,
        scopeInstanceId: "fragment",
        value: {
          type: "json",
          value: [{ id: "link-id", name: "link", type: "link" }],
        },
      },
      {
        id: "values-a",
        type: "variable",
        name: builderComponentValuesVariable,
        scopeInstanceId: "card-a",
        value: {
          type: "json",
          value: { "link-id": { type: "page", value: "pageId" } },
        },
      },
      {
        id: "values-b",
        type: "variable",
        name: builderComponentValuesVariable,
        scopeInstanceId: "card-b",
        value: {
          type: "json",
          value: { "link-id": { type: "expression", value: globalIdentifier } },
        },
      },
    ])
  );
  selectPageRoot("body");
  await vi.waitFor(() => {
    const values = $propValuesByInstanceSelector.get();
    expect(
      values
        .get(getInstanceKey(["button", "fragment", "card-a", "body"]))
        ?.get("href")
    ).toBe("/");
    expect(
      values
        .get(getInstanceKey(["button", "fragment", "card-b", "body"]))
        ?.get("href")
    ).toBe("https://example.com/contact");
  });
});

test("Builder component image properties resolve assets like a regular Image", async () => {
  const componentIdentifier = encodeDataSourceVariable("component-parameter");
  $assets.set(
    new Map([
      [
        "photo",
        {
          id: "photo",
          projectId: "project",
          name: "photo_hash.jpg",
          type: "image",
          format: "jpg",
          size: 1,
          createdAt: "",
          description: "",
          meta: { width: 10, height: 10 },
        },
      ],
    ])
  );
  $instances.set(
    toMap<Instance>([
      {
        id: "body",
        type: "instance",
        component: "Body",
        children: [{ type: "id", value: "card" }],
      },
      {
        id: "card",
        type: "instance",
        component: builderComponent,
        children: [{ type: "id", value: "fragment" }],
      },
      {
        id: "fragment",
        type: "instance",
        component: "Fragment",
        children: [{ type: "id", value: "image" }],
      },
      { id: "image", type: "instance", component: "Image", children: [] },
    ])
  );
  $props.set(
    toMap([
      {
        id: "src",
        instanceId: "image",
        name: "src",
        type: "expression" as const,
        value: `${componentIdentifier}.image`,
      },
    ])
  );
  $dataSources.set(
    toMap<DataSource>([
      {
        id: "component-parameter",
        type: "parameter",
        name: builderComponentParameterVariable,
        scopeInstanceId: "fragment",
      },
      {
        id: "schema",
        type: "variable",
        name: builderComponentSchemaVariable,
        scopeInstanceId: "fragment",
        value: {
          type: "json",
          value: [{ id: "image-id", name: "image", type: "image" }],
        },
      },
      {
        id: "values",
        type: "variable",
        name: builderComponentValuesVariable,
        scopeInstanceId: "card",
        value: {
          type: "json",
          value: { "image-id": { type: "asset", value: "photo" } },
        },
      },
    ])
  );
  selectPageRoot("body");
  await vi.waitFor(() => {
    expect(
      $propValuesByInstanceSelector
        .get()
        .get(getInstanceKey(["image", "fragment", "card", "body"]))
        ?.get("src")
    ).toBe("/cgi/asset/photo_hash.jpg");
  });
});

test("a nested Builder component shows each parent copy's own values", async () => {
  const cardComponent = encodeDataSourceVariable("card-component");
  const buttonComponent = encodeDataSourceVariable("button-component");
  $instances.set(
    toMap<Instance>([
      {
        id: "body",
        type: "instance",
        component: "Body",
        children: [
          { type: "id", value: "card-a" },
          { type: "id", value: "card-b" },
        ],
      },
      ...["card-a", "card-b"].map(
        (id): Instance => ({
          id,
          type: "instance",
          component: builderComponent,
          children: [{ type: "id", value: "card-fragment" }],
        })
      ),
      {
        id: "card-fragment",
        type: "instance",
        component: "Fragment",
        children: [{ type: "id", value: "nested-button" }],
      },
      {
        id: "nested-button",
        type: "instance",
        component: builderComponent,
        children: [{ type: "id", value: "button-fragment" }],
      },
      {
        id: "button-fragment",
        type: "instance",
        component: "Fragment",
        children: [{ type: "id", value: "label" }],
      },
      {
        id: "label",
        type: "instance",
        component: "Text",
        children: [{ type: "expression", value: `${buttonComponent}.label` }],
      },
    ])
  );
  $dataSources.set(
    toMap<DataSource>([
      {
        id: "card-component",
        type: "parameter",
        name: builderComponentParameterVariable,
        scopeInstanceId: "card-fragment",
      },
      {
        id: "card-schema",
        type: "variable",
        name: builderComponentSchemaVariable,
        scopeInstanceId: "card-fragment",
        value: {
          type: "json",
          value: [{ id: "button-label-id", name: "buttonLabel" }],
        },
      },
      ...(["Read more", "Buy now"] as const).map(
        (label, index): DataSource => ({
          id: `card-values-${index}`,
          type: "variable",
          name: builderComponentValuesVariable,
          scopeInstanceId: index === 0 ? "card-a" : "card-b",
          value: {
            type: "json",
            value: { "button-label-id": { type: "literal", value: label } },
          },
        })
      ),
      {
        id: "button-component",
        type: "parameter",
        name: builderComponentParameterVariable,
        scopeInstanceId: "button-fragment",
      },
      {
        id: "button-schema",
        type: "variable",
        name: builderComponentSchemaVariable,
        scopeInstanceId: "button-fragment",
        value: { type: "json", value: [{ id: "label-id", name: "label" }] },
      },
      // the nested button's label is connected to the card's property
      {
        id: "button-values",
        type: "variable",
        name: builderComponentValuesVariable,
        scopeInstanceId: "nested-button",
        value: {
          type: "json",
          value: {
            "label-id": {
              type: "expression",
              value: `${cardComponent}.buttonLabel`,
            },
          },
        },
      },
    ])
  );
  selectPageRoot("body");
  const getLabel = (card: string) =>
    $propValuesByInstanceSelector
      .get()
      .get(
        getInstanceKey([
          "label",
          "button-fragment",
          "nested-button",
          "card-fragment",
          card,
          "body",
        ])
      )
      ?.get(textContentAttribute);
  await vi.waitFor(() => {
    expect(getLabel("card-a")).toBe("Read more");
    expect(getLabel("card-b")).toBe("Buy now");
  });
});

test("a parent copy's override changes only its own nested copy", async () => {
  const buttonComponent = encodeDataSourceVariable("button-component");
  $instances.set(
    toMap<Instance>([
      {
        id: "body",
        type: "instance",
        component: "Body",
        children: [
          { type: "id", value: "card-a" },
          { type: "id", value: "card-b" },
        ],
      },
      ...["card-a", "card-b"].map(
        (id): Instance => ({
          id,
          type: "instance",
          component: builderComponent,
          children: [{ type: "id", value: "card-fragment" }],
        })
      ),
      {
        id: "card-fragment",
        type: "instance",
        component: "Fragment",
        children: [{ type: "id", value: "nested-button" }],
      },
      {
        id: "nested-button",
        type: "instance",
        component: builderComponent,
        children: [{ type: "id", value: "button-fragment" }],
      },
      {
        id: "button-fragment",
        type: "instance",
        component: "Fragment",
        children: [{ type: "id", value: "label" }],
      },
      {
        id: "label",
        type: "instance",
        component: "Text",
        children: [{ type: "expression", value: `${buttonComponent}.label` }],
      },
    ])
  );
  $dataSources.set(
    toMap<DataSource>([
      {
        id: "card-component",
        type: "parameter",
        name: builderComponentParameterVariable,
        scopeInstanceId: "card-fragment",
      },
      {
        id: "card-schema",
        type: "variable",
        name: builderComponentSchemaVariable,
        scopeInstanceId: "card-fragment",
        value: { type: "json", value: [] },
      },
      {
        id: "button-component",
        type: "parameter",
        name: builderComponentParameterVariable,
        scopeInstanceId: "button-fragment",
      },
      {
        id: "button-schema",
        type: "variable",
        name: builderComponentSchemaVariable,
        scopeInstanceId: "button-fragment",
        value: { type: "json", value: [{ id: "label-id", name: "label" }] },
      },
      {
        id: "button-values",
        type: "variable",
        name: builderComponentValuesVariable,
        scopeInstanceId: "nested-button",
        value: {
          type: "json",
          value: { "label-id": { type: "literal", value: "Shared" } },
        },
      },
      {
        id: "card-a-overrides",
        type: "variable",
        name: "__builderComponentOverrides",
        scopeInstanceId: "card-a",
        value: {
          type: "json",
          value: {
            "nested-button": {
              "label-id": { type: "literal", value: "Read more" },
            },
          },
        },
      },
    ])
  );
  selectPageRoot("body");
  const getLabel = (card: string) =>
    $propValuesByInstanceSelector
      .get()
      .get(
        getInstanceKey([
          "label",
          "button-fragment",
          "nested-button",
          "card-fragment",
          card,
          "body",
        ])
      )
      ?.get(textContentAttribute);
  await vi.waitFor(() => {
    expect(getLabel("card-a")).toBe("Read more");
    expect(getLabel("card-b")).toBe("Shared");
  });
});

test("editing ordinary variables does not touch Builder component rendering", () => {
  const { $builderComponentDataSources } = propsTesting;
  const unsubscribe = $builderComponentDataSources.listen(() => {});
  $dataSources.set(
    toMap<DataSource>([
      {
        id: "title",
        type: "variable",
        name: "title",
        scopeInstanceId: ROOT_INSTANCE_ID,
        value: { type: "string", value: "Hello" },
      },
    ])
  );
  const before = $builderComponentDataSources.get();
  expect(before.size).toBe(0);
  $dataSources.set(
    toMap<DataSource>([
      {
        id: "title",
        type: "variable",
        name: "title",
        scopeInstanceId: ROOT_INSTANCE_ID,
        value: { type: "string", value: "Changed" },
      },
    ])
  );
  expect($builderComponentDataSources.get()).toBe(before);
  // Builder component data still updates
  $dataSources.set(
    toMap<DataSource>([
      {
        id: "values",
        type: "variable",
        name: builderComponentValuesVariable,
        scopeInstanceId: "card",
        value: { type: "json", value: {} },
      },
    ])
  );
  expect($builderComponentDataSources.get()).not.toBe(before);
  expect($builderComponentDataSources.get().has("values")).toBe(true);
  unsubscribe();
});

const selectPageRoot = (
  rootInstanceId: Instance["id"],
  systemDataSourceId?: DataSource["id"]
) => {
  const defaultPages = createDefaultPages({
    homePageId: "pageId",
    rootInstanceId,
    systemDataSourceId,
  });
  $pages.set(defaultPages);
  $selectedPageId.set(defaultPages.homePageId);
};

let unsubscribeResourceRequestPlan: (() => void) | undefined;
let resourceRequests: readonly { name: string }[] = [];

beforeEach(() => {
  $instances.set(new Map());
  $props.set(new Map());
  $resources.set(new Map());
  $dataSources.set(new Map());
  $dataSourceVariables.set(new Map());
  $resourcesCache.set(new Map());
  $externalContentRoots.set(new Map());
  resourceRequests = [];
  unsubscribeResourceRequestPlan = subscribeResourceRequestPlan((plan) => {
    resourceRequests = plan.requests;
  });
});

afterEach(() => {
  unsubscribeResourceRequestPlan?.();
  unsubscribeResourceRequestPlan = undefined;
  resourceRequests = [];
});

test("provides occurrence frontmatter to a repeated Content Block", async () => {
  const sourceBlock: Instance = {
    type: "instance",
    id: "source-block",
    component: blockComponent,
    children: [],
  };
  const runtimeBlock: Instance = {
    ...sourceBlock,
    id: "runtime-block",
  };
  $instances.set(toMap([sourceBlock, runtimeBlock]));
  $dataSources.set(
    toMap([
      {
        type: "parameter",
        id: "document-data-source",
        scopeInstanceId: sourceBlock.id,
        name: contentBlockDocumentProp,
      },
    ])
  );
  $props.set(
    toMap([
      {
        id: "document-prop",
        instanceId: sourceBlock.id,
        name: contentBlockDocumentProp,
        type: "parameter",
        value: "document-data-source",
      },
    ])
  );
  $externalContentRoots.set(
    new Map([
      [
        "root",
        {
          sourceBlockInstanceId: sourceBlock.id,
          blockInstanceId: runtimeBlock.id,
          instanceIds: new Set<string>(),
          mutationRevision: 0,
          frontmatter: { title: "Occurrence title" },
        },
      ],
    ])
  );
  selectPageRoot(runtimeBlock.id);
  await waitForStores();

  await waitForStores();
  expect(
    $variableValuesByInstanceSelector
      .get()
      .get(getInstanceKey([runtimeBlock.id, ROOT_INSTANCE_ID]))
      ?.get("document-data-source")
  ).toEqual({ frontmatter: { title: "Occurrence title" } });
});

test("does not reuse frontmatter from a previous Collection occurrence", async () => {
  const collectionData = new Variable("Posts", ["first", "second"]);
  const collectionItem = new Parameter("Collection Item");
  const document = new Parameter(contentBlockDocumentProp);
  const data = renderData(
    <Body ws:id="body">
      <ws.collection
        ws:id="collection"
        data={expression`${collectionData}`}
        item={collectionItem}
      >
        <ws.block ws:id="block" document={document}>
          <Box
            ws:id="title"
            ariaLabel={expression`${document}.frontmatter.title`}
          />
        </ws.block>
      </ws.collection>
    </Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  selectPageRoot("body");
  await waitForStores();
  const firstBlockSelector = ["block", "collection[0]", "collection", "body"];
  $externalContentRoots.set(
    new Map([
      [
        "first",
        {
          sourceBlockInstanceId: "block",
          sourceRenderScope: JSON.stringify(firstBlockSelector),
          blockInstanceId: "runtime-first",
          instanceIds: new Set<string>(),
          mutationRevision: 0,
          frontmatter: { title: "First title" },
        },
      ],
    ])
  );

  await waitForStores();
  const values = $propValuesByInstanceSelector.get();
  expect(
    values
      .get(getInstanceKey(["title", ...firstBlockSelector]))
      ?.get("ariaLabel")
  ).toBe("First title");
  await waitForStores();
  expect(
    values
      .get(
        getInstanceKey([
          "title",
          "block",
          "collection[1]",
          "collection",
          "body",
        ])
      )
      ?.has("ariaLabel")
  ).toBe(false);
});

test("does not preload resources in statically hidden subtrees", async () => {
  $instances.set(
    toMap([
      {
        id: "root",
        type: "instance",
        component: "Body",
        children: [
          { type: "id", value: "hidden" },
          { type: "id", value: "visible" },
          { type: "id", value: "dynamic" },
        ],
      },
      {
        id: "hidden",
        type: "instance",
        component: "Box",
        children: [
          { type: "id", value: "hidden-child" },
          {
            type: "expression",
            value: encodeDataSourceVariable("hidden-data-source"),
          },
        ],
      },
      {
        id: "hidden-child",
        type: "instance",
        component: "Box",
        children: [
          {
            type: "expression",
            value: encodeDataSourceVariable("hidden-child-data-source"),
          },
        ],
      },
      {
        id: "visible",
        type: "instance",
        component: "Box",
        children: [
          {
            type: "expression",
            value: encodeDataSourceVariable("visible-data-source"),
          },
        ],
      },
      {
        id: "dynamic",
        type: "instance",
        component: "Box",
        children: [
          {
            type: "expression",
            value: encodeDataSourceVariable("dynamic-data-source"),
          },
        ],
      },
    ])
  );
  selectPageRoot("root");
  await waitForStores();
  $props.set(
    toMap([
      {
        id: "hidden-show",
        instanceId: "hidden",
        name: showAttribute,
        type: "boolean",
        value: false,
      },
      {
        id: "dynamic-show",
        instanceId: "dynamic",
        name: showAttribute,
        type: "expression",
        value: "false",
      },
    ])
  );
  $dataSources.set(
    toMap(
      ["hidden", "hidden-child", "visible", "dynamic"].map((instanceId) => ({
        id: `${instanceId}-data-source`,
        scopeInstanceId: instanceId,
        type: "resource" as const,
        name: instanceId,
        resourceId: `${instanceId}-resource`,
      }))
    )
  );
  $resources.set(
    toMap(
      ["hidden", "hidden-child", "visible", "dynamic"].map((name) => ({
        id: `${name}-resource`,
        name,
        url: JSON.stringify(`https://example.com/${name}`),
        method: "get" as const,
        headers: [],
      }))
    )
  );

  await vi.waitFor(() => {
    expect(resourceRequests.map((request) => request.name)).toEqual([
      "visible",
      "dynamic",
    ]);
  });
});

test("preloads resources consumed by copied expressions", async () => {
  const dataSourceId = "copied-resource-data-source";
  $instances.set(
    toMap([
      {
        id: "root",
        type: "instance",
        component: "Body",
        children: [
          {
            type: "expression",
            value: `${encodeDataSourceVariable(dataSourceId)}.data.year`,
          },
        ],
      },
    ])
  );
  selectPageRoot("root");
  await waitForStores();
  $dataSources.set(
    toMap([
      {
        id: dataSourceId,
        scopeInstanceId: "template-source",
        type: "resource",
        name: "Current date",
        resourceId: "current-date-resource",
      },
    ])
  );
  $resources.set(
    toMap([
      {
        id: "current-date-resource",
        name: "Current date",
        url: '"/$resources/current-date"',
        method: "get",
        headers: [],
      },
    ])
  );

  await vi.waitFor(() => {
    expect(resourceRequests.map((request) => request.name)).toEqual([
      "Current date",
    ]);
  });
});

test("collect prop values", async () => {
  setBoxInstance("box");
  selectPageRoot("box");
  await waitForStores();
  $dataSources.set(new Map());
  $props.set(
    toMap([
      {
        id: "prop1",
        name: "first",
        instanceId: "box",
        type: "number",
        value: 0,
      },
      {
        id: "prop2",
        name: "second",
        instanceId: "box",
        type: "json",
        value: { name: "John" },
      },
    ])
  );
  await waitForStores();
  expect(
    $propValuesByInstanceSelector.get().get(getInstanceKey(["box"]))
  ).toEqual(
    new Map<string, unknown>([
      ["first", 0],
      ["second", { name: "John" }],
    ])
  );
});

test("compute expression prop values", async () => {
  setBoxInstance("box");
  selectPageRoot("box");
  await waitForStores();
  $dataSources.set(
    toMap([
      {
        id: "var1",
        scopeInstanceId: "box",
        type: "variable",
        name: "",
        value: { type: "number", value: 1 },
      },
      {
        id: "var2",
        scopeInstanceId: "box",
        type: "variable",
        name: "",
        value: { type: "string", value: "Hello" },
      },
    ])
  );
  $props.set(
    toMap([
      {
        id: "prop1",
        name: "first",
        instanceId: "box",
        type: "expression",
        value: `$ws$dataSource$var1 + 2`,
      },
      {
        id: "prop2",
        name: "second",
        instanceId: "box",
        type: "expression",
        value: `$ws$dataSource$var2 + ' World!'`,
      },
      {
        id: "prop3",
        name: "third",
        instanceId: "box",
        type: "expression",
        // do not fail when access fields of undefined
        value: `$ws$dataSource$var1.second.third || "something"`,
      },
    ])
  );
  await waitForStores();
  expect(
    $propValuesByInstanceSelector.get().get(getInstanceKey(["box"]))
  ).toEqual(
    new Map<string, unknown>([
      ["first", 3],
      ["second", "Hello World!"],
      ["third", "something"],
    ])
  );

  $dataSourceVariables.set(new Map([["var1", 4]]));
  await waitForStores();
  expect(
    $propValuesByInstanceSelector.get().get(getInstanceKey(["box"]))
  ).toEqual(
    new Map<string, unknown>([
      ["first", 6],
      ["second", "Hello World!"],
      ["third", "something"],
    ])
  );
});

test("generate action prop callbacks", async () => {
  setBoxInstance("box");
  selectPageRoot("box");
  await waitForStores();
  $dataSources.set(
    toMap([
      {
        id: "var",
        scopeInstanceId: "box",
        type: "variable",
        name: "",
        value: { type: "number", value: 1 },
      },
    ])
  );
  $props.set(
    toMap([
      {
        id: "valueId",
        name: "value",
        instanceId: "box",
        type: "expression",
        value: `$ws$dataSource$var`,
      },
      {
        id: "actionId",
        name: "onChange",
        instanceId: "box",
        type: "action",
        value: [
          {
            type: "execute",
            args: [],
            code: `$ws$dataSource$var = $ws$dataSource$var + 1`,
          },
        ],
      },
    ])
  );
  await waitForStores();
  const values1 = $propValuesByInstanceSelector
    .get()
    .get(getInstanceKey(["box"]));
  expect(values1?.get("value")).toEqual(1);

  (values1?.get("onChange") as () => void)();
  await waitForStores();
  const values2 = $propValuesByInstanceSelector
    .get()
    .get(getInstanceKey(["box"]));
  expect(values2?.get("value")).toEqual(2);
});

test("resolve asset prop values", async () => {
  setBoxInstance("box");
  selectPageRoot("box");
  await waitForStores();
  $dataSources.set(new Map());
  $assets.set(
    toMap([
      {
        id: "assetId",
        type: "image",
        name: "my-file.jpg",
        format: "jpeg",
        size: 0,
        projectId: "",
        createdAt: "",
        meta: { width: 0, height: 0 },
        description: "",
      },
    ])
  );
  $props.set(
    toMap([
      {
        id: "propId",
        name: "myAsset",
        instanceId: "box",
        type: "asset",
        value: "assetId",
      },
    ])
  );
  await waitForStores();
  expect(
    $propValuesByInstanceSelector.get().get(getInstanceKey(["box"]))
  ).toEqual(
    new Map<string, unknown>([
      ["$webstudio$canvasOnly$assetId", "assetId"],
      ["myAsset", "/cgi/asset/my-file.jpg"],
    ])
  );
});

test("resolve page prop values", async () => {
  setBoxInstance("box");
  selectPageRoot("box");
  await waitForStores();
  $dataSources.set(new Map());
  $props.set(
    toMap([
      {
        id: "propId",
        name: "myPage",
        instanceId: "box",
        type: "page",
        value: "pageId",
      },
    ])
  );
  await waitForStores();
  expect(
    $propValuesByInstanceSelector.get().get(getInstanceKey(["box"]))
  ).toEqual(new Map<string, unknown>([["myPage", "/"]]));
});

test("compute expression from collection items", async () => {
  $instances.set(
    toMap([
      {
        id: "list",
        type: "instance",
        component: collectionComponent,
        children: [{ type: "id", value: "item" }],
      },
      {
        id: "item",
        type: "instance",
        component: "Box",
        children: [],
      },
    ])
  );
  selectPageRoot("list");
  await waitForStores();
  $dataSources.set(
    toMap([
      {
        id: "itemId",
        scopeInstanceId: "list",
        type: "parameter",
        name: "item",
      },
    ])
  );
  $props.set(
    toMap([
      {
        id: "prop1",
        name: "data",
        instanceId: "list",
        type: "json",
        value: ["orange", "apple", "banana"],
      },
      {
        id: "prop2",
        name: "item",
        instanceId: "list",
        type: "parameter",
        value: "itemId",
      },
      {
        id: "prop3",
        name: "ariaLabel",
        instanceId: "item",
        type: "expression",
        value: `$ws$dataSource$itemId`,
      },
    ])
  );
  await waitForStores();
  expect($propValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        getInstanceKey(["list"]),
        new Map<string, unknown>([["data", ["orange", "apple", "banana"]]]),
      ],
      [
        getInstanceKey(["item", "list[0]", "list"]),
        new Map<string, unknown>([["ariaLabel", "orange"]]),
      ],
      [
        getInstanceKey(["item", "list[1]", "list"]),
        new Map<string, unknown>([["ariaLabel", "apple"]]),
      ],
      [
        getInstanceKey(["item", "list[2]", "list"]),
        new Map<string, unknown>([["ariaLabel", "banana"]]),
      ],
    ])
  );
});

test("compute expression from object collection items", async () => {
  const dataVariable = new Variable("dataVariable", {
    first: "orange",
    second: "apple",
    third: "banana",
  });
  const collectionItem = new Parameter("Collection Item");
  const data = renderData(
    <Body ws:id="bodyId">
      <ws.collection
        ws:id="collectionId"
        data={expression`${dataVariable}`}
        item={collectionItem}
      >
        <Box ws:id="boxId" ariaLabel={expression`${collectionItem}`}></Box>
      </ws.collection>
    </Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  selectPageRoot("bodyId");
  await waitForStores();
  $dataSourceVariables.set(new Map([]));

  await waitForStores();
  expect($propValuesByInstanceSelector.get()).toEqual(
    new Map([
      [getInstanceKey(["bodyId"]), new Map<string, unknown>([])],
      [
        getInstanceKey(["collectionId", "bodyId"]),
        new Map<string, unknown>([
          ["data", { first: "orange", second: "apple", third: "banana" }],
        ]),
      ],
      [
        getInstanceKey([
          "boxId",
          "collectionId[first]",
          "collectionId",
          "bodyId",
        ]),
        new Map<string, unknown>([["ariaLabel", "orange"]]),
      ],
      [
        getInstanceKey([
          "boxId",
          "collectionId[second]",
          "collectionId",
          "bodyId",
        ]),
        new Map<string, unknown>([["ariaLabel", "apple"]]),
      ],
      [
        getInstanceKey([
          "boxId",
          "collectionId[third]",
          "collectionId",
          "bodyId",
        ]),
        new Map<string, unknown>([["ariaLabel", "banana"]]),
      ],
    ])
  );
});

test("compute prop values inside collection without item parameter", async () => {
  $instances.set(
    toMap([
      {
        id: "list",
        type: "instance",
        component: collectionComponent,
        children: [{ type: "id", value: "item" }],
      },
      {
        id: "item",
        type: "instance",
        component: "Box",
        children: [],
      },
    ])
  );
  selectPageRoot("list");
  await waitForStores();
  $dataSources.set(new Map());
  $props.set(
    toMap([
      {
        id: "prop1",
        name: "data",
        instanceId: "list",
        type: "json",
        value: ["orange", "apple"],
      },
      {
        id: "prop2",
        name: "ariaLabel",
        instanceId: "item",
        type: "string",
        value: "collection item",
      },
    ])
  );
  await waitForStores();
  expect($propValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        getInstanceKey(["list"]),
        new Map<string, unknown>([["data", ["orange", "apple"]]]),
      ],
      [
        getInstanceKey(["item", "list[0]", "list"]),
        new Map<string, unknown>([["ariaLabel", "collection item"]]),
      ],
      [
        getInstanceKey(["item", "list[1]", "list"]),
        new Map<string, unknown>([["ariaLabel", "collection item"]]),
      ],
    ])
  );
});

test("access parameter value from variables values", async () => {
  $instances.set(
    toMap([
      {
        id: "body",
        type: "instance",
        component: "Body",
        children: [],
      },
    ])
  );
  selectPageRoot("body");
  await waitForStores();
  $dataSources.set(
    toMap([
      {
        id: "parameterId",
        scopeInstanceId: "body",
        type: "parameter",
        name: "paramName",
      },
    ])
  );
  $dataSourceVariables.set(new Map([["parameterId", "paramValue"]]));
  $props.set(
    toMap([
      {
        id: "parameterPropId",
        name: "param",
        instanceId: "body",
        type: "expression",
        value: "$ws$dataSource$parameterId",
      },
    ])
  );
  await waitForStores();
  expect($propValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        getInstanceKey(["body"]),
        new Map<string, unknown>([["param", "paramValue"]]),
      ],
    ])
  );
});

test("compute props bound to resource variables", async () => {
  $instances.set(
    toMap([{ id: "body", type: "instance", component: "Body", children: [] }])
  );
  selectPageRoot("body");
  await waitForStores();
  $dataSources.set(
    toMap([
      {
        id: "resourceVariableId",
        scopeInstanceId: "body",
        type: "resource",
        name: "paramName",
        resourceId: "resourceId",
      },
    ])
  );
  $resources.set(
    toMap<Resource>([
      {
        id: "resourceId",
        name: "my-resource",
        url: `""`,
        method: "get",
        headers: [],
      },
    ])
  );
  const key = getResourceKey({
    name: "my-resource",
    url: "",
    method: "get",
    headers: [],
    searchParams: [],
  });
  $resourcesCache.set(new Map([[key, "my-value"]]));
  $props.set(
    toMap([
      {
        id: "resourcePropId",
        name: "resource",
        instanceId: "body",
        type: "expression",
        value: "$ws$dataSource$resourceVariableId",
      },
    ])
  );
  await vi.waitFor(() => {
    expect($propValuesByInstanceSelector.get()).toEqual(
      new Map([
        [
          getInstanceKey(["body"]),
          new Map<string, unknown>([["resource", "my-value"]]),
        ],
      ])
    );
  });
});

test("compute instance text content when plain text", async () => {
  $instances.set(
    toMap([
      {
        id: "body",
        type: "instance",
        component: "Body",
        children: [
          { type: "id", value: "plainBox" },
          { type: "id", value: "richBox" },
        ],
      },
      {
        id: "plainBox",
        type: "instance",
        component: "Box",
        children: [{ type: "text", value: "plain" }],
      },
      {
        id: "richBox",
        type: "instance",
        component: "Box",
        children: [
          { type: "text", value: "plain" },
          { type: "id", value: "bold" },
        ],
      },
      {
        id: "bold",
        type: "instance",
        component: "Bold",
        children: [{ type: "text", value: "bold" }],
      },
    ])
  );
  selectPageRoot("body");
  await waitForStores();
  await waitForStores();
  expect($propValuesByInstanceSelector.get()).toEqual(
    new Map([
      [getInstanceKey(["body"]), new Map<string, unknown>()],
      [
        getInstanceKey(["plainBox", "body"]),
        new Map<string, unknown>([[textContentAttribute, "plain"]]),
      ],
      [getInstanceKey(["richBox", "body"]), new Map<string, unknown>()],
      [
        getInstanceKey(["bold", "richBox", "body"]),
        new Map<string, unknown>([[textContentAttribute, "bold"]]),
      ],
    ])
  );
});

test("compute instance text content bound to expression", async () => {
  $instances.set(
    toMap([
      {
        id: "body",
        type: "instance",
        component: "Body",
        children: [{ type: "id", value: "expressionBox" }],
      },
      {
        id: "expressionBox",
        type: "instance",
        component: "Box",
        children: [
          { type: "expression", value: `"Hello " + $ws$dataSource$world` },
        ],
      },
    ])
  );
  $dataSources.set(
    toMap([
      {
        id: "world",
        scopeInstanceId: "body",
        name: "world",
        type: "variable",
        value: { type: "string", value: "world" },
      },
    ])
  );
  selectPageRoot("body");
  await waitForStores();
  await waitForStores();
  expect($propValuesByInstanceSelector.get()).toEqual(
    new Map([
      [getInstanceKey(["body"]), new Map<string, unknown>()],
      [
        getInstanceKey(["expressionBox", "body"]),
        new Map<string, unknown>([[textContentAttribute, "Hello world"]]),
      ],
    ])
  );
});

test("does not collapse mixed expression and element children into text", async () => {
  $instances.set(
    toMap([
      {
        id: "body",
        type: "instance",
        component: "Body",
        children: [{ type: "id", value: "mixed" }],
      },
      {
        id: "mixed",
        type: "instance",
        component: "Box",
        children: [
          { type: "expression", value: '"Hello"' },
          { type: "id", value: "sibling" },
        ],
      },
      {
        id: "sibling",
        type: "instance",
        component: "Text",
        children: [{ type: "text", value: "world" }],
      },
    ])
  );
  selectPageRoot("body");

  await waitForStores();
  expect(
    $propValuesByInstanceSelector.get().get(getInstanceKey(["mixed", "body"]))
  ).toEqual(new Map());
});

test("use page system values in props", async () => {
  const systemParameter = new Parameter("system");
  const data = renderData(
    <Body
      ws:id="bodyId"
      data-origin={expression`${systemParameter}.origin`}
    ></Body>
  );
  expect(data.dataSources.size).toEqual(1);
  const [systemParameterId] = data.dataSources.keys();
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  selectPageRoot("bodyId", systemParameterId);
  await waitForStores();
  expect($propValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        getInstanceKey(["bodyId"]),
        new Map<string, unknown>([
          ["data-origin", "https://undefined.wstd.work"],
        ]),
      ],
    ])
  );
});

test("compute props with global variables", async () => {
  const rootVariable = new Variable("rootVariable", "root value");
  const data = renderData(
    <ws.root ws:id={ROOT_INSTANCE_ID} vars={expression`${rootVariable}`}>
      <Body ws:id="bodyId">
        <Box ws:id="boxId" data-value={expression`${rootVariable}`}></Box>
      </Body>
    </ws.root>
  );
  data.instances.delete(ROOT_INSTANCE_ID);
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  selectPageRoot("bodyId");
  await waitForStores();
  expect($propValuesByInstanceSelector.get()).toEqual(
    new Map([
      [getInstanceKey(["bodyId"]), new Map<string, unknown>()],
      [
        getInstanceKey(["boxId", "bodyId"]),
        new Map<string, unknown>([["data-value", "root value"]]),
      ],
    ])
  );
});

test("use global system values in props", async () => {
  const data = renderData(
    <Body ws:id="bodyId" data-origin={expression`$ws$system.origin`}></Body>
  );
  expect(data.dataSources.size).toEqual(0);
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  selectPageRoot("bodyId");
  await waitForStores();
  expect($propValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        getInstanceKey(["bodyId"]),
        new Map<string, unknown>([
          ["data-origin", "https://undefined.wstd.work"],
        ]),
      ],
    ])
  );
});

test("compute variable values for page root", async () => {
  const bodyVariable = new Variable("bodyVariable", "initial");
  const data = renderData(
    <Body ws:id="bodyId" vars={expression`${bodyVariable}`}></Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  const [dataSourceId] = data.dataSources.keys();
  selectPageRoot("bodyId");
  $dataSourceVariables.set(new Map([[dataSourceId, "success"]]));
  await waitForStores();
  expect(
    $variableValuesByInstanceSelector
      .get()
      .get(getInstanceKey(["bodyId", ROOT_INSTANCE_ID]))
  ).toEqual(
    new Map<string, unknown>([
      [SYSTEM_VARIABLE_ID, initialSystem],
      [dataSourceId, "success"],
    ])
  );
});

test("nest variable values from global root to current instance", async () => {
  const bodyVariable = new Variable("bodyVariable", "");
  const boxVariable = new Variable("boxVariable", "");
  const textVariable = new Variable("textVariable", "");
  const data = renderData(
    <Body ws:id="bodyId" vars={expression`${bodyVariable}`}>
      <Box ws:id="boxId" ars={expression`${boxVariable}`}></Box>
      <Text ws:id="textId" ars={expression`${textVariable}`}></Text>
    </Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  const [bodyVariableId, boxVariableId, textVariableId] =
    data.dataSources.keys();
  selectPageRoot("bodyId");
  $dataSourceVariables.set(
    new Map([
      [bodyVariableId, "bodyValue"],
      [boxVariableId, "boxValue"],
      [textVariableId, "textValue"],
    ])
  );
  await waitForStores();
  expect($variableValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        getInstanceKey([ROOT_INSTANCE_ID]),
        new Map([[SYSTEM_VARIABLE_ID, initialSystem]]),
      ],
      [
        getInstanceKey(["bodyId", ROOT_INSTANCE_ID]),
        new Map<string, unknown>([
          [SYSTEM_VARIABLE_ID, initialSystem],
          [bodyVariableId, "bodyValue"],
        ]),
      ],
      [
        getInstanceKey(["boxId", "bodyId", ROOT_INSTANCE_ID]),
        new Map<string, unknown>([
          [SYSTEM_VARIABLE_ID, initialSystem],
          [bodyVariableId, "bodyValue"],
          [boxVariableId, "boxValue"],
        ]),
      ],
      [
        getInstanceKey(["textId", "bodyId", ROOT_INSTANCE_ID]),
        new Map<string, unknown>([
          [SYSTEM_VARIABLE_ID, initialSystem],
          [bodyVariableId, "bodyValue"],
          [textVariableId, "textValue"],
        ]),
      ],
    ])
  );
});

test("compute item values for collection", async () => {
  const dataVariable = new Variable("dataVariable", [
    "apple",
    "banana",
    "orange",
  ]);
  const collectionItem = new Parameter("Collection Item");
  const data = renderData(
    <Body ws:id="bodyId">
      <ws.collection
        ws:id="collectionId"
        data={expression`${dataVariable}`}
        item={collectionItem}
      >
        <Box ws:id="boxId"></Box>
      </ws.collection>
    </Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  const [_dataVariableId, itemParameterId] = data.dataSources.keys();
  selectPageRoot("bodyId");
  $dataSourceVariables.set(new Map([]));
  await waitForStores();
  const values = $variableValuesByInstanceSelector.get();
  expect(
    values
      .get(
        getInstanceKey([
          "boxId",
          "collectionId[0]",
          "collectionId",
          "bodyId",
          ROOT_INSTANCE_ID,
        ])
      )
      ?.get(itemParameterId)
  ).toEqual("apple");
  await waitForStores();
  expect(
    values
      .get(
        getInstanceKey([
          "boxId",
          "collectionId[1]",
          "collectionId",
          "bodyId",
          ROOT_INSTANCE_ID,
        ])
      )
      ?.get(itemParameterId)
  ).toEqual("banana");
  await waitForStores();
  expect(
    values
      .get(
        getInstanceKey([
          "boxId",
          "collectionId[2]",
          "collectionId",
          "bodyId",
          ROOT_INSTANCE_ID,
        ])
      )
      ?.get(itemParameterId)
  ).toEqual("orange");
});

test("keeps explicitly referenced outer collection items in nested scope", async () => {
  const outerItem = new Parameter("item");
  const innerItem = new Parameter("item");
  const data = renderData(
    <Body ws:id="bodyId">
      <ws.collection ws:id="outerId" data={["outer"]} item={outerItem}>
        <ws.collection ws:id="innerId" data={["inner"]} item={innerItem}>
          <Box ws:id="boxId" />
        </ws.collection>
      </ws.collection>
    </Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  const [outerItemId, innerItemId] = data.dataSources.keys();
  selectPageRoot("bodyId");
  await waitForStores();
  const values = $variableValuesByInstanceSelector
    .get()
    .get(
      getInstanceKey([
        "boxId",
        "innerId[0]",
        "innerId",
        "outerId[0]",
        "outerId",
        "bodyId",
        ROOT_INSTANCE_ID,
      ])
    );
  expect(values?.get(outerItemId)).toBe("outer");
  expect(values?.get(innerItemId)).toBe("inner");
});

test("compute item values for collection with object data", async () => {
  const dataVariable = new Variable("dataVariable", {
    first: "apple",
    second: "banana",
    third: "orange",
  });
  const collectionItem = new Parameter("Collection Item");
  const data = renderData(
    <Body ws:id="bodyId">
      <ws.collection
        ws:id="collectionId"
        data={expression`${dataVariable}`}
        item={collectionItem}
      >
        <Box ws:id="boxId"></Box>
      </ws.collection>
    </Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  const [_dataVariableId, itemParameterId] = data.dataSources.keys();
  selectPageRoot("bodyId");
  $dataSourceVariables.set(new Map([]));
  await waitForStores();
  const values = $variableValuesByInstanceSelector.get();
  expect(
    values
      .get(
        getInstanceKey([
          "boxId",
          "collectionId[first]",
          "collectionId",
          "bodyId",
          ROOT_INSTANCE_ID,
        ])
      )
      ?.get(itemParameterId)
  ).toEqual("apple");
  await waitForStores();
  expect(
    values
      .get(
        getInstanceKey([
          "boxId",
          "collectionId[second]",
          "collectionId",
          "bodyId",
          ROOT_INSTANCE_ID,
        ])
      )
      ?.get(itemParameterId)
  ).toEqual("banana");
  await waitForStores();
  expect(
    values
      .get(
        getInstanceKey([
          "boxId",
          "collectionId[third]",
          "collectionId",
          "bodyId",
          ROOT_INSTANCE_ID,
        ])
      )
      ?.get(itemParameterId)
  ).toEqual("orange");
});

test("compute item values for collection with nested object data", async () => {
  const dataVariable = new Variable("dataVariable", {
    user1: { name: "Alice", age: 30 },
    user2: { name: "Bob", age: 25 },
  });
  const collectionItem = new Parameter("Collection Item");
  const data = renderData(
    <Body ws:id="bodyId">
      <ws.collection
        ws:id="collectionId"
        data={expression`${dataVariable}`}
        item={collectionItem}
      >
        <Box ws:id="boxId"></Box>
      </ws.collection>
    </Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  const [_dataVariableId, itemParameterId] = data.dataSources.keys();
  selectPageRoot("bodyId");
  $dataSourceVariables.set(new Map([]));
  await waitForStores();
  const values = $variableValuesByInstanceSelector.get();
  expect(
    values
      .get(
        getInstanceKey([
          "boxId",
          "collectionId[user1]",
          "collectionId",
          "bodyId",
          ROOT_INSTANCE_ID,
        ])
      )
      ?.get(itemParameterId)
  ).toEqual({ name: "Alice", age: 30 });
  await waitForStores();
  expect(
    values
      .get(
        getInstanceKey([
          "boxId",
          "collectionId[user2]",
          "collectionId",
          "bodyId",
          ROOT_INSTANCE_ID,
        ])
      )
      ?.get(itemParameterId)
  ).toEqual({ name: "Bob", age: 25 });
});

test("compute inherited item values inside collection without item parameter", async () => {
  const dataVariable = new Variable("dataVariable", [
    { items: ["apple", "banana"] },
  ]);
  const outerItem = new Parameter("Outer Item");
  const data = renderData(
    <Body ws:id="bodyId">
      <ws.collection
        ws:id="outerCollectionId"
        data={expression`${dataVariable}`}
        item={outerItem}
      >
        <ws.collection
          ws:id="innerCollectionId"
          data={expression`${outerItem}.items`}
        >
          <Box ws:id="boxId"></Box>
        </ws.collection>
      </ws.collection>
    </Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  const outerItemParameterId = Array.from(data.dataSources.values()).find(
    (dataSource) => dataSource.name === "Outer Item"
  )?.id;
  selectPageRoot("bodyId");
  $dataSourceVariables.set(new Map([]));
  await waitForStores();
  const values = $variableValuesByInstanceSelector.get();
  expect(
    values
      .get(
        getInstanceKey([
          "boxId",
          "innerCollectionId[0]",
          "innerCollectionId",
          "outerCollectionId[0]",
          "outerCollectionId",
          "bodyId",
          ROOT_INSTANCE_ID,
        ])
      )
      ?.get(outerItemParameterId ?? "")
  ).toEqual({
    items: ["apple", "banana"],
  });
});

test("compute resource variable values", async () => {
  const resourceVariable = new ResourceValue("resourceVariable", {
    url: expression`""`,
    method: "get",
    searchParams: [],
    headers: [],
  });
  const data = renderData(
    <Body ws:id="bodyId" vars={expression`${resourceVariable}`}></Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $resources.set(data.resources);
  $props.set(data.props);
  const [resourceVariableId] = data.dataSources.keys();
  selectPageRoot("bodyId");
  const key = getResourceKey({
    name: "resourceVariable",
    url: "",
    method: "get",
    headers: [],
    searchParams: [],
  });
  $resourcesCache.set(new Map([[key, "my-value"]]));
  await vi.waitFor(() => {
    expect(
      $variableValuesByInstanceSelector
        .get()
        .get(getInstanceKey(["bodyId", ROOT_INSTANCE_ID]))
        ?.get(resourceVariableId)
    ).toEqual("my-value");
  });
});

test("stop variables lookup outside of slots", async () => {
  const bodyVariable = new Variable("bodyVariable", "body");
  const slotVariable = new Variable("slotVariable", "slot");
  const boxVariable = new Variable("boxVariable", "box");
  const data = renderData(
    <Body ws:id="bodyId" vars={expression`${bodyVariable}`}>
      <Slot ws:id="slotId" vars={expression`${slotVariable}`}>
        <Fragment ws:id="fragmentId">
          <Box ws:id="boxId" vars={expression`${boxVariable}`}></Box>
        </Fragment>
      </Slot>
    </Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  selectPageRoot("bodyId");
  await waitForStores();
  const values = $variableValuesByInstanceSelector.get();
  expect(
    values.get(getInstanceKey(["slotId", "bodyId", ROOT_INSTANCE_ID]))?.size
  ).toEqual(3);
  expect(
    values.get(
      getInstanceKey(["fragmentId", "slotId", "bodyId", ROOT_INSTANCE_ID])
    )?.size
  ).toEqual(1);
  expect(
    values.get(
      getInstanceKey([
        "boxId",
        "fragmentId",
        "slotId",
        "bodyId",
        ROOT_INSTANCE_ID,
      ])
    )?.size
    // global system and box variable
  ).toEqual(2);
});

test("compute parameter and resource variables without values to make it available in scope", async () => {
  const resourceVariable = new ResourceValue("resourceVariable", {
    url: expression`""`,
    method: "get",
    searchParams: [],
    headers: [],
  });
  const parameterVariable = new Parameter("parameterVariable");
  const data = renderData(
    <Body
      ws:id="bodyId"
      vars={expression`${resourceVariable} + ${parameterVariable}`}
    ></Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  const [resourceVariableId, parameterVariableId] = data.dataSources.keys();
  selectPageRoot("bodyId");
  await waitForStores();
  const values = $variableValuesByInstanceSelector
    .get()
    .get(getInstanceKey(["bodyId", ROOT_INSTANCE_ID]));
  expect(values?.get(resourceVariableId)).toEqual(undefined);
  expect(values?.get(parameterVariableId)).toEqual(undefined);
});

test("provide page system variable value", async () => {
  const system = new Parameter("system");
  const data = renderData(
    <Body ws:id="bodyId" vars={expression`${system}`}></Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  const [systemId] = data.dataSources.keys();
  selectPageRoot("bodyId", systemId);
  await waitForStores();
  expect(
    $variableValuesByInstanceSelector
      .get()
      .get(getInstanceKey(["bodyId", ROOT_INSTANCE_ID]))
      ?.get(systemId)
  ).toEqual(initialSystem);
  updateCurrentSystem({
    params: { slug: "my-post" },
  });
  await waitForStores();
  expect(
    $variableValuesByInstanceSelector
      .get()
      .get(getInstanceKey(["bodyId", ROOT_INSTANCE_ID]))
      ?.get(systemId)
  ).toEqual({
    params: { slug: "my-post" },
    pathname: "/",
    search: {},
    origin: "https://undefined.wstd.work",
  });
});

test("provide global system variable value", async () => {
  const data = renderData(
    <Body ws:id="bodyId" vars={expression`$ws$system`}></Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  selectPageRoot("bodyId");
  $systemDataByPage.set(new Map());
  await waitForStores();
  expect($variableValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        getInstanceKey([ROOT_INSTANCE_ID]),
        new Map([[SYSTEM_VARIABLE_ID, initialSystem]]),
      ],
      [
        getInstanceKey(["bodyId", ROOT_INSTANCE_ID]),
        new Map<string, unknown>([[SYSTEM_VARIABLE_ID, initialSystem]]),
      ],
    ])
  );
  updateCurrentSystem({
    params: { slug: "my-post" },
  });
  await waitForStores();
  const updatedSystem = {
    params: { slug: "my-post" },
    pathname: "/",
    search: {},
    origin: "https://undefined.wstd.work",
  };
  expect($variableValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        getInstanceKey([ROOT_INSTANCE_ID]),
        new Map([[SYSTEM_VARIABLE_ID, updatedSystem]]),
      ],
      [
        getInstanceKey(["bodyId", ROOT_INSTANCE_ID]),
        new Map<string, unknown>([[SYSTEM_VARIABLE_ID, updatedSystem]]),
      ],
    ])
  );
});

test("keeps shadowed variables addressable by id in nested scope", async () => {
  const bodyVariable = new Variable("myVariable", "body");
  const boxVariable = new Variable("myVariable", "box");
  const data = renderData(
    <Body ws:id="bodyId" vars={expression`${bodyVariable}`}>
      <Box ws:id="boxId" vars={expression`${boxVariable}`}></Box>
    </Body>
  );
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  const [bodyVariableId, boxVariableId] = data.dataSources.keys();
  selectPageRoot("bodyId");
  $systemDataByPage.set(new Map());
  await waitForStores();
  expect($variableValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        getInstanceKey([ROOT_INSTANCE_ID]),
        new Map([[SYSTEM_VARIABLE_ID, initialSystem]]),
      ],
      [
        getInstanceKey(["bodyId", ROOT_INSTANCE_ID]),
        new Map<string, unknown>([
          [SYSTEM_VARIABLE_ID, initialSystem],
          [bodyVariableId, "body"],
        ]),
      ],
      [
        getInstanceKey(["boxId", "bodyId", ROOT_INSTANCE_ID]),
        new Map<string, unknown>([
          [SYSTEM_VARIABLE_ID, initialSystem],
          [bodyVariableId, "body"],
          [boxVariableId, "box"],
        ]),
      ],
    ])
  );
});

test("inherit variables from global root", async () => {
  const rootVariable = new Variable("rootVariable", "root");
  const boxVariable = new Variable("myVariable", "box");
  const data = renderData(
    <ws.root ws:id={ROOT_INSTANCE_ID} vars={expression`${rootVariable}`}>
      <Body ws:id="bodyId">
        <Box ws:id="boxId" vars={expression`${boxVariable}`}></Box>
      </Body>
    </ws.root>
  );
  data.instances.delete(ROOT_INSTANCE_ID);
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  const [rootVariableId, boxVariableId] = data.dataSources.keys();
  selectPageRoot("bodyId");
  await waitForStores();
  expect($variableValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        getInstanceKey([ROOT_INSTANCE_ID]),
        new Map<string, unknown>([
          [SYSTEM_VARIABLE_ID, initialSystem],
          [rootVariableId, "root"],
        ]),
      ],
      [
        getInstanceKey(["bodyId", ROOT_INSTANCE_ID]),
        new Map<string, unknown>([
          [SYSTEM_VARIABLE_ID, initialSystem],
          [rootVariableId, "root"],
        ]),
      ],
      [
        getInstanceKey(["boxId", "bodyId", ROOT_INSTANCE_ID]),
        new Map<string, unknown>([
          [SYSTEM_VARIABLE_ID, initialSystem],
          [rootVariableId, "root"],
          [boxVariableId, "box"],
        ]),
      ],
    ])
  );
});

test("inherit variables from global root inside slots", async () => {
  const rootVariable = new Variable("rootVariable", "root");
  const bodyVariable = new Variable("bodyVariable", "body");
  const boxVariable = new Variable("myVariable", "box");
  const data = renderData(
    <ws.root ws:id={ROOT_INSTANCE_ID} vars={expression`${rootVariable}`}>
      <Body ws:id="bodyId" vars={expression`${bodyVariable}`}>
        <Slot ws:id="slotId">
          <Fragment ws:id="fragmentId">
            <Box ws:id="boxId" vars={expression`${boxVariable}`}></Box>
          </Fragment>
        </Slot>
      </Body>
    </ws.root>
  );
  data.instances.delete(ROOT_INSTANCE_ID);
  $instances.set(data.instances);
  $dataSources.set(data.dataSources);
  $props.set(data.props);
  const [rootVariableId, _bodyVariableId, boxVariableId] =
    data.dataSources.keys();
  selectPageRoot("bodyId");
  await waitForStores();
  expect(
    $variableValuesByInstanceSelector
      .get()
      .get(
        getInstanceKey([
          "boxId",
          "fragmentId",
          "slotId",
          "bodyId",
          ROOT_INSTANCE_ID,
        ])
      )
  ).toEqual(
    new Map<string, unknown>([
      [SYSTEM_VARIABLE_ID, initialSystem],
      [rootVariableId, "root"],
      [boxVariableId, "box"],
    ])
  );
});
