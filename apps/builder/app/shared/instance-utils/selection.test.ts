import { describe, expect, test } from "vitest";
import { builderComponent, type Instances } from "@webstudio-is/sdk";
import {
  getCanvasClickSelector,
  getContextMenuSelectedInstanceSelectors,
} from "./selection";

describe("getContextMenuSelectedInstanceSelectors", () => {
  test("preserves selected set when context menu opens on a selected instance", () => {
    const selectedSelectors = [
      ["box", "section", "body"],
      ["heading", "section", "body"],
    ];

    expect(
      getContextMenuSelectedInstanceSelectors({
        selectedSelectors,
        clickedSelector: ["heading", "section", "body"],
      })
    ).toBe(selectedSelectors);
  });

  test("selects only the clicked instance when context menu opens on an unselected instance", () => {
    expect(
      getContextMenuSelectedInstanceSelectors({
        selectedSelectors: [
          ["box", "section", "body"],
          ["heading", "section", "body"],
        ],
        clickedSelector: ["footer", "body"],
      })
    ).toEqual([["footer", "body"]]);
  });
});

describe("getCanvasClickSelector", () => {
  // body > card (copy) > fragment > heading, button (copy) > fragment > label
  const instances: Instances = new Map(
    (
      [
        ["body", "Body"],
        ["card", builderComponent],
        ["card-fragment", "Fragment"],
        ["heading", "ws:element"],
        ["button", builderComponent],
        ["button-fragment", "Fragment"],
        ["label", "ws:element"],
      ] as const
    ).map(([id, component]) => [
      id,
      { type: "instance", id, component, children: [] },
    ])
  );
  const label = [
    "label",
    "button-fragment",
    "button",
    "card-fragment",
    "card",
    "body",
  ];
  const click = (selectedSelector: undefined | string[]) =>
    getCanvasClickSelector({
      clickedSelector: label,
      selectedSelector,
      instances,
    });

  test("first click selects the outermost copy", () => {
    expect(click(undefined)).toEqual(["card", "body"]);
    expect(click(["body"])).toEqual(["card", "body"]);
  });

  test("clicking again goes one copy deeper, then to the element", () => {
    expect(click(["card", "body"])).toEqual(label.slice(2));
    expect(click(["heading", "card-fragment", "card", "body"])).toEqual(
      label.slice(2)
    );
    expect(click(label.slice(2))).toEqual(label);
  });

  test("clicking another copy selects that copy", () => {
    expect(click(["other-card", "body"])).toEqual(["card", "body"]);
  });
});
