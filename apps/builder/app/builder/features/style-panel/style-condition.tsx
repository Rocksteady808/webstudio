import { Fragment, useState } from "react";
import { computed } from "nanostores";
import { useStore } from "@nanostores/react";
import {
  Box,
  Button,
  cssVar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Flex,
  Text,
  theme,
} from "@webstudio-is/design-system";
import { CheckMarkIcon, ChevronDownIcon, DotIcon } from "@webstudio-is/icons";
import { pseudoClassesByTag } from "@webstudio-is/html-data";
import { isPseudoElement } from "@webstudio-is/css-data";
import { splitBuilderComponentChoiceState } from "@webstudio-is/sdk";
import { getBuilderComponentChoiceStates } from "@webstudio-is/project-build/runtime";
import {
  $registeredComponentMetas,
  $selectedInstance,
  $selectedInstanceSelector,
  $selectedInstanceStatesByStyleSourceId,
  $selectedOrLastStyleSourceSelector,
  $selectedStyleState,
} from "~/shared/nano-states";
import {
  $dataSources,
  $instances,
  $styleSourceSelections,
  $styles,
} from "~/shared/sync/data-stores";
import { $instanceTags } from "./shared/model";
import { SelectorCombobox } from "./style-source/style-source-menu";

/**
 * A style condition decides when declarations apply: a CSS state like
 * `:hover`, a component state, a property value like `size: large`, or a
 * custom selector. Picking one edits and previews it; Local or a token still
 * decides where declarations are saved.
 */
export type StyleCondition = {
  type: "property" | "component" | "state" | "custom";
  selector: string;
  label: string;
};

const groupLabels: Record<StyleCondition["type"], string> = {
  property: "Property values",
  component: "Component states",
  state: "States",
  custom: "Custom selectors",
};

const groupOrder: StyleCondition["type"][] = [
  "property",
  "component",
  "state",
  "custom",
];

/**
 * The short default list: property values and component states are one
 * click, CSS states only show once styled or selected. Everything else is
 * under More.
 */
export const getDefaultConditions = ({
  propertyConditions,
  componentStates,
  usedSelectors,
  selectedState,
}: {
  propertyConditions: Array<{ label: string; selector: string }>;
  componentStates: Array<{ label: string; selector: string }>;
  usedSelectors: Iterable<string>;
  selectedState: undefined | string;
}) => {
  const conditions = new Map<string, StyleCondition>();
  for (const { label, selector } of propertyConditions) {
    conditions.set(selector, { type: "property", selector, label });
  }
  for (const { label, selector } of componentStates) {
    conditions.set(selector, { type: "component", selector, label });
  }
  const getLabel = (selector: string) => {
    // a property value combined with a state, e.g. `size: large :hover`
    const choice = splitBuilderComponentChoiceState(selector);
    if (choice !== undefined) {
      const choiceLabel = conditions.get(choice.choiceState)?.label;
      return `${choiceLabel ?? choice.choiceState} ${choice.state}`.trim();
    }
    return selector;
  };
  const extra = new Set(usedSelectors);
  if (selectedState !== undefined && selectedState.trim() !== "") {
    extra.add(selectedState);
  }
  const nativeStates = new Set(pseudoClassesByTag["*"]);
  for (const selector of extra) {
    if (conditions.has(selector)) {
      continue;
    }
    const choice = splitBuilderComponentChoiceState(selector);
    const isNative =
      nativeStates.has(selector) ||
      isPseudoElement(selector) ||
      (choice !== undefined && choice.state !== "");
    conditions.set(selector, {
      type: choice?.state === "" ? "property" : isNative ? "state" : "custom",
      selector,
      label: getLabel(selector),
    });
  }
  return Array.from(conditions.values());
};

const $conditions = computed(
  [
    $selectedInstance,
    $selectedInstanceSelector,
    $registeredComponentMetas,
    $instanceTags,
    $instances,
    $dataSources,
    $styles,
    $styleSourceSelections,
    $selectedStyleState,
  ],
  (
    instance,
    instanceSelector,
    metas,
    instanceTags,
    instances,
    dataSources,
    styles,
    styleSourceSelections,
    selectedState
  ) => {
    if (instance === undefined) {
      return { conditions: [], predefinedStates: [] };
    }
    // conditions styled on any source applied to the element
    const styleSourceIds = new Set(
      styleSourceSelections.get(instance.id)?.values
    );
    const usedSelectors = new Set<string>();
    for (const styleDecl of styles.values()) {
      if (
        styleDecl.state !== undefined &&
        styleDecl.state.trim() !== "" &&
        styleSourceIds.has(styleDecl.styleSourceId)
      ) {
        usedSelectors.add(styleDecl.state);
      }
    }
    const tag = instanceTags.get(instance.id);
    return {
      conditions: getDefaultConditions({
        propertyConditions: getBuilderComponentChoiceStates({
          instances,
          dataSources,
          instanceSelector: instanceSelector ?? [],
        }),
        componentStates: metas.get(instance.component)?.states ?? [],
        usedSelectors,
        selectedState,
      }),
      predefinedStates: [
        ...pseudoClassesByTag["*"],
        ...(pseudoClassesByTag[tag ?? ""] ?? []),
      ],
    };
  }
);

/**
 * Picking a CSS state inside `size: large` edits the hover of large, the way
 * styling without a state edits large; picking None from there goes back to
 * large, and from large to the base styles.
 */
export const getNextStyleState = (
  current: undefined | string,
  condition: undefined | StyleCondition
) => {
  const choice = splitBuilderComponentChoiceState(current);
  if (condition === undefined) {
    return choice !== undefined && choice.state !== ""
      ? choice.choiceState
      : undefined;
  }
  if (
    choice !== undefined &&
    (condition.type === "state" || condition.type === "custom") &&
    splitBuilderComponentChoiceState(condition.selector) === undefined
  ) {
    return `${choice.choiceState}${condition.selector}`;
  }
  return condition.selector;
};

const getCurrentLabel = (
  conditions: StyleCondition[],
  selectedState: undefined | string
) => {
  if (selectedState === undefined || selectedState.trim() === "") {
    return "None";
  }
  return (
    conditions.find((condition) => condition.selector === selectedState)
      ?.label ?? selectedState
  );
};

/**
 * Always visible next to the style sources, so the condition being edited is
 * never hidden inside the token menu.
 */
export const StyleConditionSelect = () => {
  const { conditions, predefinedStates } = useStore($conditions);
  const selectedState = useStore($selectedStyleState);
  const selectedSource = useStore($selectedOrLastStyleSourceSelector);
  const statesBySource = useStore($selectedInstanceStatesByStyleSourceId);
  const [open, setOpen] = useState(false);
  const styledStates = new Set(
    statesBySource.get(selectedSource?.styleSourceId ?? "") ?? []
  );
  const select = (condition: undefined | StyleCondition) => {
    $selectedStyleState.set(getNextStyleState(selectedState, condition));
    setOpen(false);
  };
  const isActive = selectedState !== undefined && selectedState.trim() !== "";
  return (
    <Flex align="center" gap="2" css={{ paddingTop: theme.spacing[3] }}>
      <Text variant="labels" css={{ flexShrink: 0 }}>
        Condition
      </Text>
      <DropdownMenu modal open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            color={isActive ? "primary" : "neutral"}
            suffix={<ChevronDownIcon />}
            css={{ flexGrow: 1, justifyContent: "space-between", minWidth: 0 }}
            aria-label="Style condition"
          >
            <Text truncate css={{ color: "inherit" }}>
              {getCurrentLabel(conditions, selectedState)}
            </Text>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          onCloseAutoFocus={(event) => event.preventDefault()}
          css={{ minWidth: theme.spacing[26], maxWidth: theme.spacing[30] }}
        >
          <DropdownMenuItem
            withIndicator={true}
            icon={isActive === false && <CheckMarkIcon size={12} />}
            onSelect={() => select(undefined)}
          >
            None
          </DropdownMenuItem>
          {groupOrder.map((type) => {
            const items = conditions.filter(
              (condition) => condition.type === type
            );
            if (items.length === 0) {
              return;
            }
            return (
              <Fragment key={type}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{groupLabels[type]}</DropdownMenuLabel>
                {items.map((condition) => (
                  <DropdownMenuItem
                    key={condition.selector}
                    withIndicator={true}
                    icon={
                      condition.selector === selectedState && (
                        <CheckMarkIcon size={12} />
                      )
                    }
                    onSelect={() => select(condition)}
                  >
                    <Flex justify="between" align="center" grow gap="2">
                      <Text variant="labels" truncate>
                        {condition.label}
                      </Text>
                      {styledStates.has(condition.selector) && (
                        <DotIcon
                          size="12"
                          color={cssVar("--foreground-accent")}
                        />
                      )}
                    </Flex>
                  </DropdownMenuItem>
                ))}
              </Fragment>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>More…</DropdownMenuLabel>
          <Box css={{ padding: theme.spacing[4] }}>
            <SelectorCombobox
              existingSelectors={[
                ...conditions.map((condition) => condition.selector),
              ]}
              suggestions={predefinedStates}
              onSelect={(selector) =>
                select({
                  type: pseudoClassesByTag["*"].includes(selector)
                    ? "state"
                    : "custom",
                  selector,
                  label: selector,
                })
              }
            />
          </Box>
        </DropdownMenuContent>
      </DropdownMenu>
    </Flex>
  );
};
