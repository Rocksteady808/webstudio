import { describe, expect, test } from "vitest";
import type { Instances } from "./schema/instances";
import { customSlotComponent, getCustomSlotContentRootId } from "./custom-slot";
import {
  parseCustomSlotFields,
  parseCustomSlotFieldValues,
  resolveCustomSlotFields,
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
