import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect } from "react";

import { UsageRing } from "../components/billing/usage-ring";
import { FREE_PLAN_HANDLE, PRO_PLAN_HANDLE } from "../services/billing/billing-config";
import { getShopifyAppHandle } from "../services/billing/billing-config.server";
import { getShopPlanSummary } from "../services/billing/billing.server";
import { getShopifyPricingUrl } from "../services/billing/shopify-pricing.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const planSummary = await getShopPlanSummary(session.shop);

  const url = new URL(request.url);

  return {
    planSummary,

    // Shopify's hosted pricing page appends this to whichever Redirect
    // URL is configured for the selected plan in Partner Dashboard
    // (Shopify App Pricing has no billing webhooks, so this — along
    // with the live isShopOnProPlan() check above — is how the app
    // finds out a plan changed).
    planHandleFromRedirect: url.searchParams.get("plan_handle"),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);

  const formData = await request.formData();

  const intent = formData.get("intent");

  if (intent !== "manage-plans") {
    return Response.json({ error: "Unsupported plans action." }, { status: 400 });
  }

  // Shopify App Pricing owns plan selection and changes entirely — the
  // app can't create or cancel a subscription charge itself via the
  // Billing API. Every "Choose X" button, upgrade or downgrade alike,
  // sends the merchant to Shopify's own hosted pricing page.
  const pricingUrl = getShopifyPricingUrl({
    shopDomain: session.shop,
    appHandle: getShopifyAppHandle(),
  });

  return redirect(pricingUrl, { target: "_top" });
};

export default function PlansRoute() {
  const { planSummary, planHandleFromRedirect } = useLoaderData<typeof loader>();

  const navigation = useNavigation();

  const shopify = useAppBridge();

  const submittedPlanHandle = navigation.formData?.get("planHandle");

  const isPro = planSummary.isPro;

  useEffect(() => {
    if (!planHandleFromRedirect) {
      return;
    }

    const planName =
      planHandleFromRedirect.toLowerCase() === PRO_PLAN_HANDLE ? "Pro" : "Free";

    shopify.toast.show(`You're now on the ${planName} plan`);

    window.history.replaceState(null, "", "/app/plans");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planHandleFromRedirect, shopify]);

  return (
    <s-page heading="Plans" inlineSize="base">
      <s-stack direction="block" gap="large">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-heading>Choose the right plan for your store</s-heading>

            <s-text tone="neutral">
              Free forever for light use, or upgrade to Pro for unlimited
              published prompts and generations — managed securely through
              Shopify billing.
            </s-text>

            {isPro ? (
              <s-banner tone="success">You&apos;re on the Pro plan.</s-banner>
            ) : null}

            <s-divider />

            <s-heading>Your usage</s-heading>

            <s-stack direction="inline" gap="large" alignItems="center">
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
          </s-stack>
        </s-section>

        <s-section heading="Available plans">
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
            gap="base"
          >
            <s-box
              background="base"
              borderWidth="base"
              borderColor="subdued"
              borderRadius="base"
              padding="large"
            >
              <s-stack direction="block" gap="small">
                <s-grid
                  gridTemplateColumns="minmax(0, 1fr) auto"
                  gap="small"
                  alignItems="start"
                >
                  <s-stack direction="block" gap="small-200">
                    <s-heading>Free</s-heading>

                    <s-text tone="neutral">
                      Try the app with no commitment.
                    </s-text>
                  </s-stack>

                  {!isPro ? <s-badge tone="success">Current</s-badge> : null}
                </s-grid>

                <s-stack direction="block" gap="small-200">
                  <s-heading>$0</s-heading>

                  <s-text tone="neutral">forever</s-text>
                </s-stack>

                {isPro ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="manage-plans" />
                    <input
                      type="hidden"
                      name="planHandle"
                      value={FREE_PLAN_HANDLE}
                    />

                    <s-button
                      type="submit"
                      variant="secondary"
                      tone="critical"
                      loading={submittedPlanHandle === FREE_PLAN_HANDLE}
                      disabled={submittedPlanHandle === FREE_PLAN_HANDLE}
                    >
                      Switch to Free
                    </s-button>
                  </Form>
                ) : (
                  <s-button variant="secondary" disabled>
                    Selected
                  </s-button>
                )}

                <s-divider />

                <s-unordered-list>
                  <s-list-item>Unlimited draft prompts</s-list-item>
                  <s-list-item>1 published prompt</s-list-item>
                  <s-list-item>10 AI generations per month</s-list-item>
                  <s-list-item>No credit card required</s-list-item>
                </s-unordered-list>
              </s-stack>
            </s-box>

            <s-box
              background="base"
              borderWidth="base"
              borderColor="strong"
              borderRadius="base"
              padding="large"
            >
              <s-stack direction="block" gap="small">
                <s-grid
                  gridTemplateColumns="minmax(0, 1fr) auto"
                  gap="small"
                  alignItems="start"
                >
                  <s-stack direction="block" gap="small-200">
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      <s-heading>Pro</s-heading>

                      <s-badge tone="info">Recommended</s-badge>
                    </s-stack>

                    <s-text tone="neutral">
                      For stores generating regularly.
                    </s-text>
                  </s-stack>

                  {isPro ? <s-badge tone="success">Current</s-badge> : null}
                </s-grid>

                <s-stack direction="block" gap="small-200">
                  <s-heading>
                    ${planSummary.proPlanMonthlyPrice.toFixed(2)}
                  </s-heading>

                  <s-text tone="neutral">per month</s-text>

                  <s-text tone="neutral">
                    or ${planSummary.proPlanYearlyPrice.toFixed(2)}/year
                  </s-text>
                </s-stack>

                {planSummary.proPlanTrialDays > 0 ? (
                  <s-badge tone="info">
                    {planSummary.proPlanTrialDays}-day trial
                  </s-badge>
                ) : null}

                {isPro ? (
                  <s-button variant="secondary" disabled>
                    Selected
                  </s-button>
                ) : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="manage-plans" />
                    <input
                      type="hidden"
                      name="planHandle"
                      value={PRO_PLAN_HANDLE}
                    />

                    <s-button
                      type="submit"
                      variant="primary"
                      loading={submittedPlanHandle === PRO_PLAN_HANDLE}
                      disabled={submittedPlanHandle === PRO_PLAN_HANDLE}
                    >
                      Choose Pro
                    </s-button>
                  </Form>
                )}

                <s-divider />

                <s-unordered-list>
                  <s-list-item>Unlimited prompts</s-list-item>
                  <s-list-item>Unlimited AI generations</s-list-item>
                  <s-list-item>3-day free trial</s-list-item>
                  <s-list-item>Cancel anytime from Shopify billing</s-list-item>
                </s-unordered-list>
              </s-stack>
            </s-box>
          </s-grid>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
