import { describe, expect, test } from "vitest";

import { cartTransformRun } from "../src/cart_transform_run";

const ADJUSTMENT_CONFIG = {
  version: 1,
  adjustmentVariantId: "gid://shopify/ProductVariant/1",
};

const SHIPPING_CONFIG = {
  version: 1,
  shippingVariantId: "gid://shopify/ProductVariant/2",
};

const STYLE_ID = "style-1";

const SIZE_OPTION_ID = "opt-size";
const FRAMING_OPTION_ID = "opt-framing";

const STYLE_WITH_SIZE_AND_FRAMING = {
  basePrice: "40.00",
  options: [
    {
      id: SIZE_OPTION_ID,
      axisRole: "SIZE",
      choices: [
        { id: "size-small", priceDelta: "40.00" },
        { id: "size-large", priceDelta: "89.00" },
      ],
    },
    {
      id: FRAMING_OPTION_ID,
      axisRole: "FRAMING",
      choices: [
        { id: "frame-none", priceDelta: "0.00", requiresShipping: false },
        { id: "frame-black", priceDelta: "50.00", requiresShipping: true },
      ],
    },
  ],
};

function buildInput({
  pricingShards = [{ [STYLE_ID]: STYLE_WITH_SIZE_AND_FRAMING }, {}, {}],
  adjustmentConfig = ADJUSTMENT_CONFIG,
  shippingConfig = SHIPPING_CONFIG,
  lines,
  presentmentCurrencyRate = 1,
}) {
  return {
    presentmentCurrencyRate,
    cartTransform: {
      adjustmentConfig: adjustmentConfig ? { jsonValue: adjustmentConfig } : null,
      shippingConfig: shippingConfig ? { jsonValue: shippingConfig } : null,
      pricingShard0: { jsonValue: pricingShards[0] ?? {} },
      pricingShard1: { jsonValue: pricingShards[1] ?? {} },
      pricingShard2: { jsonValue: pricingShards[2] ?? {} },
    },
    cart: { lines },
  };
}

function line(overrides) {
  return {
    id: "gid://shopify/CartLine/1",
    quantity: 1,
    cost: { amountPerQuantity: { amount: "40.00" } },
    aigOptionSet: null,
    aigSelections: null,
    sellingPlanAllocation: null,
    merchandise: { __typename: "ProductVariant", id: "gid://shopify/ProductVariant/99" },
    ...overrides,
  };
}

describe("cartTransformRun", () => {
  test("no adjustment config configured -> no operations", () => {
    const result = cartTransformRun(
      buildInput({ adjustmentConfig: null, lines: [line()] }),
    );

    expect(result.operations).toEqual([]);
  });

  test("line with no option-set attribute -> no operations", () => {
    const result = cartTransformRun(buildInput({ lines: [line()] }));

    expect(result.operations).toEqual([]);
  });

  test("size + framing selection produces a price line and a shipping line", () => {
    const result = cartTransformRun(
      buildInput({
        lines: [
          line({
            aigOptionSet: { value: STYLE_ID },
            aigSelections: {
              value: JSON.stringify({
                [SIZE_OPTION_ID]: "size-large",
                [FRAMING_OPTION_ID]: "frame-black",
              }),
            },
          }),
        ],
      }),
    );

    // large size ($89) + black frame (+$50) = $139 total; the original
    // line is already priced at $40 (its Shopify variant price), so the
    // surcharge line must carry the remaining $99.
    expect(result.operations).toEqual([
      {
        lineExpand: {
          cartLineId: "gid://shopify/CartLine/1",
          expandedCartItems: [
            {
              merchandiseId: "gid://shopify/ProductVariant/99",
              quantity: 1,
              price: { adjustment: { fixedPricePerUnit: { amount: "40.00" } } },
            },
            {
              merchandiseId: "gid://shopify/ProductVariant/1",
              quantity: 1,
              price: { adjustment: { fixedPricePerUnit: { amount: "99.00" } } },
            },
            {
              merchandiseId: "gid://shopify/ProductVariant/2",
              quantity: 1,
              price: { adjustment: { fixedPricePerUnit: { amount: "0.00" } } },
            },
          ],
        },
      },
    ]);
  });

  test("no-frame choice omits the shipping line", () => {
    const result = cartTransformRun(
      buildInput({
        lines: [
          line({
            aigOptionSet: { value: STYLE_ID },
            aigSelections: {
              value: JSON.stringify({
                [SIZE_OPTION_ID]: "size-small",
                [FRAMING_OPTION_ID]: "frame-none",
              }),
            },
          }),
        ],
      }),
    );

    // small size ($40) + no frame (+$0) = $40 total, exactly matching
    // the line's already-charged price, so no operation is needed at
    // all — nothing to adjust and no shipping carrier line to add.
    expect(result.operations).toEqual([]);
  });

  test("a smaller size than the base price produces a negative surcharge", () => {
    const result = cartTransformRun(
      buildInput({
        pricingShards: [
          {
            [STYLE_ID]: {
              basePrice: "40.00",
              options: [
                {
                  id: SIZE_OPTION_ID,
                  axisRole: "SIZE",
                  choices: [{ id: "size-tiny", priceDelta: "25.00" }],
                },
              ],
            },
          },
          {},
          {},
        ],
        lines: [
          line({
            aigOptionSet: { value: STYLE_ID },
            aigSelections: { value: JSON.stringify({ [SIZE_OPTION_ID]: "size-tiny" }) },
          }),
        ],
      }),
    );

    expect(result.operations).toEqual([
      {
        lineExpand: {
          cartLineId: "gid://shopify/CartLine/1",
          expandedCartItems: [
            {
              merchandiseId: "gid://shopify/ProductVariant/99",
              quantity: 1,
              price: { adjustment: { fixedPricePerUnit: { amount: "40.00" } } },
            },
            {
              merchandiseId: "gid://shopify/ProductVariant/1",
              quantity: 1,
              price: { adjustment: { fixedPricePerUnit: { amount: "-15.00" } } },
            },
          ],
        },
      },
    ]);
  });

  test("a subscription line is left untouched", () => {
    const result = cartTransformRun(
      buildInput({
        lines: [
          line({
            aigOptionSet: { value: STYLE_ID },
            aigSelections: {
              value: JSON.stringify({ [SIZE_OPTION_ID]: "size-large" }),
            },
            sellingPlanAllocation: { sellingPlan: { id: "gid://shopify/SellingPlan/1" } },
          }),
        ],
      }),
    );

    expect(result.operations).toEqual([]);
  });
});
