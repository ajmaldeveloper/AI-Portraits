const NO_CHANGES = {
  operations: [],
};

const EPSILON = 0.000001;

// Kept identical (duplicated) in
// app/services/styles/style-pricing-sync.server.ts, which writes the
// fixed set of shard metafields this reads.
const PRICING_SHARD_COUNT = 3;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseSelections(raw) {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  try {
    return asObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

// Every priced choice's own priceDelta is additive on top of the base
// price — except the one SIZE-axis option, whose choice's priceDelta
// instead REPLACES the base price outright (it holds each size's own
// absolute price, not an increment — the same convention the admin
// editor and style-publish.server.ts's price computation already use).
// Returns null when a required selection is missing/invalid, so the
// caller can skip pricing this line rather than charge a wrong amount.
function computeStyleTotal(style, selections) {
  const options = Array.isArray(style.options) ? style.options : [];
  const sizeOption = options.find((option) => option.axisRole === "SIZE");

  let total = numberOrNull(style.basePrice) ?? 0;

  if (sizeOption) {
    const choiceId = selections[sizeOption.id];
    const choice = sizeOption.choices.find((item) => item.id === choiceId);

    if (!choice) {
      return null;
    }

    total = numberOrNull(choice.priceDelta) ?? 0;
  }

  let framingRequiresShipping = false;

  for (const option of options) {
    if (option === sizeOption) {
      continue;
    }

    const choiceId = selections[option.id];

    if (!choiceId) {
      continue;
    }

    const choice = option.choices.find((item) => item.id === choiceId);

    if (!choice) {
      continue;
    }

    total += numberOrNull(choice.priceDelta) ?? 0;

    if (option.axisRole === "FRAMING" && choice.requiresShipping) {
      framingRequiresShipping = true;
    }
  }

  return { total: roundMoney(total), requiresShipping: framingRequiresShipping };
}

export function cartTransformRun(input) {
  const adjustmentConfig = asObject(
    input?.cartTransform?.adjustmentConfig?.jsonValue,
  );

  if (
    !adjustmentConfig ||
    adjustmentConfig.version !== 1 ||
    !adjustmentConfig.adjustmentVariantId
  ) {
    return NO_CHANGES;
  }

  const shippingConfig = asObject(
    input?.cartTransform?.shippingConfig?.jsonValue,
  );

  const shippingVariantId =
    shippingConfig?.version === 1 ? shippingConfig.shippingVariantId : null;

  // Each shard metafield holds { [styleId]: styleConfig, ... } for
  // whichever styles landed in that shard at write time (see
  // app/services/styles/style-pricing-sync.server.ts) — merge them
  // all into one lookup keyed by style id.
  const styles = new Map();

  for (let shard = 0; shard < PRICING_SHARD_COUNT; shard += 1) {
    const shardConfig = asObject(
      input?.cartTransform?.[`pricingShard${shard}`]?.jsonValue,
    );

    if (!shardConfig) {
      continue;
    }

    for (const [styleId, style] of Object.entries(shardConfig)) {
      const parsed = asObject(style);

      if (parsed) {
        styles.set(styleId, parsed);
      }
    }
  }

  const presentmentRate = numberOrNull(input.presentmentCurrencyRate) ?? 1;
  const operations = [];

  for (const line of input.cart.lines) {
    if (line.sellingPlanAllocation) {
      continue;
    }

    if (line.merchandise.__typename !== "ProductVariant") {
      continue;
    }

    const styleId = line.aigOptionSet?.value ?? "";
    const selections = parseSelections(line.aigSelections?.value);

    if (!styleId || !selections) {
      continue;
    }

    const style = styles.get(styleId);

    if (!style) {
      continue;
    }

    const computed = computeStyleTotal(style, selections);

    if (!computed) {
      continue;
    }

    const basePrice = numberOrNull(line.cost.amountPerQuantity.amount);

    if (basePrice === null || basePrice < 0) {
      continue;
    }

    const surcharge = roundMoney(computed.total - basePrice);
    const presentmentSurcharge = roundMoney(surcharge * presentmentRate);

    const needsPriceLine = Math.abs(presentmentSurcharge) > EPSILON;
    const needsShippingLine = computed.requiresShipping && Boolean(shippingVariantId);

    if (!needsPriceLine && !needsShippingLine) {
      continue;
    }

    const expandedCartItems = [
      {
        merchandiseId: line.merchandise.id,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: basePrice.toFixed(2),
            },
          },
        },
      },
    ];

    if (needsPriceLine) {
      expandedCartItems.push({
        merchandiseId: adjustmentConfig.adjustmentVariantId,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: presentmentSurcharge.toFixed(2),
            },
          },
        },
      });
    }

    if (needsShippingLine) {
      expandedCartItems.push({
        merchandiseId: shippingVariantId,
        quantity: 1,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: "0.00",
            },
          },
        },
      });
    }

    operations.push({
      lineExpand: {
        cartLineId: line.id,
        expandedCartItems,
      },
    });
  }

  return operations.length > 0 ? { operations } : NO_CHANGES;
}
