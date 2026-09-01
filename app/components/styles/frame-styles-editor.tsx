import { useEffect, useState } from "react";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { Form, useNavigation, useSubmit } from "react-router";

import { eventValue } from "../../utils/event-value";

export const CSS_TREATMENT_OPTIONS = [
  { value: "thin", label: "Thin" },
  { value: "gallery", label: "Gallery" },
  { value: "classic", label: "Classic" },
] as const;

export type FrameStyleView = {
  id: string;
  label: string;
  cssTreatment: string;
};

type FrameStyleFormState = {
  label: string;
  cssTreatment: string;
};

const blankFrameStyleValues: FrameStyleFormState = {
  label: "",
  cssTreatment: "thin",
};

function frameStyleValuesOf(style: FrameStyleView): FrameStyleFormState {
  return {
    label: style.label,
    cssTreatment: style.cssTreatment,
  };
}

type FrameStyleFormErrors = Partial<Record<keyof FrameStyleFormState, string>>;

function validateFrameStyleForm(
  values: FrameStyleFormState,
  otherLabels: string[],
): FrameStyleFormErrors {
  const errors: FrameStyleFormErrors = {};

  const label = values.label.trim();

  if (!label) {
    errors.label = "Name is required.";
  } else if (
    otherLabels.some(
      (existing) => existing.toLowerCase() === label.toLowerCase(),
    )
  ) {
    errors.label = "A frame style with this name already exists.";
  }

  return errors;
}

function FrameStyleFormFields({
  values,
  errors,
  onChange,
}: {
  values: FrameStyleFormState;
  errors: FrameStyleFormErrors;
  onChange: (patch: Partial<FrameStyleFormState>) => void;
}) {
  return (
    <s-stack direction="block" gap="base">
      <s-text-field
        label="Name"
        name="label"
        value={values.label}
        onInput={(event: Event) => onChange({ label: eventValue(event) })}
        placeholder="e.g. Gallery"
        required
        autocomplete="off"
        error={errors.label}
      />

      <s-select
        label="Border treatment"
        name="cssTreatment"
        value={values.cssTreatment}
        onChange={(event: Event) =>
          onChange({ cssTreatment: eventValue(event) })
        }
        error={errors.cssTreatment}
      >
        {CSS_TREATMENT_OPTIONS.map((option) => (
          <s-option key={option.value} value={option.value}>
            {option.label}
          </s-option>
        ))}
      </s-select>
    </s-stack>
  );
}

function AddFrameStyleModal({
  submitting,
  resetSignal,
  existingLabels,
}: {
  submitting: boolean;
  resetSignal: number;
  existingLabels: string[];
}) {
  const [values, setValues] = useState<FrameStyleFormState>(
    blankFrameStyleValues,
  );

  const [errors, setErrors] = useState<FrameStyleFormErrors>({});

  const dirty = values.label.trim().length > 0;

  const reset = () => {
    setValues(blankFrameStyleValues);
    setErrors({});
  };

  // Resets in place, not via remounting — see the identical comment in
  // size-options-editor.tsx's AddSizeModal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [resetSignal]);

  return (
    <s-modal id="add-frame-style" heading="Add frame style">
      <Form
        method="post"
        onSubmit={(event) => {
          const validationErrors = validateFrameStyleForm(
            values,
            existingLabels,
          );

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
          }

          // Do NOT reset values here — see AddSizeModal's identical
          // comment. The trigger button resets it instead, right
          // before a fresh modal opens.
        }}
      >
        <input type="hidden" name="intent" value="addFrameStyle" />

        <s-stack direction="block" gap="base">
          <FrameStyleFormFields
            values={values}
            errors={errors}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };

                for (const key of Object.keys(patch) as Array<
                  keyof FrameStyleFormState
                >) {
                  delete next[key];
                }

                return next;
              });
            }}
          />

          <s-stack direction="inline" gap="base">
            <s-button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={!dirty || submitting}
            >
              Add frame style
            </s-button>

            <s-button
              variant="secondary"
              commandFor="add-frame-style"
              command="--hide"
              onClick={reset}
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

function EditFrameStyleModal({
  style,
  submitting,
  otherLabels,
}: {
  style: FrameStyleView;
  submitting: boolean;
  otherLabels: string[];
}) {
  const initialValues = frameStyleValuesOf(style);

  const [values, setValues] = useState<FrameStyleFormState>(initialValues);

  const [errors, setErrors] = useState<FrameStyleFormErrors>({});

  const isDirty =
    values.label !== initialValues.label ||
    values.cssTreatment !== initialValues.cssTreatment;

  return (
    <s-modal id={`edit-frame-style-${style.id}`} heading={`Edit ${style.label}`}>
      <Form
        method="post"
        onSubmit={(event) => {
          const validationErrors = validateFrameStyleForm(values, otherLabels);

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
            return;
          }

          setErrors({});
        }}
      >
        <input type="hidden" name="intent" value="editFrameStyle" />

        <input type="hidden" name="frameStyleId" value={style.id} />

        <s-stack direction="block" gap="base">
          <FrameStyleFormFields
            values={values}
            errors={errors}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };

                for (const key of Object.keys(patch) as Array<
                  keyof FrameStyleFormState
                >) {
                  delete next[key];
                }

                return next;
              });
            }}
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
              commandFor={`edit-frame-style-${style.id}`}
              command="--hide"
              onClick={() => {
                setValues(initialValues);
                setErrors({});
              }}
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

function cssTreatmentLabel(cssTreatment: string) {
  return (
    CSS_TREATMENT_OPTIONS.find((option) => option.value === cssTreatment)
      ?.label ?? cssTreatment
  );
}

// Draggable row using @dnd-kit — same library/pattern as this app's
// Customer fields tab (see SortableFieldRow in customer-fields.tsx).
function SortableFrameStyleRow({
  style,
  index,
  editable,
}: {
  style: FrameStyleView;
  index: number;
  editable: boolean;
}) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: style.id,
    index,
    group: "frame-styles",
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
          aria-label={`Drag ${style.label} to reorder`}
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
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text type="strong">{style.label}</s-text>

            <s-badge tone="info">{cssTreatmentLabel(style.cssTreatment)}</s-badge>
          </s-stack>

          {editable ? (
            <s-stack direction="inline" gap="small">
              <s-button
                variant="tertiary"
                commandFor={`edit-frame-style-${style.id}`}
                command="--show"
              >
                Edit
              </s-button>

              <s-button
                icon="delete"
                variant="tertiary"
                tone="critical"
                commandFor={`delete-frame-style-${style.id}`}
                command="--show"
                accessibilityLabel={`Delete ${style.label}`}
              />
            </s-stack>
          ) : null}
        </s-stack>
      </div>
    </div>
  );
}

export function FrameStylesEditor({
  frameStyles,
  editable,
}: {
  frameStyles: FrameStyleView[];
  editable: boolean;
}) {
  const navigation = useNavigation();

  const submitting =
    navigation.state !== "idle" && Boolean(navigation.formData);

  const submittingIntent = submitting
    ? navigation.formData?.get("intent")
    : null;

  const submittingFrameStyleId = submitting
    ? navigation.formData?.get("frameStyleId")
    : null;

  // Triggers AddFrameStyleModal's own reset effect right before a
  // fresh modal opens — see the identical comment in
  // size-options-editor.tsx's SizeOptionsEditor.
  const [addModalResetKey, setAddModalResetKey] = useState(0);

  const submit = useSubmit();

  const [orderedFrameStyles, setOrderedFrameStyles] = useState(frameStyles);

  useEffect(() => {
    setOrderedFrameStyles(frameStyles);
  }, [frameStyles]);

  const submitReorder = (nextStyles: FrameStyleView[]) => {
    const formData = new FormData();

    formData.set("intent", "reorderFrameStyles");

    for (const style of nextStyles) {
      formData.append("frameStyleId", style.id);
    }

    submit(formData, { method: "post" });
  };

  return (
    <s-section heading="Frame styles">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          Border treatments shown alongside frame colors on the storefront —
          any style can be combined with any color. Purely visual; never sent
          to Shopify.
        </s-text>

        {frameStyles.length === 0 ? (
          <s-text color="subdued">No frame styles yet.</s-text>
        ) : (
          <DragDropProvider
            onDragEnd={(event) => {
              if (event.canceled || !editable) {
                return;
              }

              const reordered = move(orderedFrameStyles, event);

              const orderChanged = reordered.some(
                (style, index) =>
                  style.id !== orderedFrameStyles[index]?.id,
              );

              if (!orderChanged) {
                return;
              }

              setOrderedFrameStyles(reordered);

              submitReorder(reordered);
            }}
          >
            <s-stack direction="block" gap="small-200">
              {orderedFrameStyles.map((style, index) => (
                <SortableFrameStyleRow
                  key={style.id}
                  style={style}
                  index={index}
                  editable={editable}
                />
              ))}
            </s-stack>
          </DragDropProvider>
        )}

        {editable ? (
          <s-stack direction="inline" gap="base">
            <s-button
              icon="plus"
              variant="secondary"
              commandFor="add-frame-style"
              command="--show"
              onClick={() => setAddModalResetKey((key) => key + 1)}
            >
              Add frame style
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>

      {editable ? (
        <AddFrameStyleModal
          submitting={submittingIntent === "addFrameStyle"}
          resetSignal={addModalResetKey}
          existingLabels={frameStyles.map((style) => style.label)}
        />
      ) : null}

      {editable
        ? frameStyles.map((style) => (
            <EditFrameStyleModal
              key={`edit-${style.id}`}
              style={style}
              submitting={
                submittingIntent === "editFrameStyle" &&
                submittingFrameStyleId === style.id
              }
              otherLabels={frameStyles
                .filter((other) => other.id !== style.id)
                .map((other) => other.label)}
            />
          ))
        : null}

      {editable
        ? frameStyles.map((style) => (
            <s-modal
              key={`delete-${style.id}`}
              id={`delete-frame-style-${style.id}`}
              heading="Delete frame style?"
            >
              <Form method="post">
                <input type="hidden" name="intent" value="deleteFrameStyle" />

                <input type="hidden" name="frameStyleId" value={style.id} />

                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Delete “{style.label}”? This frame style will no longer
                    be offered to customers.
                  </s-paragraph>

                  <s-stack direction="inline" gap="base">
                    <s-button
                      variant="secondary"
                      commandFor={`delete-frame-style-${style.id}`}
                      command="--hide"
                      disabled={
                        submittingIntent === "deleteFrameStyle" &&
                        submittingFrameStyleId === style.id
                      }
                    >
                      Cancel
                    </s-button>

                    <s-button
                      type="submit"
                      variant="primary"
                      tone="critical"
                      loading={
                        submittingIntent === "deleteFrameStyle" &&
                        submittingFrameStyleId === style.id
                      }
                      disabled={
                        submittingIntent === "deleteFrameStyle" &&
                        submittingFrameStyleId === style.id
                      }
                    >
                      Delete frame style
                    </s-button>
                  </s-stack>
                </s-stack>
              </Form>
            </s-modal>
          ))
        : null}
    </s-section>
  );
}
