import { Form, useNavigation } from "react-router";

import { useNavLoadingGroup } from "../../utils/use-navigating-to";

export type StyleActionsMenuStyle = {
  id: string;
  name: string;
  status: string;
  productAdminUrl: string | null;
  canDelete: boolean;
  isPublishReady: boolean;
};

/**
 * Shared row-level actions menu for a Style — used by both the dashboard's
 * Recent styles table and the full Styles list table so the available
 * actions and their behavior never drift between the two.
 */
export function StyleActionsMenu({ style }: { style: StyleActionsMenuStyle }) {
  const menuId = `style-actions-${style.id}`;

  const duplicateModalId = `duplicate-style-${style.id}`;

  const deleteModalId = `delete-style-${style.id}`;

  const base = `/app/styles/${style.id}`;

  const canPublish =
    style.status === "DRAFT" || style.status === "PUBLISH_ERROR";

  const isPublished = style.status === "PUBLISHED";

  const navigation = useNavigation();

  // Multiple rows render this component at once, so match both the
  // intent and the specific style's own route to avoid every row's
  // button lighting up for one row's submission.
  const submittingIntent =
    navigation.state !== "idle" && navigation.formAction === base
      ? navigation.formData?.get("intent")
      : null;

  const duplicating = submittingIntent === "duplicateStyle";

  const deleting = submittingIntent === "deleteStyle";

  const menuNav = useNavLoadingGroup<"edit" | "publish">();

  const publishHref = `${base}/publish`;

  return (
    <>
      <s-button
        commandFor={menuId}
        command="--show"
        icon="menu-horizontal"
        variant="tertiary"
        accessibilityLabel={`Actions for ${style.name}`}
      />

      <s-menu id={menuId} accessibilityLabel={`Actions for ${style.name}`}>
        <s-button
          href={base}
          icon="edit"
          loading={menuNav.isLoading("edit")}
          onClick={() => menuNav.start("edit")}
        >
          Edit
        </s-button>

        {canPublish ? (
          style.isPublishReady ? (
            <s-button
              href={publishHref}
              icon="upload"
              loading={menuNav.isLoading("publish")}
              onClick={() => menuNav.start("publish")}
            >
              Publish
            </s-button>
          ) : (
            <s-button
              href={publishHref}
              icon="alert-circle"
              loading={menuNav.isLoading("publish")}
              onClick={() => menuNav.start("publish")}
            >
              Action required
            </s-button>
          )
        ) : null}

        {isPublished ? (
          <>
            {style.productAdminUrl ? (
              <s-button
                href={style.productAdminUrl}
                target="_blank"
                icon="external"
              >
                View product
              </s-button>
            ) : null}

            <s-button
              href={publishHref}
              icon="hide"
              loading={menuNav.isLoading("publish")}
              onClick={() => menuNav.start("publish")}
            >
              Unpublish
            </s-button>
          </>
        ) : null}

        <s-button
          commandFor={duplicateModalId}
          command="--show"
          icon="duplicate"
        >
          Duplicate
        </s-button>

        <s-button href={`${base}/export`} target="_blank" icon="export">
          Export
        </s-button>

        {style.canDelete ? (
          <s-button
            commandFor={deleteModalId}
            command="--show"
            icon="delete"
            tone="critical"
          >
            Delete
          </s-button>
        ) : null}
      </s-menu>

      <s-modal id={duplicateModalId} heading={`Duplicate "${style.name}"?`}>
        <Form method="post" action={base}>
          <input type="hidden" name="intent" value="duplicateStyle" />

          <s-stack direction="block" gap="base">
            <s-paragraph>
              This creates a new draft prompt with the same instructions,
              fields, and product settings. Generated images are not copied.
            </s-paragraph>

            <s-stack direction="inline" gap="base">
              <s-button
                variant="secondary"
                commandFor={duplicateModalId}
                command="--hide"
                disabled={duplicating}
              >
                Cancel
              </s-button>

              <s-button
                type="submit"
                variant="primary"
                loading={duplicating}
                disabled={duplicating}
              >
                Duplicate prompt
              </s-button>
            </s-stack>
          </s-stack>
        </Form>
      </s-modal>

      {style.canDelete ? (
        <s-modal id={deleteModalId} heading={`Delete "${style.name}"?`}>
          <Form method="post" action={base}>
            <input type="hidden" name="intent" value="deleteStyle" />

            <s-stack direction="block" gap="base">
              <s-paragraph>
                Delete this prompt permanently, including its customer fields,
                generated images, and generation history?
                {style.status === "PUBLISHED"
                  ? " This will also delete its live Shopify product."
                  : ""}
              </s-paragraph>

              <s-text tone="critical">This action cannot be undone.</s-text>

              <s-stack direction="inline" gap="base">
                <s-button
                  variant="secondary"
                  commandFor={deleteModalId}
                  command="--hide"
                  disabled={deleting}
                >
                  Cancel
                </s-button>

                <s-button
                  type="submit"
                  variant="primary"
                  tone="critical"
                  loading={deleting}
                  disabled={deleting}
                >
                  Delete prompt
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-modal>
      ) : null}
    </>
  );
}
