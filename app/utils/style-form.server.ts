import type { CreateStyleDraftInput } from "../services/styles/style.server";
import type { StyleFormValues } from "./style-form";

export type ParsedStyleForm = {
  values: StyleFormValues;
  input?: CreateStyleDraftInput;
  error?: string;
};

function text(formData: FormData, key: keyof StyleFormValues) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

// Step 1 of the style wizard — just the internal name and the
// transformation prompt. Product details and generation output are
// filled in afterward, as their own steps, once the draft exists.
export function parseStyleForm(formData: FormData): ParsedStyleForm {
  const values: StyleFormValues = {
    name: text(formData, "name"),
    prompt: text(formData, "prompt"),
  };

  if (!values.name) {
    return {
      values,
      error: "Style name is required.",
    };
  }

  return {
    values,
    input: {
      name: values.name,
      prompt: values.prompt,
    },
  };
}
