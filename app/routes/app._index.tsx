import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { UsageRing } from "../components/billing/usage-ring";
import { MetricCard } from "../components/dashboard/metric-card";
import { StyleActionsMenu } from "../components/styles/style-actions-menu";
import { StyleNameLink } from "../components/styles/style-name-link";
import { StyleStatusBadge } from "../components/styles/style-status-badge";
import { getShopPlanSummary } from "../services/billing/billing.server";
import { getDashboardForShop } from "../services/dashboard/dashboard.server";
import { getAppSetupChecks } from "../services/setup/app-setup.server";
import {
  getStyleReadiness,
  isStylePublishReady,
} from "../services/styles/style-readiness.server";
import {
  getStyleForShop,
  styleCanBeDeleted,
} from "../services/styles/style.server";
import { authenticate } from "../shopify.server";
import { formatDate } from "../utils/format-date";
import { shopifyProductAdminUrl } from "../utils/shopify-admin-link";
import { useNavigatingTo } from "../utils/use-navigating-to";

const sectionHrefs: Record<string, string> = {
  overview: "",
  fields: "/fields",
  product: "/product",
  media: "/media",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const dashboard = await getDashboardForShop(session.shop);

  const planSummary = await getShopPlanSummary(session.shop);

  const setupChecks = await getAppSetupChecks(session);

  const setupReadyCount = setupChecks.filter((check) => check.complete).length;

  const recentStyles = dashboard.recentStyles.map((style) => ({
    id: style.id,
    name: style.name,
    productTitle: style.productTitle,
    status: style.status,
    shopifyProductId: style.shopifyProductId,
    updatedAt: style.updatedAt.toISOString(),
    generationsCount: style._count.generations,

    canDelete: styleCanBeDeleted(style),

    isPublishReady: isStylePublishReady(style),

    productAdminUrl: style.shopifyProductId
      ? shopifyProductAdminUrl(session.shop, style.shopifyProductId)
      : null,
  }));

  // Next-best-action nudge: point the merchant at whatever their most
  // recently touched unpublished Style actually still needs, reusing the
  // same readiness logic the Style workspace uses — never a canned
  // message unrelated to real state.
  const nudgeCandidate = dashboard.recentStyles.find(
    (style) => style.status === "DRAFT" || style.status === "PUBLISH_ERROR",
  );

  let nudge: {
    styleName: string;
    message: string;
    href: string;
    actionLabel: string;
  } | null = null;

  if (nudgeCandidate) {
    const fullStyle = await getStyleForShop(session.shop, nudgeCandidate.id);

    if (fullStyle) {
      if (fullStyle.status === "PUBLISH_ERROR") {
        nudge = {
          styleName: fullStyle.name,
          message: `The last publish attempt for "${fullStyle.name}" failed. Review the error and try again.`,
          href: `/app/styles/${fullStyle.id}/publish`,
          actionLabel: "Review publish error",
        };
      } else {
        const readiness = getStyleReadiness(fullStyle);

        const firstIncomplete = readiness.find((item) => !item.complete);

        if (firstIncomplete) {
          nudge = {
            styleName: fullStyle.name,
            message: `${firstIncomplete.description} Finish setting up "${fullStyle.name}" to get it ready to publish.`,
            href: `/app/styles/${fullStyle.id}${sectionHrefs[firstIncomplete.section]}`,
            actionLabel: "Continue setup",
          };
        } else {
          nudge = {
            styleName: fullStyle.name,
            message: `"${fullStyle.name}" is ready. Publish it to create its Shopify product and start selling.`,
            href: `/app/styles/${fullStyle.id}/publish`,
            actionLabel: "Publish this prompt",
          };
        }
      }
    }
  }

  return {
    stats: {
      totalStyles: dashboard.totalStyles,
      draftStyles: dashboard.draftStyles,
      publishedStyles: dashboard.publishedStyles,

      totalGenerations: dashboard.totalGenerations,
      successfulGenerations: dashboard.successfulGenerations,
      failedGenerations: dashboard.failedGenerations,
      processingGenerations: dashboard.processingGenerations,
      successRate: dashboard.successRate,
    },

    draftsMissingPrompt: dashboard.draftsMissingPrompt,

    recentStyles,

    planSummary,

    setup: {
      checks: setupChecks,
      readyCount: setupReadyCount,
      totalCount: setupChecks.length,
    },

    nudge,
  };
};

function SetupRing({ ready, total }: { ready: number; total: number }) {
  const radius = 17;

  const circumference = 2 * Math.PI * radius;

  const fraction = total === 0 ? 0 : ready / total;

  const complete = total > 0 && ready === total;

  const strokeColor = complete ? "#008060" : "#B98900";

  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      role="img"
      aria-label={`${ready} of ${total} setup checks complete`}
    >
      <circle
        cx="20"
        cy="20"
        r={radius}
        fill="none"
        stroke="#E3E5E8"
        strokeWidth="4"
      />

      <circle
        cx="20"
        cy="20"
        r={radius}
        fill="none"
        stroke={strokeColor}
        strokeWidth="4"
        strokeDasharray={`${circumference * fraction} ${circumference}`}
        strokeLinecap="round"
        transform="rotate(-90 20 20)"
      />

      <text
        x="20"
        y="24"
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fill={strokeColor}
      >
        {ready}/{total}
      </text>
    </svg>
  );
}

function SuccessRateBar({ rate }: { rate: number | null }) {
  const pct = rate ?? 0;

  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Generation success rate"
      style={{
        width: "100%",
        height: 6,
        borderRadius: 999,
        background: "#E3E5E8",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 999,
          background: rate === null ? "transparent" : "#008060",
        }}
      />
    </div>
  );
}

export default function Dashboard() {
  const {
    stats,
    draftsMissingPrompt,
    recentStyles,
    planSummary,
    setup,
    nudge,
  } = useLoaderData<typeof loader>();

  const setupReady = setup.readyCount === setup.totalCount;

  const createStyleEmptyStateNav = useNavigatingTo();

  return (
    <s-page heading="Winslet AI Portraits">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          Turn prompts into products your customers can buy.
        </s-text>

        <s-query-container>
          <s-grid
            gridTemplateColumns="@container (inline-size > 760px) 1fr 1fr 1fr 1fr, 1fr"
            gap="base"
          >
            <MetricCard
              icon="grid"
              tone="info"
              label="Total prompts"
              value={stats.totalStyles}
              detail="All AI product prompts"
            />

            <MetricCard
              icon="clock"
              tone="caution"
              label="Draft prompts"
              value={stats.draftStyles}
              detail={
                draftsMissingPrompt > 0
                  ? "Needs a prompt review to publish"
                  : "Still being configured"
              }
              detailTone={draftsMissingPrompt > 0 ? "caution" : "subdued"}
            />

            <MetricCard
              icon="check"
              tone="success"
              label="Published"
              value={stats.publishedStyles}
              detail="Linked Shopify products"
            />

            <MetricCard
              icon="wand"
              tone="neutral"
              label="Generations"
              value={stats.totalGenerations}
              detail="All generation jobs"
            />
          </s-grid>
        </s-query-container>

        <s-query-container>
          <s-grid
            gridTemplateColumns="@container (inline-size > 760px) 2fr 1fr, 1fr"
            gap="base"
            alignItems="start"
          >
            <s-stack direction="block" gap="base">
              <s-section heading="Generation health">
                <s-stack direction="block" gap="base">
                  <s-stack
                    direction="inline"
                    gap="small"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-icon
                        type="check-circle-filled"
                        tone="success"
                        size="small"
                      />

                      <s-text color="subdued">Successful</s-text>
                    </s-stack>

                    <s-text>{stats.successfulGenerations}</s-text>
                  </s-stack>

                  <s-stack
                    direction="inline"
                    gap="small"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-icon type="clock" tone="caution" size="small" />

                      <s-text color="subdued">Processing</s-text>
                    </s-stack>

                    <s-text>{stats.processingGenerations}</s-text>
                  </s-stack>

                  <s-stack
                    direction="inline"
                    gap="small"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-icon
                        type="alert-circle"
                        tone="critical"
                        size="small"
                      />

                      <s-text color="subdued">Failed</s-text>
                    </s-stack>

                    <s-text>{stats.failedGenerations}</s-text>
                  </s-stack>

                  <SuccessRateBar rate={stats.successRate} />

                  <s-text color="subdued">
                    {stats.successRate === null
                      ? "No generations yet — success rate will appear once your first prompt runs."
                      : `${stats.successRate}% of generations succeed.`}
                  </s-text>
                </s-stack>
              </s-section>

              <s-section>
                <s-stack direction="block" gap="base">
                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-heading>Recent prompts</s-heading>

                    <s-link href="/app/styles">View all</s-link>
                  </s-stack>

                  {recentStyles.length === 0 ? (
                    <s-stack direction="block" gap="base">
                      <s-paragraph>
                        You have not created any prompts yet.
                      </s-paragraph>

                      <s-stack direction="inline" gap="base">
                        <s-button
                          href="/app/styles/new"
                          variant="primary"
                          loading={createStyleEmptyStateNav.loading}
                          onClick={createStyleEmptyStateNav.onClick}
                        >
                          Create your first prompt
                        </s-button>
                      </s-stack>
                    </s-stack>
                  ) : (
                    <>
                      <s-table>
                        <s-table-header-row>
                          <s-table-header>Prompt</s-table-header>

                          <s-table-header>Status</s-table-header>

                          <s-table-header>Activity</s-table-header>

                          <s-table-header>Updated</s-table-header>

                          <s-table-header>Actions</s-table-header>
                        </s-table-header-row>

                        <s-table-body>
                          {recentStyles.map((style) => (
                            <s-table-row key={style.id}>
                              <s-table-cell>
                                <StyleNameLink
                                  id={style.id}
                                  name={style.name}
                                />
                              </s-table-cell>

                              <s-table-cell>
                                <StyleStatusBadge status={style.status} />
                              </s-table-cell>

                              <s-table-cell>
                                <s-text color="subdued">
                                  {style.generationsCount} generations
                                </s-text>
                              </s-table-cell>

                              <s-table-cell>
                                <s-text color="subdued">
                                  {formatDate(style.updatedAt)}
                                </s-text>
                              </s-table-cell>

                              <s-table-cell>
                                <StyleActionsMenu
                                  style={{
                                    id: style.id,
                                    name: style.name,
                                    status: style.status,
                                    productAdminUrl: style.productAdminUrl,
                                    canDelete: style.canDelete,
                                    isPublishReady: style.isPublishReady,
                                  }}
                                />
                              </s-table-cell>
                            </s-table-row>
                          ))}
                        </s-table-body>
                      </s-table>

                      {stats.totalStyles === 1 ? (
                        <s-box
                          padding="base"
                          background="subdued"
                          borderRadius="base"
                        >
                          <s-stack direction="block" gap="small">
                            <s-text type="strong">
                              Every studio starts with one prompt
                            </s-text>

                            <s-text color="subdued">
                              Create a second prompt to see how variations
                              compare side by side, or publish this one to start
                              generating.
                            </s-text>
                          </s-stack>
                        </s-box>
                      ) : null}
                    </>
                  )}
                </s-stack>
              </s-section>
            </s-stack>

            <s-stack direction="block" gap="base">
              <s-section>
                <s-stack direction="block" gap="base">
                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-heading>Your plan</s-heading>

                    <s-badge tone={planSummary.isPro ? "success" : "info"}>
                      {planSummary.isPro ? "Pro" : "Free"}
                    </s-badge>
                  </s-stack>

                  <s-stack direction="block" gap="base">
                    <UsageRing
                      label="Published prompts"
                      count={planSummary.publishedStyleCount}
                      limit={planSummary.publishedStyleLimit}
                    />

                    <UsageRing
                      label="Generations this month"
                      count={planSummary.generationsThisMonth}
                      limit={planSummary.generationLimit}
                    />
                  </s-stack>

                  <s-link href="/app/plans">Manage plan</s-link>
                </s-stack>
              </s-section>

              <s-section>
                <s-stack direction="block" gap="base">
                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-heading>Setup</s-heading>

                      {setupReady ? (
                        <s-badge tone="success">Ready</s-badge>
                      ) : (
                        <s-badge tone="warning">Action needed</s-badge>
                      )}
                    </s-stack>

                    <SetupRing
                      ready={setup.readyCount}
                      total={setup.totalCount}
                    />
                  </s-stack>

                  <s-stack direction="block" gap="base">
                    {setup.checks.map((check) => (
                      <div
                        key={check.key}
                        style={{
                          display: "flex",
                          flexWrap: "nowrap",
                          alignItems: "flex-start",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            flex: "0 0 20px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 20,
                            height: 20,
                            maxWidth: 20,
                            maxHeight: 20,
                            overflow: "hidden",
                            marginTop: 2,
                          }}
                        >
                          <s-icon
                            type={
                              check.complete
                                ? "check-circle-filled"
                                : "alert-circle"
                            }
                            tone={check.complete ? "success" : "warning"}
                            size="small"
                          />
                        </div>

                        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                          <s-stack direction="block" gap="small-200">
                            <s-text type="strong">{check.label}</s-text>

                            <s-text color="subdued">{check.description}</s-text>
                          </s-stack>
                        </div>
                      </div>
                    ))}
                  </s-stack>
                </s-stack>
              </s-section>

              {nudge ? (
                <div
                  style={{
                    borderRadius: 12,
                    padding: 16,
                    background: "#F4F1FE",
                  }}
                >
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <div
                        style={{
                          flex: "0 0 20px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 20,
                          height: 20,
                          maxWidth: 20,
                          maxHeight: 20,
                          overflow: "hidden",
                        }}
                      >
                        <s-icon type="wand" tone="info" size="small" />
                      </div>

                      <s-text type="strong">Get to your first sale</s-text>
                    </s-stack>

                    <s-text color="subdued">{nudge.message}</s-text>

                    <s-link href={nudge.href}>{nudge.actionLabel} →</s-link>
                  </s-stack>
                </div>
              ) : null}
            </s-stack>
          </s-grid>
        </s-query-container>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
