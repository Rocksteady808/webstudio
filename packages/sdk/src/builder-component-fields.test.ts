import { describe, expect, test } from "vitest";
import type { Instances } from "./schema/instances";
import type { Pages } from "./schema/pages";
import {
  builderComponent,
  getBuilderComponentContentRootId,
} from "./builder-component";
import {
  applyBuilderComponentOverrides,
  getBuilderComponentEnclosingCopies,
  getBuilderComponentOverrideTarget,
  parseBuilderComponentOverrides,
  type BuilderComponentOverrides,
  getBuilderComponentPageHref,
  getBuilderComponentChoiceAttribute,
  getBuilderComponentChoiceState,
  splitBuilderComponentChoiceState,
  parseBuilderComponentFields,
  getBuilderComponentFieldIssue,
  parseBuilderComponentFieldValues,
  resolveBuilderComponentFields,
  resolveBuilderComponentPageValues,
  type BuilderComponentFieldValues,
} from "./builder-component-fields";

const fields = parseBuilderComponentFields([
  { id: "image-id", name: "image" },
  { id: "heading-id", name: "heading" },
  { id: "description-id", name: "description" },
  { id: "button-text-id", name: "buttonText" },
  { id: "button-url-id", name: "buttonUrl" },
]);

describe("Builder component fields", () => {
  test("resolves four independent card occurrences after adding a field", async () => {
    const cards = ["Design", "Applications", "Commerce", "Identity"].map(
      (heading, index) =>
        parseBuilderComponentFieldValues({
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
        resolveBuilderComponentFields({
          fields,
          values,
          evaluateExpression: () => undefined,
        })
      )
    );
    const extendedFields = parseBuilderComponentFields([
      ...fields,
      {
        id: "category-id",
        name: "category",
        defaultValue: { type: "literal", value: "Featured" },
      },
    ]);
    const updated = await Promise.all(
      cards.map((values) =>
        resolveBuilderComponentFields({
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
        component: builderComponent,
        children: [{ type: "id", value: "card-fragment" }],
      });
    }
    const source = instances.get("card-fragment");
    expect(source).toBeDefined();
    source!.children.splice(1, 0, { type: "id", value: "category" });
    for (let index = 0; index < 4; index += 1) {
      const fragmentId = getBuilderComponentContentRootId(
        instances,
        `card-${index}`
      );
      expect(fragmentId).toBe("card-fragment");
      expect(instances.get(fragmentId!)?.children).toEqual([
        { type: "id", value: "image" },
        { type: "id", value: "category" },
        { type: "id", value: "heading" },
      ]);
    }
  });

  test("keeps values across rename and ignores deleted fields", async () => {
    const values = parseBuilderComponentFieldValues({
      "heading-id": { type: "literal", value: "Local title" },
      "button-text-id": { type: "literal", value: "Stale value" },
    });
    const changedFields = parseBuilderComponentFields([
      { id: "heading-id", name: "title" },
      { id: "new-id", name: "category" },
    ]);
    const result = await resolveBuilderComponentFields({
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
    const values: BuilderComponentFieldValues = {
      "heading-id": { type: "expression", value: "titleFromPage" },
    };
    const resolve = (title: string) =>
      resolveBuilderComponentFields({
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
      await resolveBuilderComponentFields({
        fields: parseBuilderComponentFields(storedFields),
        values: parseBuilderComponentFieldValues(storedValues),
        evaluateExpression: () => undefined,
      })
    ).toEqual({ heading: "Persisted" });
  });
});

describe("Builder component link properties", () => {
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
      parseBuilderComponentFields([
        { id: "link-id", name: "link", type: "link" },
        { id: "label-id", name: "label", type: "unknown" },
      ])
    ).toEqual([
      { id: "link-id", name: "link", type: "link" },
      { id: "label-id", name: "label" },
    ]);
    expect(
      parseBuilderComponentFieldValues({
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
    expect(
      getBuilderComponentPageHref({ value: "about", pages, props: [] })
    ).toEqual("/about");
    expect(
      getBuilderComponentPageHref({
        value: { pageId: "about", instanceId: "faq" },
        pages,
        props,
      })
    ).toEqual("/about#faq");
    expect(
      getBuilderComponentPageHref({ value: "missing", pages, props: [] })
    ).toBeUndefined();
  });

  test("resolves page values when rendering an occurrence", async () => {
    expect(
      await resolveBuilderComponentFields({
        fields: [{ id: "link-id", name: "link", type: "link" }],
        values: { "link-id": { type: "page", value: "about" } },
        evaluateExpression: () => undefined,
        resolvePage: (value) =>
          getBuilderComponentPageHref({ value, pages, props: [] }),
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
          name: "__builderComponentSchema",
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
          name: "__builderComponentValues",
          value: {
            type: "json" as const,
            value: { "link-id": { type: "page", value: "about" } },
          },
        },
      ],
    ]);
    const resolved = resolveBuilderComponentPageValues({
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

describe("Builder component choice conditions", () => {
  test("builds the style condition for copies using a value", () => {
    expect(getBuilderComponentChoiceState("size-id", "large")).toEqual(
      ':is([data-ws-props~="size-id=large"] *)'
    );
    // values with spaces or quotes stay one attribute token
    expect(getBuilderComponentChoiceState("label-id", 'Summer "sale"')).toEqual(
      ':is([data-ws-props~="label-id=Summer%20%22sale%22"] *)'
    );
  });

  test("lists the values a copy uses as one attribute value", () => {
    const fields = parseBuilderComponentFields([
      {
        id: "size-id",
        name: "size",
        type: "choice",
        choices: ["small", "large"],
        defaultValue: { type: "literal", value: "small" },
      },
      {
        id: "tone-id",
        name: "tone",
        type: "choice",
        choices: ["light", "dark"],
        defaultValue: { type: "literal", value: "light" },
      },
      { id: "label-id", name: "label" },
    ]);
    expect(
      getBuilderComponentChoiceAttribute(fields, {
        "size-id": { type: "literal", value: "large" },
        // removed choices and other properties are ignored
        "tone-id": { type: "literal", value: "removed" },
        "label-id": { type: "literal", value: "small" },
      })
    ).toEqual("size-id=large");
    expect(getBuilderComponentChoiceAttribute(fields, {})).toEqual(
      "size-id=small tone-id=light"
    );
  });

  test("choice values are part of the component value", async () => {
    expect(
      await resolveBuilderComponentFields({
        fields: [
          {
            id: "size-id",
            name: "size",
            type: "choice",
            choices: ["small"],
            defaultValue: { type: "literal", value: "small" },
          },
        ],
        values: {},
        evaluateExpression: () => undefined,
      })
    ).toEqual({ size: "small" });
  });
});

describe("Builder component html and boolean properties", () => {
  test("keeps html and boolean types", () => {
    expect(
      parseBuilderComponentFields([
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
      await resolveBuilderComponentFields({
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

describe("Builder component image properties", () => {
  test("keeps image type and asset values", () => {
    expect(
      parseBuilderComponentFields([
        { id: "image-id", name: "image", type: "image" },
      ])
    ).toEqual([{ id: "image-id", name: "image", type: "image" }]);
    expect(
      parseBuilderComponentFieldValues({
        a: { type: "asset", value: "asset-id" },
        b: { type: "asset", value: 1 },
      })
    ).toEqual({ a: { type: "asset", value: "asset-id" } });
  });

  test("resolves assets when rendering an occurrence", async () => {
    expect(
      await resolveBuilderComponentFields({
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
          name: "__builderComponentValues",
          value: {
            type: "json" as const,
            value: { "image-id": { type: "asset", value: "asset-id" } },
          },
        },
      ],
    ]);
    const resolved = resolveBuilderComponentPageValues({
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

describe("Builder component overrides", () => {
  // body > card-a (copy) > card-fragment > button (copy)
  const instances: Instances = new Map([
    [
      "card-a",
      {
        type: "instance",
        id: "card-a",
        component: builderComponent,
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
        component: builderComponent,
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
      getBuilderComponentEnclosingCopies(instances, [
        "button",
        "card-fragment",
        "card-a",
        "body",
      ])
    ).toEqual(["card-a"]);
    expect(
      getBuilderComponentEnclosingCopies(instances, ["card-a", "body"])
    ).toEqual([]);
  });

  test("names the override a parent copy stores for a nested copy", () => {
    expect(getBuilderComponentOverrideTarget(["card-a"], "button")).toEqual({
      ownerSlotId: "card-a",
      key: "button",
    });
    // deeper nesting stores on the outermost copy with the full path
    expect(
      getBuilderComponentOverrideTarget(["inner-card", "section"], "button")
    ).toEqual({ ownerSlotId: "section", key: "inner-card/button" });
    expect(getBuilderComponentOverrideTarget([], "button")).toBeUndefined();
  });

  test("applies parent overrides on top of the nested copy's values", () => {
    const overrides: Record<string, BuilderComponentOverrides> = {
      "card-a": {
        button: { label: { type: "literal", value: "Read more" } },
      },
      section: {
        "inner-card/button": { label: { type: "literal", value: "Outer" } },
      },
    };
    const shared: BuilderComponentFieldValues = {
      label: { type: "literal", value: "Shared" },
      link: { type: "literal", value: "/shared" },
    };
    expect(
      applyBuilderComponentOverrides({
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
      applyBuilderComponentOverrides({
        values: shared,
        slotId: "button",
        enclosingCopyIds: ["inner-card", "section"],
        getOverrides: (id) => overrides[id] ?? {},
      }).label
    ).toEqual({ type: "literal", value: "Outer" });
  });

  test("parses overrides and drops malformed entries", () => {
    expect(
      parseBuilderComponentOverrides({
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
  const resolved = resolveBuilderComponentPageValues({
    dataSources: new Map([
      [
        "overrides",
        {
          type: "variable" as const,
          id: "overrides",
          scopeInstanceId: "card-a",
          name: "__builderComponentOverrides",
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

test("publishing without Builder components leaves data sources untouched", () => {
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
    resolveBuilderComponentPageValues({
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

test("splits the hover of a choice value into the value and the state", () => {
  expect(
    splitBuilderComponentChoiceState(
      `${getBuilderComponentChoiceState("size-id", "extra large")}:hover`
    )
  ).toEqual({
    choiceState: getBuilderComponentChoiceState("size-id", "extra large"),
    token: "size-id=extra%20large",
    fieldId: "size-id",
    value: "extra large",
    state: ":hover",
  });
  expect(
    splitBuilderComponentChoiceState(
      getBuilderComponentChoiceState("size-id", "small")
    )?.state
  ).toEqual("");
  expect(splitBuilderComponentChoiceState(":hover")).toBeUndefined();
  expect(splitBuilderComponentChoiceState(undefined)).toBeUndefined();
});

test("reports missing, mismatched and removed choice values", () => {
  const text = { id: "a", name: "title", type: "text" as const };
  expect(getBuilderComponentFieldIssue(text, undefined)?.type).toEqual(
    "missing"
  );
  expect(
    getBuilderComponentFieldIssue(
      { ...text, defaultValue: { type: "literal", value: "Hi" } },
      undefined
    )
  ).toBeUndefined();
  expect(
    getBuilderComponentFieldIssue(
      { id: "b", name: "count", type: "number" },
      { type: "literal", value: "large" }
    )?.type
  ).toEqual("type");
  expect(
    getBuilderComponentFieldIssue(
      { id: "c", name: "size", type: "choice", choices: ["small"] },
      { type: "literal", value: "large" }
    )?.type
  ).toEqual("choice");
  expect(
    getBuilderComponentFieldIssue(
      { id: "d", name: "items", type: "json" },
      { type: "literal", value: [1, 2] }
    )
  ).toBeUndefined();
  // expressions are checked when they run
  expect(
    getBuilderComponentFieldIssue(
      { id: "e", name: "count", type: "number" },
      { type: "expression", value: "$ws$dataSource$x" }
    )
  ).toBeUndefined();
});

test("parses number, JSON and choice properties", () => {
  expect(
    parseBuilderComponentFields([
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
