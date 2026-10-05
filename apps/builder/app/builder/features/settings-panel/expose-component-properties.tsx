import { useState } from "react";
import { computed } from "nanostores";
import { useStore } from "@nanostores/react";
import {
  Button,
  Checkbox,
  Flex,
  InputField,
  Label,
  Text,
  theme,
  toast,
} from "@webstudio-is/design-system";
import {
  builderComponent,
  builderComponentParameterVariable,
  encodeDataVariableId,
  findBuilderComponentDataSource,
  getComponentName,
  type PropMeta,
} from "@webstudio-is/sdk";
import { textContentAttribute } from "@webstudio-is/react-sdk";
import { toBuilderComponentFieldName } from "@webstudio-is/project-build/runtime";
import { $isDesignMode, $selectedInstanceSelector } from "~/shared/nano-states";
import { $dataSources, $instances } from "~/shared/sync/data-stores";
import { executeRuntimeMutation } from "~/shared/instance-utils/data";
import type { PropAndMeta } from "./props-section/use-props-logic";
import { humanizeAttribute } from "./shared";

type ExposableType =
  | "text"
  | "richText"
  | "number"
  | "boolean"
  | "link"
  | "image"
  | "json";

/** The property type a setting becomes, or undefined when it cannot. */
const getExposableType = (meta: PropMeta): undefined | ExposableType => {
  switch (meta.control) {
    case "action":
    case "resource":
    case "animationAction":
    case "tag":
      return;
    case "number":
    case "range":
      return "number";
    case "boolean":
      return "boolean";
    case "url":
      return "link";
    case "code":
      return meta.language === "markdown" ? "richText" : "text";
    case "file":
      return meta.accept?.includes("image") ? "image" : "text";
    case "json":
    case "json-code":
    case "check":
    case "inline-check":
    case "multi-select":
      return "json";
    default:
      return "text";
  }
};

/**
 * The component whose source the selected element is in, when the element
 * is selected inside a copy.
 */
const $enclosingComponent = computed(
  [$selectedInstanceSelector, $instances, $dataSources],
  (instanceSelector, instances, dataSources) => {
    if (instanceSelector === undefined) {
      return;
    }
    for (let index = 1; index < instanceSelector.length - 1; index += 1) {
      const fragmentId = instanceSelector[index];
      if (
        instances.get(fragmentId)?.component === "Fragment" &&
        instances.get(instanceSelector[index + 1])?.component ===
          builderComponent
      ) {
        const component = findBuilderComponentDataSource(
          dataSources,
          fragmentId,
          builderComponentParameterVariable
        );
        return {
          fragmentId,
          name: getComponentName(instances, fragmentId),
          reference: `${encodeDataVariableId(component?.id ?? "")}.`,
        };
      }
    }
  }
);

type Candidate = {
  propName: string;
  label: string;
  type: ExposableType;
  isDefaultVisible: boolean;
};

const getCandidates = (
  items: { item: PropAndMeta; isDefaultVisible: boolean }[],
  reference: string
) => {
  const candidates: Candidate[] = [];
  for (const { item, isDefaultVisible } of items) {
    const type = getExposableType(item.meta);
    // already connected to a property of this component
    const isConnected =
      item.prop?.type === "expression" && item.prop.value.includes(reference);
    if (type === undefined || isConnected) {
      continue;
    }
    candidates.push({
      propName: item.propName,
      label:
        item.propName === textContentAttribute
          ? "Text"
          : (item.meta.label ?? humanizeAttribute(item.propName)),
      type,
      isDefaultVisible,
    });
  }
  return candidates;
};

const getDefaultName = (candidate: Candidate) =>
  toBuilderComponentFieldName(
    candidate.propName === textContentAttribute ? "text" : candidate.label
  );

const ExposeForm = ({
  instanceId,
  fragmentId,
  candidates,
  onClose,
}: {
  instanceId: string;
  fragmentId: string;
  candidates: Candidate[];
  onClose: () => void;
}) => {
  // start from the settings an element shows by default, like its Text
  const [checked, setChecked] = useState(
    () =>
      new Set(
        candidates
          .filter((candidate) => candidate.isDefaultVisible)
          .map((candidate) => candidate.propName)
      )
  );
  const [names, setNames] = useState(
    () =>
      new Map(
        candidates.map((candidate) => [
          candidate.propName,
          getDefaultName(candidate),
        ])
      )
  );
  const selected = candidates.filter((candidate) =>
    checked.has(candidate.propName)
  );
  const expose = () => {
    try {
      executeRuntimeMutation({
        id: "builderComponents.exposeProperties",
        input: {
          fragmentId,
          instanceId,
          properties: selected.map((candidate) => ({
            propName: candidate.propName,
            name:
              toBuilderComponentFieldName(
                names.get(candidate.propName) ?? ""
              ) || getDefaultName(candidate),
            type: candidate.type,
          })),
        },
      });
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Cannot expose properties"
      );
    }
  };
  return (
    <Flex direction="column" gap="2">
      {candidates.map((candidate) => (
        <Flex key={candidate.propName} align="center" gap="2">
          <Checkbox
            id={`expose-${candidate.propName}`}
            checked={checked.has(candidate.propName)}
            onCheckedChange={(value) => {
              const next = new Set(checked);
              if (value === true) {
                next.add(candidate.propName);
              } else {
                next.delete(candidate.propName);
              }
              setChecked(next);
            }}
          />
          <Label
            htmlFor={`expose-${candidate.propName}`}
            truncate
            css={{ width: theme.spacing[20], flexShrink: 0 }}
          >
            {candidate.label}
          </Label>
          <InputField
            aria-label={`Property name for ${candidate.label}`}
            disabled={checked.has(candidate.propName) === false}
            value={names.get(candidate.propName) ?? ""}
            onChange={(event) =>
              setNames(
                new Map(names).set(candidate.propName, event.target.value)
              )
            }
            css={{ flexGrow: 1 }}
          />
        </Flex>
      ))}
      <Flex gap="1" justify="end">
        <Button color="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={selected.length === 0} onClick={expose}>
          {selected.length === 1
            ? "Expose 1 property"
            : `Expose ${selected.length} properties`}
        </Button>
      </Flex>
    </Flex>
  );
};

/**
 * Inside a component, picks settings of the selected element to become
 * component properties that every copy fills in, like Webflow's
 * "Create property" for several settings at once.
 */
export const ExposeComponentProperties = ({
  instanceId,
  systemProps,
  initialProps,
  addedProps,
}: {
  instanceId: string;
  systemProps: PropAndMeta[];
  initialProps: PropAndMeta[];
  addedProps: PropAndMeta[];
}) => {
  const component = useStore($enclosingComponent);
  const isDesignMode = useStore($isDesignMode);
  const [isOpen, setIsOpen] = useState(false);
  if (component === undefined || isDesignMode === false) {
    return;
  }
  const candidates = getCandidates(
    [
      ...systemProps.map((item) => ({
        item,
        isDefaultVisible: item.propName === textContentAttribute,
      })),
      ...initialProps.map((item) => ({ item, isDefaultVisible: true })),
      ...addedProps.map((item) => ({ item, isDefaultVisible: false })),
    ],
    component.reference
  );
  if (candidates.length === 0) {
    return;
  }
  return (
    <Flex
      direction="column"
      gap="2"
      css={{
        px: theme.panel.paddingInline,
        pb: theme.panel.paddingBlock,
      }}
    >
      {isOpen ? (
        <>
          <Text variant="titles">Expose to {component.name}</Text>
          <Text color="subtle">
            Each copy of {component.name} fills these in. Current values become
            the defaults.
          </Text>
          <ExposeForm
            // a fresh form for every element
            key={instanceId}
            instanceId={instanceId}
            fragmentId={component.fragmentId}
            candidates={candidates}
            onClose={() => setIsOpen(false)}
          />
        </>
      ) : (
        <Button type="button" color="neutral" onClick={() => setIsOpen(true)}>
          Expose as {component.name} properties
        </Button>
      )}
    </Flex>
  );
};
