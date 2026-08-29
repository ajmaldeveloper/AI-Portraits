import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { MetricIconChip } from "../components/dashboard/metric-card";
import {
  AI_PROVIDERS,
  getProviderDefinition,
  type AIProviderDefinition,
} from "../services/ai/provider-registry.server";
import {
  getAIProviderSettingsSummary,
  removeAIProviderSettings,
  saveAIProviderSettings,
} from "../services/settings/ai-provider-settings.server";
import {
  ASPECT_RATIO_OPTIONS,
  QUALITY_OPTIONS,
  getGenerationDefaults,
  saveGenerationDefaults,
} from "../services/settings/generation-defaults.server";
import {
  type SaveSizeOptionInput,
  getSizeOptions,
  saveSizeOptions,
} from "../services/settings/size-options.server";
import { authenticate } from "../shopify.server";
import { eventValue } from "../utils/event-value";
import { formatDate } from "../utils/format-date";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const [summary, generationDefaults, sizeOptions] = await Promise.all([
    getAIProviderSettingsSummary(session.shop),
    getGenerationDefaults(session.shop),
    getSizeOptions(session.shop),
  ]);

  const url = new URL(request.url);

  return {
    summary,

    currentProviderLabel: summary.provider
      ? (getProviderDefinition(summary.provider)?.label ?? summary.provider)
      : null,

    providers: AI_PROVIDERS,

    generationDefaults,

    aspectRatioOptions: ASPECT_RATIO_OPTIONS,

    qualityOptions: QUALITY_OPTIONS,

    sizeOptions,

    saved: url.searchParams.get("saved") === "1",

    removed: url.searchParams.get("removed") === "1",

    defaultsSaved: url.searchParams.get("defaultsSaved") === "1",

    sizesSaved: url.searchParams.get("sizesSaved") === "1",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);

  const formData = await request.formData();

  const intent = formData.get("intent");

  if (intent === "remove") {
    try {
      await removeAIProviderSettings(session.shop);

      return redirect("/app/settings?removed=1");
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Could not remove the AI provider.",
      };
    }
  }

  if (intent === "saveSizes") {
    let parsed: unknown;

    try {
      parsed = JSON.parse(String(formData.get("sizesJson") ?? "[]"));
    } catch {
      return { error: "Could not read the submitted print sizes." };
    }

    if (!Array.isArray(parsed)) {
      return { error: "Could not read the submitted print sizes." };
    }

    const inputs: SaveSizeOptionInput[] = parsed.map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;

      // "default-*" ids come from the built-in Small/Medium/Large
      // default (see size-options.server.ts); "new-*" ids are rows
      // added client-side this session. Neither is a real saved row —
      // dropping the id here makes saveSizeOptions create them fresh.
      const id =
        typeof row.id === "string" &&
        !row.id.startsWith("default-") &&
        !row.id.startsWith("new-")
          ? row.id
          : undefined;

      return {
        id,
        label: String(row.label ?? ""),
        scalePercent: Number(row.scalePercent),
        priceDelta: String(row.priceDelta ?? "0"),
      };
    });

    try {
      await saveSizeOptions(session.shop, inputs);

      return redirect("/app/settings?sizesSaved=1");
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Could not save print sizes.",
      };
    }
  }

  if (intent === "saveDefaults") {
    const outputAspectRatio = String(
      formData.get("outputAspectRatio") ?? "",
    ).trim();

    const outputQuality = String(formData.get("outputQuality") ?? "").trim();

    const previewCount = Number(formData.get("previewCount"));

    try {
      await saveGenerationDefaults(session.shop, {
        outputAspectRatio,
        outputQuality,
        previewCount,
      });

      return redirect("/app/settings?defaultsSaved=1");
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Could not save generation defaults.",
      };
    }
  }

  const provider = String(formData.get("provider") ?? "").trim();

  const model = String(formData.get("model") ?? "").trim();

  const apiKeyRaw = String(formData.get("apiKey") ?? "").trim();

  try {
    await saveAIProviderSettings(session.shop, {
      provider,
      model,
      apiKey: apiKeyRaw || undefined,
    });

    return redirect("/app/settings?saved=1");
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not save AI provider settings.",
    };
  }
};

type ProviderFormFieldsProps = {
  providers: AIProviderDefinition[];
  providerId: string;
  providerDefinition: AIProviderDefinition;
  modelId: string;
  apiKeyValue: string;
  onProviderChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
};

function ProviderFormFields({
  providers,
  providerId,
  providerDefinition,
  modelId,
  apiKeyValue,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
}: ProviderFormFieldsProps) {
  return (
    <s-stack direction="block" gap="base">
      <s-select
        label="Provider"
        name="provider"
        value={providerId}
        onChange={(event: Event) => onProviderChange(eventValue(event))}
      >
        {providers.map((provider) => (
          <s-option key={provider.id} value={provider.id}>
            {provider.label}
          </s-option>
        ))}
      </s-select>

      <s-select
        label="Model"
        name="model"
        value={modelId}
        onChange={(event: Event) => onModelChange(eventValue(event))}
      >
        {providerDefinition.models.map((model) => (
          <s-option key={model.id} value={model.id}>
            {model.label}
          </s-option>
        ))}
      </s-select>

      <s-password-field
        label={providerDefinition.apiKeyLabel}
        name="apiKey"
        value={apiKeyValue}
        onInput={(event: Event) => onApiKeyChange(eventValue(event))}
        placeholder={providerDefinition.apiKeyPlaceholder}
        autocomplete="new-password"
        required
        details={providerDefinition.apiKeyHelp}
      />

      <s-text color="subdued">
        <s-link href={providerDefinition.apiKeyDocsUrl} target="_blank">
          Get a {providerDefinition.label} API key
        </s-link>
      </s-text>
    </s-stack>
  );
}

export default function AppSettings() {
  const {
    summary,
    currentProviderLabel,
    providers,
    generationDefaults,
    aspectRatioOptions,
    qualityOptions,
    sizeOptions,
    saved,
    removed,
    defaultsSaved,
    sizesSaved,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();

  const navigation = useNavigation();

  const shopify = useAppBridge();

  const blankProvider = providers[0];

  const [providerId, setProviderId] = useState<string>(blankProvider.id);

  const [modelId, setModelId] = useState(blankProvider.models[0].id);

  const [apiKeyValue, setApiKeyValue] = useState("");

  const providerDefinition =
    providers.find((provider) => provider.id === providerId) ?? blankProvider;

  const resetForm = () => {
    setProviderId(blankProvider.id);
    setModelId(blankProvider.models[0].id);
    setApiKeyValue("");
  };

  const handleProviderChange = (value: string) => {
    setProviderId(value);

    const nextDefinition = providers.find((provider) => provider.id === value);

    setModelId(nextDefinition ? nextDefinition.models[0].id : "");
  };

  // The form only ever starts blank (first-time setup, or a fresh
  // "Change"), so a non-empty API key is exactly what "the merchant
  // has actually filled this in" means here — that's what gates Save.
  const isDirty = apiKeyValue.trim().length > 0;

  const submittingIntent =
    navigation.state !== "idle" ? navigation.formData?.get("intent") : null;

  const saving = submittingIntent === "save";

  const removing = submittingIntent === "remove";

  const savingDefaults = submittingIntent === "saveDefaults";

  const savingSizes = submittingIntent === "saveSizes";

  type SizeRow = {
    id: string;
    label: string;
    scalePercent: string;
    priceDelta: string;
  };

  const [sizeRows, setSizeRows] = useState<SizeRow[]>(() =>
    sizeOptions.map((option) => ({
      id: option.id,
      label: option.label,
      scalePercent: String(option.scalePercent),
      priceDelta: option.priceDelta,
    })),
  );

  const sizesDirty =
    JSON.stringify(sizeRows) !==
    JSON.stringify(
      sizeOptions.map((option) => ({
        id: option.id,
        label: option.label,
        scalePercent: String(option.scalePercent),
        priceDelta: option.priceDelta,
      })),
    );

  const updateSizeRow = (index: number, patch: Partial<SizeRow>) => {
    setSizeRows((rows) =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const addSizeRow = () => {
    setSizeRows((rows) => [
      ...rows,
      {
        id: `new-${Date.now()}`,
        label: "",
        scalePercent: "100",
        priceDelta: "0",
      },
    ]);
  };

  const removeSizeRow = (index: number) => {
    setSizeRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  };

  const [defaultAspectRatio, setDefaultAspectRatio] = useState(
    generationDefaults.outputAspectRatio,
  );

  const [defaultQuality, setDefaultQuality] = useState(
    generationDefaults.outputQuality,
  );

  const [defaultPreviewCount, setDefaultPreviewCount] = useState(
    String(generationDefaults.previewCount),
  );

  const defaultsDirty =
    defaultAspectRatio !== generationDefaults.outputAspectRatio ||
    defaultQuality !== generationDefaults.outputQuality ||
    defaultPreviewCount !== String(generationDefaults.previewCount);

  useEffect(() => {
    if (!saved && !removed) {
      return;
    }

    shopify.toast.show(removed ? "AI provider removed" : "AI provider saved");

    resetForm();

    // A successful save/remove leaves its triggering modal open, showing
    // stale content behind the toast — s-modal exposes hideOverlay()
    // directly on the element.
    document
      .querySelectorAll<HTMLElement & { hideOverlay?: () => void }>("s-modal")
      .forEach((modal) => modal.hideOverlay?.());

    // A plain URL cleanup, not a real navigation — history.replaceState
    // avoids triggering React Router's navigation state (and a spurious
    // loader revalidation), which would otherwise flash every submit
    // button on this page into a loading state right after landing here.
    window.history.replaceState(null, "", "/app/settings");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [removed, saved, shopify]);

  useEffect(() => {
    if (!defaultsSaved) {
      return;
    }

    shopify.toast.show("Generation defaults saved");

    window.history.replaceState(null, "", "/app/settings");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsSaved, shopify]);

  useEffect(() => {
    if (!sizesSaved) {
      return;
    }

    shopify.toast.show("Print sizes saved");

    window.history.replaceState(null, "", "/app/settings");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizesSaved, shopify]);

  const formFieldsProps: ProviderFormFieldsProps = {
    providers,
    providerId,
    providerDefinition,
    modelId,
    apiKeyValue,
    onProviderChange: handleProviderChange,
    onModelChange: setModelId,
    onApiKeyChange: setApiKeyValue,
  };

  return (
    <s-page heading="Settings">
      <s-stack direction="block" gap="base">
        {actionData?.error ? (
          <s-banner tone="critical" heading="Could not save settings">
            <s-paragraph>{actionData.error}</s-paragraph>
          </s-banner>
        ) : null}

        {summary.configured ? (
          <s-section heading="AI provider">
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-stack direction="inline" gap="base" alignItems="center">
                <MetricIconChip icon="wand" tone="info" />

                <s-stack direction="block" gap="small-200">
                  <s-text type="strong">{currentProviderLabel}</s-text>

                  <s-text color="subdued">
                    {summary.model} · key ending in {summary.apiKeyLastFour}
                  </s-text>

                  {summary.updatedAt ? (
                    <s-text color="subdued">
                      Updated {formatDate(summary.updatedAt)}
                    </s-text>
                  ) : null}
                </s-stack>
              </s-stack>

              <s-stack direction="inline" gap="base" alignItems="center">
                <s-badge tone="success">Configured</s-badge>

                <s-button
                  variant="secondary"
                  commandFor="change-ai-provider"
                  command="--show"
                  onClick={resetForm}
                >
                  Change
                </s-button>

                <s-button
                  variant="tertiary"
                  tone="critical"
                  commandFor="remove-ai-provider"
                  command="--show"
                >
                  Remove
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>
        ) : (
          <>
            <s-banner tone="warning" heading="No AI provider configured yet">
              <s-paragraph>
                Product image generation is unavailable for this shop until a
                provider is configured below. Winslet AI Portraits never
                supplies its own AI credentials — bring your own key.
              </s-paragraph>
            </s-banner>

            <s-section heading="Configure AI provider">
              <Form method="post">
                <input type="hidden" name="intent" value="save" />

                <s-stack direction="block" gap="base">
                  <ProviderFormFields {...formFieldsProps} />

                  <s-stack direction="inline" gap="base">
                    <s-button
                      type="submit"
                      variant="primary"
                      loading={saving}
                      disabled={!isDirty || saving}
                    >
                      Save
                    </s-button>
                  </s-stack>
                </s-stack>
              </Form>
            </s-section>
          </>
        )}

        <s-section heading="Generation defaults">
          <Form method="post">
            <input type="hidden" name="intent" value="saveDefaults" />

            <s-stack direction="block" gap="base">
              <s-paragraph>Applied to every new prompt you create.</s-paragraph>

              <s-query-container>
                <s-grid
                  gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr 1fr, 1fr"
                  gap="base"
                >
                  <s-select
                    label="Artwork aspect ratio"
                    name="outputAspectRatio"
                    value={defaultAspectRatio}
                    onChange={(event: Event) =>
                      setDefaultAspectRatio(eventValue(event))
                    }
                  >
                    {aspectRatioOptions.map((option) => (
                      <s-option key={option.id} value={option.id}>
                        {option.label}
                      </s-option>
                    ))}
                  </s-select>

                  <s-select
                    label="Output quality"
                    name="outputQuality"
                    value={defaultQuality}
                    onChange={(event: Event) =>
                      setDefaultQuality(eventValue(event))
                    }
                  >
                    {qualityOptions.map((option) => (
                      <s-option key={option.id} value={option.id}>
                        {option.label}
                      </s-option>
                    ))}
                  </s-select>

                  <s-number-field
                    label="Example images per prompt"
                    name="previewCount"
                    value={defaultPreviewCount}
                    onInput={(event: Event) =>
                      setDefaultPreviewCount(eventValue(event))
                    }
                    min={1}
                    max={4}
                    step={1}
                    autocomplete="off"
                    details="Results requested per generation job."
                  />
                </s-grid>
              </s-query-container>

              <s-stack direction="inline" gap="base">
                <s-button
                  type="submit"
                  variant="primary"
                  loading={savingDefaults}
                  disabled={!defaultsDirty || savingDefaults}
                >
                  Save
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-section>

        <s-section heading="Print sizes">
          <Form method="post">
            <input type="hidden" name="intent" value="saveSizes" />
            <input type="hidden" name="sizesJson" value={JSON.stringify(sizeRows)} />

            <s-stack direction="block" gap="base">
              <s-paragraph>
                Offered as size variants on every published product. Scale is
                a percentage of the AI's original output — 100% is the
                original resolution; anything lower is resized down, never
                up, so nothing looks soft. Price adjustment is added to a
                prompt's base price for that size. Changes here apply the
                next time you publish or update each prompt — already-live
                products keep their current variants until then.
              </s-paragraph>

              <s-stack direction="block" gap="small">
                {sizeRows.map((row, index) => (
                  <s-query-container key={row.id}>
                    <s-grid
                      gridTemplateColumns="@container (inline-size > 560px) 2fr 1fr 1fr auto, 1fr"
                      gap="small"
                      alignItems="end"
                    >
                      <s-text-field
                        label="Name"
                        value={row.label}
                        onInput={(event: Event) =>
                          updateSizeRow(index, { label: eventValue(event) })
                        }
                        placeholder="e.g. Medium"
                        autocomplete="off"
                      />

                      <s-number-field
                        label="Scale %"
                        value={row.scalePercent}
                        onInput={(event: Event) =>
                          updateSizeRow(index, {
                            scalePercent: eventValue(event),
                          })
                        }
                        min={1}
                        max={100}
                        step={1}
                        autocomplete="off"
                      />

                      <s-number-field
                        label="Price adjustment"
                        value={row.priceDelta}
                        onInput={(event: Event) =>
                          updateSizeRow(index, {
                            priceDelta: eventValue(event),
                          })
                        }
                        step={0.01}
                        autocomplete="off"
                      />

                      <s-button
                        variant="tertiary"
                        tone="critical"
                        disabled={sizeRows.length <= 1}
                        onClick={() => removeSizeRow(index)}
                        accessibilityLabel={`Remove ${row.label || "this size"}`}
                      >
                        Remove
                      </s-button>
                    </s-grid>
                  </s-query-container>
                ))}
              </s-stack>

              <s-stack direction="inline" gap="base">
                <s-button variant="secondary" onClick={addSizeRow}>
                  Add size
                </s-button>
              </s-stack>

              <s-stack direction="inline" gap="base">
                <s-button
                  type="submit"
                  variant="primary"
                  loading={savingSizes}
                  disabled={!sizesDirty || savingSizes}
                >
                  Save
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-section>
      </s-stack>

      {summary.configured ? (
        <s-modal id="change-ai-provider" heading="Change AI provider">
          <Form method="post">
            <input type="hidden" name="intent" value="save" />

            <s-stack direction="block" gap="base">
              <ProviderFormFields {...formFieldsProps} />

              <s-stack direction="inline" gap="base">
                <s-button
                  variant="secondary"
                  commandFor="change-ai-provider"
                  command="--hide"
                  onClick={resetForm}
                  disabled={saving}
                >
                  Cancel
                </s-button>

                <s-button
                  type="submit"
                  variant="primary"
                  loading={saving}
                  disabled={!isDirty || saving}
                >
                  Save
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-modal>
      ) : null}

      {summary.configured ? (
        <s-modal id="remove-ai-provider" heading="Remove AI provider?">
          <Form method="post">
            <input type="hidden" name="intent" value="remove" />

            <s-stack direction="block" gap="base">
              <s-paragraph>
                Remove the configured AI provider and its API key? Product image
                generation will be unavailable until you configure a new one.
              </s-paragraph>

              <s-stack direction="inline" gap="base">
                <s-button
                  variant="secondary"
                  commandFor="remove-ai-provider"
                  command="--hide"
                  disabled={removing}
                >
                  Cancel
                </s-button>

                <s-button
                  type="submit"
                  variant="primary"
                  tone="critical"
                  loading={removing}
                  disabled={removing}
                >
                  Remove
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-modal>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
