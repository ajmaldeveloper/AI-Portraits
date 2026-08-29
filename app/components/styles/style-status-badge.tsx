export function StyleStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PUBLISHED":
      return <s-badge tone="success">Published</s-badge>;

    case "PUBLISHING":
    case "UNPUBLISHING":
      return <s-badge tone="info">Processing</s-badge>;

    case "PUBLISH_ERROR":
      return <s-badge tone="critical">Publish error</s-badge>;

    case "UNPUBLISHED":
      return <s-badge tone="warning">Unpublished</s-badge>;

    default:
      return <s-badge tone="info">Draft</s-badge>;
  }
}
