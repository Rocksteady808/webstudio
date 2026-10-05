import { useState } from "react";
import { computed } from "nanostores";
import { useStore } from "@nanostores/react";
import {
  Button,
  DialogClose,
  DialogMaximize,
  DialogTitle,
  DialogTitleActions,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Flex,
  InputField,
  ResettableLabel,
  SectionTitle,
  SectionTitleButton,
  SectionTitleLabel,
  Select,
  SmallIconButton,
  Switch,
  Text,
  TextArea,
  theme,
} from "@webstudio-is/design-system";
import { EllipsesIcon, PlusIcon, XIcon } from "@webstudio-is/icons";
import {
  createId,
  customSlotComponent,
  customSlotTags,
  getComponentName,
  getCustomSlotFieldIssue,
  getCustomSlotTag,
  getCustomSlotCopyOverrides,
  getCustomSlotEnclosingCopies,
  getCustomSlotOverrideTarget,
  type CustomSlotField,
  type CustomSlotFieldType,
  type CustomSlotFieldValue,
} from "@webstudio-is/sdk";
import {
  getContentModeEditableInstanceIds,
  findBrokenCustomSlotReferences,
  getCustomSlotProperties,
  isCustomSlotFieldContentEditable,
  validateHtmlEmbedCode,
  toCustomSlotFieldName,
  type CustomSlotProperty,
} from "@webstudio-is/project-build/runtime";
import {
  $isContentMode,
  $selectedInstance,
  $selectedInstanceSelector,
} from "~/shared/nano-states";
import { $dataSources, $instances, $props } from "~/shared/sync/data-stores";
import {
  executeRuntimeMutation,
  executeRuntimeMutationSequence,
} from "~/shared/instance-utils/data";
import {
  CollapsibleSectionRoot,
  useOpenState,
} from "~/builder/shared/collapsible-section";
import { useDraftValue } from "~/builder/shared/use-draft-value";
import { BindableExpressionControl } from "~/builder/shared/bindable-expression";
import { evaluateExpressionWithinScope } from "~/builder/shared/binding-popover";
import { useAsyncValue } from "~/shared/use-async-value";
import { toast } from "@webstudio-is/design-system";
import { useBindableControl } from "./controls/use-bindable-control";
import { UrlInput, type UrlInputValue } from "./controls/url";
import { SelectAsset } from "./controls/select-asset";
import { CodeEditor } from "~/shared/code-editor";
import { humanizeAttribute } from "./shared";
import { getInstanceLabel } from "~/builder/shared/instance-label";

/**
 * Where edits to the selected copy go. A copy shown inside another copy
 * saves its values on that parent copy only, like a Figma override.
 */
const $customSlotOverrideTarget = computed(
  [$selectedInstanceSelector, $instances],
  (instanceSelector, instances) => {
    const [slotId] = instanceSelector ?? [];
    if (
      instanceSelector === undefined ||
      instances.get(slotId)?.component !== customSlotComponent
    ) {
      return;
    }
    return getCustomSlotOverrideTarget(
      getCustomSlotEnclosingCopies(instances, instanceSelector),
      slotId
    );
  }
);

/**
 * Content editors fill in values of copies placed in content they can edit;
 * the shared design and its properties stay with designers.
 */
const $isSelectedCopyContentEditable = computed(
  [$isContentMode, $selectedInstance, $instances, $customSlotOverrideTarget],
  (isContentMode, instance, instances, overrideTarget) => {
    if (isContentMode === false || instance === undefined) {
      return false;
    }
    return getContentModeEditableInstanceIds({ instances }).has(
      overrideTarget?.ownerSlotId ?? instance.id
    );
  }
);

const $selectedCustomSlot = computed(
  [$selectedInstance, $instances, $dataSources, $customSlotOverrideTarget],
  (instance, instances, dataSources, overrideTarget) => {
    if (instance?.component !== customSlotComponent) {
      return;
    }
    const result = getCustomSlotProperties({
      instances,
      dataSources,
      slotId: instance.id,
    });
    if (result === undefined) {
      return;
    }
    if (overrideTarget === undefined) {
      return { slotId: instance.id, overrideTarget, ...result };
    }
    // inside a parent copy: this copy's own value is the shared value and
    // the parent's override is what this copy changes
    const overrides =
      getCustomSlotCopyOverrides(dataSources, overrideTarget.ownerSlotId)[
        overrideTarget.key
      ] ?? {};
    return {
      slotId: instance.id,
      overrideTarget,
      ...result,
      properties: result.properties.map(({ field, localValue }) => ({
        field: { ...field, defaultValue: localValue ?? field.defaultValue },
        localValue: overrides[field.id],
      })),
    };
  }
);

const formatValue = (value: unknown) =>
  value === undefined || value === null ? "" : String(value);

const PropertyNameForm = ({
  initialLabel = "",
  submitLabel,
  placeholder = "Property name, e.g. Link",
  describe,
  onSubmit,
  onCancel,
}: {
  initialLabel?: string;
  submitLabel: string;
  placeholder?: string;
  /** explains or rejects the name while typing */
  describe?: (name: string) => { message?: string; error?: string };
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) => {
  const [label, setLabel] = useState(initialLabel);
  const name = toCustomSlotFieldName(label);
  const description = name.length === 0 ? undefined : describe?.(name);
  const canSubmit = name.length > 0 && description?.error === undefined;
  const submit = () => {
    if (canSubmit) {
      onSubmit(name);
    }
  };
  return (
    <Flex direction="column" gap="1">
      <Flex gap="1" align="center">
        <InputField
          autoFocus
          placeholder={placeholder}
          color={description?.error === undefined ? undefined : "error"}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              submit();
            }
            if (event.key === "Escape") {
              onCancel();
            }
          }}
          css={{ flexGrow: 1 }}
        />
        <Button type="button" disabled={canSubmit === false} onClick={submit}>
          {submitLabel}
        </Button>
        <SmallIconButton
          aria-label="Cancel"
          icon={<XIcon />}
          onClick={onCancel}
        />
      </Flex>
      {description?.error !== undefined && (
        <Text color="destructive">{description.error}</Text>
      )}
      {description?.error === undefined &&
        description?.message !== undefined && (
          <Text color="subtle">{description.message}</Text>
        )}
    </Flex>
  );
};

/** Rejects a name another property of this component already uses. */
const describeTakenName = (takenNames: readonly string[]) => (name: string) =>
  takenNames.includes(name)
    ? { error: `${humanizeAttribute(name)} already exists` }
    : {};

const propertyTypes = new Map<CustomSlotFieldType, string>([
  ["text", "Text"],
  ["number", "Number"],
  ["boolean", "Boolean"],
  ["choice", "Choice"],
  ["image", "Image"],
  ["link", "Link"],
  ["json", "JSON"],
  ["html", "HTML Embed"],
]);

type NewProperty = {
  name: string;
  type: CustomSlotFieldType;
  choices: string[];
};

/** "small, large" into ["small", "large"]; each value is also its label */
const parseChoicesInput = (value: string) =>
  Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );

const AddPropertyForm = ({
  takenNames,
  onSubmit,
  onCancel,
}: {
  takenNames: readonly string[];
  onSubmit: (property: NewProperty) => void;
  onCancel: () => void;
}) => {
  const [type, setType] = useState<CustomSlotFieldType>("text");
  const [choices, setChoices] = useState("");
  return (
    <Flex direction="column" gap="1">
      <Select
        options={Array.from(propertyTypes.keys())}
        getLabel={(option: CustomSlotFieldType) => propertyTypes.get(option)}
        value={type}
        onChange={setType}
      />
      {type === "choice" && (
        <InputField
          placeholder="Choices, e.g. small, large"
          value={choices}
          onChange={(event) => setChoices(event.target.value)}
        />
      )}
      <PropertyNameForm
        submitLabel="Add"
        placeholder="Property name, e.g. Link"
        describe={describeTakenName(takenNames)}
        onCancel={onCancel}
        onSubmit={(name) =>
          onSubmit({ name, type, choices: parseChoicesInput(choices) })
        }
      />
    </Flex>
  );
};

/**
 * The fixed default a new property starts with. A property without a default
 * is required: every copy has to fill it in.
 */
const getInitialDefault = (
  property: NewProperty
): undefined | CustomSlotFieldValue => {
  switch (property.type) {
    // images start empty instead of an invalid "" source
    case "image":
      return;
    // booleans start on, so a connected Show keeps the element visible
    case "boolean":
      return { type: "literal", value: true };
    case "number":
      return { type: "literal", value: 0 };
    case "json":
      return { type: "literal", value: {} };
    case "choice":
      return property.choices.length === 0
        ? undefined
        : { type: "literal", value: property.choices[0] };
    default:
      return { type: "literal", value: "" };
  }
};

const createProperty = ({
  fragmentId,
  property,
}: {
  fragmentId: string;
  property: NewProperty;
}) => {
  executeRuntimeMutation({
    id: "customSlots.createField",
    input: {
      fragmentId,
      name: property.name,
      type: property.type,
      choices: property.type === "choice" ? property.choices : undefined,
      defaultValue: getInitialDefault(property),
    },
  });
};

// Radix Select cannot use an empty value, so Base has its own id
const baseVariantId = "__base";

/**
 * Webflow-like variants: each copy picks Base or a variant, and styling
 * anything inside a copy edits the variant that copy uses.
 */
const VariantSwitcher = ({
  slotId,
  fragmentId,
  variant,
  canEditVariants,
}: {
  slotId: string;
  fragmentId: string;
  variant: undefined | CustomSlotProperty;
  /** content editors pick a variant but cannot create or change them */
  canEditVariants: boolean;
}) => {
  const [mode, setMode] = useState<"idle" | "create" | "rename">("idle");
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<string>();
  const options = variant?.field.options ?? [];
  // the design without a variant, renamable like Webflow's Primary variant
  const baseLabel = variant?.field.baseName ?? "Base";
  const localValue = variant?.localValue;
  const selected = options.find(
    (option) => localValue?.type === "literal" && option.id === localValue.value
  );
  const selectVariant = (optionId: undefined | string) => {
    if (variant === undefined) {
      return;
    }
    setValue(
      slotId,
      variant.field.id,
      optionId === undefined ? null : { type: "literal", value: optionId }
    );
  };
  const createVariant = (variantName: string) => {
    const option = { id: createId(), name: variantName };
    const fieldId = variant?.field.id ?? createId();
    // create the variant and switch this copy to it in one undo step
    executeRuntimeMutationSequence([
      variant === undefined
        ? {
            id: "customSlots.createField",
            input: {
              fragmentId,
              fieldId,
              name: "variant",
              type: "variant",
              options: [option],
            },
          }
        : {
            id: "customSlots.updateField",
            input: {
              fragmentId,
              fieldId,
              options: [...options, option],
            },
          },
      {
        id: "customSlots.setFieldValue",
        input: {
          slotId,
          fieldId,
          value: { type: "literal", value: option.id },
          override: $customSlotOverrideTarget.get(),
        },
      },
    ] as const);
  };
  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return;
    }
    if (mode === "create") {
      createVariant(trimmed);
    }
    if (mode === "rename" && renamingId === baseVariantId) {
      executeRuntimeMutation(
        variant === undefined
          ? {
              id: "customSlots.createField",
              input: {
                fragmentId,
                name: "variant",
                type: "variant",
                options: [],
                baseName: trimmed,
              },
            }
          : {
              id: "customSlots.updateField",
              input: {
                fragmentId,
                fieldId: variant.field.id,
                baseName: trimmed,
              },
            }
      );
    } else if (mode === "rename" && variant !== undefined) {
      executeRuntimeMutation({
        id: "customSlots.updateField",
        input: {
          fragmentId,
          fieldId: variant.field.id,
          options: options.map((option) =>
            option.id === renamingId ? { ...option, name: trimmed } : option
          ),
        },
      });
    }
    setMode("idle");
    setName("");
  };
  return (
    <Flex direction="column" gap="1">
      <Flex align="center" justify="between">
        <Text variant="titles">Variant</Text>
        {canEditVariants && (
          <Flex gap="1">
            <SmallIconButton
              aria-label="New variant"
              icon={<PlusIcon />}
              onClick={() => {
                setName("");
                setMode("create");
              }}
            />

            <DropdownMenu modal>
              <DropdownMenuTrigger asChild>
                <SmallIconButton
                  aria-label="Variant menu"
                  icon={<EllipsesIcon />}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                css={{ width: theme.spacing[28] }}
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                <DropdownMenuItem
                  onSelect={() => {
                    setName(variant?.field.baseName ?? "");
                    setRenamingId(baseVariantId);
                    setMode("rename");
                  }}
                >
                  Rename {baseLabel}
                </DropdownMenuItem>
                {options.map((option) => (
                  <DropdownMenuItem
                    key={`rename-${option.id}`}
                    onSelect={() => {
                      setName(option.name);
                      setRenamingId(option.id);
                      setMode("rename");
                    }}
                  >
                    Rename {option.name}
                  </DropdownMenuItem>
                ))}
                {options.map((option) => (
                  <DropdownMenuItem
                    key={`delete-${option.id}`}
                    destructive
                    onSelect={() =>
                      variant !== undefined &&
                      executeRuntimeMutation({
                        id: "customSlots.updateField",
                        input: {
                          fragmentId,
                          fieldId: variant.field.id,
                          options: options.filter(
                            (item) => item.id !== option.id
                          ),
                        },
                      })
                    }
                  >
                    Delete {option.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </Flex>
        )}
      </Flex>
      {mode === "idle" ? (
        <Select
          options={[baseVariantId, ...options.map((option) => option.id)]}
          getLabel={(id: string) =>
            id === baseVariantId
              ? baseLabel
              : (options.find((option) => option.id === id)?.name ?? id)
          }
          value={selected?.id ?? baseVariantId}
          onChange={(id) =>
            selectVariant(id === baseVariantId ? undefined : id)
          }
        />
      ) : (
        <Flex gap="1" align="center">
          <InputField
            autoFocus
            css={{ flexGrow: 1 }}
            placeholder="Variant name, e.g. Small"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submit();
              }
              if (event.key === "Escape") {
                setMode("idle");
              }
            }}
          />
          <Button
            type="button"
            disabled={name.trim().length === 0}
            onClick={submit}
          >
            {mode === "create" ? "Create" : "Rename"}
          </Button>
          <SmallIconButton
            aria-label="Cancel"
            icon={<XIcon />}
            onClick={() => {
              setMode("idle");
              setName("");
            }}
          />
        </Flex>
      )}
      {canEditVariants && (
        <Text color="subtle">
          {selected === undefined
            ? `Styling inside this copy edits ${baseLabel}, the design every variant starts from.`
            : `Styling inside this copy edits ${selected.name}. Other copies keep their own variant.`}
        </Text>
      )}
    </Flex>
  );
};

const deleteProperty = ({
  fragmentId,
  field,
}: {
  fragmentId: string;
  field: CustomSlotField;
}) =>
  executeRuntimeMutation({
    id: "customSlots.deleteField",
    input: { fragmentId, fieldId: field.id },
  });

const setValue = (
  slotId: string,
  fieldId: string,
  value: null | CustomSlotFieldValue
) =>
  executeRuntimeMutation({
    id: "customSlots.setFieldValue",
    input: {
      slotId,
      fieldId,
      value,
      override: $customSlotOverrideTarget.get(),
    },
  });

/** What the binding dot does for a property: type, bind, or unbind. */
const getBindingHandlers = (slotId: string, fieldId: string) => ({
  onChangeValue: (value: unknown) =>
    setValue(slotId, fieldId, { type: "literal", value }),
  onChangeExpression: (value: string) =>
    setValue(slotId, fieldId, { type: "expression", value }),
  onRemove: (value: unknown) =>
    setValue(slotId, fieldId, { type: "literal", value: formatValue(value) }),
});

/** The binding dot for a text-like property and the value it is bound to. */
const useTextBinding = (localValue: undefined | CustomSlotFieldValue) => {
  const binding = useBindableControl({
    boundExpression: localValue?.type === "expression" ? localValue : undefined,
    fallbackExpression: JSON.stringify(
      localValue?.type === "literal" ? formatValue(localValue.value) : ""
    ),
  });
  const boundValue = useAsyncValue(
    () =>
      localValue?.type === "expression"
        ? evaluateExpressionWithinScope(localValue.value, binding.scope)
        : Promise.resolve(undefined),
    [localValue, binding.scope],
    undefined
  );
  return { binding, boundValue };
};

/** Text property: plain text, or bound to a variable with the dot. */
const TextValueControl = ({
  slotId,
  property,
}: {
  slotId: string;
  property: CustomSlotProperty;
}) => {
  const { field, localValue } = property;
  const { binding, boundValue } = useTextBinding(localValue);
  const draft = useDraftValue(
    localValue?.type === "literal" ? formatValue(localValue.value) : "",
    (value) => setValue(slotId, field.id, { type: "literal", value })
  );
  const defaultValue =
    field.defaultValue?.type === "literal" ? field.defaultValue.value : "";
  return (
    <BindableExpressionControl
      {...binding}
      value={draft.value}
      {...getBindingHandlers(slotId, field.id)}
      renderControl={({ readOnly }) => (
        <TextArea
          autoGrow
          rows={1}
          maxRows={4}
          disabled={readOnly}
          placeholder={formatValue(defaultValue)}
          value={readOnly ? formatValue(boundValue) : draft.value}
          onChange={draft.set}
          onBlur={draft.save}
          onSubmit={draft.save}
        />
      )}
    />
  );
};

/**
 * HTML Embed property: the same code editor as an HTML Embed's Code setting,
 * with the expand button for a bigger window.
 */
const HtmlValueControl = ({
  slotId,
  property,
}: {
  slotId: string;
  property: CustomSlotProperty;
}) => {
  const { field, localValue } = property;
  const [error, setError] = useState<string>();
  const { binding, boundValue } = useTextBinding(localValue);
  const draft = useDraftValue(
    localValue?.type === "literal" ? formatValue(localValue.value) : "",
    (value) => {
      const issue = validateHtmlEmbedCode(value);
      setError(issue?.message);
      if (issue === undefined) {
        setValue(slotId, field.id, { type: "literal", value });
      }
    }
  );
  return (
    <Flex direction="column" gap="1">
      <BindableExpressionControl
        {...binding}
        value={draft.value}
        {...getBindingHandlers(slotId, field.id)}
        renderControl={({ readOnly }) => (
          <CodeEditor
            lang="html"
            title={
              <DialogTitle
                maximizable
                suffix={
                  <DialogTitleActions>
                    <DialogMaximize />
                    <DialogClose />
                  </DialogTitleActions>
                }
              >
                <Text variant="labels">{humanizeAttribute(field.name)}</Text>
              </DialogTitle>
            }
            readOnly={readOnly}
            invalid={error !== undefined}
            value={readOnly ? formatValue(boundValue) : draft.value}
            onChange={(value) => {
              setError(undefined);
              draft.set(value);
            }}
            onChangeComplete={draft.save}
          />
        )}
      />
      {error !== undefined && <Text color="destructive">{error}</Text>}
    </Flex>
  );
};

/** Boolean property: a switch, or bound to a variable with the dot. */
const BooleanValueControl = ({
  slotId,
  property,
}: {
  slotId: string;
  property: CustomSlotProperty;
}) => {
  const { field, localValue } = property;
  const shownValue = localValue ?? field.defaultValue;
  const checked =
    shownValue?.type === "literal" ? shownValue.value === true : false;
  const binding = useBindableControl({
    boundExpression: localValue?.type === "expression" ? localValue : undefined,
    fallbackExpression: JSON.stringify(checked),
  });
  return (
    <BindableExpressionControl
      {...binding}
      value={checked}
      onChangeValue={(value) =>
        setValue(slotId, field.id, { type: "literal", value })
      }
      onChangeExpression={(value) =>
        setValue(slotId, field.id, { type: "expression", value })
      }
      onRemove={(value) =>
        setValue(slotId, field.id, { type: "literal", value: Boolean(value) })
      }
      renderControl={({ value, readOnly, onChangeValue }) => (
        <Switch
          disabled={readOnly}
          checked={value}
          onCheckedChange={onChangeValue}
        />
      )}
    />
  );
};

/** Image property: pick from the asset library, or paste an image URL. */
const ImageValueControl = ({
  slotId,
  property,
}: {
  slotId: string;
  property: CustomSlotProperty;
}) => {
  const { field, localValue } = property;
  const shownValue = localValue ?? field.defaultValue;
  const draft = useDraftValue(
    shownValue?.type === "literal" ? formatValue(shownValue.value) : "",
    (value) => setValue(slotId, field.id, { type: "literal", value })
  );
  return (
    <Flex direction="column" gap="1">
      <SelectAsset
        accept="image/*"
        assetId={shownValue?.type === "asset" ? shownValue.value : undefined}
        onChange={(assetId) =>
          setValue(slotId, field.id, { type: "asset", value: assetId })
        }
      />
      <InputField
        placeholder="or paste an image URL"
        value={draft.value}
        onChange={(event) => draft.set(event.target.value)}
        onBlur={draft.save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            draft.save();
          }
        }}
      />
    </Flex>
  );
};

const toUrlInputProp = (value: undefined | CustomSlotFieldValue) => {
  if (value?.type === "page") {
    return { type: "page" as const, value: value.value };
  }
  if (value?.type === "expression") {
    return { type: "expression" as const, value: value.value };
  }
  if (value?.type === "literal") {
    return { type: "string" as const, value: formatValue(value.value) };
  }
};

/** Link property: the same URL, Page, Email and Phone picker as a Link. */
const LinkValueControl = ({
  slotId,
  property,
}: {
  slotId: string;
  property: CustomSlotProperty;
}) => {
  const { field, localValue } = property;
  // show the default until this copy has its own link
  const shownValue = localValue ?? field.defaultValue;
  const binding = useBindableControl({
    boundExpression: localValue?.type === "expression" ? localValue : undefined,
    fallbackExpression: JSON.stringify(
      shownValue?.type === "literal" ? formatValue(shownValue.value) : ""
    ),
  });
  const value = useAsyncValue(
    () =>
      shownValue?.type === "expression"
        ? evaluateExpressionWithinScope(shownValue.value, binding.scope)
        : Promise.resolve(
            shownValue?.type === "literal" ? shownValue.value : undefined
          ),
    [shownValue, binding.scope],
    undefined
  );
  const onChange = (next: UrlInputValue) => {
    if (next.type === "asset") {
      toast.error("Attachments can't be used in properties yet.");
      return;
    }
    setValue(
      slotId,
      field.id,
      next.type === "page"
        ? { type: "page", value: next.value }
        : { type: "literal", value: next.value }
    );
  };
  return (
    <UrlInput
      // remount when switching copies so the picker shows the right mode
      key={slotId}
      instanceId={slotId}
      prop={toUrlInputProp(shownValue)}
      value={formatValue(value)}
      readOnly={binding.bindingState.overwritable === false}
      onChange={onChange}
      renderControl={(control) => (
        <BindableExpressionControl
          {...binding}
          value={formatValue(value)}
          {...getBindingHandlers(slotId, field.id)}
          renderControl={() => control}
        />
      )}
    />
  );
};

/** Number property: a number field, or bound to a variable with the dot. */
const NumberValueControl = ({
  slotId,
  property,
}: {
  slotId: string;
  property: CustomSlotProperty;
}) => {
  const { field, localValue } = property;
  const { binding, boundValue } = useTextBinding(localValue);
  const draft = useDraftValue(
    localValue?.type === "literal" ? formatValue(localValue.value) : "",
    (value) => {
      const number = Number(value);
      // keep what was typed, so a mistake shows an error instead of vanishing
      setValue(slotId, field.id, {
        type: "literal",
        value: value.trim() !== "" && Number.isFinite(number) ? number : value,
      });
    }
  );
  const defaultValue =
    field.defaultValue?.type === "literal" ? field.defaultValue.value : "";
  return (
    <BindableExpressionControl
      {...binding}
      value={draft.value}
      {...getBindingHandlers(slotId, field.id)}
      renderControl={({ readOnly }) => (
        <InputField
          inputMode="decimal"
          disabled={readOnly}
          placeholder={formatValue(defaultValue)}
          value={readOnly ? formatValue(boundValue) : draft.value}
          onChange={(event) => draft.set(event.target.value)}
          onBlur={draft.save}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              draft.save();
            }
          }}
        />
      )}
    />
  );
};

const formatJson = (value: unknown) =>
  value === undefined ? "" : JSON.stringify(value, null, 2);

/** JSON property: an object or array typed as JSON, or bound to data. */
const JsonValueControl = ({
  slotId,
  property,
}: {
  slotId: string;
  property: CustomSlotProperty;
}) => {
  const { field, localValue } = property;
  const [error, setError] = useState<string>();
  const shownValue = localValue ?? field.defaultValue;
  const binding = useBindableControl({
    boundExpression: localValue?.type === "expression" ? localValue : undefined,
    fallbackExpression:
      shownValue?.type === "literal" ? JSON.stringify(shownValue.value) : "{}",
  });
  const boundValue = useAsyncValue(
    () =>
      localValue?.type === "expression"
        ? evaluateExpressionWithinScope(localValue.value, binding.scope)
        : Promise.resolve(undefined),
    [localValue, binding.scope],
    undefined
  );
  const draft = useDraftValue(
    shownValue?.type === "literal" ? formatJson(shownValue.value) : "",
    (value) => {
      try {
        setValue(slotId, field.id, {
          type: "literal",
          value: JSON.parse(value),
        });
        setError(undefined);
      } catch {
        setError('Enter valid JSON, e.g. {"title": "Hello"}');
      }
    }
  );
  return (
    <Flex direction="column" gap="1">
      <BindableExpressionControl
        {...binding}
        value={draft.value}
        onChangeValue={(value) =>
          setValue(slotId, field.id, { type: "literal", value })
        }
        onChangeExpression={(value) =>
          setValue(slotId, field.id, { type: "expression", value })
        }
        onRemove={(value) =>
          setValue(slotId, field.id, {
            type: "literal",
            value: value ?? {},
          })
        }
        renderControl={({ readOnly }) => (
          <CodeEditor
            lang="json"
            title={
              <DialogTitle
                maximizable
                suffix={
                  <DialogTitleActions>
                    <DialogMaximize />
                    <DialogClose />
                  </DialogTitleActions>
                }
              >
                <Text variant="labels">{humanizeAttribute(field.name)}</Text>
              </DialogTitle>
            }
            readOnly={readOnly}
            invalid={error !== undefined}
            value={readOnly ? formatJson(boundValue) : draft.value}
            onChange={(value) => {
              setError(undefined);
              draft.set(value);
            }}
            onChangeComplete={draft.save}
          />
        )}
      />
      {error !== undefined && <Text color="destructive">{error}</Text>}
    </Flex>
  );
};

/** Choice property: one click picks one of the fixed values. */
const ChoiceValueControl = ({
  slotId,
  property,
}: {
  slotId: string;
  property: CustomSlotProperty;
}) => {
  const { field, localValue } = property;
  const shownValue = localValue ?? field.defaultValue;
  const current =
    shownValue?.type === "literal" && typeof shownValue.value === "string"
      ? shownValue.value
      : undefined;
  const choices = field.choices ?? [];
  // a removed choice stays visible until another one is picked
  const options =
    current === undefined || choices.includes(current)
      ? choices
      : [current, ...choices];
  if (options.length === 0) {
    return <Text color="subtle">Add choices from the property menu.</Text>;
  }
  return (
    <Select
      options={options}
      placeholder="Pick a choice"
      value={current}
      onChange={(value) =>
        setValue(slotId, field.id, { type: "literal", value })
      }
    />
  );
};

const EditChoicesForm = ({
  field,
  fragmentId,
  onClose,
}: {
  field: CustomSlotField;
  fragmentId: string;
  onClose: () => void;
}) => {
  const [value, setValue] = useState((field.choices ?? []).join(", "));
  const submit = () => {
    executeRuntimeMutation({
      id: "customSlots.updateField",
      input: {
        fragmentId,
        fieldId: field.id,
        choices: parseChoicesInput(value),
      },
    });
    onClose();
  };
  return (
    <Flex gap="1" align="center">
      <InputField
        autoFocus
        css={{ flexGrow: 1 }}
        placeholder="Choices, e.g. small, large"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            submit();
          }
          if (event.key === "Escape") {
            onClose();
          }
        }}
      />
      <Button type="button" onClick={submit}>
        Save
      </Button>
      <SmallIconButton aria-label="Cancel" icon={<XIcon />} onClick={onClose} />
    </Flex>
  );
};

const PropertyRow = ({
  slotId,
  fragmentId,
  property,
  takenNames,
  canEditProperties,
}: {
  slotId: string;
  fragmentId: string;
  property: CustomSlotProperty;
  /** names of the component's other properties */
  takenNames: readonly string[];
  /** content editors fill in the value but cannot change the property */
  canEditProperties: boolean;
}) => {
  const { field, localValue } = property;
  const [isRenaming, setIsRenaming] = useState(false);
  const [isEditingChoices, setIsEditingChoices] = useState(false);
  const isLink = field.type === "link";
  const issue = getCustomSlotFieldIssue(field, localValue);

  if (isRenaming) {
    return (
      <PropertyNameForm
        initialLabel={humanizeAttribute(field.name)}
        submitLabel="Rename"
        describe={describeTakenName(
          takenNames.filter((name) => name !== field.name)
        )}
        onCancel={() => setIsRenaming(false)}
        onSubmit={(name) => {
          executeRuntimeMutation({
            id: "customSlots.updateField",
            input: { fragmentId, fieldId: field.id, name },
          });
          setIsRenaming(false);
        }}
      />
    );
  }

  return (
    <Flex direction="column" gap="1">
      <Flex align="center" justify="between">
        <ResettableLabel
          color={localValue === undefined ? "default" : "local"}
          resetLabel="Use default"
          onReset={
            localValue === undefined
              ? undefined
              : () => setValue(slotId, field.id, null)
          }
          description={
            <Text>
              Shared by every copy. This copy
              {localValue === undefined
                ? " uses the default value."
                : " has its own value."}
            </Text>
          }
        >
          {humanizeAttribute(field.name)}
        </ResettableLabel>
        {canEditProperties && (
          <DropdownMenu modal>
            <DropdownMenuTrigger asChild>
              <SmallIconButton
                aria-label={`Open ${field.name} property menu`}
                icon={<EllipsesIcon />}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              css={{ width: theme.spacing[28] }}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <DropdownMenuItem onSelect={() => setIsRenaming(true)}>
                Rename
              </DropdownMenuItem>
              {field.type === "choice" && (
                <DropdownMenuItem onSelect={() => setIsEditingChoices(true)}>
                  Edit choices
                </DropdownMenuItem>
              )}
              {Array.from(propertyTypes)
                .filter(([type]) => type !== (field.type ?? "text"))
                .map(([type, typeLabel]) => (
                  <DropdownMenuItem
                    key={type}
                    onSelect={() =>
                      executeRuntimeMutation({
                        id: "customSlots.updateField",
                        input: { fragmentId, fieldId: field.id, type },
                      })
                    }
                  >
                    Change to {typeLabel}
                  </DropdownMenuItem>
                ))}
              {localValue !== undefined && localValue.type !== "expression" && (
                <DropdownMenuItem
                  onSelect={() =>
                    executeRuntimeMutation({
                      id: "customSlots.updateField",
                      input: {
                        fragmentId,
                        fieldId: field.id,
                        defaultValue: localValue,
                      },
                    })
                  }
                >
                  Make this the default
                </DropdownMenuItem>
              )}
              {field.defaultValue !== undefined && (
                <DropdownMenuItem
                  onSelect={() =>
                    executeRuntimeMutation({
                      id: "customSlots.updateField",
                      input: {
                        fragmentId,
                        fieldId: field.id,
                        defaultValue: null,
                      },
                    })
                  }
                >
                  Remove default (required)
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                destructive
                onSelect={() => deleteProperty({ fragmentId, field })}
              >
                Delete from all copies
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Flex>
      {isEditingChoices && (
        <EditChoicesForm
          field={field}
          fragmentId={fragmentId}
          onClose={() => setIsEditingChoices(false)}
        />
      )}
      {isLink ? (
        <LinkValueControl slotId={slotId} property={property} />
      ) : field.type === "image" ? (
        <ImageValueControl slotId={slotId} property={property} />
      ) : field.type === "boolean" ? (
        <BooleanValueControl slotId={slotId} property={property} />
      ) : field.type === "html" ? (
        <HtmlValueControl slotId={slotId} property={property} />
      ) : field.type === "number" ? (
        <NumberValueControl slotId={slotId} property={property} />
      ) : field.type === "json" ? (
        <JsonValueControl slotId={slotId} property={property} />
      ) : field.type === "choice" ? (
        <ChoiceValueControl slotId={slotId} property={property} />
      ) : (
        <TextValueControl slotId={slotId} property={property} />
      )}
      {issue !== undefined && <Text color="destructive">{issue.message}</Text>}
    </Flex>
  );
};

// Radix Select cannot use an empty value
const noTag = "none";

/**
 * The element a copy renders as. By default a copy adds no element, so the
 * page structure stays as it was; li, article or section wrap the copy in
 * that element.
 */
const CopyTagSelect = ({ slotId }: { slotId: string }) => {
  const instance = useStore($selectedInstance);
  return (
    <Flex align="center" justify="between" gap="2">
      <Text variant="titles">Tag</Text>
      <Select
        css={{ width: theme.spacing[22] }}
        options={[noTag, ...customSlotTags]}
        getLabel={(tag: string) => (tag === noTag ? "None" : tag)}
        value={getCustomSlotTag(instance?.tag) ?? noTag}
        onChange={(tag) =>
          executeRuntimeMutation({
            id: "instances.setTag",
            input: { instanceId: slotId, tag: tag === noTag ? "" : tag },
          })
        }
      />
    </Flex>
  );
};

/** Settings inside the component still connected to deleted properties. */
const $brokenConnections = computed(
  [$selectedCustomSlot, $instances, $props, $dataSources],
  (selected, instances, props, dataSources) =>
    selected === undefined
      ? []
      : findBrokenCustomSlotReferences({
          instances,
          props,
          dataSources,
          fragmentId: selected.fragmentId,
        })
);

const label = "Properties";

const BrokenConnections = () => {
  const broken = useStore($brokenConnections);
  if (broken.length === 0) {
    return;
  }
  const names = Array.from(new Set(broken.map(({ name }) => name)));
  return (
    <Text color="destructive">
      {broken.length === 1
        ? "1 setting inside is"
        : `${broken.length} settings inside are`}{" "}
      connected to deleted {names.length === 1 ? "property" : "properties"}{" "}
      {names.map((name) => humanizeAttribute(name)).join(", ")}. Select it and
      connect it to another property or remove the connection.
    </Text>
  );
};

/**
 * Properties of the selected Custom Slot copy, like Figma or Webflow component
 * properties: the list is shared, each copy fills in its own values.
 */
export const CustomSlotPropertiesSection = () => {
  const selected = useStore($selectedCustomSlot);
  const isContentMode = useStore($isContentMode);
  const isContentEditable = useStore($isSelectedCopyContentEditable);
  const instances = useStore($instances);
  const [isOpen, setIsOpen] = useOpenState(label);
  const [isAdding, setIsAdding] = useState(false);
  if (
    selected === undefined ||
    (isContentMode && isContentEditable === false)
  ) {
    return;
  }
  const { slotId, fragmentId, overrideTarget } = selected;
  const isDesigner = isContentMode === false;
  // data bindings and HTML Embed code stay with designers
  const properties = isDesigner
    ? selected.properties
    : selected.properties.filter(({ field, localValue }) =>
        isCustomSlotFieldContentEditable(field, localValue)
      );
  const variant = properties.find(({ field }) => field.type === "variant");
  const takenNames = selected.properties.map(({ field }) => field.name);
  return (
    <CollapsibleSectionRoot
      label={label}
      fullWidth={true}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      trigger={
        <SectionTitle
          suffix={
            isDesigner && (
              <SectionTitleButton
                type="button"
                aria-label="Add property"
                prefix={<PlusIcon />}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setIsOpen(true);
                  setIsAdding(true);
                }}
              />
            )
          }
        >
          <SectionTitleLabel>
            {getComponentName(instances, selected.fragmentId)} {label}
          </SectionTitleLabel>
        </SectionTitle>
      }
    >
      <Flex direction="column" gap="2" css={{ px: theme.panel.paddingInline }}>
        {overrideTarget !== undefined && (
          <Text color="subtle">
            Changes apply only inside{" "}
            {getInstanceLabel(overrideTarget.ownerSlotId)}. Click a property
            name to use the shared value again.
          </Text>
        )}
        {isDesigner && <BrokenConnections />}
        {isDesigner && <CopyTagSelect slotId={slotId} />}
        {(isDesigner || (variant?.field.options?.length ?? 0) > 0) && (
          <VariantSwitcher
            slotId={slotId}
            fragmentId={fragmentId}
            variant={variant}
            canEditVariants={isDesigner}
          />
        )}
        {properties
          .filter(({ field }) => field.type !== "variant")
          .map((property) => (
            <PropertyRow
              key={property.field.id}
              slotId={slotId}
              fragmentId={fragmentId}
              property={property}
              takenNames={takenNames}
              canEditProperties={isDesigner}
            />
          ))}
        {isDesigner && isAdding && (
          <AddPropertyForm
            takenNames={takenNames}
            onCancel={() => setIsAdding(false)}
            onSubmit={(property) => {
              createProperty({ fragmentId, property });
              setIsAdding(false);
            }}
          />
        )}
        {isDesigner && (
          <Text color="subtle">
            {properties.length === 0
              ? "Add a property, then select an element inside and connect a setting to it with the dot next to the setting."
              : "Connect a setting inside this component to a property with the dot next to the setting. Everything else is shared by every copy."}
          </Text>
        )}
      </Flex>
    </CollapsibleSectionRoot>
  );
};

/** Broken connections of the selected element inside a component source. */
const $selectedElementBrokenConnections = computed(
  [$selectedInstanceSelector, $instances, $props, $dataSources],
  (instanceSelector, instances, props, dataSources) => {
    if (instanceSelector === undefined) {
      return [];
    }
    // the closest component the element is shown inside
    for (let index = 1; index < instanceSelector.length - 1; index += 1) {
      const fragmentId = instanceSelector[index];
      if (
        instances.get(fragmentId)?.component === "Fragment" &&
        instances.get(instanceSelector[index + 1])?.component ===
          customSlotComponent
      ) {
        return findBrokenCustomSlotReferences({
          instances,
          props,
          dataSources,
          fragmentId,
        }).filter(({ instanceId }) => instanceId === instanceSelector[0]);
      }
    }
    return [];
  }
);

/**
 * Shown on an element whose settings are connected to a property that was
 * deleted, until they are connected to another property or disconnected.
 */
export const BrokenPropertyConnectionsBanner = () => {
  const broken = useStore($selectedElementBrokenConnections);
  const isContentMode = useStore($isContentMode);
  if (broken.length === 0 || isContentMode) {
    return;
  }
  return (
    <Flex
      direction="column"
      gap="1"
      css={{ px: theme.panel.paddingInline, pb: theme.spacing[5] }}
    >
      {broken.map(({ propName, name }, index) => (
        <Text key={index} color="destructive">
          {propName === undefined ? "Text" : humanizeAttribute(propName)} is
          connected to deleted property {humanizeAttribute(name)}. Connect it to
          another property or remove the connection.
        </Text>
      ))}
    </Flex>
  );
};
