type OpenAIImageData = {
  b64_json?: string;
  revised_prompt?: string;
};

type OpenAIImagesResponse = {
  created?: number;
  data?: OpenAIImageData[];
  output_format?: string;
  quality?: string;
  size?: string;

  error?: {
    message?: string;
    type?: string;
    code?: string | null;
  };
};

export type OpenAIGeneratedImage = {
  bytes: Uint8Array;
  revisedPrompt: string | null;
};

export type GenerateOpenAIImagesInput = {
  apiKey: string;
  model: string;
  prompt: string;
  count: number;
  size: "1024x1024" | "1024x1536" | "1536x1024";
  quality: "low" | "medium" | "high";
  user?: string;
};

export type GenerateOpenAIImagesResult = {
  images: OpenAIGeneratedImage[];
  model: string;
  requestId: string | null;
  created: number | null;
  size: string;
  quality: string;
  outputFormat: string;
};

export class OpenAIImageError extends Error {
  readonly code: string | null;

  readonly requestId: string | null;

  constructor(
    message: string,
    options: {
      code?: string | null;
      requestId?: string | null;
    } = {},
  ) {
    super(message);

    this.name = "OpenAIImageError";

    this.code = options.code ?? null;

    this.requestId = options.requestId ?? null;
  }
}

function decodeBase64Image(value: string) {
  const buffer = Buffer.from(value, "base64");

  if (buffer.length === 0) {
    throw new OpenAIImageError("OpenAI returned an empty image.", {
      code: "empty_image",
    });
  }

  if (buffer.length > 25 * 1024 * 1024) {
    throw new OpenAIImageError("Generated image exceeded the app size limit.", {
      code: "image_too_large",
    });
  }

  return new Uint8Array(buffer);
}

/**
 * Generates images via OpenAI using the merchant's own API key and
 * chosen model — never the app's own credentials. `apiKey`/`model`
 * come from that shop's ShopAIProviderSettings (see
 * app/services/settings/ai-provider-settings.server.ts).
 */
export async function generateOpenAIImages(
  input: GenerateOpenAIImagesInput,
): Promise<GenerateOpenAIImagesResult> {
  const apiKey = input.apiKey.trim();

  if (!apiKey) {
    throw new OpenAIImageError("An OpenAI API key is required.", {
      code: "openai_not_configured",
    });
  }

  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 4) {
    throw new OpenAIImageError("Image count must be between 1 and 4.", {
      code: "invalid_image_count",
    });
  }

  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new OpenAIImageError("Image prompt is required.", {
      code: "missing_prompt",
    });
  }

  if (prompt.length > 32000) {
    throw new OpenAIImageError("Image prompt is too long.", {
      code: "prompt_too_long",
    });
  }

  const model = input.model.trim() || "gpt-image-2";

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",

    headers: {
      Authorization: `Bearer ${apiKey}`,

      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      model,
      prompt,
      n: input.count,
      size: input.size,
      quality: input.quality,
      output_format: "png",
      background: "opaque",
      moderation: "auto",

      ...(input.user
        ? {
            user: input.user,
          }
        : {}),
    }),

    signal: AbortSignal.timeout(180000),
  });

  const requestId = response.headers.get("x-request-id");

  let payload: OpenAIImagesResponse;

  try {
    payload = (await response.json()) as OpenAIImagesResponse;
  } catch {
    throw new OpenAIImageError(
      `OpenAI returned an unreadable response (${response.status}).`,
      {
        code: `http_${response.status}`,
        requestId,
      },
    );
  }

  if (!response.ok) {
    throw new OpenAIImageError(
      payload.error?.message ||
        `OpenAI image generation failed with status ${response.status}.`,
      {
        code:
          payload.error?.code ||
          payload.error?.type ||
          `http_${response.status}`,

        requestId,
      },
    );
  }

  const imageData = payload.data ?? [];

  const images = imageData
    .filter(
      (
        item,
      ): item is OpenAIImageData & {
        b64_json: string;
      } => Boolean(item.b64_json),
    )
    .map((item) => ({
      bytes: decodeBase64Image(item.b64_json),

      revisedPrompt: item.revised_prompt ?? null,
    }));

  if (images.length === 0) {
    throw new OpenAIImageError(
      "OpenAI completed the request but returned no images.",
      {
        code: "no_images_returned",
        requestId,
      },
    );
  }

  return {
    images,
    model,
    requestId,
    created: typeof payload.created === "number" ? payload.created : null,

    size: payload.size ?? input.size,

    quality: payload.quality ?? input.quality,

    outputFormat: payload.output_format ?? "png",
  };
}

export type EditOpenAIImageInput = {
  apiKey: string;
  model: string;
  prompt: string;
  size: "1024x1024" | "1024x1536" | "1536x1024";
  quality: "low" | "medium" | "high";
  image: {
    bytes: Uint8Array;
    mimeType: string;
  };
  user?: string;

  // When provided, the request streams (OpenAI's images/edits endpoint
  // supports `stream`/`partial_images`) and this is called once per
  // low-res preview as the image is progressively refined, before the
  // final full-quality image is returned as this function's own
  // result. A throwing/rejecting callback is swallowed — losing a
  // preview frame must never abort the actual generation, only the
  // final image affects success/failure.
  onPartialImage?: (partial: {
    bytes: Uint8Array;
    index: number;
  }) => void | Promise<void>;
};

const MAX_PARTIAL_IMAGES = 3;

type OpenAIImageStreamEvent = {
  type?: string;
  b64_json?: string;
  revised_prompt?: string;
  partial_image_index?: number;
  error?: { message?: string; type?: string; code?: string | null };
};

// OpenAI's images/edits streaming response is plain Server-Sent
// Events over the same fetch body — no SDK needed, just line-based
// parsing of "data: {...}" frames separated by a blank line.
async function consumeEditImageStream(
  response: Response,
  onPartialImage: EditOpenAIImageInput["onPartialImage"],
): Promise<OpenAIImageStreamEvent> {
  const requestId = response.headers.get("x-request-id");

  if (!response.body) {
    throw new OpenAIImageError("OpenAI returned no response body to stream.", {
      code: "empty_stream",
      requestId,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let completed: OpenAIImageStreamEvent | null = null;
  let streamError: OpenAIImageStreamEvent["error"] | null = null;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");

    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);

      buffer = buffer.slice(boundary + 2);

      const dataText = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");

      if (dataText && dataText !== "[DONE]") {
        try {
          const event = JSON.parse(dataText) as OpenAIImageStreamEvent;

          if (event.type === "image_edit.partial_image" && event.b64_json) {
            try {
              await onPartialImage?.({
                bytes: decodeBase64Image(event.b64_json),
                index: event.partial_image_index ?? 0,
              });
            } catch (callbackError) {
              console.error(
                "Could not record a partial image preview",
                callbackError,
              );
            }
          } else if (event.type === "image_edit.completed") {
            completed = event;
          } else if (event.error) {
            streamError = event.error;
          }
        } catch {
          // A malformed frame is skipped rather than aborting the whole
          // stream — the final image_edit.completed event is what
          // actually determines success.
        }
      }

      boundary = buffer.indexOf("\n\n");
    }
  }

  if (streamError) {
    throw new OpenAIImageError(
      streamError.message || "OpenAI image editing failed.",
      {
        code: streamError.code || streamError.type || "stream_error",
        requestId,
      },
    );
  }

  if (!completed?.b64_json) {
    throw new OpenAIImageError(
      "OpenAI completed the request but returned no image.",
      {
        code: "no_images_returned",
        requestId,
      },
    );
  }

  return completed;
}

export type EditOpenAIImageResult = {
  image: OpenAIGeneratedImage;
  model: string;
  requestId: string | null;
};

const EDIT_IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Edits a single customer-uploaded photo per the Style's transformation
 * prompt — the customer-facing counterpart to generateOpenAIImages,
 * which only ever generates from a text prompt (used for merchant
 * storefront examples, where there is no input photo).
 */
export async function editOpenAIImage(
  input: EditOpenAIImageInput,
): Promise<EditOpenAIImageResult> {
  const apiKey = input.apiKey.trim();

  if (!apiKey) {
    throw new OpenAIImageError("An OpenAI API key is required.", {
      code: "openai_not_configured",
    });
  }

  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new OpenAIImageError("Image prompt is required.", {
      code: "missing_prompt",
    });
  }

  if (prompt.length > 32000) {
    throw new OpenAIImageError("Image prompt is too long.", {
      code: "prompt_too_long",
    });
  }

  if (input.image.bytes.byteLength === 0) {
    throw new OpenAIImageError("The uploaded photo is empty.", {
      code: "empty_input_image",
    });
  }

  const model = input.model.trim() || "gpt-image-2";

  const extension =
    EDIT_IMAGE_EXTENSION_BY_MIME_TYPE[input.image.mimeType] ?? "png";

  // multipart Blob only accepts an ArrayBuffer-backed view, and the
  // incoming Uint8Array's backing type is ArrayBufferLike — copying
  // into a fresh Uint8Array removes that ambiguity for TypeScript.
  const imageCopy = new Uint8Array(input.image.bytes.byteLength);

  imageCopy.set(input.image.bytes);

  const form = new FormData();

  form.set("model", model);
  form.set("prompt", prompt);
  form.set("size", input.size);
  form.set("quality", input.quality);
  form.set("n", "1");

  form.set(
    "image",
    new Blob([imageCopy], { type: input.image.mimeType }),
    `photo.${extension}`,
  );

  if (input.user) {
    form.set("user", input.user);
  }

  // Streaming is only worth turning on when there's actually a
  // callback to hand previews to — every other caller gets the exact
  // same plain request/response shape as before.
  if (input.onPartialImage) {
    form.set("stream", "true");
    form.set("partial_images", String(MAX_PARTIAL_IMAGES));
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",

    headers: {
      Authorization: `Bearer ${apiKey}`,
    },

    body: form,

    signal: AbortSignal.timeout(180000),
  });

  const requestId = response.headers.get("x-request-id");

  // An error status is always a plain JSON body, streaming request or
  // not — OpenAI never starts the SSE stream unless the request first
  // validates.
  if (!response.ok) {
    let errorPayload: OpenAIImagesResponse = {};

    try {
      errorPayload = (await response.json()) as OpenAIImagesResponse;
    } catch {
      throw new OpenAIImageError(
        `OpenAI returned an unreadable response (${response.status}).`,
        {
          code: `http_${response.status}`,
          requestId,
        },
      );
    }

    throw new OpenAIImageError(
      errorPayload.error?.message ||
        `OpenAI image editing failed with status ${response.status}.`,
      {
        code:
          errorPayload.error?.code ||
          errorPayload.error?.type ||
          `http_${response.status}`,

        requestId,
      },
    );
  }

  if (input.onPartialImage) {
    const completed = await consumeEditImageStream(
      response,
      input.onPartialImage,
    );

    return {
      image: {
        bytes: decodeBase64Image(completed.b64_json as string),
        revisedPrompt: completed.revised_prompt ?? null,
      },

      model,
      requestId,
    };
  }

  let payload: OpenAIImagesResponse;

  try {
    payload = (await response.json()) as OpenAIImagesResponse;
  } catch {
    throw new OpenAIImageError(
      `OpenAI returned an unreadable response (${response.status}).`,
      {
        code: `http_${response.status}`,
        requestId,
      },
    );
  }

  const imageData = (payload.data ?? []).find((item) => Boolean(item.b64_json));

  if (!imageData?.b64_json) {
    throw new OpenAIImageError(
      "OpenAI completed the request but returned no image.",
      {
        code: "no_images_returned",
        requestId,
      },
    );
  }

  return {
    image: {
      bytes: decodeBase64Image(imageData.b64_json),
      revisedPrompt: imageData.revised_prompt ?? null,
    },

    model,
    requestId,
  };
}
