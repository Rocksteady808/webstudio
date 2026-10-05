import { describe, expect, test } from "vitest";
import type { Instances } from "./schema/instances";
import type { Pages } from "./schema/pages";
import { customSlotComponent, getCustomSlotContentRootId } from "./custom-slot";
import {
  applyCustomSlotOverrides,
  getCustomSlotEnclosingCopies,
  getCustomSlotOverrideTarget,
  parseCustomSlotOverrides,
  type CustomSlotOverrides,
  getCustomSlotPageHref,
  getCustomSlotVariantAttribute,
  getCustomSlotVariantState,
  splitCustomSlotVariantState,
  parseCustomSlotFields,
  getCustomSlotFieldIssue,
  parseCustomSlotFieldValues,
  resolveCustomSlotFields,
  resolveCustomSlotPageValues,
  type CustomSlotFieldValues,
} from "./custom-slot-fields";

const fields = parseCustomSlotFields([
  { id: "image-id", name: "image" },
  { id: "heading-id", name: "heading" },
  { id: "description-id", name: "description" },
  { id: "button-text-id", name: "buttonText" },
  { id: "button-url-id", name: "buttonUrl" },
]);

describe("custom slot fields", () => {
  test("resolves four independent card occurrences after adding a field", async () => {
    const cards = ["Design", "Applications", "Commerce", "Identity"].map(
      (heading, index) =>
        parseCustomSlotFieldValues({
          "image-id": { type: "literal", value: `/image-${index}.jpg` },
          "heading-id": { type: "literal", value: heading },
          "description-id": {
            type: "literal",
            value: `Description ${index}`,
          },
          "button-text-id": { type: "literal", value: `View ${index}` },
          "button-url-id": { type: "literal", value: `/project-${index}` },
        })
    );
    const original = await Promise.all(
      cards.map((values) =>
        resolveCustomSlotFields({
          fields,
          values,
          evaluateExpression: () => undefined,
        })
      )
    );
    const extendedFields = parseCustomSlotFields([
      ...fields,
      {
        id: "category-id",
        name: "category",
        defaultValue: { type: "literal", value: "Featured" },
      },
    ]);
    const updated = await Promise.all(
      cards.map((values) =>
        resolveCustomSlotFields({
          fields: extendedFields,
          values,
          evaluateExpression: () => undefined,
        })
      )
    );
    for (const [index, card] of updated.entries()) {
      expect(card).toEqual({ ...original[index], category: "Featured" });
      expect(card.image).toBe(`/image-${index}.jpg`);
    }
    expect(new Set(updated.map((card) => card.heading)).size).toBe(4);
  });

  test("four occurrences see the same structural edit", () => {
    const instances: Instances = new Map();
    instances.set("card-fragment", {
      type: "instance",
      id: "card-fragment",
      component: "Fragment",
      children: [
        { type: "id", value: "image" },
        { type: "id", value: "heading" },
      ],
    });
    for (let index = 0; index < 4; index += 1) {
      instances.set(`card-${index}`, {
        type: "instance",
        id: `card-${index}`,
        component: customSlotComponent,
        children: [{ type: "id", value: "card-fragment" }],
      });
    }
    const source = instances.get("card-fragment");
    expect(source).toBeDefined();
    source!.children.splice(1, 0, { type: "id", value: "category" });
    for (let index = 0; index < 4; index += 1) {
      const fragmentId = getCustomSlotContentRootId(instances, `card-${index}`);
      expect(fragmentId).toBe("card-fragment");
      expect(instances.get(fragmentId!)?.children).toEqual([
        { type: "id", value: "image" },
        { type: "id", value: "category" },
        { type: "id", value: "heading" },
      ]);
    }
  });

  test("keeps values across rename and ignores deleted fields", async () => {
    const values = parseCustomSlotFieldValues({
      "heading-id": { type: "literal", value: "Local title" },
      "button-text-id": { type: "literal", value: "Stale value" },
    });
    const changedFields = parseCustomSlotFields([
      { id: "heading-id", name: "title" },
      { id: "new-id", name: "category" },
    ]);
    const result = await resolveCustomSlotFields({
      fields: changedFields,
      values,
      evaluateExpression: () => undefined,
    });
    expect(result).toEqual({ title: "Local title", category: undefined });
    expect(values["button-text-id"]).toEqual({
      type: "literal",
      value: "Stale value",
    });
  });

  test("evaluates expression values in the supplied occurrence scope", async () => {
    const values: CustomSlotFieldValues = {
      "heading-id": { type: "expression", value: "titleFromPage" },
    };
    const resolve = (title: string) =>
      resolveCustomSlotFields({
        fields,
        values,
        evaluateExpression: async (expression) =>
          expression === "titleFromPage" ? title : undefined,
      });
    expect((await resolve("Page A")).heading).toBe("Page A");
    expect((await resolve("Page B")).heading).toBe("Page B");
  });

  test("round trips JSON and ignores malformed duplicate definitions", async () => {
    const storedFields = JSON.parse(
      JSON.stringify([
        { id: "heading-id", name: "heading" },
        { id: "heading-id", name: "duplicate" },
        { id: "other-id", name: "heading" },
        { id: 3, name: "invalid" },
      ])
    );
    const storedValues = JSON.parse(
      JSON.stringify({
        "heading-id": { type: "literal", value: "Persisted" },
        malformed: { type: "expression", value: 1 },
      })
    );
    expect(
      await resolveCustomSlotFields({
        fields: parseCustomSlotFields(storedFields),
        values: parseCustomSlotFieldValues(storedValues),
        evaluateExpression: () => undefined,
      })
    ).toEqual({ heading: "Persisted" });
  });
});

describe("custom slot link properties", () => {
  const pages = {
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
  } as unknown as Pages;

  test("keeps link type and page values", () => {
    expect(
      parseCustomSlotFields([
        { id: "link-id", name: "link", type: "link" },
        { id: "label-id", name: "label", type: "unknown" },
      ])
    ).toEqual([
      { id: "link-id", name: "link", type: "link" },
      { id: "label-id", name: "label" },
    ]);
    expect(
      parseCustomSlotFieldValues({
        a: { type: "page", value: "about" },
        b: { type: "page", value: { pageId: "about", instanceId: "faq" } },
        c: { type: "page", value: 1 },
      })
    ).toEqual({
      a: { type: "page", value: "about" },
      b: { type: "page", value: { pageId: "about", instanceId: "faq" } },
    });
  });

  test("resolves page values to the page path with section anchors", () => {
    const props = [
      {
        id: "faq-id",
        instanceId: "faq",
        name: "id",
        type: "string" as const,
        value: "faq",
      },
    ];
    expect(getCustomSlotPageHref({ value: "about", pages, props: [] })).toEqual(
      "/about"
    );
    expect(
      getCustomSlotPageHref({
        value: { pageId: "about", instanceId: "faq" },
        pages,
        props,
      })
    ).toEqual("/about#faq");
    expect(
      getCustomSlotPageHref({ value: "missing", pages, props: [] })
    ).toBeUndefined();
  });

  test("resolves page values when rendering an occurrence", async () => {
    expect(
      await resolveCustomSlotFields({
        fields: [{ id: "link-id", name: "link", type: "link" }],
        values: { "link-id": { type: "page", value: "about" } },
        evaluateExpression: () => undefined,
        resolvePage: (value) =>
          getCustomSlotPageHref({ value, pages, props: [] }),
      })
    ).toEqual({ link: "/about" });
  });

  test("turns page values into literal paths before publishing", () => {
    const dataSources = new Map([
      [
        "schema",
        {
          type: "variable" as const,
          id: "schema",
          scopeInstanceId: "fragment",
          name: "__customSlotSchema",
          value: {
            type: "json" as const,
            value: [
              {
                id: "link-id",
                name: "link",
                type: "link",
                defaultValue: { type: "page", value: "home" },
              },
            ],
          },
        },
      ],
      [
        "values",
        {
          type: "variable" as const,
          id: "values",
          scopeInstanceId: "slot",
          name: "__customSlotValues",
          value: {
            type: "json" as const,
            value: { "link-id": { type: "page", value: "about" } },
          },
        },
      ],
    ]);
    const resolved = resolveCustomSlotPageValues({
      dataSources,
      pages,
      props: [],
    });
    expect(resolved.get("schema")).toEqual(
      expect.objectContaining({
        value: {
          type: "json",
          value: [
            {
              id: "link-id",
              name: "link",
              type: "link",
              defaultValue: { type: "literal", value: "/" },
            },
          ],
        },
      })
    );
    expect(resolved.get("values")).toEqual(
      expect.objectContaining({
        value: {
          type: "json",
          value: { "link-id": { type: "literal", value: "/about" } },
        },
      })
    );
    // the original data is not mutated
    expect(dataSources.get("values")?.value.value).toEqual({
      "link-id": { type: "page", value: "about" },
    });
  });
});

describe("custom slot variants", () => {
  test("keeps variant options and drops malformed ones", () => {
    expect(
      parseCustomSlotFields([
        {
          id: "size-id",
          name: "size",
          type: "variant",
          options: [
            { id: "small-id", name: "Small" },
            { id: "large-id", name: "Large" },
            { id: "small-id", name: "Duplicate" },
            { id: "bad id", name: "Spaces" },
            { name: "No id" },
          ],
        },
      ])
    ).toEqual([
      {
        id: "size-id",
        name: "size",
        type: "variant",
        options: [
          { id: "small-id", name: "Small" },
          { id: "large-id", name: "Large" },
        ],
      },
    ]);
  });

  test("builds the style state that targets copies using an option", () => {
    expect(getCustomSlotVariantState("small-id")).toEqual(
      ':is([data-ws-variant~="small-id"] *)'
    );
  });

  test("lists the options a copy uses as one attribute value", () => {
    const fields = parseCustomSlotFields([
      {
        id: "size-id",
        name: "size",
        type: "variant",
        options: [
          { id: "small-id", name: "Small" },
          { id: "large-id", name: "Large" },
        ],
      },
      {
        id: "tone-id",
        name: "tone",
        type: "variant",
        options: [{ id: "primary-id", name: "Primary" }],
        defaultValue: { type: "literal", value: "primary-id" },
      },
      { id: "label-id", name: "label" },
    ]);
    expect(
      getCustomSlotVariantAttribute(fields, {
        "size-id": { type: "literal", value: "large-id" },
        // unknown options are ignored
        "label-id": { type: "literal", value: "small-id" },
      })
    ).toEqual("large-id primary-id");
    expect(getCustomSlotVariantAttribute(fields, {})).toEqual("primary-id");
  });

  test("variants are not part of the component value", async () => {
    expect(
      await resolveCustomSlotFields({
        fields: [{ id: "size-id", name: "size", type: "variant", options: [] }],
        values: {},
        evaluateExpression: () => undefined,
      })
    ).toEqual({});
  });
});

describe("custom slot html and boolean properties", () => {
  test("keeps html and boolean types", () => {
    expect(
      parseCustomSlotFields([
        { id: "icon-id", name: "icon", type: "html" },
        {
          id: "show-id",
          name: "showIcon",
          type: "boolean",
          defaultValue: { type: "literal", value: true },
        },
      ])
    ).toEqual([
      { id: "icon-id", name: "icon", type: "html" },
      {
        id: "show-id",
        name: "showIcon",
        type: "boolean",
        defaultValue: { type: "literal", value: true },
      },
    ]);
  });

  test("resolves booleans as real booleans for Show", async () => {
    expect(
      await resolveCustomSlotFields({
        fields: [
          {
            id: "show-id",
            name: "showIcon",
            type: "boolean",
            defaultValue: { type: "literal", value: true },
          },
        ],
        values: { "show-id": { type: "literal", value: false } },
        evaluateExpression: () => undefined,
      })
    ).toEqual({ showIcon: false });
  });
});

describe("custom slot image properties", () => {
  test("keeps image type and asset values", () => {
    expect(
      parseCustomSlotFields([{ id: "image-id", name: "image", type: "image" }])
    ).toEqual([{ id: "image-id", name: "image", type: "image" }]);
    expect(
      parseCustomSlotFieldValues({
        a: { type: "asset", value: "asset-id" },
        b: { type: "asset", value: 1 },
      })
    ).toEqual({ a: { type: "asset", value: "asset-id" } });
  });

  test("resolves assets when rendering an occurrence", async () => {
    expect(
      await resolveCustomSlotFields({
        fields: [{ id: "image-id", name: "image", type: "image" }],
        values: { "image-id": { type: "asset", value: "asset-id" } },
        evaluateExpression: () => undefined,
        resolveAsset: (assetId) => `/assets/${assetId}.png`,
      })
    ).toEqual({ image: "/assets/asset-id.png" });
  });

  test("turns assets into URLs before publishing", () => {
    const dataSources = new Map([
      [
        "values",
        {
          type: "variable" as const,
          id: "values",
          scopeInstanceId: "slot",
          name: "__customSlotValues",
          value: {
            type: "json" as const,
            value: { "image-id": { type: "asset", value: "asset-id" } },
          },
        },
      ],
    ]);
    const resolved = resolveCustomSlotPageValues({
      dataSources,
      pages: {
        homePageId: "home",
        rootFolderId: "root",
        pages: new Map(),
        folders: new Map(),
      } as unknown as Pages,
      props: [],
      resolveAsset: (assetId) => `/cgi/asset/${assetId}.png`,
    });
    expect(resolved.get("values")).toMatchObject({
      value: {
        type: "json",
        value: {
          "image-id": { type: "literal", value: "/cgi/asset/asset-id.png" },
        },
      },
    });
  });
});

describe("custom slot overrides", () => {
  // body > card-a (copy) > card-fragment > button (copy)
  const instances: Instances = new Map([
    [
      "card-a",
      {
        type: "instance",
        id: "card-a",
        component: customSlotComponent,
        children: [{ type: "id", value: "card-fragment" }],
      },
    ],
    [
      "card-fragment",
      {
        type: "instance",
        id: "card-fragment",
        component: "Fragment",
        children: [{ type: "id", value: "button" }],
      },
    ],
    [
      "button",
      {
        type: "instance",
        id: "button",
        component: customSlotComponent,
        children: [{ type: "id", value: "button-fragment" }],
      },
    ],
    [
      "button-fragment",
      {
        type: "instance",
        id: "button-fragment",
        component: "Fragment",
        children: [],
      },
    ],
  ]);

  test("finds the copies a nested copy is inside, innermost first", () => {
    expect(
      getCustomSlotEnclosingCopies(instances, [
        "button",
        "card-fragment",
        "card-a",
        "body",
      ])
    ).toEqual(["card-a"]);
    expect(getCustomSlotEnclosingCopies(instances, ["card-a", "body"])).toEqual(
      []
    );
  });

  test("names the override a parent copy stores for a nested copy", () => {
    expect(getCustomSlotOverrideTarget(["card-a"], "button")).toEqual({
      ownerSlotId: "card-a",
      key: "button",
    });
    // deeper nesting stores on the outermost copy with the full path
    expect(
      getCustomSlotOverrideTarget(["inner-card", "section"], "button")
    ).toEqual({ ownerSlotId: "section", key: "inner-card/button" });
    expect(getCustomSlotOverrideTarget([], "button")).toBeUndefined();
  });

  test("applies parent overrides on top of the nested copy's values", () => {
    const overrides: Record<string, CustomSlotOverrides> = {
      "card-a": {
        button: { label: { type: "literal", value: "Read more" } },
      },
      section: {
        "inner-card/button": { label: { type: "literal", value: "Outer" } },
      },
    };
    const shared: CustomSlotFieldValues = {
      label: { type: "literal", value: "Shared" },
      link: { type: "literal", value: "/shared" },
    };
    expect(
      applyCustomSlotOverrides({
        values: shared,
        slotId: "button",
        enclosingCopyIds: ["card-a"],
        getOverrides: (id) => overrides[id] ?? {},
      })
    ).toEqual({
      label: { type: "literal", value: "Read more" },
      link: { type: "literal", value: "/shared" },
    });
    // the outermost copy wins
    expect(
      applyCustomSlotOverrides({
        values: shared,
        slotId: "button",
        enclosingCopyIds: ["inner-card", "section"],
        getOverrides: (id) => overrides[id] ?? {},
      }).label
    ).toEqual({ type: "literal", value: "Outer" });
  });

  test("parses overrides and drops malformed entries", () => {
    expect(
      parseCustomSlotOverrides({
        button: {
          label: { type: "literal", value: "Go" },
          broken: { type: "nope" },
        },
        bad: "x",
      })
    ).toEqual({ button: { label: { type: "literal", value: "Go" } } });
  });
});

test("resolves page links stored in overrides before publishing", () => {
  const resolved = resolveCustomSlotPageValues({
    dataSources: new Map([
      [
        "overrides",
        {
          type: "variable" as const,
          id: "overrides",
          scopeInstanceId: "card-a",
          name: "__customSlotOverrides",
          value: {
            type: "json" as const,
            value: { button: { link: { type: "asset", value: "photo" } } },
          },
        },
      ],
    ]),
    pages: {
      homePageId: "home",
      rootFolderId: "root",
      pages: new Map(),
      folders: new Map(),
    } as unknown as Pages,
    props: [],
    resolveAsset: (assetId) => `/cgi/asset/${assetId}.png`,
  });
  expect(resolved.get("overrides")).toMatchObject({
    value: {
      type: "json",
      value: {
        button: { link: { type: "literal", value: "/cgi/asset/photo.png" } },
      },
    },
  });
});

test("publishing without Custom Slots leaves data sources untouched", () => {
  const dataSources = new Map([
    [
      "title",
      {
        type: "variable" as const,
        id: "title",
        scopeInstanceId: "body",
        name: "title",
        value: { type: "string" as const, value: "Hello" },
      },
    ],
  ]);
  expect(
    resolveCustomSlotPageValues({
      dataSources,
      pages: {
        homePageId: "home",
        rootFolderId: "root",
        pages: new Map(),
        folders: new Map(),
      } as unknown as Pages,
      props: [],
    })
  ).toBe(dataSources);
});

test("keeps a custom name for the base variant", () => {
  expect(
    parseCustomSlotFields([
      {
        id: "variant",
        name: "variant",
        type: "variant",
        baseName: "Primary",
        options: [{ id: "outline", name: "Outline" }],
      },
      // an empty name falls back to "Base" in the UI
      { id: "other", name: "other", type: "variant", baseName: "" },
    ])
  ).toEqual([
    {
      id: "variant",
      name: "variant",
      type: "variant",
      baseName: "Primary",
      options: [{ id: "outline", name: "Outline" }],
    },
    { id: "other", name: "other", type: "variant", options: [] },
  ]);
});

test("splits a variant's hover into the variant and the state", () => {
  expect(
    splitCustomSlotVariantState(`${getCustomSlotVariantState("small")}:hover`)
  ).toEqual({
    variantState: getCustomSlotVariantState("small"),
    optionId: "small",
    state: ":hover",
  });
  expect(
    splitCustomSlotVariantState(getCustomSlotVariantState("small"))?.state
  ).toEqual("");
  expect(splitCustomSlotVariantState(":hover")).toBeUndefined();
  expect(splitCustomSlotVariantState(undefined)).toBeUndefined();
});

test("reports missing, mismatched and removed choice values", () => {
  const text = { id: "a", name: "title", type: "text" as const };
  expect(getCustomSlotFieldIssue(text, undefined)?.type).toEqual("missing");
  expect(
    getCustomSlotFieldIssue(
      { ...text, defaultValue: { type: "literal", value: "Hi" } },
      undefined
    )
  ).toBeUndefined();
  expect(
    getCustomSlotFieldIssue(
      { id: "b", name: "count", type: "number" },
      { type: "literal", value: "large" }
    )?.type
  ).toEqual("type");
  expect(
    getCustomSlotFieldIssue(
      { id: "c", name: "size", type: "choice", choices: ["small"] },
      { type: "literal", value: "large" }
    )?.type
  ).toEqual("choice");
  expect(
    getCustomSlotFieldIssue(
      { id: "d", name: "items", type: "json" },
      { type: "literal", value: [1, 2] }
    )
  ).toBeUndefined();
  // expressions are checked when they run
  expect(
    getCustomSlotFieldIssue(
      { id: "e", name: "count", type: "number" },
      { type: "expression", value: "$ws$dataSource$x" }
    )
  ).toBeUndefined();
});

test("parses number, JSON and choice properties", () => {
  expect(
    parseCustomSlotFields([
      { id: "a", name: "count", type: "number" },
      { id: "b", name: "items", type: "json" },
      { id: "c", name: "size", type: "choice", choices: ["s", "s", "", "l"] },
    ])
  ).toEqual([
    { id: "a", name: "count", type: "number" },
    { id: "b", name: "items", type: "json" },
    { id: "c", name: "size", type: "choice", choices: ["s", "l"] },
  ]);
});
