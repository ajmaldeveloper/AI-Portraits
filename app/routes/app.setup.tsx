import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import {
  getAppSetupChecks,
  getAppSetupUpcoming,
} from "../services/setup/app-setup.server";
import { authenticate } from "../shopify.server";
import { useNavLoadingGroup } from "../utils/use-navigating-to";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return {
    checks: await getAppSetupChecks(session),
    upcoming: getAppSetupUpcoming(),
  };
};

export default function AppSetup() {
  const { checks, upcoming } = useLoaderData<typeof loader>();

  const readyCount = checks.filter((check) => check.complete).length;

  const fixNav = useNavLoadingGroup<string>();

  return (
    <s-page heading="Setup" inlineSize="small">
      <s-link slot="breadcrumb-actions" href="/app">
        Home
      </s-link>

      <s-stack direction="block" gap="base">
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">
                {readyCount} of {checks.length} required checks complete
              </s-text>

              <s-text color="subdued">
                Complete these before relying on Winslet AI Portraits in
                production.
              </s-text>
            </s-stack>
          </s-stack>
        </s-box>

        <s-stack direction="block" gap="base">
          {checks.map((check, index) => (
            <s-section key={check.key} heading={`${index + 1}. ${check.label}`}>
              <s-stack direction="block" gap="base">
                <s-stack
                  direction="inline"
                  gap="base"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-text color="subdued">{check.description}</s-text>

                  {check.complete ? (
                    <s-badge tone="success">Complete</s-badge>
                  ) : (
                    <s-badge tone="warning">Action required</s-badge>
                  )}
                </s-stack>

                <s-box padding="base" background="subdued" borderRadius="base">
                  <s-stack direction="block" gap="small">
                    {check.details.map((detail) => (
                      <s-stack
                        key={detail.label}
                        direction="inline"
                        gap="base"
                        alignItems="center"
                        justifyContent="space-between"
                      >
                        <s-text color="subdued">{detail.label}</s-text>

                        <s-text>{detail.value}</s-text>
                      </s-stack>
                    ))}
                  </s-stack>
                </s-box>

                {!check.complete && check.fixHref ? (
                  <s-stack direction="inline" gap="base">
                    <s-button
                      href={check.fixHref}
                      variant="secondary"
                      loading={fixNav.isLoading(check.key)}
                      onClick={() => fixNav.start(check.key)}
                    >
                      {check.fixLabel}
                    </s-button>
                  </s-stack>
                ) : null}
              </s-stack>
            </s-section>
          ))}
        </s-stack>

        <s-section heading="Coming soon">
          <s-stack direction="block" gap="base">
            {upcoming.map((item) => (
              <s-box
                key={item.key}
                padding="base"
                background="subdued"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-text type="strong">{item.label}</s-text>

                    <s-badge tone="neutral">Planned</s-badge>
                  </s-stack>

                  <s-text color="subdued">{item.description}</s-text>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}
