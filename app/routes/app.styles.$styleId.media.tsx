import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { createSignedStyleAssetUrl } from "../services/media/media-signing.server";
import { getAIProviderSettingsSummary } from "../services/settings/ai-provider-settings.server";
import { uploadImageToShopifyFiles } from "../services/shopify/files.server";
import {
  attachStyleAssetShopifyMediaId,
  deleteStyleProductImages,
  generateStyleProductImages,
  getStyleImageContentHashes,
  hashImageBytes,
  setStyleMediaMode,
  uploadStyleProductImages,
} from "../services/styles/style-product-media.server";
import {
  requireStyleForShop,
  styleMediaCanBeEdited,
} from "../services/styles/style.server";
import { authenticate } from "../shopify.server";
import { useNavigatingTo } from "../utils/use-navigating-to";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const styleId = params.styleId;

  if (!styleId) {
    throw new Response("Style ID is required", {
      status: 400,
    });
  }

  const style = await requireStyleForShop(session.shop, styleId);

  const aiSettings = await getAIProviderSettingsSummary(session.shop);

  const url = new URL(request.url);

  const productSettings =
    typeof style.productSettings === "object" &&
    style.productSettings !== null &&
    !Array.isArray(style.productSettings)
      ? (style.productSettings as Record<string, unknown>)
      : {};

  const mediaMode =
    productSettings.mediaMode === "upload" ? "upload" : "generate";

  const generatedImages = style.assets
    .filter(
      (asset) =>
        asset.kind === "PRODUCT_GENERATED" || asset.kind === "PRODUCT_SELECTED",
    )
    .map((asset) => ({
      id: asset.id,

      uploaded: asset.generationId === null,

      width: asset.width,

      height: asset.height,

      altText:
        asset.altText ||
        (asset.generationId === null
          ? `Uploaded image for ${style.name}`
          : `Generated image for ${style.name}`),

      url: createSignedStyleAssetUrl(request.url, asset.id, session.shop),
    }));

  return {
    styleId: style.id,

    styleName: style.name,

    productTitle: style.productTitle,

    promptConfigured: Boolean(style.prompt.trim()),

    editable: styleMediaCanBeEdited(style),

    mediaMode,

    aiConfigured: aiSettings.configured,

    provider: aiSettings.provider,

    model: aiSettings.model,

    previewCount: style.previewCount,

    generatedImages,

    notice: url.searchParams.get("notice"),

    generatedCount: url.searchParams.get("count"),

    duplicatesSkipped: Number(url.searchParams.get("duplicates") ?? "0"),
  };
};

function formString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);

  const styleId = params.styleId;

  if (!styleId) {
    throw new Response("Style ID is required", {
      status: 400,
    });
  }

  const formData = await request.formData();

  const intent = formString(formData, "intent");

  try {
    if (intent === "generateProductImages") {
      const promptOverride = formString(formData, "prompt");

      const result = await generateStyleProductImages(session.shop, styleId, {
        promptOverride,
      });

      return redirect(
        `/app/styles/${styleId}/media?notice=generated&count=${result.count}`,
      );
    }

    if (intent === "uploadProductImages") {
      const entries = formData.getAll("images");

      const imageFiles = entries.filter(
        (entry): entry is File => entry instanceof File && entry.size > 0,
      );

      if (imageFiles.length === 0) {
        throw new Error("Choose at least one image to upload.");
      }

      const existingHashes = await getStyleImageContentHashes(
        session.shop,
        styleId,
      );

      const seenHashes = new Set(existingHashes);

      let duplicateCount = 0;

      const files: Array<{
        bytes: Uint8Array;
        mimeType: string;
        name: string;
      }> = [];

      for (const file of imageFiles) {
        const bytes = new Uint8Array(await file.arrayBuffer());

        const hash = hashImageBytes(bytes);

        // Catches the same file picked twice in one selection, and a
        // file that's byte-identical to one already in the gallery —
        // either way, don't create a second, indistinguishable copy.
        if (seenHashes.has(hash)) {
          duplicateCount += 1;

          continue;
        }

        seenHashes.add(hash);

        files.push({
          bytes,
          mimeType: file.type || "application/octet-stream",
          name: file.name,
        });
      }

      if (files.length === 0) {
        throw new Error(
          duplicateCount > 0
            ? "This image has already been uploaded."
            : "Choose at least one image to upload.",
        );
      }

      // Saved locally first so the gallery updates right away — pushing
      // to Shopify Files (two GraphQL calls plus an external upload per
      // image) is comparatively slow, and shouldn't make the merchant
      // wait before they see their image. That sync runs afterward,
      // in the background: see below.
      const assets = await uploadStyleProductImages(
        session.shop,
        styleId,
        files.map((file) => ({
          bytes: file.bytes,
          mimeType: file.mimeType,
          shopifyMediaId: null,
        })),
      );

      // Not awaited — the response is returned before this finishes.
      // Sequential, not Promise.all, so several images uploaded at once
      // don't all hit Shopify's GraphQL cost-based rate limiter
      // together. If a given image's push fails, it's simply left
      // without a shopifyMediaId — publish/update already falls back to
      // uploading it by URL at that point instead.
      void (async () => {
        for (let index = 0; index < assets.length; index += 1) {
          const asset = assets[index];

          const file = files[index];

          if (!asset || !file) {
            continue;
          }

          try {
            const shopifyMediaId = await uploadImageToShopifyFiles(admin, {
              bytes: file.bytes,
              mimeType: file.mimeType,
              filename: file.name || "product-image",
              alt: file.name || "Product image",
            });

            await attachStyleAssetShopifyMediaId(asset.id, shopifyMediaId);
          } catch (error) {
            console.error("Shopify Files upload failed", error);
          }
        }
      })();

      return redirect(
        `/app/styles/${styleId}/media?notice=uploaded&count=${assets.length}&duplicates=${duplicateCount}`,
      );
    }

    if (intent === "importShopFile") {
      const fileUrl = formString(formData, "fileUrl");

      const fileId = formString(formData, "fileId");

      if (!fileUrl) {
        throw new Error("Choose an image to import.");
      }

      const fileResponse = await fetch(fileUrl);

      if (!fileResponse.ok) {
        throw new Error("Could not download the selected file from Shopify.");
      }

      const bytes = new Uint8Array(await fileResponse.arrayBuffer());

      const existingHashes = await getStyleImageContentHashes(
        session.shop,
        styleId,
      );

      if (existingHashes.has(hashImageBytes(bytes))) {
        throw new Error("This image has already been added.");
      }

      const mimeType =
        fileResponse.headers.get("content-type") || "application/octet-stream";

      // This file already lives in Shopify Files — the picker gave us
      // its GID directly, so there's no need to re-upload a duplicate
      // copy the way a fresh device upload does.
      const assets = await uploadStyleProductImages(session.shop, styleId, [
        { bytes, mimeType, shopifyMediaId: fileId || null },
      ]);

      return redirect(
        `/app/styles/${styleId}/media?notice=uploaded&count=${assets.length}`,
      );
    }

    if (intent === "setMediaMode") {
      const mode = formString(formData, "mediaMode");

      if (mode === "generate" || mode === "upload") {
        await setStyleMediaMode(session.shop, styleId, mode);
      }

      return { ok: true };
    }

    if (intent === "removeSelectedImages") {
      const assetIds = formData
        .getAll("assetId")
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        );

      if (assetIds.length === 0) {
        throw new Error("Choose at least one image to remove.");
      }

      const count = await deleteStyleProductImages(
        session.shop,
        styleId,
        assetIds,
      );

      return redirect(
        `/app/styles/${styleId}/media?notice=removed-selected&count=${count}`,
      );
    }

    throw new Error("Unsupported media action.");
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not complete the media action.",
    };
  }
};

const noticeMessages: Record<string, string> = {
  "removed-selected": "Images removed",
};

const MAX_UPLOAD_MB = 10;

// Starting points for the "Generate more" dialog — a merchant unsure
// what to write can pick one and edit from there, rather than facing a
// blank box. Each one is a complete, standalone generation instruction
// (not a "transform this photo" instruction — there's no customer
// photo here, so the AI needs to be told to invent a whole scene) and
// doubles as a worked example a merchant can copy the structure of
// when writing their own prompt: what to create, the subject, the
// style, the lighting/mood, and the quality bar.
function buildGenerationPromptTemplate(input: {
  productTitle: string;
  subject: string;
  style: string;
  palette: string;
  lighting: string;
  composition: string;
  texture: string;
  avoid: string;
}) {
  return `Create a professional, high-resolution product example photo for "${input.productTitle}". There is no customer photo to edit — invent the full scene described below from scratch.

- Subject: ${input.subject}
- Style: ${input.style}
- Color palette: ${input.palette}
- Lighting & mood: ${input.lighting}
- Composition & framing: ${input.composition}
- Texture & fine detail: ${input.texture}
- Quality bar: Sharp focus on the primary subject, clean edges, professional ecommerce photography suitable for a Shopify product gallery, true-to-palette color grading, well-balanced exposure with no blown-out highlights or crushed shadows.
- Avoid: ${input.avoid} Also avoid watermarks, logos, brand names, readable text, UI elements, borders, mockup frames, and any before-and-after split layout.`;
}

const GENERATION_PROMPT_TEMPLATES: Array<{
  label: string;
  prompt: (productTitle: string) => string;
}> = [
  {
    label: "Forest Wanderer",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "An adult in their mid-20s to 30s with tousled shoulder-length brown hair and a calm, contented expression, wearing a simple cream linen shirt and a woven moss-green scarf, walking along a soft dirt path through a sunlit woodland clearing scattered with ferns and fallen leaves, tall trees rising on either side.",
        style:
          "A hand-painted woodland illustration — ink outline linework filled with loose watercolor washes, visible paper texture, and soft pigment bleed at the edges of every shape, including the trees and foliage surrounding the subject.",
        palette:
          "Earthy woodland tones: #2D4A34 (deep pine), #6B8F71 (moss green), #5C4433 (bark brown), and #EDE6D6 (soft cream highlight), kept muted and harmonious throughout.",
        lighting:
          "Dappled sunlight filtering through a tall tree canopy, soft warm patches of light scattered across the path and the subject's shoulders.",
        composition:
          "Subject slightly off-center on the winding path, tall trees framing either side of the frame, soft depth fading into the woodland background.",
        texture:
          "Visible paper grain, pigment granulation in the shaded foliage, and loose confident brushwork on bark and leaves.",
        avoid:
          "Photorealistic rendering, hard vector-clean edges, or a flat green color filter with no painterly depth.",
      }),
  },
  {
    label: "Golden Meadow",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "An adult in their late 20s with wavy sun-lightened blonde hair loosely tied back and a warm, relaxed smile, wearing a flowing cream cotton dress with short sleeves, standing waist-deep in tall golden wheat with a soft rolling horizon behind them.",
        style:
          "A warm, painterly scene bathed in soft sunlit glow — visible brushstroke texture, gentle atmospheric haze, and warm low-angle light washing over the whole frame.",
        palette:
          "Golden wheat tones: #E8B854 (golden wheat), #D98F4B (warm amber), #FFF4DD (soft cream highlight), and #8FA382 (sage green), kept warm and glowing throughout.",
        lighting:
          "Warm low-angle sunlight from behind the subject, a gentle golden rim light along their silhouette, and soft haze easing the background into a painterly blur.",
        composition:
          "Subject centered in the wheat, horizon placed low in the frame, expansive warm sky filling the upper two-thirds.",
        texture:
          "Painterly brush texture across the wheat stalks and sky, soft blended edges with no crisp digital sharpness.",
        avoid:
          "Cold or blue-toned shadows, flat midday lighting, or an artificial orange filter with no painterly texture.",
      }),
  },
  {
    label: "Wildflower Dream",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "A young adult with loose, flowing light-brown hair with a few small wildflowers tucked behind one ear and a soft, gentle expression, wearing a pale lavender linen dress, seated in a meadow of blooming wildflowers.",
        style:
          "A soft botanical watercolor illustration — gentle pigment bleed, visible watercolor paper texture, and delicate wildflower and leaf motifs blooming at the edges of the frame.",
        palette:
          "Soft floral tones: #F3B9C6 (blush pink), #B9A4D4 (lavender), #8FA88A (sage green), and #FBF3E7 (cream paper), light and airy rather than saturated.",
        lighting:
          "Soft, diffuse natural daylight with no harsh shadows, evoking a calm, hand-painted mood.",
        composition:
          "Subject seated centrally, wildflowers framing the lower and side edges of the frame, generous negative space (unpainted paper) around the subject.",
        texture:
          "Visible paper grain, soft pigment bleed at every edge, loose confident brushwork on the florals.",
        avoid:
          "A sticker-like flower overlay pasted on top, or crisp vector-clean edges with no watercolor bleed.",
      }),
  },
  {
    label: "Mountain Spirit",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "A rugged adult in their 30s to 40s with short windswept dark hair and a weathered, determined expression, wearing a thick wool sweater in slate gray, standing on a rocky outcrop with layered mountain peaks fading into the distance behind them.",
        style:
          "A bold, rugged painting with thick, confident brushstroke texture built up in visible layers across a coarse canvas surface.",
        palette:
          "Rugged natural stone tones: #5A6B73 (slate gray), #7C93A0 (stone blue), #33473A (deep pine), and #E8EDEA (muted white highlight), with strong weathered contrast throughout.",
        lighting:
          "Overcast mountain light with strong, weathered contrast between light and shadow across the rock and the subject's clothing.",
        composition:
          "Subject placed small against the vast layered peaks, following the rule of thirds, with generous open sky above.",
        texture:
          "Visible canvas weave showing through thin paint areas, heavy layered brush texture on the rock and clothing.",
        avoid:
          "A smooth digital painting filter, flat even lighting, or photorealistic rendering with no visible brushwork.",
      }),
  },
  {
    label: "Ocean Drift",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "An adult with damp, wavy dark hair pushed back and a serene expression, wearing a simple linen shirt in soft sandy beige rolled to the elbows, standing at the edge of gentle rolling waves on a quiet shoreline.",
        style:
          "A flowing, cool-toned watercolor wash — soft pigment bleed, visible wet-on-wet blending, and gentle paper texture across the whole image, as if painted with sea water itself.",
        palette:
          "Coastal sea-glass tones: #7FB6A8 (sea-glass teal), #A9D8D0 (soft aqua), #E4D8C3 (sandy beige), and #F5F7F5 (foam white).",
        lighting:
          "Soft coastal daylight with gentle reflections shimmering on the wet sand and water.",
        composition:
          "Subject placed off-center, horizon low in the frame, wide open sky and sea filling the background.",
        texture:
          "Visible paper grain, soft wash blending at every edge, no crisp photographic sharpness.",
        avoid:
          "A flat teal color filter, harsh vector-clean edges, or photorealistic water detail.",
      }),
  },
  {
    label: "Autumn Ember",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "An adult in their 30s with shoulder-length auburn hair and a warm, thoughtful expression, wearing a chunky knit sweater in deep maroon, standing among fallen autumn leaves beneath a canopy of orange and red foliage.",
        style:
          "A warm, richly painted portrait with visible brushstroke texture and deep, saturated fall tones throughout the scene.",
        palette:
          "Burnt autumn tones: #C1592B (burnt orange), #7A2E2E (deep maroon), #D9A441 (golden yellow), and #5C3A21 (warm brown).",
        lighting:
          "A soft ember-like glow settling on skin and surfaces, with long warm-toned shadows stretching across the leaves.",
        composition:
          "Subject centered, autumn foliage framing the top and sides of the frame, fallen leaves scattered in the foreground.",
        texture:
          "Visible brush texture on the leaves and clothing, layered paint built up in warm tones.",
        avoid:
          "An orange color filter over a flat photo with no painterly depth or brush texture.",
      }),
  },
  {
    label: "Moonlit Grove",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "An adult with dark hair loosely tousled and a calm, quiet expression, wearing a deep teal cloak-like wrap, standing in a small forest clearing softly lit by moonlight filtering through tall trees.",
        style:
          "A soft nocturnal woodland scene with a gentle blue-green glow and a subtle silver rim light tracing the subject's edges.",
        palette:
          "Nocturnal woodland tones: #1F2E3D (deep indigo), #3E5C55 (moonlit teal), #A8C4C2 (silver-blue highlight), and #E4EDE8 (pale glow).",
        lighting:
          "Soft moonlight filtering through the tree canopy, gentle atmospheric haze, and a silver rim light along the subject's silhouette.",
        composition:
          "Subject centered in the small clearing, tall tree silhouettes framing the scene on either side.",
        texture:
          "Soft glow bloom around the moonlight, subtle atmospheric particles visible in the haze.",
        avoid:
          "A flat blue color filter, harsh direct shadows, or a daylight-bright background that breaks the nocturnal mood.",
      }),
  },
  {
    label: "Royal Portrait",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "An adult with neatly styled hair and a composed, dignified expression, wearing a richly detailed velvet garment in deep burgundy trimmed with gold embroidery, seated against a softly rendered draped backdrop.",
        style:
          "A rich, classical oil portrait with visible brushstroke texture built up in layers and dramatic chiaroscuro lighting — strong contrast between richly lit highlights and soft, deep shadow.",
        palette:
          "Regal tones: #5C1A1A (deep burgundy), #C9A227 (royal gold), #1F5C4A (emerald accent), and #1A1210 (rich black shadow).",
        lighting:
          "A single strong light source with warm gold catching the fabric's embroidered edges, deep atmospheric shadow elsewhere.",
        composition:
          "Classical portrait framing, subject centered against a softly rendered dark drapery background, generous negative space for a gallery-style crop.",
        texture:
          "Layered brushstroke texture, visible fabric sheen on the velvet and gold trim.",
        avoid:
          "Flat even lighting, a smooth digital painting filter, or contemporary casual clothing.",
      }),
  },
  {
    label: "Old World Explorer",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "An adult in their 30s to 40s with tousled windswept hair and a determined, adventurous expression, wearing a weathered leather jacket over a simple canvas shirt with a worn satchel slung across one shoulder, standing before a faint background suggestion of an old hand-drawn map.",
        style:
          "A weathered vintage expedition photograph — visible film grain, a warm aged-parchment color grade, soft vignetting in the corners, and a faint background texture reminiscent of an old leather-bound journal fading into the edges.",
        palette:
          "Aged, warm hues: #D8C39A (aged parchment), #6B4423 (leather brown), #3E5266 (faded ink blue), and #8B6B4A (warm sepia).",
        lighting:
          "Soft directional light with a gentle vignette darkening the corners, evoking a weathered, well-traveled mood.",
        composition:
          "Subject centered, faint map or journal texture fading softly into the background behind them.",
        texture:
          "Consistent fine film grain, aged paper texture bleeding faintly into the background.",
        avoid:
          "A harsh flat sepia filter with no depth, or modern synthetic clothing that breaks the period feel.",
      }),
  },
  {
    label: "Vintage Romance",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "An adult with soft, gently curled hair and a warm, wistful smile, wearing a delicate blouse in dusty rose, softly lit against a simple, softly blurred background.",
        style:
          "A soft, glowing romantic film photograph — gentle soft-focus glow around highlights, fine film grain, and softened contrast with gently lifted blacks.",
        palette:
          "Dusty romantic tones: #D9A9A0 (dusty rose), #F2E4D0 (warm cream), #8B6F52 (soft sepia brown), and #C9A96A (faded gold).",
        lighting:
          "Soft glow bleeding gently around bright highlights, evoking a nostalgic, romantic mood.",
        composition:
          "Intimate, close framing with a softly blurred background that keeps full attention on the subject.",
        texture:
          "Fine, consistent film grain and a soft-focus quality across the whole image.",
        avoid:
          "A harsh Instagram-style filter, sharp digital clarity, or a fully in-focus background.",
      }),
  },
  {
    label: "Noir Legend",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "An adult with neatly combed hair and a sharp, composed expression, wearing a simple collared shirt or coat, positioned against a plain dark backdrop.",
        style:
          "A dramatic black-and-white cinematic portrait — strong chiaroscuro lighting with deep, high-contrast shadow and crisp, luminous highlights, reminiscent of a classic film noir still.",
        palette:
          "Pure monochrome only: #0D0D0D (pure black), #3A3A3A (charcoal), #D8D8D8 (silver highlight), and #F2F2F2 (pale white) — no color anywhere in the image.",
        lighting:
          "A single strong light source producing deep shadow across most of the frame and a crisp, luminous highlight on the subject's face.",
        composition:
          "Classic film-still framing, subject placed slightly off-center against a plain dark background.",
        texture: "Subtle, consistent film grain across the whole image.",
        avoid:
          "Any trace of color, or a generic flat grayscale conversion with no dramatic lighting.",
      }),
  },
  {
    label: "Desert Nomad",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "An adult with sun-tanned skin, tousled dark hair, and a calm, weathered expression, wearing a flowing linen robe in warm ochre tones, standing amid low sand dunes with a distant weathered rock formation.",
        style:
          "A sun-bleached desert scene with a hazy heat-shimmer softness settling over the background and a fine dusty grain across the image.",
        palette:
          "Sun-warmed earth tones: #C1703B (terracotta), #D9C29B (sand beige), #A6674A (dusty rose-brown), and #B98A3E (warm ochre).",
        lighting:
          "Warm low-angle sunlight casting long soft shadows across the dunes.",
        composition:
          "Subject centered amid the dunes, wide open sky filling the upper half of the frame, distant rock formation on the horizon.",
        texture:
          "Fine dusty grain across the whole image, soft heat-shimmer haze near the horizon.",
        avoid:
          "An artificial orange filter with no atmospheric depth, or modern synthetic clothing.",
      }),
  },
  {
    label: "Midnight Muse",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "An adult with sleek dark hair and a soft, glamorous expression, wearing an elegant simple garment in deep violet, softly lit against a plain dark backdrop.",
        style:
          "A moody, richly painted portrait with visible brushstroke texture and dramatic low-key lighting — deep shadow dominating the frame with a soft, glamorous highlight catching the subject's features.",
        palette:
          "Deep nocturnal glamour tones: #141B3C (midnight navy), #3B2C63 (deep violet), #B9C4E0 (silver highlight), and #EDEFFA (soft glow white).",
        lighting:
          "Deep shadow across most of the frame with a soft, focused highlight on the subject's face and shoulders.",
        composition:
          "Classic portrait framing, subject emerging from a softly rendered dark background.",
        texture:
          "Layered brushstroke texture, soft glow bloom around the highlight.",
        avoid:
          "A flat dark color filter, harsh direct lighting, or a smooth digital painting look with no brush texture.",
      }),
  },
  {
    label: "Timeless Sketch",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "A clearly readable adult subject with simple, well-defined features and a natural, relaxed expression, wearing plain, unpatterned clothing suited to fine linework.",
        style:
          "A detailed graphite pencil sketch on textured paper — fine cross-hatching used for shading, confident linework, and the visible tooth of the drawing paper throughout.",
        palette:
          "Pure monochrome grayscale only: #1A1A1A (deep graphite for darkest shadows), #4D4D4D (mid gray for core shading), #B3B3B3 (light gray for soft transitions), and #F5F5F0 (warm paper white) — no color anywhere in the image.",
        lighting:
          "Soft, realistic shading implying a single gentle light source, rendered entirely through pencil density and cross-hatch spacing rather than color.",
        composition:
          "Centered subject on a plain, lightly textured paper-colored background.",
        texture:
          "Visible individual pencil strokes, varying line weight, fine cross-hatching in shadow areas.",
        avoid:
          "Any trace of color, digital airbrush smoothness, or fully rendered photorealistic shading with no visible strokes.",
      }),
  },
  {
    label: "Golden Age",
    prompt: (productTitle) =>
      buildGenerationPromptTemplate({
        productTitle,
        subject:
          "An adult with elegantly styled hair (finger waves or a neat side part) and a poised, glamorous expression, wearing a sleek satin garment in warm bronze tones, softly lit in a classic studio setting.",
        style:
          "A glamorous 1920s studio portrait — soft directional key lighting, fine warm-toned film grain, and a subtle metallic sheen along the highlights reminiscent of art-deco glamour photography.",
        palette:
          "Warm vintage-glamour tones: #C9A227 (warm gold), #6B4E2E (deep bronze), #F0E6D2 (soft cream), and #1A1512 (black accent).",
        lighting:
          "Soft directional key light catching the satin fabric and hair with a subtle metallic sheen.",
        composition:
          "Classic studio glamour framing, subject centered against a plain softly lit backdrop.",
        texture:
          "Fine, consistent film grain and a soft metallic highlight sheen on the fabric.",
        avoid:
          "A flat sepia filter, contemporary casual styling, or harsh unflattering lighting.",
      }),
  },
];

export default function StyleMedia() {
  const data = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();

  const navigation = useNavigation();

  const submit = useSubmit();

  const shopify = useAppBridge();

  const backNav = useNavigatingTo();

  const nextNav = useNavigatingTo();

  // Every image in the gallery is already product media — the checkbox
  // only marks images to bulk-remove from the gallery, so which boxes
  // are checked is purely local UI state; nothing is written to the
  // server until "Remove" is pressed.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const toggleChecked = (assetId: string) => {
    setCheckedIds((current) => {
      const next = new Set(current);

      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }

      return next;
    });
  };

  // Remembered server-side (Style.productSettings), not localStorage, so
  // the choice survives a reload instead of always resetting to
  // "Generate with AI" — localStorage is scoped per browser origin, and
  // local dev runs behind an ephemeral tunnel hostname that changes on
  // every restart, silently discarding it.
  const [mediaMode, setMediaModeState] = useState<"generate" | "upload">(
    data.mediaMode === "upload" ? "upload" : "generate",
  );

  useEffect(() => {
    setMediaModeState(data.mediaMode === "upload" ? "upload" : "generate");
  }, [data.mediaMode]);

  // Starts empty — the placeholder text is just guidance, not
  // pre-filled text the merchant has to clear out first. The Generate
  // button stays disabled until something is actually typed.
  const [generationPrompt, setGenerationPrompt] = useState("");

  const mediaModeFetcher = useFetcher();

  const setMediaMode = (mode: "generate" | "upload") => {
    setMediaModeState(mode);

    const formData = new FormData();

    formData.set("intent", "setMediaMode");
    formData.set("mediaMode", mode);

    mediaModeFetcher.submit(formData, {
      method: "post",
    });
  };

  const activeIntent = navigation.formData
    ? formString(navigation.formData, "intent")
    : "";

  const generating =
    navigation.state !== "idle" && activeIntent === "generateProductImages";

  const uploading =
    navigation.state !== "idle" &&
    (activeIntent === "uploadProductImages" ||
      activeIntent === "importShopFile");

  const [importing, setImporting] = useState(false);

  const [shopFilePickerError, setShopFilePickerError] = useState<string | null>(
    null,
  );

  const openShopFilePicker = async () => {
    setImporting(true);
    setShopFilePickerError(null);

    try {
      const response = await fetch("/api/shop-files");

      const result = (await response.json()) as {
        files?: Array<{ id: string; url: string; label: string }>;
      };

      const files = result.files ?? [];

      if (files.length === 0) {
        setShopFilePickerError(
          "No images found in your Shopify Files library yet — upload one in Shopify admin under Content > Files first.",
        );

        return;
      }

      const { selected } = await shopify.picker({
        heading: "Select an image",
        multiple: false,

        items: files.map((file) => ({
          id: file.id,
          heading: file.label,
          thumbnail: {
            url: file.url,
          },
        })),
      });

      const selectedIds = await selected;

      const selectedFile = files.find((file) => file.id === selectedIds?.[0]);

      if (!selectedFile) {
        return;
      }

      const formData = new FormData();

      formData.set("intent", "importShopFile");

      formData.set("fileUrl", selectedFile.url);

      formData.set("fileId", selectedFile.id);

      submit(formData, {
        method: "post",
      });
    } catch {
      setShopFilePickerError("Could not open the Shopify Files picker.");
    } finally {
      setImporting(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = (files: readonly File[]) => {
    if (files.length === 0) {
      return;
    }

    const formData = new FormData();

    formData.set("intent", "uploadProductImages");

    for (const file of files) {
      formData.append("images", file);
    }

    submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  const removingSelected =
    navigation.state !== "idle" && activeIntent === "removeSelectedImages";

  // Clears the checkboxes once a removal actually goes through, rather
  // than leaving ids referring to now-deleted images sitting around.
  useEffect(() => {
    if (data.notice === "removed-selected") {
      setCheckedIds(new Set());
    }
  }, [data.notice]);

  useEffect(() => {
    if (!actionData?.error) {
      return;
    }

    shopify.toast.show(actionData.error, {
      isError: true,
    });
  }, [actionData, shopify]);

  useEffect(() => {
    if (!data.notice) {
      return;
    }

    let message = noticeMessages[data.notice];

    if (data.notice === "generated") {
      const count = Number(data.generatedCount ?? "0");

      message =
        count === 1
          ? "Product image generated"
          : `${count} product images generated`;
    }

    if (data.notice === "uploaded") {
      const count = Number(data.generatedCount ?? "0");

      message = count === 1 ? "Image uploaded" : `${count} images uploaded`;

      if (data.duplicatesSkipped > 0) {
        message += ` (${data.duplicatesSkipped} duplicate${data.duplicatesSkipped === 1 ? "" : "s"} skipped)`;
      }
    }

    if (data.notice === "removed-selected") {
      const count = Number(data.generatedCount ?? "0");

      message = count === 1 ? "1 image removed" : `${count} images removed`;
    }

    if (!message) {
      return;
    }

    shopify.toast.show(message);

    // A successful delete leaves its triggering modal open, showing
    // stale content behind the toast — s-modal exposes hideOverlay()
    // directly on the element.
    document
      .querySelectorAll<HTMLElement & { hideOverlay?: () => void }>("s-modal")
      .forEach((modal) => modal.hideOverlay?.());

    // A plain URL cleanup, not a real navigation — history.replaceState
    // avoids a spurious loader revalidation that would otherwise flash
    // every action button on this page into a loading state.
    window.history.replaceState(null, "", `/app/styles/${data.styleId}/media`);
  }, [
    data.duplicatesSkipped,
    data.generatedCount,
    data.notice,
    data.styleId,
    shopify,
  ]);

  // Not gated on data.promptConfigured — the generation dialog lets the
  // merchant supply a prompt for this batch even if the Style's own
  // (customer-facing) prompt is still empty.
  const generationDisabled = !data.editable || !data.aiConfigured || generating;

  const checkedCount = data.generatedImages.filter((image) =>
    checkedIds.has(image.id),
  ).length;

  return (
    <s-stack direction="block" gap="base">
      {!data.aiConfigured ? (
        <s-banner tone="warning" heading="AI provider required">
          <s-paragraph>
            Configure an AI provider and your own API key in{" "}
            <s-link href="/app/settings">Settings</s-link> before generating
            images.
          </s-paragraph>
        </s-banner>
      ) : null}

      {!data.promptConfigured ? (
        <s-banner tone="warning" heading="Transformation prompt required">
          <s-paragraph>
            Configure the transformation prompt on the Prompt tab before
            generating product examples.
          </s-paragraph>
        </s-banner>
      ) : null}

      <s-query-container>
        <s-grid
          gridTemplateColumns="@container (inline-size > 820px) 2fr 1fr, 1fr"
          gap="base"
        >
          <s-stack direction="block" gap="base">
            <s-section heading="Product imagery">
              <s-stack direction="block" gap="base">
                <s-choice-list
                  label="How do you want to add images?"
                  name="mediaMode"
                  values={[mediaMode]}
                  onChange={(event: Event) => {
                    const target = event.currentTarget as {
                      values?: string[];
                    } | null;

                    const next = target?.values?.[0];

                    if (next === "generate" || next === "upload") {
                      setMediaMode(next);
                    }
                  }}
                >
                  <s-choice value="generate">Generate with AI</s-choice>

                  <s-choice value="upload">Upload my own</s-choice>
                </s-choice-list>

                {mediaMode === "generate" ? (
                  <>
                    <s-stack direction="inline" gap="base" alignItems="center">
                      <s-stack direction="block" gap="small">
                        <s-heading>AI-generated storefront examples</s-heading>

                        <s-text color="subdued">
                          Generate polished examples from this prompt — every
                          image kept here becomes Shopify product media.
                        </s-text>
                      </s-stack>

                      <s-button
                        variant="primary"
                        commandFor="generate-images-modal"
                        command="--show"
                        disabled={generationDisabled}
                      >
                        {data.generatedImages.length > 0
                          ? "Generate more"
                          : "Generate product images"}
                      </s-button>
                    </s-stack>

                    <s-modal
                      id="generate-images-modal"
                      heading="Generate example images"
                    >
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="generateProductImages"
                        />

                        {/* A plain native input, not the s-text-area
                            below, is what actually submits — setting an
                            element's value via React doesn't reliably
                            reach a custom element's own form-submission
                            value unless it comes from real keystrokes,
                            which the template buttons don't produce. */}
                        <input
                          type="hidden"
                          name="prompt"
                          value={generationPrompt}
                        />

                        <s-stack direction="block" gap="base">
                          <s-text-area
                            label="Generation prompt"
                            value={generationPrompt}
                            placeholder="e.g. Show a generic subject demonstrating this style — describe the mood, setting, and details the AI should include."
                            onInput={(event: Event) => {
                              const target = event.currentTarget as {
                                value?: string;
                              } | null;

                              if (typeof target?.value === "string") {
                                setGenerationPrompt(target.value);
                              }
                            }}
                            rows={12}
                            autocomplete="off"
                            details="Sent to the AI provider exactly as written, for this batch only — this is separate from the customer-facing transformation prompt set on the Prompt tab."
                          />

                          <s-box
                            padding="base"
                            background="subdued"
                            borderWidth="base"
                            borderColor="base"
                            borderRadius="base"
                          >
                            <s-stack direction="block" gap="small-200">
                              <s-text type="strong">
                                Or start from a suggested prompt
                              </s-text>

                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: "8px",
                                }}
                              >
                                {GENERATION_PROMPT_TEMPLATES.map((template) => (
                                  <s-button
                                    key={template.label}
                                    type="button"
                                    variant="secondary"
                                    onClick={() =>
                                      setGenerationPrompt(
                                        template.prompt(data.productTitle),
                                      )
                                    }
                                  >
                                    {template.label}
                                  </s-button>
                                ))}
                              </div>
                            </s-stack>
                          </s-box>

                          <s-stack direction="inline" gap="base">
                            <s-button
                              variant="secondary"
                              commandFor="generate-images-modal"
                              command="--hide"
                              disabled={generating}
                            >
                              Cancel
                            </s-button>

                            <s-button
                              type="submit"
                              variant="primary"
                              loading={generating}
                              disabled={
                                generating ||
                                generationPrompt.trim().length === 0
                              }
                            >
                              Generate
                            </s-button>
                          </s-stack>
                        </s-stack>
                      </Form>
                    </s-modal>
                  </>
                ) : (
                  <s-stack direction="block" gap="base">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      multiple
                      hidden
                      onChange={(event) => {
                        handleFilesSelected(
                          Array.from(event.currentTarget.files ?? []),
                        );

                        event.currentTarget.value = "";
                      }}
                    />

                    {data.generatedImages.length === 0 ? (
                      <s-box
                        padding="base"
                        background="subdued"
                        borderWidth="base"
                        borderColor="base"
                        borderRadius="base"
                      >
                        <s-stack
                          direction="block"
                          gap="small"
                          alignItems="center"
                        >
                          <s-stack
                            direction="inline"
                            gap="small"
                            alignItems="center"
                          >
                            <s-button
                              variant="secondary"
                              disabled={!data.editable || uploading}
                              loading={uploading}
                              onClick={() => fileInputRef.current?.click()}
                            >
                              Upload new
                            </s-button>

                            <s-button
                              variant="secondary"
                              disabled={!data.editable || importing}
                              loading={importing}
                              onClick={openShopFilePicker}
                            >
                              Select existing
                            </s-button>
                          </s-stack>

                          <s-text color="subdued">
                            Accepts PNG, JPEG, WEBP, or GIF up to{" "}
                            {MAX_UPLOAD_MB}MB each.
                          </s-text>
                        </s-stack>
                      </s-box>
                    ) : null}

                    {shopFilePickerError ? (
                      <s-text tone="critical">{shopFilePickerError}</s-text>
                    ) : null}
                  </s-stack>
                )}
              </s-stack>
            </s-section>

            <s-section heading="Gallery">
              {data.generatedImages.length === 0 ? (
                <s-box padding="large" background="subdued" borderRadius="base">
                  <s-stack direction="block" gap="base">
                    <s-heading>No product images yet</s-heading>

                    <s-paragraph>
                      Generate examples using the transformation prompt, or
                      upload your own. Every image here becomes part of this
                      product&rsquo;s media once this prompt is published.
                    </s-paragraph>
                  </s-stack>
                </s-box>
              ) : (
                <s-stack direction="block" gap="small-200">
                  {checkedCount > 0 ? (
                    <s-stack
                      direction="inline"
                      gap="base"
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <s-stack
                        direction="inline"
                        gap="small"
                        alignItems="center"
                      >
                        <s-icon type="check-circle-filled" tone="success" />

                        <s-text type="strong">
                          {checkedCount}{" "}
                          {checkedCount === 1 ? "image" : "images"} selected
                        </s-text>
                      </s-stack>

                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="removeSelectedImages"
                        />

                        {data.generatedImages
                          .filter((image) => checkedIds.has(image.id))
                          .map((image) => (
                            <input
                              key={image.id}
                              type="hidden"
                              name="assetId"
                              value={image.id}
                            />
                          ))}

                        <s-button
                          type="submit"
                          variant="tertiary"
                          tone="critical"
                          loading={removingSelected}
                          disabled={!data.editable || removingSelected}
                        >
                          Remove
                        </s-button>
                      </Form>
                    </s-stack>
                  ) : null}

                  <style>
                    {`
                      .style-media-checkbox {
                        opacity: 0;
                        transition: opacity 0.12s ease;
                      }
                      .style-media-thumb:hover .style-media-checkbox,
                      .style-media-thumb:focus-within .style-media-checkbox,
                      .style-media-checkbox[data-selected="true"] {
                        opacity: 1;
                      }
                    `}
                  </style>

                  <s-query-container>
                    <s-grid
                      gridTemplateColumns="1fr 1fr 1fr 1fr"
                      gap="small-200"
                    >
                      {data.generatedImages.map((image, index) => (
                        <div
                          key={image.id}
                          className="style-media-thumb"
                          style={{ position: "relative" }}
                        >
                          <s-image
                            src={image.url}
                            alt={image.altText}
                            aspectRatio="1/1"
                            objectFit="cover"
                            borderRadius="base"
                            inlineSize="fill"
                          />

                          <div
                            className="style-media-checkbox"
                            data-selected={checkedIds.has(image.id)}
                            style={{
                              position: "absolute",
                              top: 6,
                              left: 6,
                            }}
                          >
                            <s-checkbox
                              checked={checkedIds.has(image.id)}
                              disabled={!data.editable || removingSelected}
                              accessibilityLabel={
                                checkedIds.has(image.id)
                                  ? `Deselect image ${index + 1}`
                                  : `Select image ${index + 1} for removal`
                              }
                              onChange={() => toggleChecked(image.id)}
                            />
                          </div>
                        </div>
                      ))}

                      {data.editable && mediaMode === "upload" ? (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploading}
                          style={{
                            aspectRatio: "1 / 1",
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background:
                              "var(--p-color-bg-surface-secondary, #f1f1f1)",
                            border: "1px solid var(--p-color-border, #d1d1d1)",
                            borderRadius: "var(--p-border-radius-200, 8px)",
                            cursor: uploading ? "default" : "pointer",
                            padding: 0,
                          }}
                          aria-label={
                            uploading ? "Uploading image" : "Add more images"
                          }
                        >
                          {uploading ? (
                            <s-spinner size="base" />
                          ) : (
                            <s-icon type="plus" tone="neutral" />
                          )}
                        </button>
                      ) : null}
                    </s-grid>
                  </s-query-container>
                </s-stack>
              )}
            </s-section>
          </s-stack>

          {mediaMode === "generate" ? (
            <s-stack direction="block" gap="base">
              <s-section heading="AI generation settings">
                <s-stack direction="block" gap="base">
                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-text color="subdued">Provider</s-text>

                    <s-text>{data.provider ?? "Not configured"}</s-text>
                  </s-stack>

                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-text color="subdued">Model</s-text>

                    <s-text>{data.model ?? "—"}</s-text>
                  </s-stack>

                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-text color="subdued">Images per generation</s-text>

                    <s-text>{data.previewCount}</s-text>
                  </s-stack>

                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-text color="subdued">Images in gallery</s-text>

                    <s-badge
                      tone={
                        data.generatedImages.length > 0 ? "success" : "neutral"
                      }
                    >
                      {data.generatedImages.length}
                    </s-badge>
                  </s-stack>
                </s-stack>
              </s-section>
            </s-stack>
          ) : null}
        </s-grid>
      </s-query-container>

      <s-stack direction="inline" gap="base">
        <s-button
          href={`/app/styles/${data.styleId}/product`}
          loading={backNav.loading}
          onClick={backNav.onClick}
        >
          Back
        </s-button>

        <s-button
          href={`/app/styles/${data.styleId}/generation`}
          variant="primary"
          loading={nextNav.loading}
          onClick={nextNav.onClick}
        >
          Next
        </s-button>
      </s-stack>
    </s-stack>
  );
}
