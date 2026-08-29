import { useEffect, useState, type CSSProperties } from "react";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { Form, useNavigation, useSubmit } from "react-router";

import { eventValue } from "../../utils/event-value";

export type CustomerFieldView = {
  id: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder: string | null;
  helpText: string | null;
  defaultValue: string | null;
  options: string[];
};

type CustomerFieldsProps = {
  fields: CustomerFieldView[];
  editable: boolean;
};

const fieldTypeLabels: Record<string, string> = {
  IMAGE: "Image upload",
  TEXT: "Text",
  TEXTAREA: "Long text",
  SELECT: "Select",
  TOGGLE: "Checkbox",
  NUMBER: "Number",
  DATE: "Date",
};

type FieldFormState = {
  label: string;
  type: string;
  required: boolean;
  placeholder: string;
  helpText: string;
  defaultValue: string;
  options: string;
};

const blankFieldValues: FieldFormState = {
  label: "",
  type: "IMAGE",
  required: false,
  placeholder: "",
  helpText: "",
  defaultValue: "",
  options: "",
};

function fieldValuesOf(field: CustomerFieldView): FieldFormState {
  return {
    label: field.label,
    type: field.type,
    required: field.required,
    placeholder: field.placeholder ?? "",
    helpText: field.helpText ?? "",
    defaultValue: field.defaultValue ?? "",
    options: field.options.join("\n"),
  };
}

function checkedValue(event: Event): boolean {
  const target = event.currentTarget as { checked?: boolean } | null;

  return target?.checked ?? false;
}

const TEXT_LIKE_TYPES = new Set(["TEXT", "TEXTAREA", "NUMBER", "SELECT"]);

const DEFAULT_VALUE_TYPES = new Set([
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "DATE",
  "SELECT",
]);

function FieldFormFields({
  values,
  onChange,
}: {
  values: FieldFormState;
  onChange: (patch: Partial<FieldFormState>) => void;
}) {
  const showPlaceholder = TEXT_LIKE_TYPES.has(values.type);

  const showDefaultValue = DEFAULT_VALUE_TYPES.has(values.type);

  const showOptions = values.type === "SELECT";

  return (
    <s-stack direction="block" gap="base">
      <s-text-field
        label="Field label"
        name="label"
        value={values.label}
        onInput={(event: Event) => onChange({ label: eventValue(event) })}
        required
        autocomplete="off"
        details="Customer-facing label shown on the product page."
      />

      <s-query-container>
        <s-grid
          gridTemplateColumns="@container (inline-size > 420px) 1fr 1fr, 1fr"
          gap="base"
        >
          <s-select
            label="Field type"
            name="type"
            value={values.type}
            onInput={(event: Event) => onChange({ type: eventValue(event) })}
            details="Choose the kind of information the customer should provide."
          >
            <s-option value="IMAGE">Image upload</s-option>

            <s-option value="TEXT">Text</s-option>

            <s-option value="TEXTAREA">Long text</s-option>

            <s-option value="SELECT">Select</s-option>

            <s-option value="TOGGLE">Checkbox</s-option>

            <s-option value="NUMBER">Number</s-option>

            <s-option value="DATE">Date</s-option>
          </s-select>

          <s-checkbox
            label="Required"
            name="required"
            value="yes"
            checked={values.required}
            onInput={(event: Event) =>
              onChange({ required: checkedValue(event) })
            }
            details="Customers must complete this field before generating their artwork."
          />
        </s-grid>
      </s-query-container>

      {showPlaceholder || showDefaultValue ? (
        <s-query-container>
          <s-grid
            gridTemplateColumns="@container (inline-size > 420px) 1fr 1fr, 1fr"
            gap="base"
          >
            {showPlaceholder ? (
              <s-text-field
                label="Placeholder"
                name="placeholder"
                value={values.placeholder}
                onInput={(event: Event) =>
                  onChange({ placeholder: eventValue(event) })
                }
                autocomplete="off"
                details="Optional example or hint shown inside the input."
              />
            ) : null}

            {showDefaultValue ? (
              <s-text-field
                label="Default value"
                name="defaultValue"
                value={values.defaultValue}
                onInput={(event: Event) =>
                  onChange({ defaultValue: eventValue(event) })
                }
                autocomplete="off"
                details="Optional initial value for this field."
              />
            ) : null}
          </s-grid>
        </s-query-container>
      ) : null}

      <s-text-field
        label="Help text"
        name="helpText"
        value={values.helpText}
        onInput={(event: Event) => onChange({ helpText: eventValue(event) })}
        autocomplete="off"
        details="Optional supporting instruction shown with the field."
      />

      {showOptions ? (
        <s-text-area
          label="Select options"
          name="options"
          value={values.options}
          onInput={(event: Event) => onChange({ options: eventValue(event) })}
          rows={5}
          autocomplete="off"
          details="Enter one option per line."
        />
      ) : null}
    </s-stack>
  );
}

function EditFieldModal({
  field,
  submitting,
}: {
  field: CustomerFieldView;
  submitting: boolean;
}) {
  const initialValues = fieldValuesOf(field);

  const [values, setValues] = useState<FieldFormState>(initialValues);

  const isDirty =
    values.label !== initialValues.label ||
    values.type !== initialValues.type ||
    values.required !== initialValues.required ||
    values.placeholder !== initialValues.placeholder ||
    values.helpText !== initialValues.helpText ||
    values.defaultValue !== initialValues.defaultValue ||
    values.options !== initialValues.options;

  return (
    <s-modal
      id={`edit-field-${field.id}`}
      heading={`Edit ${field.label}`}
      size="large"
    >
      <Form method="post">
        <input type="hidden" name="intent" value="editField" />

        <input type="hidden" name="fieldId" value={field.id} />

        <s-stack direction="block" gap="base">
          <FieldFormFields
            values={values}
            onChange={(patch) =>
              setValues((current) => ({ ...current, ...patch }))
            }
          />

          <s-stack direction="inline" gap="base">
            <s-button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={!isDirty || submitting}
            >
              Save changes
            </s-button>

            <s-button
              variant="secondary"
              commandFor={`edit-field-${field.id}`}
              command="--hide"
              onClick={() => setValues(initialValues)}
              disabled={submitting}
            >
              Cancel
            </s-button>
          </s-stack>
        </s-stack>
      </Form>
    </s-modal>
  );
}

// A realistic mock of the storefront form itself — plain HTML markup
// styled like a typical theme's product-page form, not Polaris admin
// components (which read as "the admin", not "the storefront"). No
// layout/sizing controls, just the fields themselves in order, so a
// merchant can sanity-check labels, help text, and required markers
// before publishing.
const previewControlStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 14px",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: "15px",
  color: "#1a1a1a",
  border: "1px solid #d1d1d1",
  borderRadius: "8px",
  background: "#ffffff",
};

function PreviewFieldControl({ field }: { field: CustomerFieldView }) {
  switch (field.type) {
    case "IMAGE":
      return (
        <div
          style={{
            ...previewControlStyle,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            padding: "22px 16px",
            borderStyle: "dashed",
            color: "#6d7175",
            cursor: "pointer",
          }}
        >
          <s-icon type="upload" tone="neutral" />

          <s-text type="strong">Drag and drop</s-text>

          <s-text color="subdued">or browse files</s-text>

          <s-box paddingBlockStart="small-300">
            <s-box
              padding="small-300"
              paddingInline="small"
              background="subdued"
              borderWidth="base"
              borderColor="base"
              borderRadius="base"
            >
              <s-text type="strong">Browse</s-text>
            </s-box>
          </s-box>
        </div>
      );

    case "TEXTAREA":
      return (
        <textarea
          placeholder={field.placeholder ?? ""}
          defaultValue={field.defaultValue ?? ""}
          rows={4}
          readOnly
          style={{ ...previewControlStyle, resize: "vertical" }}
        />
      );

    case "SELECT":
      return (
        <select style={{ ...previewControlStyle, cursor: "pointer" }}>
          <option value="">{field.placeholder || "Choose an option"}</option>

          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );

    case "TOGGLE":
      return (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            fontSize: "15px",
            color: "#1a1a1a",
          }}
        >
          <input type="checkbox" style={{ width: "18px", height: "18px" }} />

          {field.placeholder || "Yes"}
        </label>
      );

    case "NUMBER":
      return (
        <input
          type="number"
          placeholder={field.placeholder ?? ""}
          defaultValue={field.defaultValue ?? ""}
          readOnly
          style={previewControlStyle}
        />
      );

    case "DATE":
      return <input type="date" readOnly style={previewControlStyle} />;

    default:
      return (
        <input
          type="text"
          placeholder={field.placeholder ?? ""}
          defaultValue={field.defaultValue ?? ""}
          readOnly
          style={previewControlStyle}
        />
      );
  }
}

function PreviewField({ field }: { field: CustomerFieldView }) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <label
        style={{
          display: "block",
          marginBottom: "6px",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          fontSize: "14px",
          fontWeight: 600,
          color: "#1a1a1a",
        }}
      >
        {field.label}

        {field.required ? <span style={{ color: "#d82c0d" }}> *</span> : null}
      </label>

      <PreviewFieldControl field={field} />

      {field.helpText ? (
        <p
          style={{
            margin: "6px 0 0",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            fontSize: "13px",
            color: "#6d7175",
          }}
        >
          {field.helpText}
        </p>
      ) : null}
    </div>
  );
}

function PreviewFieldsModal({ fields }: { fields: CustomerFieldView[] }) {
  return (
    <s-modal
      id="preview-customer-fields"
      heading="Customer input preview"
      size="large"
    >
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          A mock of the storefront form as customers will see it — not the admin
          editing UI.
        </s-text>

        <div
          style={{
            padding: "24px",
            background: "#f6f6f7",
            borderRadius: "8px",
          }}
        >
          <div
            style={{
              maxWidth: "480px",
              margin: "0 auto",
              padding: "24px",
              background: "#ffffff",
              border: "1px solid #e1e1e1",
              borderRadius: "12px",
            }}
          >
            {fields.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontFamily:
                    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                  fontSize: "14px",
                  color: "#6d7175",
                }}
              >
                No fields yet — add one to see it previewed here.
              </p>
            ) : (
              <>
                {fields.map((field) => (
                  <PreviewField key={field.id} field={field} />
                ))}

                <button
                  type="button"
                  disabled
                  style={{
                    width: "100%",
                    padding: "13px",
                    fontFamily:
                      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                    fontSize: "15px",
                    fontWeight: 600,
                    color: "#ffffff",
                    background: "#1a1a1a",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "not-allowed",
                  }}
                >
                  Generate my artwork
                </button>
              </>
            )}
          </div>
        </div>

        <s-stack direction="inline" gap="base">
          <s-button
            variant="secondary"
            commandFor="preview-customer-fields"
            command="--hide"
          >
            Close
          </s-button>
        </s-stack>
      </s-stack>
    </s-modal>
  );
}

type SortableFieldRowProps = {
  field: CustomerFieldView;
  index: number;
  editable: boolean;
  submitting: boolean;
  submittingIntent: FormDataEntryValue | null | undefined;
  submittingFieldId: FormDataEntryValue | null | undefined;
  submittingDirection: FormDataEntryValue | null | undefined;
  isLast: boolean;
};

// A draggable row using @dnd-kit — the same library and pattern this
// shop's wholesale-registration app uses for its form builder's field
// list, rather than raw HTML5 drag events (which don't interact well
// with custom elements like s-table-row and feel janky).
function SortableFieldRow({
  field,
  index,
  editable,
  submitting,
  submittingIntent,
  submittingFieldId,
  submittingDirection,
  isLast,
}: SortableFieldRowProps) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: field.id,
    index,
    group: "customer-fields",
    disabled: !editable,

    transition: {
      duration: 180,
      easing: "cubic-bezier(0.25, 1, 0.5, 1)",
      idle: true,
    },
  });

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "12px",
        border: "1px solid",
        borderColor: isDropTarget ? "#005bd3" : "#e1e3e5",
        borderRadius: "8px",
        background: isDropTarget ? "#f4f8ff" : "#ffffff",
        opacity: isDragging ? 0.6 : 1,
        boxShadow: isDragging ? "0 10px 24px rgba(0, 0, 0, 0.14)" : undefined,
        zIndex: isDragging ? 20 : undefined,
        transition: "border-color 140ms ease, background 140ms ease",
      }}
    >
      {editable ? (
        <button
          ref={handleRef}
          type="button"
          aria-label={`Drag ${field.label} to reorder`}
          title="Drag to reorder"
          style={{
            display: "grid",
            placeItems: "center",
            flex: "0 0 auto",
            width: "22px",
            height: "32px",
            marginTop: "2px",
            padding: 0,
            border: 0,
            borderRadius: "6px",
            background: "transparent",
            color: "#6d7175",
            cursor: "grab",
            touchAction: "none",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "block",
              width: "14px",
              height: "20px",
              backgroundImage:
                "radial-gradient(circle, currentColor 1.4px, transparent 1.6px)",
              backgroundPosition: "1px 1px",
              backgroundSize: "6px 6px",
              opacity: 0.7,
            }}
          />
        </button>
      ) : null}

      <div style={{ flex: 1, minWidth: 0 }}>
        <s-stack
          direction="inline"
          gap="base"
          alignItems="start"
          justifyContent="space-between"
        >
          <s-stack direction="block" gap="small-200">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-text type="strong">{field.label}</s-text>

              <s-badge tone="info">
                {fieldTypeLabels[field.type] ?? field.type}
              </s-badge>

              {field.required ? (
                <s-badge tone="success">Required</s-badge>
              ) : (
                <s-badge tone="neutral">Optional</s-badge>
              )}
            </s-stack>

            {field.helpText ? (
              <s-text color="subdued">{field.helpText}</s-text>
            ) : null}
          </s-stack>

          {editable ? (
            <s-stack direction="inline" gap="small">
              <s-button
                variant="tertiary"
                commandFor={`edit-field-${field.id}`}
                command="--show"
              >
                Edit
              </s-button>

              <Form method="post">
                <input type="hidden" name="intent" value="moveField" />

                <input type="hidden" name="fieldId" value={field.id} />

                <input type="hidden" name="direction" value="up" />

                <s-button
                  type="submit"
                  icon="arrow-up"
                  variant="tertiary"
                  disabled={index === 0 || submitting}
                  loading={
                    submittingIntent === "moveField" &&
                    submittingFieldId === field.id &&
                    submittingDirection === "up"
                  }
                  accessibilityLabel={`Move ${field.label} up`}
                />
              </Form>

              <Form method="post">
                <input type="hidden" name="intent" value="moveField" />

                <input type="hidden" name="fieldId" value={field.id} />

                <input type="hidden" name="direction" value="down" />

                <s-button
                  type="submit"
                  icon="arrow-down"
                  variant="tertiary"
                  disabled={isLast || submitting}
                  loading={
                    submittingIntent === "moveField" &&
                    submittingFieldId === field.id &&
                    submittingDirection === "down"
                  }
                  accessibilityLabel={`Move ${field.label} down`}
                />
              </Form>

              <s-button
                icon="delete"
                variant="tertiary"
                tone="critical"
                commandFor={`delete-field-${field.id}`}
                command="--show"
                disabled={submitting}
                accessibilityLabel={`Delete ${field.label}`}
              />
            </s-stack>
          ) : (
            <s-text color="subdued">Locked</s-text>
          )}
        </s-stack>
      </div>
    </div>
  );
}

export function CustomerFields({ fields, editable }: CustomerFieldsProps) {
  const navigation = useNavigation();

  const submit = useSubmit();

  // Local, reorderable copy of the field list — updated instantly on
  // drop so dragging feels immediate, then synced back once the loader
  // data reflects the persisted order (or reverted if the save fails).
  const [orderedFields, setOrderedFields] = useState(fields);

  useEffect(() => {
    setOrderedFields(fields);
  }, [fields]);

  const submitReorder = (nextFields: CustomerFieldView[]) => {
    const formData = new FormData();

    formData.set("intent", "reorderFields");

    for (const field of nextFields) {
      formData.append("fieldId", field.id);
    }

    submit(formData, {
      method: "post",
    });
  };

  // Scoped to an actual form submission (formData present), not just any
  // pending navigation — a bare loading/GET transition must not disable
  // or flash these buttons into a loading state.
  const submitting =
    navigation.state !== "idle" && Boolean(navigation.formData);

  const submittingIntent = submitting
    ? navigation.formData?.get("intent")
    : null;

  const submittingFieldId = submitting
    ? navigation.formData?.get("fieldId")
    : null;

  const submittingDirection = submitting
    ? navigation.formData?.get("direction")
    : null;

  const addingField = submittingIntent === "addField";

  const [addValues, setAddValues] = useState<FieldFormState>(blankFieldValues);

  const addDirty = addValues.label.trim().length > 0;

  const resetAddForm = () => setAddValues(blankFieldValues);

  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-stack direction="block" gap="small">
            <s-heading>Product page fields</s-heading>

            <s-text color="subdued">
              Define what the customer must provide before this style can
              generate artwork.
            </s-text>
          </s-stack>

          <s-stack direction="inline" gap="small">
            {fields.length > 0 ? (
              <s-button
                variant="secondary"
                commandFor="preview-customer-fields"
                command="--show"
              >
                Preview
              </s-button>
            ) : null}

            {editable ? (
              <s-button
                icon="plus"
                variant="secondary"
                commandFor="add-customer-field"
                command="--show"
                onClick={resetAddForm}
              >
                Add field
              </s-button>
            ) : null}
          </s-stack>
        </s-stack>

        {fields.length === 0 ? (
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-text type="strong">No customer fields yet</s-text>

              <s-text color="subdued">
                Add an image upload or another input that this style needs from
                the customer.
              </s-text>
            </s-stack>
          </s-box>
        ) : (
          <DragDropProvider
            onDragEnd={(event) => {
              if (event.canceled || !editable) {
                return;
              }

              const reordered = move(orderedFields, event);

              const orderChanged = reordered.some(
                (reorderedField, fieldIndex) =>
                  reorderedField.id !== orderedFields[fieldIndex]?.id,
              );

              if (!orderChanged) {
                return;
              }

              setOrderedFields(reordered);

              submitReorder(reordered);
            }}
          >
            <s-stack direction="block" gap="small-200">
              {orderedFields.map((field, index) => (
                <SortableFieldRow
                  key={field.id}
                  field={field}
                  index={index}
                  editable={editable}
                  submitting={submitting}
                  submittingIntent={submittingIntent}
                  submittingFieldId={submittingFieldId}
                  submittingDirection={submittingDirection}
                  isLast={index === orderedFields.length - 1}
                />
              ))}
            </s-stack>
          </DragDropProvider>
        )}

        {editable ? (
          <s-modal
            id="add-customer-field"
            heading="Add customer field"
            size="large"
          >
            <Form method="post">
              <input type="hidden" name="intent" value="addField" />

              <s-stack direction="block" gap="base">
                <FieldFormFields
                  values={addValues}
                  onChange={(patch) =>
                    setAddValues((current) => ({ ...current, ...patch }))
                  }
                />

                <s-stack direction="inline" gap="base">
                  <s-button
                    type="submit"
                    variant="primary"
                    loading={addingField}
                    disabled={!addDirty || addingField}
                  >
                    Add field
                  </s-button>

                  <s-button
                    variant="secondary"
                    commandFor="add-customer-field"
                    command="--hide"
                    onClick={resetAddForm}
                    disabled={addingField}
                  >
                    Cancel
                  </s-button>
                </s-stack>
              </s-stack>
            </Form>
          </s-modal>
        ) : null}

        {editable
          ? fields.map((field) => (
              <EditFieldModal
                key={`edit-${field.id}`}
                field={field}
                submitting={
                  submittingIntent === "editField" &&
                  submittingFieldId === field.id
                }
              />
            ))
          : null}

        {editable
          ? fields.map((field) => (
              <s-modal
                key={`delete-${field.id}`}
                id={`delete-field-${field.id}`}
                heading="Delete customer field?"
              >
                <Form method="post">
                  <input type="hidden" name="intent" value="deleteField" />

                  <input type="hidden" name="fieldId" value={field.id} />

                  <s-stack direction="block" gap="base">
                    <s-paragraph>
                      Delete “{field.label}”? This field will no longer be
                      requested from customers.
                    </s-paragraph>

                    <s-text tone="critical">
                      This action cannot be undone.
                    </s-text>

                    <s-stack direction="inline" gap="base">
                      <s-button
                        variant="secondary"
                        commandFor={`delete-field-${field.id}`}
                        command="--hide"
                        disabled={
                          submittingIntent === "deleteField" &&
                          submittingFieldId === field.id
                        }
                      >
                        Cancel
                      </s-button>

                      <s-button
                        type="submit"
                        variant="primary"
                        tone="critical"
                        loading={
                          submittingIntent === "deleteField" &&
                          submittingFieldId === field.id
                        }
                        disabled={
                          submittingIntent === "deleteField" &&
                          submittingFieldId === field.id
                        }
                      >
                        Delete field
                      </s-button>
                    </s-stack>
                  </s-stack>
                </Form>
              </s-modal>
            ))
          : null}

        {fields.length > 0 ? (
          <PreviewFieldsModal fields={orderedFields} />
        ) : null}
      </s-stack>
    </s-section>
  );
}
