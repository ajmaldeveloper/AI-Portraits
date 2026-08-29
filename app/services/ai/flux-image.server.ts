// Black Forest Labs (FLUX) image generation.
//
// Verified against https://docs.bfl.ai/quick_start/generating_images —
// verbatim curl/Python examples checked directly for both the create
// request and the polling response before implementing this, including
// the exact "result.sample" field name that carries the final signed
// image URL. This is a genuinely async API (create → poll → fetch),
// unlike OpenAI/Google which return the image inline.

export type FluxGeneratedImage = {
  bytes: Uint8Array;
  revisedPrompt: string | null;
};

export type GenerateFluxImagesInput = {
  apiKey: string;
  model: string;
  prompt: string;
  count: number;
  aspectRatio: string;
};

export type GenerateFluxImagesResult = {
  images: FluxGeneratedImage[];
  model: string;
  requestId: string | null;
};

export class FluxImageError extends Error {
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

    this.name = "FluxImageError";

    this.code = options.code ?? null;

    this.requestId = options.requestId ?? null;
  }
}

function dimensionsFor(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case "4:5":
      return { width: 1024, height: 1280 };

    case "3:4":
      return { width: 960, height: 1280 };

    case "5:4":
      return { width: 1280, height: 1024 };

    case "4:3":
      return { width: 1280, height: 960 };

    case "16:9":
      return { width: 1344, height: 768 };

    default:
      return { width: 1024, height: 1024 };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CreatePayload = {
  id?: string;
  polling_url?: string;
  detail?: unknown;
};

type PollPayload = {
  status?: string;
  result?: {
    sample?: string;
  };
};

const TERMINAL_FAILURE_STATUSES = new Set([
  "Error",
  "Failed",
  "Content Moderated",
  "Request Moderated",
]);

async function generateOneImage(
  apiKey: string,
  model: string,
  prompt: string,
  width: number,
  height: number,
): Promise<{ image: FluxGeneratedImage; requestId: string | null }> {
  const createResponse = await fetch(`https://api.bfl.ai/v1/${model}`, {
    method: "POST",

    headers: {
      accept: "application/json",
      "x-key": apiKey,
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      prompt,
      width,
      height,
    }),

    signal: AbortSignal.timeout(30000),
  });

  let createPayload: CreatePayload;

  try {
    createPayload = (await createResponse.json()) as CreatePayload;
  } catch {
    throw new FluxImageError(
      `FLUX returned an unreadable response (${createResponse.status}).`,
      {
        code: `http_${createResponse.status}`,
      },
    );
  }

  if (!createResponse.ok || !createPayload.polling_url) {
    throw new FluxImageError(
      typeof createPayload.detail === "string"
        ? createPayload.detail
        : `FLUX generation request failed with status ${createResponse.status}.`,
      {
        code: `http_${createResponse.status}`,
        requestId: createPayload.id ?? null,
      },
    );
  }

  const requestId = createPayload.id ?? null;

  const deadline = Date.now() + 120000;

  while (Date.now() < deadline) {
    await sleep(1500);

    const pollResponse = await fetch(createPayload.polling_url, {
      headers: {
        accept: "application/json",
        "x-key": apiKey,
      },

      signal: AbortSignal.timeout(30000),
    });

    let pollPayload: PollPayload;

    try {
      pollPayload = (await pollResponse.json()) as PollPayload;
    } catch {
      throw new FluxImageError(
        `FLUX returned an unreadable status response (${pollResponse.status}).`,
        {
          code: `http_${pollResponse.status}`,
          requestId,
        },
      );
    }

    if (!pollResponse.ok) {
      throw new FluxImageError(
        `FLUX status check failed with status ${pollResponse.status}.`,
        {
          code: `http_${pollResponse.status}`,
          requestId,
        },
      );
    }

    if (pollPayload.status === "Ready") {
      const sampleUrl = pollPayload.result?.sample;

      if (!sampleUrl) {
        throw new FluxImageError(
          "FLUX marked the request Ready but returned no image URL.",
          {
            code: "no_images_returned",
            requestId,
          },
        );
      }

      // The signed URL is only valid for 10 minutes — fetch it now.
      const imageResponse = await fetch(sampleUrl, {
        signal: AbortSignal.timeout(30000),
      });

      if (!imageResponse.ok) {
        throw new FluxImageError(
          `Could not download the generated image (status ${imageResponse.status}).`,
          {
            code: `http_${imageResponse.status}`,
            requestId,
          },
        );
      }

      const bytes = new Uint8Array(await imageResponse.arrayBuffer());

      if (bytes.length === 0) {
        throw new FluxImageError("FLUX returned an empty image.", {
          code: "empty_image",
          requestId,
        });
      }

      return {
        image: {
          bytes,
          revisedPrompt: null,
        },

        requestId,
      };
    }

    if (pollPayload.status && TERMINAL_FAILURE_STATUSES.has(pollPayload.status)) {
      throw new FluxImageError(`FLUX generation ${pollPayload.status}.`, {
        code: pollPayload.status,
        requestId,
      });
    }

    // Anything else (e.g. "Pending", "Processing") — keep polling.
  }

  throw new FluxImageError("Timed out waiting for FLUX image generation.", {
    code: "timeout",
    requestId,
  });
}

/**
 * Generates images via Black Forest Labs' FLUX API using the merchant's
 * own API key and chosen model. The API generates one image per
 * request (async create → poll → download), so `count` issues
 * sequential requests.
 */
export async function generateFluxImages(
  input: GenerateFluxImagesInput,
): Promise<GenerateFluxImagesResult> {
  const apiKey = input.apiKey.trim();

  if (!apiKey) {
    throw new FluxImageError("A Black Forest Labs API key is required.", {
      code: "flux_not_configured",
    });
  }

  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 4) {
    throw new FluxImageError("Image count must be between 1 and 4.", {
      code: "invalid_image_count",
    });
  }

  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new FluxImageError("Image prompt is required.", {
      code: "missing_prompt",
    });
  }

  const model = input.model.trim() || "flux-pro-1.1";

  const { width, height } = dimensionsFor(input.aspectRatio);

  const images: FluxGeneratedImage[] = [];

  let lastRequestId: string | null = null;

  for (let index = 0; index < input.count; index += 1) {
    const result = await generateOneImage(apiKey, model, prompt, width, height);

    images.push(result.image);

    lastRequestId = result.requestId;
  }

  return {
    images,
    model,
    requestId: lastRequestId,
  };
}
