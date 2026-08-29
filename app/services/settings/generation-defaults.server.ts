import prisma from "../../db.server";

// Shop-wide defaults for generated image output. Applied to every new
// Style at creation time so merchants configure this once instead of on
// every style — see ShopGenerationDefaults in schema.prisma.

export type AspectRatioOption = {
  id: string;
  label: string;
};

export type QualityOption = {
  id: string;
  label: string;
};

export const ASPECT_RATIO_OPTIONS: AspectRatioOption[] = [
  { id: "1:1", label: "Square (1:1)" },
  { id: "4:5", label: "Portrait (4:5)" },
  { id: "3:4", label: "Portrait (3:4)" },
  { id: "5:4", label: "Landscape (5:4)" },
  { id: "4:3", label: "Landscape (4:3)" },
  { id: "16:9", label: "Wide (16:9)" },
];

export const QUALITY_OPTIONS: QualityOption[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

const DEFAULT_ASPECT_RATIO = "1:1";
const DEFAULT_QUALITY = "high";
const DEFAULT_PREVIEW_COUNT = 1;

function requireShop(shop: string) {
  const normalized = shop.trim();

  if (!normalized) {
    throw new Error("Shop is required.");
  }

  return normalized;
}

export function isKnownAspectRatio(value: string): boolean {
  return ASPECT_RATIO_OPTIONS.some((option) => option.id === value);
}

export function isKnownQuality(value: string): boolean {
  return QUALITY_OPTIONS.some((option) => option.id === value);
}

export type GenerationDefaults = {
  outputAspectRatio: string;
  outputQuality: string;
  previewCount: number;
};

export async function getGenerationDefaults(
  shop: string,
): Promise<GenerationDefaults> {
  const normalizedShop = requireShop(shop);

  const settings = await prisma.shopGenerationDefaults.findUnique({
    where: {
      shop: normalizedShop,
    },
  });

  return {
    outputAspectRatio: settings?.outputAspectRatio ?? DEFAULT_ASPECT_RATIO,
    outputQuality: settings?.outputQuality ?? DEFAULT_QUALITY,
    previewCount: settings?.previewCount ?? DEFAULT_PREVIEW_COUNT,
  };
}

export type SaveGenerationDefaultsInput = {
  outputAspectRatio: string;
  outputQuality: string;
  previewCount: number;
};

export async function saveGenerationDefaults(
  shop: string,
  input: SaveGenerationDefaultsInput,
): Promise<void> {
  const normalizedShop = requireShop(shop);

  if (!isKnownAspectRatio(input.outputAspectRatio)) {
    throw new Error("Choose a supported artwork aspect ratio.");
  }

  if (!isKnownQuality(input.outputQuality)) {
    throw new Error("Choose a supported output quality.");
  }

  if (
    !Number.isInteger(input.previewCount) ||
    input.previewCount < 1 ||
    input.previewCount > 4
  ) {
    throw new Error("Preview generations must be between 1 and 4.");
  }

  await prisma.shopGenerationDefaults.upsert({
    where: {
      shop: normalizedShop,
    },

    create: {
      shop: normalizedShop,
      outputAspectRatio: input.outputAspectRatio,
      outputQuality: input.outputQuality,
      previewCount: input.previewCount,
    },

    update: {
      outputAspectRatio: input.outputAspectRatio,
      outputQuality: input.outputQuality,
      previewCount: input.previewCount,
    },
  });
}
