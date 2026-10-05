import { expect, test } from "vitest";
import type { DataSource, DataSources } from "./schema/data-sources";
import {
  findBuilderComponentDataSource,
  getBuilderComponentTag,
} from "./builder-component";

const values = (id: string, scope: string, value: number): DataSource => ({
  type: "variable",
  id,
  scopeInstanceId: scope,
  name: "__builderComponentValues",
  value: { type: "json", value },
});

test("finds a copy's data source by scope and name", () => {
  const dataSources: DataSources = new Map([
    ["a", values("a", "card-a", 1)],
    ["b", values("b", "card-b", 2)],
  ]);
  expect(
    findBuilderComponentDataSource(
      dataSources,
      "card-b",
      "__builderComponentValues"
    )?.id
  ).toEqual("b");
  expect(
    findBuilderComponentDataSource(
      dataSources,
      "card-c",
      "__builderComponentValues"
    )
  ).toBeUndefined();
});

test("stays correct when the same map is changed in place", () => {
  const dataSources: DataSources = new Map([["a", values("a", "card-a", 1)]]);
  findBuilderComponentDataSource(
    dataSources,
    "card-a",
    "__builderComponentValues"
  );
  // replace a value
  dataSources.set("a", values("a", "card-a", 2));
  expect(
    findBuilderComponentDataSource(
      dataSources,
      "card-a",
      "__builderComponentValues"
    )
  ).toEqual(values("a", "card-a", 2));
  // add a data source
  dataSources.set("b", values("b", "card-b", 3));
  expect(
    findBuilderComponentDataSource(
      dataSources,
      "card-b",
      "__builderComponentValues"
    )?.id
  ).toEqual("b");
  // remove a data source
  dataSources.delete("a");
  expect(
    findBuilderComponentDataSource(
      dataSources,
      "card-a",
      "__builderComponentValues"
    )
  ).toBeUndefined();
  // move a data source to another scope without changing the size
  dataSources.set("b", values("b", "card-c", 3));
  expect(
    findBuilderComponentDataSource(
      dataSources,
      "card-b",
      "__builderComponentValues"
    )
  ).toBeUndefined();
  expect(
    findBuilderComponentDataSource(
      dataSources,
      "card-c",
      "__builderComponentValues"
    )?.id
  ).toEqual("b");
});

test("looks up many copies without rescanning every data source", () => {
  const dataSources: DataSources = new Map();
  for (let index = 0; index < 5000; index += 1) {
    dataSources.set(`v${index}`, values(`v${index}`, `card-${index}`, index));
  }
  let reads = 0;
  const counted = new Proxy(dataSources, {
    get(target, property) {
      if (property === "values") {
        reads += 1;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  for (let index = 0; index < 5000; index += 1) {
    findBuilderComponentDataSource(
      counted,
      `card-${index}`,
      "__builderComponentValues"
    );
  }
  // one scan to build the index instead of one scan per copy
  expect(reads).toBeLessThanOrEqual(2);
});

test("a copy renders as its chosen tag, or adds no element", () => {
  expect(getBuilderComponentTag(undefined)).toBeUndefined();
  expect(getBuilderComponentTag("li")).toBe("li");
  expect(getBuilderComponentTag("article")).toBe("article");
  // anything outside the allowed tags renders no element of its own
  expect(getBuilderComponentTag("script")).toBeUndefined();
  expect(getBuilderComponentTag('div onclick="x"')).toBeUndefined();
});
