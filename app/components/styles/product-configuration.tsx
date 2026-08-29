import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { eventValue } from "../../utils/event-value";

export type CollectionSummary = {
  id: string;
  title: string;
  handle: string | null;
};

export type SizeOptionSummary = {
  id: string;
  label: string;
  scalePercent: number;
  price: string;
  compareAtPrice: string;
};

export type FramingOptionSummary = {
  id: string;
  label: string;
  priceDelta: string;
  compareAtPriceDelta: string;
  requiresShipping: boolean;
};

type ProductConfigurationProps = {
  productTitle: string;
  productDescription: string;
  basePrice: string;
  compareAtPrice: string;
  tags: string[];
  collections: CollectionSummary[];
  sizeOptions: SizeOptionSummary[];
  framingOptions: FramingOptionSummary[];
  editable: boolean;
};

export function ProductConfiguration({
  productTitle: initialProductTitle,
  productDescription: initialProductDescription,
  basePrice: initialBasePrice,
  compareAtPrice: initialCompareAtPrice,
  tags: initialTags,
  collections: initialCollections,
  sizeOptions: initialSizeOptions,
  framingOptions: initialFramingOptions,
  editable,
}: ProductConfigurationProps) {
  const shopify = useAppBridge();

  const navigation = useNavigation();

  // Scoped to an actual form submission (formData present), not just any
  // pending navigation — a bare loading/GET transition (e.g. this
  // route's own toast-then-clean-url effect after saving) must not
  // flash this button into a loading state.
  const saving = navigation.state !== "idle" && Boolean(navigation.formData);

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

  const [sizeOptions, setSizeOptions] = useState(initialSizeOptions);

  const [framingOptions, setFramingOptions] = useState(initialFramingOptions);

  const isDirty =
    productTitle !== initialProductTitle ||
    productDescription !== initialProductDescription ||
    basePrice !== initialBasePrice ||
    compareAtPrice !== initialCompareAtPrice ||
    JSON.stringify(tags) !== JSON.stringify(initialTags) ||
    JSON.stringify(collectionIds) !== JSON.stringify(initialCollectionIds) ||
    JSON.stringify(sizeOptions) !== JSON.stringify(initialSizeOptions) ||
    JSON.stringify(framingOptions) !== JSON.stringify(initialFramingOptions);

  // A soft heads-up, not a hard block — Size × Framing is a cartesian
  // product of real Shopify variants, so a merchant adding many of each
  // can end up with an unwieldy matrix without realizing it.
  const variantCount =
    Math.max(sizeOptions.length, 1) * Math.max(framingOptions.length, 1);

  const updateSizeOption = (
    index: number,
    patch: Partial<SizeOptionSummary>,
  ) => {
    setSizeOptions((rows) =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const addSizeOption = () => {
    setSizeOptions((rows) => [
      ...rows,
      {
        id: `new-${Date.now()}`,
        label: "",
        scalePercent: 100,
        price: basePrice,
        compareAtPrice,
      },
    ]);
  };

  const removeSizeOption = (index: number) => {
    setSizeOptions((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  };

  const updateFramingOption = (
    index: number,
    patch: Partial<FramingOptionSummary>,
  ) => {
    setFramingOptions((rows) =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const addFramingOption = () => {
    setFramingOptions((rows) => [
      ...rows,
      {
        id: `new-${Date.now()}`,
        label: "",
        priceDelta: "0",
        compareAtPriceDelta: "",
        requiresShipping: true,
      },
    ]);
  };

  const removeFramingOption = (index: number) => {
    setFramingOptions((rows) =>
      rows.filter((_, rowIndex) => rowIndex !== index),
    );
  };

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

  return (
    <Form method="post">
      <input type="hidden" name="tags" value={JSON.stringify(tags)} />

      <input
        type="hidden"
        name="collectionIds"
        value={JSON.stringify(collectionIds)}
      />

      <input
        type="hidden"
        name="sizesJson"
        value={JSON.stringify(sizeOptions)}
      />

      <input
        type="hidden"
        name="framingJson"
        value={JSON.stringify(framingOptions)}
      />

      <s-stack direction="block" gap="base">
        <s-section heading="Shopify product">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Product title"
              name="productTitle"
              value={productTitle}
              onInput={(event: Event) => setProductTitle(eventValue(event))}
              required
              disabled={!editable}
              autocomplete="off"
            />

            <s-text-area
              label="Product description"
              name="productDescription"
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
                  name="basePrice"
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
                  name="compareAtPrice"
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

            <s-text color="subdued">
              This product is made to order from the customer&rsquo;s upload, so
              it always shows as available to add to cart — no inventory count
              to track.
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="Sizes">
          <s-stack direction="block" gap="base">
            {sizeOptions.length > 0 ? (
              <s-stack direction="block" gap="small">
                {sizeOptions.map((row, index) => (
                  <s-query-container key={row.id}>
                    <s-grid
                      gridTemplateColumns="@container (inline-size > 640px) 1.5fr 1fr 1fr 1fr auto, 1fr"
                      gap="small"
                      alignItems="end"
                    >
                      <s-text-field
                        label="Name"
                        value={row.label}
                        onInput={(event: Event) =>
                          updateSizeOption(index, { label: eventValue(event) })
                        }
                        placeholder="e.g. Medium"
                        disabled={!editable}
                        autocomplete="off"
                      />

                      <s-number-field
                        label="Scale %"
                        value={String(row.scalePercent)}
                        onInput={(event: Event) =>
                          updateSizeOption(index, {
                            scalePercent: Number(eventValue(event)) || 0,
                          })
                        }
                        min={1}
                        max={100}
                        step={1}
                        disabled={!editable}
                        autocomplete="off"
                      />

                      <s-number-field
                        label="Price"
                        value={row.price}
                        onInput={(event: Event) =>
                          updateSizeOption(index, { price: eventValue(event) })
                        }
                        min={0}
                        step={0.01}
                        prefix="$"
                        disabled={!editable}
                        autocomplete="off"
                      />

                      <s-number-field
                        label="Compare-at price"
                        value={row.compareAtPrice}
                        onInput={(event: Event) =>
                          updateSizeOption(index, {
                            compareAtPrice: eventValue(event),
                          })
                        }
                        min={0}
                        step={0.01}
                        prefix="$"
                        disabled={!editable}
                        autocomplete="off"
                      />

                      {editable ? (
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          onClick={() => removeSizeOption(index)}
                          accessibilityLabel={`Remove ${row.label || "this size"}`}
                        >
                          Remove
                        </s-button>
                      ) : null}
                    </s-grid>
                  </s-query-container>
                ))}
              </s-stack>
            ) : (
              <s-text color="subdued">
                No sizes yet — this publishes as a single, one-size product.
              </s-text>
            )}

            {editable ? (
              <s-stack direction="inline" gap="base">
                <s-button variant="secondary" onClick={addSizeOption}>
                  Add size
                </s-button>
              </s-stack>
            ) : null}
          </s-stack>
        </s-section>

        <s-section heading="Framing">
          <s-stack direction="block" gap="base">
            {framingOptions.length > 0 ? (
              <s-stack direction="block" gap="small">
                {framingOptions.map((row, index) => (
                  <s-query-container key={row.id}>
                    <s-grid
                      gridTemplateColumns="@container (inline-size > 720px) 1.5fr 1fr 1fr auto auto, 1fr"
                      gap="small"
                      alignItems="end"
                    >
                      <s-text-field
                        label="Name"
                        value={row.label}
                        onInput={(event: Event) =>
                          updateFramingOption(index, {
                            label: eventValue(event),
                          })
                        }
                        placeholder="e.g. Framed - Black"
                        disabled={!editable}
                        autocomplete="off"
                      />

                      <s-number-field
                        label="Price adjustment"
                        value={row.priceDelta}
                        onInput={(event: Event) =>
                          updateFramingOption(index, {
                            priceDelta: eventValue(event),
                          })
                        }
                        step={0.01}
                        prefix="$"
                        disabled={!editable}
                        autocomplete="off"
                      />

                      <s-number-field
                        label="Compare-at adjustment"
                        value={row.compareAtPriceDelta}
                        onInput={(event: Event) =>
                          updateFramingOption(index, {
                            compareAtPriceDelta: eventValue(event),
                          })
                        }
                        step={0.01}
                        prefix="$"
                        disabled={!editable}
                        autocomplete="off"
                      />

                      <s-checkbox
                        label="Ships physically"
                        checked={row.requiresShipping}
                        disabled={!editable}
                        onChange={(event: Event) => {
                          const target = event.currentTarget as {
                            checked?: boolean;
                          } | null;

                          updateFramingOption(index, {
                            requiresShipping: Boolean(target?.checked),
                          });
                        }}
                      />

                      {editable ? (
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          onClick={() => removeFramingOption(index)}
                          accessibilityLabel={`Remove ${row.label || "this framing option"}`}
                        >
                          Remove
                        </s-button>
                      ) : null}
                    </s-grid>
                  </s-query-container>
                ))}
              </s-stack>
            ) : (
              <s-text color="subdued">
                No framing options yet — sizes (if any) publish on their
                own.
              </s-text>
            )}

            {editable ? (
              <s-stack direction="inline" gap="base">
                <s-button variant="secondary" onClick={addFramingOption}>
                  Add framing option
                </s-button>
              </s-stack>
            ) : null}

            {variantCount > 40 ? (
              <s-banner tone="warning">
                <s-paragraph>
                  {sizeOptions.length || 1} size(s) × {framingOptions.length || 1}{" "}
                  framing option(s) creates {variantCount} variants on this
                  product — consider trimming either list.
                </s-paragraph>
              </s-banner>
            ) : null}
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

        {editable ? (
          <s-stack direction="inline" gap="base">
            <s-button
              type="submit"
              variant="primary"
              loading={saving}
              disabled={!isDirty || saving}
            >
              Save
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>

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
    </Form>
  );
}
