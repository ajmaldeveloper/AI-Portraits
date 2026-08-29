import { useEffect, useState } from "react";
import { StyleStatus } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { MetricCard } from "../components/dashboard/metric-card";
import { StyleActionsMenu } from "../components/styles/style-actions-menu";
import { StyleNameLink } from "../components/styles/style-name-link";
import { StyleStatusBadge } from "../components/styles/style-status-badge";
import { PlanLimitError } from "../services/billing/billing.server";
import { getDashboardForShop } from "../services/dashboard/dashboard.server";
import { isStylePublishReady } from "../services/styles/style-readiness.server";
import {
  listStylesForShop,
  styleCanBeDeleted,
  type StyleListSort,
} from "../services/styles/style.server";
import {
  StyleImportError,
  importStylesFromExport,
} from "../services/styles/style-export.server";
import { bulkDeleteStylesAndShopifyProducts } from "../services/styles/style-publish.server";
import { authenticate } from "../shopify.server";
import { eventValue } from "../utils/event-value";
import { formatDate } from "../utils/format-date";
import { shopifyProductAdminUrl } from "../utils/shopify-admin-link";
import { useNavigatingTo } from "../utils/use-navigating-to";

const PAGE_SIZE = 50;

const sortLabels: Record<StyleListSort, string> = {
  updated_desc: "Recently updated",
  updated_asc: "Oldest updated",
  name_asc: "Name A–Z",
};

const validStatuses = new Set<string>(Object.values(StyleStatus));

const validSorts = new Set<string>(["updated_desc", "updated_asc", "name_asc"]);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);

  const search = url.searchParams.get("q")?.trim() || undefined;

  const statusParam = url.searchParams.get("status") || "";

  const status = validStatuses.has(statusParam)
    ? (statusParam as StyleStatus)
    : undefined;

  const sortParam = url.searchParams.get("sort") || "";

  const sort: StyleListSort = validSorts.has(sortParam)
    ? (sortParam as StyleListSort)
    : "updated_desc";

  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const [dashboard, result] = await Promise.all([
    getDashboardForShop(session.shop),

    listStylesForShop(session.shop, {
      search,
      status,
      sort,
      page,
      pageSize: PAGE_SIZE,
    }),
  ]);

  return {
    deleted: url.searchParams.get("deleted") === "1",

    bulkDeleted: url.searchParams.get("bulkDeleted") === "1",

    bulkDeleteSkipped: Number(url.searchParams.get("bulkDeleteSkipped") ?? "0"),

    bulkImported: Number(url.searchParams.get("bulkImported") ?? "0"),

    bulkImportSkipped: Number(url.searchParams.get("bulkImportSkipped") ?? "0"),

    filters: {
      q: search ?? "",
      status: statusParam,
      sort,
    },

    page: result.page,

    pageSize: result.pageSize,

    total: result.total,

    hasPreviousPage: result.hasPreviousPage,

    hasNextPage: result.hasNextPage,

    counts: {
      total: dashboard.totalStyles,
      drafts: dashboard.draftStyles,
      published: dashboard.publishedStyles,
      attention: dashboard.publishErrorStyles,
    },

    styles: result.styles.map((style) => ({
      id: style.id,
      name: style.name,
      productTitle: style.productTitle,
      status: style.status,
      shopifyProductId: style.shopifyProductId,
      updatedAt: style.updatedAt.toISOString(),

      fieldsCount: style._count.fields,
      assetsCount: style._count.assets,
      generationsCount: style._count.generations,

      canDelete: styleCanBeDeleted(style),

      isPublishReady: isStylePublishReady(style),

      productAdminUrl: style.shopifyProductId
        ? shopifyProductAdminUrl(session.shop, style.shopifyProductId)
        : null,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);

  const formData = await request.formData();

  const intent = formData.get("intent");

  if (intent === "importStyle") {
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return { importError: "Choose a prompt export file to import." };
    }

    let raw: unknown;

    try {
      raw = JSON.parse(await file.text());
    } catch {
      return { importError: "That file isn't valid JSON." };
    }

    try {
      const result = await importStylesFromExport(session.shop, raw);

      if (result.created.length === 0) {
        return {
          importError:
            "Could not import any prompts — the plan limit was already reached.",
        };
      }

      if (result.created.length === 1) {
        return redirect(`/app/styles/${result.created[0]!.id}?imported=1`);
      }

      const url = new URL(request.url);

      url.searchParams.set("bulkImported", String(result.created.length));

      if (result.skipped > 0) {
        url.searchParams.set("bulkImportSkipped", String(result.skipped));
      }

      return redirect(`${url.pathname}${url.search}`);
    } catch (error) {
      return {
        importError:
          error instanceof StyleImportError || error instanceof PlanLimitError
            ? error.message
            : "Could not import that file.",
      };
    }
  }

  if (intent === "bulkDelete") {
    const idsRaw = formData.get("ids");

    let ids: string[] = [];

    if (typeof idsRaw === "string") {
      try {
        const parsed = JSON.parse(idsRaw);

        if (Array.isArray(parsed)) {
          ids = parsed.filter((id): id is string => typeof id === "string");
        }
      } catch {
        ids = [];
      }
    }

    let skippedCount = 0;

    if (ids.length > 0) {
      const result = await bulkDeleteStylesAndShopifyProducts(
        admin,
        session.shop,
        ids,
      );

      skippedCount = result.skippedCount;
    }

    const url = new URL(request.url);

    url.searchParams.delete("deleted");

    url.searchParams.set("bulkDeleted", "1");

    if (skippedCount > 0) {
      url.searchParams.set("bulkDeleteSkipped", String(skippedCount));
    }

    return redirect(`${url.pathname}${url.search}`);
  }

  throw new Response("Unsupported action.", {
    status: 400,
  });
};

export default function StylesIndex() {
  const {
    deleted,
    bulkDeleted,
    bulkDeleteSkipped,
    bulkImported,
    bulkImportSkipped,
    filters,
    page,
    total,
    pageSize,
    hasPreviousPage,
    hasNextPage,
    counts,
    styles,
  } = useLoaderData<typeof loader>();

  const [searchParams, setSearchParams] = useSearchParams();

  const navigate = useNavigate();

  const navigation = useNavigation();

  const actionData = useActionData<typeof action>();

  // Excludes POST submissions (bulk delete etc.) — those have
  // formData — so this only reflects GET navigations (search/filter/
  // sort/pagination), which is what the pagination arrows care about.
  const pageLoading = navigation.state === "loading" && !navigation.formData;

  const bulkDeleting =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "bulkDelete";

  const importing =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "importStyle";

  const createStylePrimaryNav = useNavigatingTo();

  const createStyleEmptyStateNav = useNavigatingTo();

  const shopify = useAppBridge();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [searchInput, setSearchInput] = useState(filters.q);

  useEffect(() => {
    setSearchInput(filters.q);
  }, [filters.q]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput === (searchParams.get("q") ?? "")) {
        return;
      }

      const next = new URLSearchParams(searchParams);

      if (searchInput) {
        next.set("q", searchInput);
      } else {
        next.delete("q");
      }

      next.delete("page");

      setSearchParams(next, {
        replace: true,
      });
    }, 300);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const sortLabel = sortLabels[filters.sort];

  const applyFilter = (key: "status" | "sort", value: string) => {
    const next = new URLSearchParams(searchParams);

    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }

    next.delete("page");

    setSearchParams(next);
  };

  useEffect(() => {
    if (!deleted && !bulkDeleted && !bulkImported) {
      return;
    }

    if (bulkImported) {
      shopify.toast.show(
        bulkImportSkipped > 0
          ? `Imported ${bulkImported} prompts (${bulkImportSkipped} skipped — plan limit reached)`
          : `Imported ${bulkImported} prompts`,
      );
    } else if (bulkDeleted) {
      shopify.toast.show(
        bulkDeleteSkipped > 0
          ? `Prompts deleted (${bulkDeleteSkipped} skipped — publish in progress)`
          : "Prompts deleted",
      );
    } else {
      shopify.toast.show("Prompt deleted");
    }

    setSelectedIds([]);

    // A successful bulk delete/import leaves its triggering modal open,
    // showing stale content behind the toast — s-modal exposes
    // hideOverlay() directly on the element.
    document
      .querySelectorAll<HTMLElement & { hideOverlay?: () => void }>("s-modal")
      .forEach((modal) => modal.hideOverlay?.());

    navigate("/app/styles", {
      replace: true,
    });
  }, [
    bulkDeleted,
    bulkDeleteSkipped,
    bulkImported,
    bulkImportSkipped,
    deleted,
    navigate,
    shopify,
  ]);

  const allOnPageSelected =
    styles.length > 0 &&
    styles.every((style) => selectedIds.includes(style.id));

  const toggleAll = () => {
    if (allOnPageSelected) {
      setSelectedIds((current) =>
        current.filter((id) => !styles.some((style) => style.id === id)),
      );
    } else {
      setSelectedIds((current) => [
        ...current,
        ...styles
          .map((style) => style.id)
          .filter((id) => !current.includes(id)),
      ]);
    }
  };

  const toggleOne = (styleId: string) => {
    setSelectedIds((current) =>
      current.includes(styleId)
        ? current.filter((id) => id !== styleId)
        : [...current, styleId],
    );
  };

  const goToPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);

    next.set("page", String(nextPage));

    setSearchParams(next);
  };

  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;

  const lastRow = Math.min(page * pageSize, total);

  return (
    <s-page heading="Prompts" inlineSize="large">
      <s-button
        slot="primary-action"
        href="/app/styles/new"
        variant="primary"
        loading={createStylePrimaryNav.loading}
        onClick={createStylePrimaryNav.onClick}
      >
        Create prompt
      </s-button>

      <s-button
        slot="secondary-actions"
        variant="secondary"
        icon="import"
        commandFor="import-style"
        command="--show"
      >
        Import prompt
      </s-button>

      <s-stack direction="block" gap="base">
        <s-query-container>
          <s-grid
            gridTemplateColumns="@container (inline-size > 760px) 1fr 1fr 1fr 1fr, 1fr"
            gap="base"
          >
            <MetricCard
              icon="grid"
              tone="info"
              label="Total"
              value={counts.total}
              detail="All prompts"
            />

            <MetricCard
              icon="clock"
              tone="caution"
              label="Drafts"
              value={counts.drafts}
              detail="Being configured"
            />

            <MetricCard
              icon="check"
              tone="success"
              label="Published"
              value={counts.published}
              detail="Live products"
            />

            <MetricCard
              icon="alert-circle"
              tone={counts.attention > 0 ? "critical" : "neutral"}
              label="Needs attention"
              value={counts.attention}
              detail="Publishing errors"
            />
          </s-grid>
        </s-query-container>

        {counts.total === 0 ? (
          <s-section heading="Create your first prompt">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Start by creating a draft. Nothing is added to your Shopify
                product catalog until you explicitly publish it.
              </s-paragraph>

              <s-stack direction="inline" gap="base">
                <s-button
                  href="/app/styles/new"
                  variant="primary"
                  loading={createStyleEmptyStateNav.loading}
                  onClick={createStyleEmptyStateNav.onClick}
                >
                  Create prompt
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>
        ) : (
          <s-section heading="All prompts">
            <s-stack direction="block" gap="base">
              <s-table>
                <s-stack slot="filters" direction="block" gap="small-200">
                  {selectedIds.length === 0 ? (
                    <s-grid gridTemplateColumns="1fr auto auto" gap="small-200">
                      <s-text-field
                        label="Search prompts"
                        labelAccessibilityVisibility="exclusive"
                        icon="search"
                        placeholder="Search prompts"
                        value={searchInput}
                        onInput={(event: Event) =>
                          setSearchInput(eventValue(event))
                        }
                      />

                      <s-select
                        label="Status"
                        labelAccessibilityVisibility="exclusive"
                        name="status"
                        value={filters.status}
                        onChange={(event: Event) =>
                          applyFilter("status", eventValue(event))
                        }
                      >
                        <s-option value="">All statuses</s-option>

                        <s-option value="DRAFT">Draft</s-option>

                        <s-option value="PUBLISHED">Published</s-option>

                        <s-option value="PUBLISH_ERROR">Publish error</s-option>

                        <s-option value="UNPUBLISHED">Unpublished</s-option>
                      </s-select>

                      <s-button
                        variant="secondary"
                        commandFor="styles-sort-menu"
                      >
                        {sortLabel}
                      </s-button>

                      <s-menu
                        id="styles-sort-menu"
                        accessibilityLabel="Sort prompts"
                      >
                        <s-button
                          onClick={() => applyFilter("sort", "updated_desc")}
                        >
                          Recently updated
                        </s-button>

                        <s-button
                          onClick={() => applyFilter("sort", "updated_asc")}
                        >
                          Oldest updated
                        </s-button>

                        <s-button
                          onClick={() => applyFilter("sort", "name_asc")}
                        >
                          Name A–Z
                        </s-button>
                      </s-menu>
                    </s-grid>
                  ) : (
                    <s-box
                      padding="small"
                      borderWidth="base"
                      borderColor="subdued"
                      borderRadius="base"
                    >
                      <s-stack
                        direction="inline"
                        gap="base"
                        alignItems="center"
                        justifyContent="space-between"
                      >
                        <s-text type="strong">
                          {selectedIds.length} selected
                        </s-text>

                        <s-stack direction="inline" gap="base">
                          <s-button
                            variant="tertiary"
                            onClick={() => setSelectedIds([])}
                          >
                            Cancel
                          </s-button>

                          <s-button
                            variant="secondary"
                            icon="export"
                            href={`/app/styles/export?ids=${encodeURIComponent(selectedIds.join(","))}`}
                            target="_blank"
                          >
                            Export selected
                          </s-button>

                          <s-button
                            variant="secondary"
                            tone="critical"
                            icon="delete"
                            commandFor="bulk-delete-styles"
                            command="--show"
                          >
                            Delete selected
                          </s-button>
                        </s-stack>
                      </s-stack>
                    </s-box>
                  )}
                </s-stack>

                <s-table-header-row>
                  <s-table-header>
                    <s-checkbox
                      label="Select all prompts on this page"
                      labelAccessibilityVisibility="exclusive"
                      checked={allOnPageSelected}
                      onChange={toggleAll}
                    />
                  </s-table-header>

                  <s-table-header>Prompt</s-table-header>

                  <s-table-header>Status</s-table-header>

                  <s-table-header>Customer fields</s-table-header>

                  <s-table-header>Images</s-table-header>

                  <s-table-header>Generations</s-table-header>

                  <s-table-header>Updated</s-table-header>

                  <s-table-header>Actions</s-table-header>
                </s-table-header-row>

                <s-table-body>
                  {styles.map((style) => (
                    <s-table-row key={style.id}>
                      <s-table-cell>
                        <s-checkbox
                          label={`Select ${style.name}`}
                          labelAccessibilityVisibility="exclusive"
                          checked={selectedIds.includes(style.id)}
                          onChange={() => toggleOne(style.id)}
                        />
                      </s-table-cell>

                      <s-table-cell>
                        <StyleNameLink id={style.id} name={style.name} />
                      </s-table-cell>

                      <s-table-cell>
                        <StyleStatusBadge status={style.status} />
                      </s-table-cell>

                      <s-table-cell>{style.fieldsCount}</s-table-cell>

                      <s-table-cell>{style.assetsCount}</s-table-cell>

                      <s-table-cell>{style.generationsCount}</s-table-cell>

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

              {total > pageSize ? (
                <s-stack
                  direction="inline"
                  gap="base"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-text color="subdued">
                    {`${firstRow}–${lastRow} of ${total} prompts`}
                  </s-text>

                  <s-stack direction="inline" gap="small">
                    <s-button
                      icon="chevron-left"
                      variant="tertiary"
                      disabled={!hasPreviousPage || pageLoading}
                      accessibilityLabel="Previous page"
                      onClick={() => goToPage(page - 1)}
                    />

                    <s-button
                      icon="chevron-right"
                      variant="tertiary"
                      disabled={!hasNextPage || pageLoading}
                      accessibilityLabel="Next page"
                      onClick={() => goToPage(page + 1)}
                    />
                  </s-stack>
                </s-stack>
              ) : null}
            </s-stack>
          </s-section>
        )}
      </s-stack>

      <s-modal id="import-style" heading="Import a prompt">
        <Form method="post" encType="multipart/form-data">
          <input type="hidden" name="intent" value="importStyle" />

          <s-stack direction="block" gap="base">
            <s-paragraph>
              Choose a prompt export file (from this shop or another shop
              running Winslet AI Portraits) &mdash; a single prompt, or a bundle
              exported from multiple selected prompts. Each one is imported as a
              new draft &mdash; gallery images, collections, and Shopify product
              linkage aren&rsquo;t carried over, so you can review and publish
              them independently.
            </s-paragraph>

            {actionData?.importError ? (
              <s-banner tone="critical">
                <s-paragraph>{actionData.importError}</s-paragraph>
              </s-banner>
            ) : null}

            <input type="file" name="file" accept="application/json" required />

            <s-stack direction="inline" gap="base">
              <s-button
                variant="secondary"
                commandFor="import-style"
                command="--hide"
                disabled={importing}
              >
                Cancel
              </s-button>

              <s-button
                type="submit"
                variant="primary"
                loading={importing}
                disabled={importing}
              >
                Import prompt
              </s-button>
            </s-stack>
          </s-stack>
        </Form>
      </s-modal>

      <s-modal id="bulk-delete-styles" heading="Delete selected prompts?">
        <Form method="post">
          <input type="hidden" name="intent" value="bulkDelete" />

          <input type="hidden" name="ids" value={JSON.stringify(selectedIds)} />

          <s-stack direction="block" gap="base">
            <s-paragraph>
              Delete {selectedIds.length} selected prompt
              {selectedIds.length === 1 ? "" : "s"} permanently, including their
              customer fields, generated images, and generation history? Any
              published prompt in the selection will also delete its live
              Shopify product. Prompts with a publish or unpublish actively in
              progress will be skipped.
            </s-paragraph>

            <s-text tone="critical">This action cannot be undone.</s-text>

            <s-stack direction="inline" gap="base">
              <s-button
                variant="secondary"
                commandFor="bulk-delete-styles"
                command="--hide"
                disabled={bulkDeleting}
              >
                Cancel
              </s-button>

              <s-button
                type="submit"
                variant="primary"
                tone="critical"
                loading={bulkDeleting}
                disabled={bulkDeleting}
              >
                Delete styles
              </s-button>
            </s-stack>
          </s-stack>
        </Form>
      </s-modal>
    </s-page>
  );
}
