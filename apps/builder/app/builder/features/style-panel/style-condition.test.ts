import { describe, expect, test } from "vitest";
import { getBuilderComponentChoiceState } from "@webstudio-is/sdk";
import { getDefaultConditions, getNextStyleState } from "./style-condition";

const large = getBuilderComponentChoiceState("size-id", "large");
const small = getBuilderComponentChoiceState("size-id", "small");

describe("getDefaultConditions", () => {
  test("property values and component states are one click, CSS states once used", () => {
    expect(
      getDefaultConditions({
        propertyConditions: [
          { label: "size: small", selector: small },
          { label: "size: large", selector: large },
        ],
        componentStates: [{ label: "Open", selector: '[data-state="open"]' }],
        usedSelectors: [":hover", `${large}:hover`, ".dark &"],
        selectedState: ":focus-visible",
      })
    ).toEqual([
      { type: "property", selector: small, label: "size: small" },
      { type: "property", selector: large, label: "size: large" },
      { type: "component", selector: '[data-state="open"]', label: "Open" },
      { type: "state", selector: ":hover", label: ":hover" },
      {
        type: "state",
        selector: `${large}:hover`,
        label: "size: large :hover",
      },
      { type: "custom", selector: ".dark &", label: ".dark &" },
      { type: "state", selector: ":focus-visible", label: ":focus-visible" },
    ]);
  });
});

describe("getNextStyleState", () => {
  const hover = { type: "state" as const, selector: ":hover", label: ":hover" };
  const largeCondition = {
    type: "property" as const,
    selector: large,
    label: "size: large",
  };

  test("a state picked inside a property value edits that value's state", () => {
    expect(getNextStyleState(large, hover)).toEqual(`${large}:hover`);
    expect(getNextStyleState(undefined, hover)).toEqual(":hover");
  });

  test("picking a property value replaces the current condition", () => {
    expect(getNextStyleState(`${small}:hover`, largeCondition)).toEqual(large);
  });

  test("None goes from a value's state to the value, then to the base", () => {
    expect(getNextStyleState(`${large}:hover`, undefined)).toEqual(large);
    expect(getNextStyleState(large, undefined)).toBeUndefined();
    expect(getNextStyleState(":hover", undefined)).toBeUndefined();
  });
});
