import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect } from "react";

import { UsageRing } from "../components/billing/usage-ring";
import { getShopPlanSummary } from "../services/billing/billing.server";
import { PRO_PLAN, authenticate } from "../shopify.server";

const isTestBilling = process.env.NODE_ENV !== "production";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const planSummary = await getShopPlanSummary(session.shop);

  const url = new URL(request.url);

  return {
    planSummary,

    cancelled: url.searchParams.get("cancelled") === "1",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, redirect } = await authenticate.admin(request);

  const formData = await request.formData();

  const intent = formData.get("intent");

  if (intent === "upgrade") {
    // Redirects to Shopify's own confirmation page — the merchant
    // approves the plan (and its spending cap) there, not in this app.
    // billing.request() never returns normally.
    await billing.request({
      plan: PRO_PLAN,
      isTest: isTestBilling,
      returnUrl: `${process.env.SHOPIFY_APP_URL ?? ""}/app/plans`,
    });
  }

  if (intent === "cancel") {
    try {
      const { appSubscriptions } = await billing.check({
        plans: [PRO_PLAN],
        isTest: isTestBilling,
      });

      const subscription = appSubscriptions[0];

      if (subscription) {
        await billing.cancel({
          subscriptionId: subscription.id,
          isTest: isTestBilling,
        });
      }

      return redirect("/app/plans?cancelled=1");
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Could not cancel the Pro plan.",
      };
    }
  }

  return null;
};

export default function PlansRoute() {
  const { planSummary, cancelled } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();

  const navigation = useNavigation();

  const shopify = useAppBridge();

  const submittedIntent = navigation.formData?.get("intent");

  const upgrading =
    navigation.state !== "idle" && submittedIntent === "upgrade";

  const cancelling =
    navigation.state !== "idle" && submittedIntent === "cancel";

  useEffect(() => {
    if (!cancelled) {
      return;
    }

    shopify.toast.show("Pro plan cancelled — back on the Free plan");

    window.history.replaceState(null, "", "/app/plans");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelled, shopify]);

  const isPro = planSummary.isPro;

  return (
    <s-page heading="Plans" inlineSize="base">
      <s-stack direction="block" gap="large">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-heading>Choose the right plan for your store</s-heading>

            <s-text tone="neutral">
              Free forever for light use, or pay only for what you generate on
              Pro — managed securely through Shopify billing.
            </s-text>

            {actionData?.error ? (
              <s-banner tone="critical">{actionData.error}</s-banner>
            ) : null}

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
                    <input type="hidden" name="intent" value="cancel" />

                    <s-button
                      type="submit"
                      variant="secondary"
                      tone="critical"
                      loading={cancelling}
                      disabled={cancelling}
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
                    ${planSummary.generationUnitPrice.toFixed(2)}
                  </s-heading>

                  <s-text tone="neutral">per AI generation</s-text>
                </s-stack>

                {isPro ? (
                  <s-button variant="secondary" disabled>
                    Selected
                  </s-button>
                ) : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="upgrade" />

                    <s-button
                      type="submit"
                      variant="primary"
                      loading={upgrading}
                      disabled={upgrading}
                    >
                      Choose Pro
                    </s-button>
                  </Form>
                )}

                <s-divider />

                <s-unordered-list>
                  <s-list-item>Unlimited prompts</s-list-item>
                  <s-list-item>Unlimited AI generations</s-list-item>
                  <s-list-item>Pay only for what you generate</s-list-item>
                  <s-list-item>Spending cap you approve on Shopify</s-list-item>
                </s-unordered-list>
              </s-stack>
            </s-box>
          </s-grid>
        </s-section>
      </s-stack>
    </s-page>
  );
}
