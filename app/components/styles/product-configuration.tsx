import { useState } from "react";
import { useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { eventValue } from "../../utils/event-value";
import { FramingOptionsEditor, type FramingOptionView } from "./framing-options-editor";
import { SizeOptionsEditor, type SizeOptionView } from "./size-options-editor";

export type CollectionSummary = {
  id: string;
  title: string;
  handle: string | null;
};

type ProductConfigurationProps = {
  productTitle: string;
  productDescription: string;
  basePrice: string;
  compareAtPrice: string;
  tags: string[];
  collections: CollectionSummary[];
  sizeOptions: SizeOptionView[];
  framingOptions: FramingOptionView[];
  editable: boolean;
};

export function ProductConfiguration({
  productTitle: initialProductTitle,
  productDescription: initialProductDescription,
  basePrice: initialBasePrice,
  compareAtPrice: initialCompareAtPrice,
  tags: initialTags,
  collections: initialCollections,
  sizeOptions,
  framingOptions,
  editable,
}: ProductConfigurationProps) {
  const shopify = useAppBridge();

  const navigation = useNavigation();

  const submit = useSubmit();

  // Scoped to an actual "saveProduct" submission, not just any pending
  // navigation (including size/framing modal submits, which use their
  // own intents) — a bare loading/GET transition, or a size/framing
  // save, must not flash this button into a loading state.
  const saving =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "saveProduct";

  const [productTitle, setProductTitle] = useState(initialProductTitle);

  const [productDescription, setProductDescription] = useState(
    initialProductDescription,
  );

  const [basePrice, setBasePrice] = useState(initialBasePrice);

  const [compareAtPrice, setCompareAtPrice] = useState(initialCompareAtPrice);

  const [tags, setTags] = useState(initialTags);

  const [newTagValue, setNewTagValue] = useState("");

  const [collections, setCollections] = useState(initialCollections);

  const collectionIds = collections.map((collection) => collection.id);

  const initialCollectionIds = initialCollections.map(
    (collection) => collection.id,
  );

  const isDirty =
    productTitle !== initialProductTitle ||
    productDescription !== initialProductDescription ||
    basePrice !== initialBasePrice ||
    compareAtPrice !== initialCompareAtPrice ||
    JSON.stringify(tags) !== JSON.stringify(initialTags) ||
    JSON.stringify(collectionIds) !== JSON.stringify(initialCollectionIds);

  const removeTag = (tag: string) => {
    setTags((current) => current.filter((existing) => existing !== tag));
  };

  const addTag = () => {
    const trimmed = newTagValue.trim();

    if (
      trimmed &&
      !tags.some(
        (tag) => tag.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
      )
    ) {
      setTags((current) => [...current, trimmed]);
    }

    setNewTagValue("");
  };

  const selectCollections = async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: "collection",
        action: "select",
        multiple: true,

        selectionIds: collections.map((collection) => ({
          id: collection.id,
        })),
      });

      if (!selected) {
        return;
      }

      setCollections(
        selected.map((collection) => ({
          id: collection.id,
          title: collection.title,
          handle: collection.handle ?? null,
        })),
      );
    } catch {
      shopify.toast.show("Could not open collection picker");
    }
  };

  // A plain button, not a native form submit — Sizes/Framing each have
  // their own popup forms, and HTML forms can't nest, so this section
  // can't be wrapped in one shared <Form> with them and still have
  // Save render after them. Submitting imperatively from tracked state
  // sidesteps that while still hitting the same action/intent.
  const handleSave = () => {
    const formData = new FormData();

    formData.set("intent", "saveProduct");
    formData.set("productTitle", productTitle);
    formData.set("productDescription", productDescription);
    formData.set("basePrice", basePrice);
    formData.set("compareAtPrice", compareAtPrice);
    formData.set("tags", JSON.stringify(tags));
    formData.set("collectionIds", JSON.stringify(collectionIds));

    submit(formData, { method: "post" });
  };

  return (
    <s-stack direction="block" gap="base">
      <s-section heading="Shopify product">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Product title"
            value={productTitle}
            onInput={(event: Event) => setProductTitle(eventValue(event))}
            required
            disabled={!editable}
            autocomplete="off"
          />

          <s-text-area
            label="Product description"
            value={productDescription}
            onInput={(event: Event) =>
              setProductDescription(eventValue(event))
            }
            rows={6}
            disabled={!editable}
            autocomplete="off"
          />

          <s-query-container>
            <s-grid
              gridTemplateColumns="@container (inline-size > 480px) 1fr 1fr, 1fr"
              gap="base"
            >
              <s-number-field
                label="Price"
                value={basePrice}
                onInput={(event: Event) => setBasePrice(eventValue(event))}
                min={0}
                step={0.01}
                prefix="$"
                disabled={!editable}
                autocomplete="off"
              />

              <s-number-field
                label="Compare-at price"
                value={compareAtPrice}
                onInput={(event: Event) =>
                  setCompareAtPrice(eventValue(event))
                }
                min={0}
                step={0.01}
                prefix="$"
                disabled={!editable}
                autocomplete="off"
                details="Optional. Shown crossed out next to the price."
              />
            </s-grid>
          </s-query-container>
        </s-stack>
      </s-section>

      <s-section heading="Product tags">
        <s-stack direction="block" gap="base">
          {tags.length > 0 ? (
            <s-stack direction="inline" gap="small-200">
              {tags.map((tag) => (
                <s-box
                  key={tag}
                  paddingInlineStart="small-200"
                  paddingInlineEnd={editable ? "none" : "small-200"}
                  paddingBlock="none"
                  background="subdued"
                  borderRadius="large"
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "nowrap",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <s-text>{tag}</s-text>

                    {editable ? (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`Remove ${tag}`}
                        onClick={() => removeTag(tag)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            removeTag(tag);
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 14,
                          height: 14,
                          cursor: "pointer",
                          flex: "0 0 14px",
                        }}
                      >
                        <s-icon type="x" size="small" />
                      </div>
                    ) : null}
                  </div>
                </s-box>
              ))}
            </s-stack>
          ) : (
            <s-text color="subdued">No tags yet.</s-text>
          )}

          {editable ? (
            <s-stack direction="inline" gap="base">
              <s-button
                variant="secondary"
                icon="plus"
                commandFor="add-tag-modal"
                command="--show"
              >
                Add tag
              </s-button>
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Collections">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Choose which Shopify collections the product should join when it
            is published. A product can belong to more than one collection.
          </s-paragraph>

          {collections.length === 0 ? (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-text color="subdued">No collections selected.</s-text>
            </s-box>
          ) : (
            <s-stack direction="inline" gap="small">
              {collections.map((collection) => (
                <s-badge key={collection.id} tone="info">
                  {collection.title}
                </s-badge>
              ))}
            </s-stack>
          )}

          {editable ? (
            <s-stack direction="inline" gap="base">
              <s-button
                icon="collection"
                variant="secondary"
                onClick={selectCollections}
              >
                {collections.length > 0
                  ? "Change collections"
                  : "Select collections"}
              </s-button>
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      <SizeOptionsEditor sizeOptions={sizeOptions} editable={editable} />

      <FramingOptionsEditor
        framingOptions={framingOptions}
        editable={editable}
      />

      {editable ? (
        <s-stack direction="inline" gap="base">
          <s-button
            variant="primary"
            loading={saving}
            disabled={!isDirty || saving}
            onClick={handleSave}
          >
            Save
          </s-button>
        </s-stack>
      ) : null}

      <s-modal id="add-tag-modal" heading="Add tag">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Tag"
            value={newTagValue}
            onInput={(event: Event) => setNewTagValue(eventValue(event))}
            autocomplete="off"
            placeholder="e.g. bestseller"
          />

          <s-stack direction="inline" gap="base">
            <s-button
              variant="secondary"
              commandFor="add-tag-modal"
              command="--hide"
              onClick={() => setNewTagValue("")}
            >
              Cancel
            </s-button>

            <s-button
              variant="primary"
              commandFor="add-tag-modal"
              command="--hide"
              onClick={addTag}
            >
              Add tag
            </s-button>
          </s-stack>
        </s-stack>
      </s-modal>
    </s-stack>
  );
}
