import { authenticate } from "../../shopify.server";

type AdminGraphqlClient = Awaited<
  ReturnType<typeof authenticate.admin>
>["admin"];

function assertNoGraphqlErrors(payload: {
  errors?: Array<{ message: string }>;
}) {
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(payload.errors.map((error) => error.message).join(" "));
  }
}

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function filenameFor(mimeType: string, fallback: string) {
  const extension = EXTENSION_BY_MIME_TYPE[mimeType];

  if (!extension) {
    return fallback;
  }

  return fallback.toLowerCase().endsWith(`.${extension}`)
    ? fallback
    : `${fallback}.${extension}`;
}

type StagedUploadsCreateResponse = {
  data?: {
    stagedUploadsCreate?: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }>;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
};

const STAGED_UPLOADS_CREATE_MUTATION = `#graphql
  mutation StyleMediaStagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type FileCreateResponse = {
  data?: {
    fileCreate?: {
      files: Array<{ id: string }>;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
};

const FILE_CREATE_MUTATION = `#graphql
  mutation StyleMediaFileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Uploads image bytes to Shopify Files and returns the resulting file's
 * GID, so a Style's product images already have a durable Shopify media
 * reference the moment they're uploaded — rather than only being synced
 * lazily (by URL) the next time the product is published, which is
 * fragile to match back up on retries or later updates.
 */
export async function uploadImageToShopifyFiles(
  admin: AdminGraphqlClient,
  input: {
    bytes: Uint8Array;
    mimeType: string;
    filename: string;
    alt: string;
  },
): Promise<string> {
  const stagedResponse = await admin.graphql(STAGED_UPLOADS_CREATE_MUTATION, {
    variables: {
      input: [
        {
          resource: "IMAGE",
          filename: filenameFor(input.mimeType, input.filename),
          mimeType: input.mimeType,
          httpMethod: "POST",
          fileSize: input.bytes.byteLength.toString(),
        },
      ],
    },
  });

  const stagedPayload =
    (await stagedResponse.json()) as StagedUploadsCreateResponse;

  assertNoGraphqlErrors(stagedPayload);

  const stagedUserErrors =
    stagedPayload.data?.stagedUploadsCreate?.userErrors ?? [];

  if (stagedUserErrors.length > 0) {
    throw new Error(stagedUserErrors.map((error) => error.message).join(" "));
  }

  const target = stagedPayload.data?.stagedUploadsCreate?.stagedTargets?.[0];

  if (!target) {
    throw new Error("Shopify did not return a staged upload target.");
  }

  const form = new FormData();

  for (const parameter of target.parameters) {
    form.append(parameter.name, parameter.value);
  }

  // Blob only accepts an ArrayBuffer-backed view, and the incoming
  // Uint8Array's backing type is ArrayBufferLike (it may come from a
  // SharedArrayBuffer-typed source upstream) — copying into a fresh
  // Uint8Array removes that ambiguity for TypeScript.
  const blobBytes = new Uint8Array(input.bytes.byteLength);

  blobBytes.set(input.bytes);

  form.append(
    "file",
    new Blob([blobBytes], { type: input.mimeType }),
    filenameFor(input.mimeType, input.filename),
  );

  // A stalled staging-storage request would otherwise hang indefinitely
  // — fetch has no default timeout.
  const uploadResponse = await fetch(target.url, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  if (!uploadResponse.ok) {
    throw new Error("Could not upload the image to Shopify's file storage.");
  }

  const fileCreateResponse = await admin.graphql(FILE_CREATE_MUTATION, {
    variables: {
      files: [
        {
          originalSource: target.resourceUrl,
          contentType: "IMAGE",
          alt: input.alt,
        },
      ],
    },
  });

  const fileCreatePayload =
    (await fileCreateResponse.json()) as FileCreateResponse;

  assertNoGraphqlErrors(fileCreatePayload);

  const fileUserErrors = fileCreatePayload.data?.fileCreate?.userErrors ?? [];

  if (fileUserErrors.length > 0) {
    throw new Error(fileUserErrors.map((error) => error.message).join(" "));
  }

  const file = fileCreatePayload.data?.fileCreate?.files?.[0];

  if (!file) {
    throw new Error("Shopify did not return a file for this upload.");
  }

  return file.id;
}
