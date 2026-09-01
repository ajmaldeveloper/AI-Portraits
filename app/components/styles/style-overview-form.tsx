import { useState } from "react";
import { Form, useNavigation } from "react-router";

import { useNavigatingTo } from "../../utils/use-navigating-to";

export type StyleOverviewValues = {
  name: string;
  prompt: string;
};

type StyleOverviewFormProps = {
  values: StyleOverviewValues;
  editable: boolean;
  styleId: string;
  error?: string;
};

// Starting points for the transformation prompt — a merchant unsure
// what to write can pick one and edit from there. Unlike the Media
// tab's generation templates (which invent a whole scene from
// scratch), these are transform instructions applied to the
// customer's own uploaded photo: they must always preserve the
// subject's identity, pose, and key details, and only restyle the
// surface treatment, lighting, and color grading.
const TRANSFORMATION_PROMPT_TEMPLATES: Array<{
  label: string;
  prompt: string;
}> = [
  {
    label: "Forest Wanderer",
    prompt:
      "Transform the photo into a hand-painted woodland illustration — ink outline linework filled with loose watercolor washes, visible paper texture, and soft pigment bleed at the edges of shapes. Shift the palette toward earthy woodland tones (#2D4A34 deep pine, #6B8F71 moss green, #5C4433 bark brown, #EDE6D6 soft cream highlight), keeping the composition and lighting direction faithful to the original photo. The subject's pose, proportions, and key identifying features (face, expression, silhouette) must remain clearly recognizable — only the surface texture and rendering technique should change, never the subject's shape or features. The result should feel like a gentle, artisanal woodland illustration — not a flat green color filter or a texture overlay pasted on top.",
  },
  {
    label: "Golden Meadow",
    prompt:
      "Render the photo as a warm, painterly scene bathed in soft sunlit glow — add visible brushstroke texture, gentle atmospheric haze, and warm low-angle light. Shift tones toward golden wheat and sage (#E8B854 golden wheat, #D98F4B warm amber, #FFF4DD soft cream, #8FA382 sage green), with a soft warm glow on skin and surfaces and the background easing into a hazy, painterly softness. Keep the subject's identity, pose, and all key details fully intact and recognizable — only the lighting, color grading, and paint texture should change. The final image should feel like a genuine warm-hour painted portrait — not an artificial orange filter slapped over the original lighting.",
  },
  {
    label: "Wildflower Dream",
    prompt:
      "Transform the photo into a soft botanical watercolor illustration with delicate wildflower and leaf motifs blooming gently at the edges of the frame. Add loose, confident watercolor brushwork, gentle pigment bleed, and visible paper texture across the whole image. Shift the palette toward soft floral tones (#F3B9C6 blush pink, #B9A4D4 lavender, #8FA88A sage green, #FBF3E7 cream paper). The subject's pose, proportions, and key identifying features must remain clearly recognizable — do not melt or distort them, only reinterpret their surface texture and edges as painted pigment, with the floral motifs staying confined to the border areas rather than covering the subject. The result should feel like a delicate, hand-painted botanical portrait — not a sticker-like flower overlay.",
  },
  {
    label: "Mountain Spirit",
    prompt:
      "Render the photo as a bold, rugged painting with thick, confident brushstroke texture built up in visible layers across a coarse canvas surface. Shift the palette toward rugged natural stone tones (#5A6B73 slate gray, #7C93A0 stone blue, #33473A deep pine, #E8EDEA muted white highlight), with strong, weathered contrast between light and shadow. The subject's likeness, pose, and key details must remain fully recognizable within the painterly treatment — this is a stylistic reinterpretation, not a distortion. The final look should feel like a genuine rugged landscape-painter's portrait — not a smooth digital painting filter.",
  },
  {
    label: "Ocean Drift",
    prompt:
      "Transform the photo into a flowing, cool-toned watercolor wash — add soft pigment bleed, visible wet-on-wet blending, and gentle paper texture across the whole image, as if painted with sea water itself. Shift the palette toward coastal sea-glass tones (#7FB6A8 sea-glass teal, #A9D8D0 soft aqua, #E4D8C3 sandy beige, #F5F7F5 foam white), keeping the composition and lighting direction faithful to the original photo. The subject's pose, proportions, and key identifying features must remain clearly recognizable — only the surface texture and color grading should change. The result should feel like a gentle, coastal watercolor portrait — not a flat teal color filter.",
  },
  {
    label: "Autumn Ember",
    prompt:
      "Render the photo as a warm, richly painted portrait with visible brushstroke texture and deep, saturated fall tones. Shift the palette toward burnt autumn colors (#C1592B burnt orange, #7A2E2E deep maroon, #D9A441 golden yellow, #5C3A21 warm brown), with a soft ember-like glow settling on skin and surfaces and long warm-toned shadows. Keep the subject's identity, pose, and all key details fully intact and recognizable — only the lighting, color grading, and paint texture should change. The final image should feel like a genuine warm autumn-lit painting — not an orange color filter over the original photo.",
  },
  {
    label: "Moonlit Grove",
    prompt:
      "Re-light the photo as if captured in a quiet nocturnal forest clearing under soft moonlight — add a gentle blue-green glow, soft atmospheric haze, and a subtle silver rim light along the subject's edges. Shift tones toward nocturnal woodland colors (#1F2E3D deep indigo, #3E5C55 moonlit teal, #A8C4C2 silver-blue highlight, #E4EDE8 pale glow), deepening shadows while keeping the subject's identity, pose, and all key details fully intact and recognizable. Only the lighting, color grading, and atmosphere should change, never the subject's shape or features. The result should feel like a real photograph lit by soft moonlight in a forest clearing — not a flat blue color filter.",
  },
  {
    label: "Royal Portrait",
    prompt:
      "Render the photo as a rich, classical royal oil portrait with visible brushstroke texture built up in layers and dramatic chiaroscuro lighting — strong contrast between richly lit highlights and soft, deep shadow. Replace the subject's clothing with a full royal ensemble: an ermine-trimmed velvet robe in deep burgundy (#5C1A1A deep burgundy) with white-and-black ermine fur trim, layered over an ornate gold-embroidered tunic (#C9A227 royal gold), a bejeweled royal crown set with colored gemstones on their head, and a gold ceremonial scepter held naturally in one hand — all fitted naturally to their actual pose and body. Set the scene in a grand palace interior with heavy drapery in the foreground and a softly rendered palace garden visible through a window or archway behind them (#1F5C4A emerald drapery accent, #1A1210 rich black shadow). The subject's face, likeness, expression, and pose must remain exactly recognizable — only the clothing, crown, scepter, background, and painterly rendering change, never the subject's identity or facial features. The final look should feel like a genuine museum-quality royal portrait of a monarch — not a smooth digital painting filter, and not a plain outfit with no crown or regalia.",
  },
  {
    label: "Old World Explorer",
    prompt:
      "Give the photo the look of a weathered vintage expedition photograph — add visible film grain, a warm aged-parchment color grade, soft vignetting in the corners, and a faint background texture reminiscent of an old leather-bound journal or hand-drawn map fading into the edges. Replace the subject's clothing with a weathered leather jacket over a simple canvas shirt (#6B4423 leather brown, #D8C39A canvas tan), with a worn leather satchel strap crossing one shoulder, fitted naturally to their actual pose. Shift the remaining tones toward aged, warm hues (#3E5266 faded ink blue, #8B6B4A warm sepia). The subject's face, likeness, expression, and pose must remain exactly recognizable — only the clothing, grain, texture, and color grading change, never the subject's identity or facial features. The overall feel should be an authentic, weathered explorer's photograph — not a harsh sepia filter with no depth.",
  },
  {
    label: "Vintage Romance",
    prompt:
      "Give the photo the soft, glowing look of a classic romantic film photograph — add gentle soft-focus glow around highlights, fine film grain, and softened contrast with gently lifted blacks. Replace the subject's clothing with a soft, romantic-era garment with delicate detailing in dusty rose tones (#D9A9A0 dusty rose, #F2E4D0 warm cream), fitted naturally to their actual pose. Shift the remaining tones toward a warm, dusty romantic palette (#8B6F52 soft sepia brown, #C9A96A faded gold). The subject's face, likeness, expression, and pose must remain exactly recognizable — only the clothing, grain, glow, and color grading change, never the subject's identity or facial features. The overall feel should be an authentic, nostalgic romantic film photograph — not a harsh Instagram-style filter.",
  },
  {
    label: "Noir Legend",
    prompt:
      "Convert the photo into a dramatic black-and-white cinematic portrait — add strong chiaroscuro lighting with deep, high-contrast shadow and crisp, luminous highlights, plus subtle film grain reminiscent of a classic noir film still. Replace the subject's clothing with a sharp, tailored coat or collared shirt in a solid dark tone, dapper and dressed for a classic film-noir scene, fitted naturally to their actual pose. Render entirely in monochrome tones (#0D0D0D pure black, #3A3A3A charcoal, #D8D8D8 silver highlight, #F2F2F2 pale white). The subject's face, likeness, expression, and pose must remain exactly recognizable — the result should look like the exact same subject, dressed and lit dramatically for a classic film still, not a generic grayscale conversion. The final result should feel like an authentic cinematic noir photograph — not a simple desaturation filter.",
  },
  {
    label: "Desert Nomad",
    prompt:
      "Re-light the photo with warm, sun-bleached desert tones — add a hazy heat-shimmer softness to the background, warm low-angle sunlight, and a fine dusty grain across the image. Replace the subject's clothing with a flowing linen robe in warm ochre tones (#B98A3E warm ochre, #D9C29B sand beige), fitted naturally to their actual pose. Shift the remaining tones toward sun-warmed earth colors (#C1703B terracotta, #A6674A dusty rose-brown). The subject's face, likeness, expression, and pose must remain exactly recognizable — only the clothing, lighting, color grading, and atmosphere change, never the subject's identity or facial features. The final image should feel like a genuine sun-warmed desert photograph — not an artificial orange filter over the original lighting.",
  },
  {
    label: "Midnight Muse",
    prompt:
      "Render the photo as a moody, richly painted portrait with visible brushstroke texture and dramatic low-key lighting — deep shadow dominating the frame with a soft, glamorous highlight catching the subject's features. Replace the subject's clothing with an elegant satin garment in deep violet (#3B2C63 deep violet), fitted naturally to their actual pose. Shift the remaining palette toward deep nocturnal glamour tones (#141B3C midnight navy, #B9C4E0 silver highlight, #EDEFFA soft glow white). The subject's face, likeness, expression, and pose must remain exactly recognizable within the painterly treatment — only the clothing, lighting, and rendering change, never the subject's identity or facial features. The final look should feel like a genuine moody studio portrait — not a flat dark color filter.",
  },
  {
    label: "Timeless Sketch",
    prompt:
      "Convert the photo into a detailed graphite pencil sketch — add fine cross-hatching for shading, visible paper tooth texture across the whole image, and confident hand-drawn linework, while removing all color in favor of pure monochrome grayscale (#1A1A1A deep graphite, #4D4D4D mid gray, #B3B3B3 light gray, #F5F5F0 paper white). The subject's likeness, proportions, and expression must remain fully recognizable — the sketch should look like a skilled artist drew this exact subject, not a generic or distorted rendering. The final result should feel like an authentic hand-drawn pencil portrait — not a simple grayscale filter or an edge-detection effect.",
  },
  {
    label: "Golden Age",
    prompt:
      "Give the photo the glamorous look of a 1920s studio portrait — add soft directional key lighting, a fine warm-toned film grain, and a subtle metallic sheen along the highlights reminiscent of art-deco glamour photography. Replace the subject's clothing with a sleek satin garment in warm bronze tones (#6B4E2E deep bronze, #C9A227 warm gold), fitted naturally to their actual pose. Shift the remaining tones toward warm vintage-glamour hues (#F0E6D2 soft cream, #1A1512 black accent). The subject's face, likeness, expression, and pose must remain exactly recognizable — only the clothing, lighting, grain, and color grading change, never the subject's identity or facial features. The overall feel should be an authentic art-deco-era studio glamour photograph — not a flat sepia filter.",
  },
];

export function StyleOverviewForm({
  values,
  editable,
  styleId,
  error,
}: StyleOverviewFormProps) {
  const navigation = useNavigation();

  const nextNav = useNavigatingTo();

  // This form submits without an "intent" field. The delete/duplicate
  // actions on the same route always set one, so their absence is what
  // identifies an in-flight "Next" submission specifically — but that
  // check alone isn't enough: a plain GET/loader navigation also has no
  // "intent" (no formData at all), so it must be excluded explicitly or
  // this button flashes into a loading state on every such navigation
  // (e.g. this route's own toast-then-clean-url effect after creating a
  // style).
  const submitting =
    navigation.state !== "idle" &&
    Boolean(navigation.formData) &&
    !navigation.formData?.get("intent");

  // Controlled (not defaultValue) so the template buttons below can
  // fill the field, mirrored into a plain hidden input for submission
  // — setting a custom element's value via React doesn't reliably
  // reach its own form-participation value the way real keystrokes do.
  const [prompt, setPrompt] = useState(values.prompt);

  // Controlled too (was defaultValue/uncontrolled) — needed to detect
  // isDirty below; nothing else depends on tracking it live.
  const [name, setName] = useState(values.name);

  const isDirty = name !== values.name || prompt !== values.prompt;

  return (
    <Form method="post">
      <s-stack direction="block" gap="base">
        {error ? (
          <s-banner tone="critical" heading="Could not save style">
            <s-paragraph>{error}</s-paragraph>
          </s-banner>
        ) : null}

        <s-section heading="Internal name">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Internal name"
              name="name"
              value={name}
              onInput={(event: Event) => {
                const target = event.currentTarget as {
                  value?: string;
                } | null;

                if (typeof target?.value === "string") {
                  setName(target.value);
                }
              }}
              required
              disabled={!editable}
              autocomplete="off"
              details="Used to identify this AI transformation in your admin — customers never see it."
            />
          </s-stack>
        </s-section>

        <s-section heading="AI transformation">
          <s-stack direction="block" gap="base">
            <input type="hidden" name="prompt" value={prompt} />

            <s-text-area
              label="Transformation prompt"
              value={prompt}
              onInput={(event: Event) => {
                const target = event.currentTarget as {
                  value?: string;
                } | null;

                if (typeof target?.value === "string") {
                  setPrompt(target.value);
                }
              }}
              rows={10}
              disabled={!editable}
              autocomplete="off"
              details="Describe what should change and what details from the customer's image must remain faithful."
            />

            {editable ? (
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
                    {TRANSFORMATION_PROMPT_TEMPLATES.map((template) => (
                      <s-button
                        key={template.label}
                        type="button"
                        variant="secondary"
                        onClick={() => setPrompt(template.prompt)}
                      >
                        {template.label}
                      </s-button>
                    ))}
                  </div>
                </s-stack>
              </s-box>
            ) : null}
          </s-stack>
        </s-section>

        <s-stack direction="inline" gap="base">
          {editable && isDirty ? (
            <s-button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={submitting}
            >
              Save
            </s-button>
          ) : (
            <s-button
              href={`/app/styles/${styleId}/product`}
              variant="primary"
              loading={nextNav.loading}
              onClick={nextNav.onClick}
            >
              Next
            </s-button>
          )}
        </s-stack>
      </s-stack>
    </Form>
  );
}
