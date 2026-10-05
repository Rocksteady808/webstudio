import { expect, test } from "vitest";
import type { DataSource, DataSources } from "./schema/data-sources";
import { findCustomSlotDataSource, getCustomSlotTag } from "./custom-slot";

const values = (id: string, scope: string, value: number): DataSource => ({
  type: "variable",
  id,
  scopeInstanceId: scope,
  name: "__customSlotValues",
  value: { type: "json", value },
});

test("finds a copy's data source by scope and name", () => {
  const dataSources: DataSources = new Map([
    ["a", values("a", "card-a", 1)],
    ["b", values("b", "card-b", 2)],
  ]);
  expect(
    findCustomSlotDataSource(dataSources, "card-b", "__customSlotValues")?.id
  ).toEqual("b");
  expect(
    findCustomSlotDataSource(dataSources, "card-c", "__customSlotValues")
  ).toBeUndefined();
});

test("stays correct when the same map is changed in place", () => {
  const dataSources: DataSources = new Map([["a", values("a", "card-a", 1)]]);
  findCustomSlotDataSource(dataSources, "card-a", "__customSlotValues");
  // replace a value
  dataSources.set("a", values("a", "card-a", 2));
  expect(
    findCustomSlotDataSource(dataSources, "card-a", "__customSlotValues")
  ).toEqual(values("a", "card-a", 2));
  // add a data source
  dataSources.set("b", values("b", "card-b", 3));
  expect(
    findCustomSlotDataSource(dataSources, "card-b", "__customSlotValues")?.id
  ).toEqual("b");
  // remove a data source
  dataSources.delete("a");
  expect(
    findCustomSlotDataSource(dataSources, "card-a", "__customSlotValues")
  ).toBeUndefined();
  // move a data source to another scope without changing the size
  dataSources.set("b", values("b", "card-c", 3));
  expect(
    findCustomSlotDataSource(dataSources, "card-b", "__customSlotValues")
  ).toBeUndefined();
  expect(
    findCustomSlotDataSource(dataSources, "card-c", "__customSlotValues")?.id
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
    findCustomSlotDataSource(counted, `card-${index}`, "__customSlotValues");
  }
  // one scan to build the index instead of one scan per copy
  expect(reads).toBeLessThanOrEqual(2);
});

test("a copy renders as its chosen tag, or div", () => {
  expect(getCustomSlotTag(undefined)).toBe("div");
  expect(getCustomSlotTag("li")).toBe("li");
  expect(getCustomSlotTag("article")).toBe("article");
  // anything outside the allowed tags falls back to div
  expect(getCustomSlotTag("script")).toBe("div");
  expect(getCustomSlotTag('div onclick="x"')).toBe("div");
});
