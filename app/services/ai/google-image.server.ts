// Google (Gemini) image generation via the "Interactions" REST API.
//
// Request shape verified against https://ai.google.dev/gemini-api/docs/image-generation
// (verbatim curl example, checked directly before implementing this).
// The exact response JSON shape was NOT shown anywhere on that page —
// no response example exists there to verify against — so parsing
// below is intentionally defensive: it tries the documented-adjacent
// shape first, falls back to a couple of plausible alternates, and
// throws a clear, diagnosable error rather than silently returning
// nothing. Treat this adapter as needing a real live test before
// relying on it in production, the same way the OpenAI adapter was
// flagged in M4.

export type GoogleGeneratedImage = {
  bytes: Uint8Array;
  revisedPrompt: string | null;
};

export type GenerateGoogleImagesInput = {
  apiKey: string;
  model: string;
  prompt: string;
  count: number;
  aspectRatio: string;
  quality: "low" | "medium" | "high";
};

export type GenerateGoogleImagesResult = {
  images: GoogleGeneratedImage[];
  model: string;
  requestId: string | null;
};

export class GoogleImageError extends Error {
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

    this.name = "GoogleImageError";

    this.code = options.code ?? null;

    this.requestId = options.requestId ?? null;
  }
}

function imageSizeFor(quality: "low" | "medium" | "high") {
  switch (quality) {
    case "low":
      return "1K";

    case "medium":
      return "2K";

    case "high":
      return "2K";

    default:
      return "1K";
  }
}

function decodeBase64Image(value: string) {
  const buffer = Buffer.from(value, "base64");

  if (buffer.length === 0) {
    throw new GoogleImageError("Google returned an empty image.", {
      code: "empty_image",
    });
  }

  if (buffer.length > 25 * 1024 * 1024) {
    throw new GoogleImageError("Generated image exceeded the app size limit.", {
      code: "image_too_large",
    });
  }

  return new Uint8Array(buffer);
}

type InteractionsContentBlock = {
  type?: string;
  data?: string;
  text?: string;
};

type InteractionsStep = {
  type?: string;
  content?: InteractionsContentBlock[];
};

type InteractionsResponse = {
  id?: string;
  steps?: InteractionsStep[];

  // Defensive fallbacks in case the live response shape differs from
  // what's inferable from the documented request example.
  output?: InteractionsContentBlock[];
  content?: InteractionsContentBlock[];

  error?: {
    message?: string;
    status?: string;
    code?: number;
  };
};

function extractImageBlocks(payload: InteractionsResponse) {
  const fromSteps = (payload.steps ?? [])
    .filter((step) => step.type === "model_output" || !step.type)
    .flatMap((step) => step.content ?? []);

  const candidates = [
    ...fromSteps,
    ...(payload.output ?? []),
    ...(payload.content ?? []),
  ];

  return candidates.filter(
    (block): block is InteractionsContentBlock & { data: string } =>
      block.type === "image" && Boolean(block.data),
  );
}

async function generateOneImage(
  apiKey: string,
  model: string,
  prompt: string,
  aspectRatio: string,
  quality: "low" | "medium" | "high",
): Promise<{ image: GoogleGeneratedImage; requestId: string | null }> {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",

      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        model,
        input: prompt,
        response_format: {
          type: "image",
          mime_type: "image/png",
          aspect_ratio: aspectRatio,
          image_size: imageSizeFor(quality),
        },
      }),

      signal: AbortSignal.timeout(180000),
    },
  );

  const requestId = response.headers.get("x-goog-request-id");

  let payload: InteractionsResponse;

  try {
    payload = (await response.json()) as InteractionsResponse;
  } catch {
    throw new GoogleImageError(
      `Google returned an unreadable response (${response.status}).`,
      {
        code: `http_${response.status}`,
        requestId,
      },
    );
  }

  if (!response.ok) {
    throw new GoogleImageError(
      payload.error?.message ||
        `Google image generation failed with status ${response.status}.`,
      {
        code: payload.error?.status || `http_${response.status}`,
        requestId,
      },
    );
  }

  const imageBlocks = extractImageBlocks(payload);

  if (imageBlocks.length === 0) {
    throw new GoogleImageError(
      "Google completed the request but the app could not find an image in the response. The Interactions API response shape may have changed — this adapter needs a live check.",
      {
        code: "no_images_returned",
        requestId: requestId ?? payload.id ?? null,
      },
    );
  }

  const textBlock = (payload.steps ?? [])
    .flatMap((step) => step.content ?? [])
    .find((block) => block.type === "text" && block.text);

  return {
    image: {
      bytes: decodeBase64Image(imageBlocks[0].data),
      revisedPrompt: textBlock?.text ?? null,
    },

    requestId: requestId ?? payload.id ?? null,
  };
}

/**
 * Generates images via Google's Gemini Interactions API using the
 * merchant's own API key and chosen model. The API generates one
 * image per call, so `count` issues sequential requests.
 */
export async function generateGoogleImages(
  input: GenerateGoogleImagesInput,
): Promise<GenerateGoogleImagesResult> {
  const apiKey = input.apiKey.trim();

  if (!apiKey) {
    throw new GoogleImageError("A Google Gemini API key is required.", {
      code: "google_not_configured",
    });
  }

  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 4) {
    throw new GoogleImageError("Image count must be between 1 and 4.", {
      code: "invalid_image_count",
    });
  }

  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new GoogleImageError("Image prompt is required.", {
      code: "missing_prompt",
    });
  }

  const model = input.model.trim() || "gemini-3.1-flash-image";

  const images: GoogleGeneratedImage[] = [];

  let lastRequestId: string | null = null;

  // Sequential, not parallel — this is a low-frequency, merchant-
  // triggered action, and keeps us clear of any per-second rate limit
  // on the caller's own API key.
  for (let index = 0; index < input.count; index += 1) {
    const result = await generateOneImage(
      apiKey,
      model,
      prompt,
      input.aspectRatio,
      input.quality,
    );

    images.push(result.image);

    lastRequestId = result.requestId;
  }

  return {
    images,
    model,
    requestId: lastRequestId,
  };
}
