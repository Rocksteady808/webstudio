import { expect, test } from "vitest";
import {
  builderComponent,
  builderComponentSchemaVariable,
  builderComponentValuesVariable,
  getBuilderComponentChoiceState,
  getStyleDeclKey,
  type WebstudioData,
} from "@webstudio-is/sdk";
import {
  migrateBuilderComponentsMutable,
  migrateBuilderComponentVariantsMutable,
} from "./builder-components";

test("renames components saved as Custom Slots", () => {
  const data: Pick<WebstudioData, "instances" | "dataSources"> = {
    instances: new Map([
      [
        "copy",
        {
          type: "instance",
          id: "copy",
          component: "ws:customSlot",
          children: [],
        },
      ],
    ]),
    dataSources: new Map([
      [
        "schema",
        {
          type: "variable",
          id: "schema",
          scopeInstanceId: "fragment",
          name: "__customSlotSchema",
          value: { type: "json", value: [] },
        },
      ],
    ]),
  };
  migrateBuilderComponentsMutable(data);
  migrateBuilderComponentsMutable(data);
  expect(data.instances.get("copy")?.component).toEqual(builderComponent);
  expect(data.dataSources.get("schema")?.name).toEqual(
    builderComponentSchemaVariable
  );
});

test("turns saved variants into choice properties", () => {
  const data: Pick<WebstudioData, "dataSources" | "styles"> = {
    dataSources: new Map([
      [
        "schema",
        {
          type: "variable",
          id: "schema",
          scopeInstanceId: "fragment",
          name: builderComponentSchemaVariable,
          value: {
            type: "json",
            value: [
              { id: "title-id", name: "title", type: "text" },
              {
                id: "variant-id",
                name: "variant",
                type: "variant",
                baseName: "Primary",
                options: [
                  { id: "outline-id", name: "Outline" },
                  { id: "ghost-id", name: "Primary" },
                ],
              },
            ],
          },
        },
      ],
      [
        "values",
        {
          type: "variable",
          id: "values",
          scopeInstanceId: "copy",
          name: builderComponentValuesVariable,
          value: {
            type: "json",
            value: { "variant-id": { type: "literal", value: "outline-id" } },
          },
        },
      ],
    ]),
    styles: new Map([
      [
        "old",
        {
          styleSourceId: "local",
          breakpointId: "base",
          property: "color",
          state: ':is([data-ws-variant~="outline-id"] *):hover',
          value: { type: "keyword", value: "red" },
        },
      ],
    ]),
  };
  migrateBuilderComponentVariantsMutable(data);
  migrateBuilderComponentVariantsMutable(data);
  const schema = data.dataSources.get("schema");
  expect(schema?.type === "variable" && schema.value.value).toEqual([
    { id: "title-id", name: "title", type: "text" },
    {
      id: "variant-id",
      name: "variant",
      type: "choice",
      // a clashing option name stays unique
      choices: ["Primary", "Outline", "Primary 2"],
      defaultValue: { type: "literal", value: "Primary" },
    },
  ]);
  const values = data.dataSources.get("values");
  expect(values?.type === "variable" && values.value.value).toEqual({
    "variant-id": { type: "literal", value: "Outline" },
  });
  const state = `${getBuilderComponentChoiceState("variant-id", "Outline")}:hover`;
  expect(Array.from(data.styles.entries())).toEqual([
    [
      getStyleDeclKey({
        styleSourceId: "local",
        breakpointId: "base",
        property: "color",
        state,
      }),
      expect.objectContaining({ state }),
    ],
  ]);
});
