import { StyleFieldType, StyleStatus } from "@prisma/client";

import prisma from "../../db.server";
import {
  getProviderDefinition,
  isKnownModel,
} from "../ai/provider-registry.server";
import { getGenerationDefaults } from "../settings/generation-defaults.server";
import { requireStyleForShop } from "./style.server";

// Portable style export/import — lets a merchant (or an agency working
// across several shops) move a Style's configuration from one shop's
// Winslet AI Portraits install to another's, or archive one outside the app.
//
// Deliberately excludes anything shop- or Shopify-linkage-specific:
// gallery images (StyleAsset — shop's own uploads/generations),
// shopifyProductId/handle/publishedAt/status (this shop's live
// product), and collectionIds (Shopify collection GIDs that only
// resolve within the shop that created them). This mirrors
// duplicateStyleDraft's same-shop copy, which excludes the same
// things for the same reason — an import always lands as a fresh,
// unpublished draft the merchant reviews before publishing.

export const STYLE_EXPORT_FORMAT_VERSION = 1;

export const STYLE_EXPORT_KIND = "ai-art-studio-style";

export const STYLE_EXPORT_BUNDLE_KIND = "ai-art-studio-style-bundle";

export type StyleExportField = {
  key: string;
  label: string;
  type: StyleFieldType;
  required: boolean;
  position: number;
  placeholder: string | null;
  helpText: string | null;
  defaultValue: string | null;
  options: unknown;
  config: unknown;
};

export type StyleExportData = {
  name: string;
  prompt: string;
  provider: string;
  model: string | null;
  outputAspectRatio: string;
  outputQuality: string;
  previewCount: number;
  generationSettings: unknown;
  productTitle: string;
  productDescription: string;
  basePrice: string;
  compareAtPrice: string | null;
  tags: string[];
  fields: StyleExportField[];
};

export type StyleExportPayload = {
  kind: typeof STYLE_EXPORT_KIND;
  formatVersion: number;
  exportedAt: string;
  style: StyleExportData;
};

export type StyleExportBundlePayload = {
  kind: typeof STYLE_EXPORT_BUNDLE_KIND;
  formatVersion: number;
  exportedAt: string;
  styles: StyleExportData[];
};

async function buildStyleExportData(
  shop: string,
  styleId: string,
): Promise<StyleExportData> {
  const style = await requireStyleForShop(shop, styleId);

  const tags = Array.isArray(style.tags)
    ? style.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  return {
    name: style.name,
    prompt: style.prompt,
    provider: style.provider,
    model: style.model,
    outputAspectRatio: style.outputAspectRatio,
    outputQuality: style.outputQuality,
    previewCount: style.previewCount,
    generationSettings: style.generationSettings ?? {},

    productTitle: style.productTitle,
    productDescription: style.productDescription,
    basePrice: style.basePrice.toString(),
    compareAtPrice: style.compareAtPrice
      ? style.compareAtPrice.toString()
      : null,
    tags,

    fields: style.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      position: field.position,
      placeholder: field.placeholder,
      helpText: field.helpText,
      defaultValue: field.defaultValue,
      options: field.options ?? null,
      config: field.config ?? null,
    })),
  };
}

export async function buildStyleExport(
  shop: string,
  styleId: string,
): Promise<StyleExportPayload> {
  return {
    kind: STYLE_EXPORT_KIND,
    formatVersion: STYLE_EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    style: await buildStyleExportData(shop, styleId),
  };
}

export async function buildStylesExportBundle(
  shop: string,
  styleIds: string[],
): Promise<StyleExportBundlePayload> {
  const styles = await Promise.all(
    styleIds.map((styleId) => buildStyleExportData(shop, styleId)),
  );

  return {
    kind: STYLE_EXPORT_BUNDLE_KIND,
    formatVersion: STYLE_EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    styles,
  };
}

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "style"
  );
}

export function styleExportFilename(styleName: string) {
  return `${slugify(styleName)}.ai-art-studio-style.json`;
}

export function stylesExportBundleFilename(shopName: string) {
  return `${slugify(shopName)}.ai-art-studio-styles.json`;
}

export class StyleImportError extends Error {}

function requireString(
  value: unknown,
  fieldName: string,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new StyleImportError(`This export is missing a valid ${fieldName}.`);
  }

  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function decimalStringOrDefault(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? value : fallback;
}

const validFieldTypes = new Set<string>(Object.values(StyleFieldType));

function sanitizeFields(value: unknown): StyleExportField[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenKeys = new Set<string>();

  const fields: StyleExportField[] = [];

  value.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      return;
    }

    const raw = entry as Record<string, unknown>;

    const key = typeof raw.key === "string" ? raw.key.trim() : "";

    const type = typeof raw.type === "string" ? raw.type : "";

    // Skip anything unrecognizable rather than guessing — an import
    // that silently drops one malformed field is safer than one that
    // inserts bad data or aborts the whole style.
    if (!key || !validFieldTypes.has(type) || seenKeys.has(key)) {
      return;
    }

    seenKeys.add(key);

    fields.push({
      key,
      label:
        typeof raw.label === "string" && raw.label.trim() ? raw.label : key,
      type: type as StyleFieldType,
      required: raw.required === true,
      position: numberOrDefault(raw.position, index),
      placeholder: optionalString(raw.placeholder),
      helpText: optionalString(raw.helpText),
      defaultValue: optionalString(raw.defaultValue),
      options: raw.options ?? null,
      config: raw.config ?? null,
    });
  });

  return fields;
}

function requireFormatVersion(payload: Record<string, unknown>) {
  if (
    typeof payload.formatVersion !== "number" ||
    payload.formatVersion > STYLE_EXPORT_FORMAT_VERSION
  ) {
    throw new StyleImportError(
      "This export was created by a newer version of the app and can't be imported here.",
    );
  }
}

async function createStyleFromExportedData(
  shop: string,
  source: Record<string, unknown>,
) {
  const name = requireString(source.name, "style name");

  const productTitle = optionalString(source.productTitle) || name;

  const defaults = await getGenerationDefaults(shop);

  const providerId =
    typeof source.provider === "string" &&
    getProviderDefinition(source.provider)
      ? source.provider
      : "openai";

  const model =
    typeof source.model === "string" && isKnownModel(providerId, source.model)
      ? source.model
      : null;

  const tags = Array.isArray(source.tags)
    ? source.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  const fields = sanitizeFields(source.fields);

  return prisma.$transaction(async (tx) => {
    const created = await tx.style.create({
      data: {
        shop,
        name: `${name} (imported)`,
        status: StyleStatus.DRAFT,

        prompt: typeof source.prompt === "string" ? source.prompt : "",
        provider: providerId,
        model,
        outputAspectRatio:
          optionalString(source.outputAspectRatio) ||
          defaults.outputAspectRatio,
        outputQuality:
          optionalString(source.outputQuality) || defaults.outputQuality,
        previewCount: numberOrDefault(
          source.previewCount,
          defaults.previewCount,
        ),
        generationSettings:
          typeof source.generationSettings === "object" &&
          source.generationSettings !== null &&
          !Array.isArray(source.generationSettings)
            ? (source.generationSettings as object)
            : {},

        productTitle: `${productTitle} (imported)`,
        productDescription:
          typeof source.productDescription === "string"
            ? source.productDescription
            : "",
        basePrice: decimalStringOrDefault(source.basePrice, "0.00"),
        compareAtPrice: optionalString(source.compareAtPrice),
        tags,

        // Not carried over — collection GIDs and any Shopify-linked
        // settings only resolve within the shop that created them.
        collectionIds: [],
        productSettings: {},
      },
    });

    if (fields.length > 0) {
      await tx.styleField.createMany({
        data: fields.map((field) => ({
          styleId: created.id,
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          position: field.position,
          placeholder: field.placeholder,
          helpText: field.helpText,
          defaultValue: field.defaultValue,
          options: field.options ?? undefined,
          config: field.config ?? undefined,
        })),
      });
    }

    return created;
  });
}

export async function importStyleFromExport(shop: string, raw: unknown) {
  if (typeof raw !== "object" || raw === null) {
    throw new StyleImportError("This file isn't a valid style export.");
  }

  const payload = raw as Record<string, unknown>;

  if (payload.kind !== STYLE_EXPORT_KIND) {
    throw new StyleImportError(
      "This file isn't a Winslet AI Portraits style export.",
    );
  }

  requireFormatVersion(payload);

  if (typeof payload.style !== "object" || payload.style === null) {
    throw new StyleImportError("This export is missing its style data.");
  }

  return createStyleFromExportedData(
    shop,
    payload.style as Record<string, unknown>,
  );
}

export type StylesBulkImportResult = {
  created: Awaited<ReturnType<typeof createStyleFromExportedData>>[];
  skipped: number;
};

/**
 * Accepts either a single-style export or a bulk bundle (multiple
 * styles in one file) and imports every style it can as a draft.
 * Drafts are unlimited on every plan — the Free plan's cap only
 * applies at publish time — so a bulk import never needs to stop
 * partway through; anything that isn't a valid style entry is simply
 * skipped.
 */
export async function importStylesFromExport(
  shop: string,
  raw: unknown,
): Promise<StylesBulkImportResult> {
  if (typeof raw !== "object" || raw === null) {
    throw new StyleImportError("This file isn't a valid style export.");
  }

  const payload = raw as Record<string, unknown>;

  if (payload.kind === STYLE_EXPORT_KIND) {
    const created = await importStyleFromExport(shop, raw);

    return { created: [created], skipped: 0 };
  }

  if (payload.kind !== STYLE_EXPORT_BUNDLE_KIND) {
    throw new StyleImportError(
      "This file isn't a Winslet AI Portraits style export.",
    );
  }

  requireFormatVersion(payload);

  if (!Array.isArray(payload.styles) || payload.styles.length === 0) {
    throw new StyleImportError("This export doesn't contain any styles.");
  }

  const created: Awaited<ReturnType<typeof createStyleFromExportedData>>[] = [];

  for (const entry of payload.styles) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    created.push(
      await createStyleFromExportedData(shop, entry as Record<string, unknown>),
    );
  }

  return {
    created,
    skipped: payload.styles.length - created.length,
  };
}
