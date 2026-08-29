import { Prisma, StyleFieldType } from "@prisma/client";

import prisma from "../../db.server";
import { requireStyleForShop, styleCanBeEdited } from "./style.server";

export type StyleFieldDraftInput = {
  label: string;
  type: StyleFieldType;
  required?: boolean;
  placeholder?: string | null;
  helpText?: string | null;
  defaultValue?: string | null;
  options?: string[];
};

function requiredText(value: string, fieldName: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function optionalText(value: string | null | undefined) {
  if (value == null) {
    return null;
  }

  const normalized = value.trim();

  return normalized || null;
}

function normalizeOptions(values: string[] | undefined) {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values ?? []) {
    const normalized = value.trim();

    if (!normalized) {
      continue;
    }

    const dedupeKey = normalized.toLocaleLowerCase();

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    result.push(normalized);
  }

  return result;
}

function keyBase(label: string) {
  const value = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

  if (!value) {
    return "field";
  }

  if (/^[a-z]/.test(value)) {
    return value;
  }

  return `field_${value}`;
}

async function uniqueFieldKey(styleId: string, label: string) {
  const base = keyBase(label);

  const existing = await prisma.styleField.findMany({
    where: {
      styleId,
    },

    select: {
      key: true,
    },
  });

  const used = new Set(existing.map((field) => field.key));

  if (!used.has(base)) {
    return base;
  }

  let suffix = 2;

  while (used.has(`${base}_${suffix}`)) {
    suffix += 1;
  }

  return `${base}_${suffix}`;
}

async function requireEditableStyle(shop: string, styleId: string) {
  const style = await requireStyleForShop(shop, styleId);

  if (!styleCanBeEdited(style)) {
    throw new Error(
      `Customer fields cannot be changed while the style status is ${style.status}.`,
    );
  }

  return style;
}

async function requireField(styleId: string, fieldId: string) {
  const field = await prisma.styleField.findFirst({
    where: {
      id: fieldId,
      styleId,
    },
  });

  if (!field) {
    throw new Error("Customer field was not found.");
  }

  return field;
}

function validateFieldInput(input: StyleFieldDraftInput) {
  const label = requiredText(input.label, "Field label");

  const options = normalizeOptions(input.options);

  if (input.type === StyleFieldType.SELECT && options.length < 2) {
    throw new Error("Select fields require at least two options.");
  }

  return {
    label,
    type: input.type,
    required: input.required ?? false,
    placeholder: optionalText(input.placeholder),
    helpText: optionalText(input.helpText),
    defaultValue: optionalText(input.defaultValue),
    options,
  };
}

export async function createStyleField(
  shop: string,
  styleId: string,
  input: StyleFieldDraftInput,
) {
  await requireEditableStyle(shop, styleId);

  const normalized = validateFieldInput(input);

  const key = await uniqueFieldKey(styleId, normalized.label);

  const lastField = await prisma.styleField.findFirst({
    where: {
      styleId,
    },

    orderBy: {
      position: "desc",
    },

    select: {
      position: true,
    },
  });

  const position = (lastField?.position ?? -1) + 1;

  return prisma.styleField.create({
    data: {
      styleId,
      key,
      label: normalized.label,
      type: normalized.type,
      required: normalized.required,
      position,
      placeholder: normalized.placeholder,
      helpText: normalized.helpText,
      defaultValue: normalized.defaultValue,

      ...(normalized.type === StyleFieldType.SELECT
        ? {
            options: normalized.options,
          }
        : {}),
    },
  });
}

export async function updateStyleField(
  shop: string,
  styleId: string,
  fieldId: string,
  input: StyleFieldDraftInput,
) {
  await requireEditableStyle(shop, styleId);

  const field = await requireField(styleId, fieldId);

  const normalized = validateFieldInput(input);

  const data: Prisma.StyleFieldUpdateInput = {
    label: normalized.label,
    type: normalized.type,
    required: normalized.required,
    placeholder: normalized.placeholder,
    helpText: normalized.helpText,
    defaultValue: normalized.defaultValue,
  };

  if (normalized.type === StyleFieldType.SELECT) {
    data.options = normalized.options;
  }

  return prisma.styleField.update({
    where: {
      id: field.id,
    },
    data,
  });
}

export async function deleteStyleField(
  shop: string,
  styleId: string,
  fieldId: string,
) {
  await requireEditableStyle(shop, styleId);

  const field = await requireField(styleId, fieldId);

  await prisma.$transaction(async (tx) => {
    await tx.styleField.delete({
      where: {
        id: field.id,
      },
    });

    const remaining = await tx.styleField.findMany({
      where: {
        styleId,
      },

      orderBy: [
        {
          position: "asc",
        },
        {
          createdAt: "asc",
        },
      ],
    });

    for (let index = 0; index < remaining.length; index += 1) {
      if (remaining[index].position === index) {
        continue;
      }

      await tx.styleField.update({
        where: {
          id: remaining[index].id,
        },

        data: {
          position: index,
        },
      });
    }
  });
}

export async function moveStyleField(
  shop: string,
  styleId: string,
  fieldId: string,
  direction: "up" | "down",
) {
  await requireEditableStyle(shop, styleId);

  await requireField(styleId, fieldId);

  const fields = await prisma.styleField.findMany({
    where: {
      styleId,
    },

    orderBy: [
      {
        position: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
  });

  const currentIndex = fields.findIndex((field) => field.id === fieldId);

  if (currentIndex < 0) {
    throw new Error("Customer field was not found.");
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= fields.length) {
    return;
  }

  const current = fields[currentIndex];

  const target = fields[targetIndex];

  await prisma.$transaction([
    prisma.styleField.update({
      where: {
        id: current.id,
      },

      data: {
        position: target.position,
      },
    }),

    prisma.styleField.update({
      where: {
        id: target.id,
      },

      data: {
        position: current.position,
      },
    }),
  ]);
}

/**
 * Sets an arbitrary new field order — the drag-and-drop reorder
 * counterpart to moveStyleField's single-step up/down swap.
 */
export async function reorderStyleFields(
  shop: string,
  styleId: string,
  orderedFieldIds: string[],
) {
  await requireEditableStyle(shop, styleId);

  const fields = await prisma.styleField.findMany({
    where: {
      styleId,
    },

    select: {
      id: true,
    },
  });

  const knownIds = new Set(fields.map((field) => field.id));

  if (
    orderedFieldIds.length !== fields.length ||
    !orderedFieldIds.every((id) => knownIds.has(id))
  ) {
    throw new Error("The new field order does not match this style's fields.");
  }

  await prisma.$transaction(
    orderedFieldIds.map((id, index) =>
      prisma.styleField.update({
        where: {
          id,
        },

        data: {
          position: index,
        },
      }),
    ),
  );
}
