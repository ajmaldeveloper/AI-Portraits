import { StyleFieldType } from "@prisma/client";

import type { StyleFieldDraftInput } from "../services/styles/style-fields.server";

export type ParsedStyleFieldForm = {
  input?: StyleFieldDraftInput;
  error?: string;
};

const allowedTypes = new Set<StyleFieldType>(Object.values(StyleFieldType));

function stringValue(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function parseOptions(value: string) {
  const seen = new Set<string>();

  const result: string[] = [];

  for (const option of value.split(/\r?\n|,/)) {
    const normalized = option.trim();

    if (!normalized) {
      continue;
    }

    const key = normalized.toLocaleLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export function parseStyleFieldForm(formData: FormData): ParsedStyleFieldForm {
  const label = stringValue(formData, "label");

  if (!label) {
    return {
      error: "Field label is required.",
    };
  }

  const rawType = stringValue(formData, "type");

  if (!allowedTypes.has(rawType as StyleFieldType)) {
    return {
      error: "Choose a supported customer field type.",
    };
  }

  const type = rawType as StyleFieldType;

  const options = parseOptions(stringValue(formData, "options"));

  if (type === StyleFieldType.SELECT && options.length < 2) {
    return {
      error: "Select fields require at least two options.",
    };
  }

  return {
    input: {
      label,
      type,

      required: formData.has("required"),

      placeholder: stringValue(formData, "placeholder") || null,

      helpText: stringValue(formData, "helpText") || null,

      defaultValue: stringValue(formData, "defaultValue") || null,

      options: type === StyleFieldType.SELECT ? options : undefined,
    },
  };
}
