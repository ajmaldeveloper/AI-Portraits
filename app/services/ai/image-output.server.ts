// Shared helpers for turning a Style's output settings into the shape
// AI provider APIs expect, and for safely handing image bytes to
// Prisma. Used by both the merchant-facing generation flow
// (style-product-media.server.ts) and the customer-facing one
// (customer-generation.server.ts).

export function outputSize(
  aspectRatio: string,
): "1024x1024" | "1024x1536" | "1536x1024" {
  switch (aspectRatio) {
    case "4:5":
    case "3:4":
      return "1024x1536";

    case "5:4":
    case "4:3":
    case "16:9":
      return "1536x1024";

    default:
      return "1024x1024";
  }
}

export function outputQuality(value: string): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  return "high";
}

/**
 * Prisma Bytes expects an ArrayBuffer-backed Uint8Array.
 *
 * OpenAI/base64 decoding can produce a Uint8Array whose generic backing
 * type is ArrayBufferLike. Creating a fresh typed array removes that
 * SharedArrayBuffer ambiguity for TypeScript and Prisma.
 */
export function toDatabaseBytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);

  copy.set(bytes);

  return copy;
}

export function pngDimensions(bytes: Uint8Array) {
  if (bytes.length < 24) {
    return {
      width: null,
      height: null,
    };
  }

  const signature = [137, 80, 78, 71, 13, 10, 26, 10];

  const isPng = signature.every((value, index) => bytes[index] === value);

  if (!isPng) {
    return {
      width: null,
      height: null,
    };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return {
    width: view.getUint32(16, false),

    height: view.getUint32(20, false),
  };
}
