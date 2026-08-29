export type MetricIcon = "grid" | "clock" | "check" | "wand" | "alert-circle";

export type MetricTone =
  "neutral" | "info" | "success" | "caution" | "critical";

const chipTints: Record<MetricTone, string> = {
  neutral: "#F1F1F3",
  info: "#EEF2FF",
  success: "#E3F6EC",
  caution: "#FEF3E2",
  critical: "#FBEAE9",
};

export function MetricIconChip({
  icon,
  tone,
}: {
  icon: MetricIcon;
  tone: MetricTone;
}) {
  return (
    <div
      style={{
        flex: "0 0 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        maxWidth: 32,
        maxHeight: 32,
        overflow: "hidden",
        borderRadius: 8,
        background: chipTints[tone],
      }}
    >
      <s-icon
        type={icon}
        tone={tone === "neutral" ? "auto" : tone}
        size="small"
      />
    </div>
  );
}

export function MetricCard({
  icon,
  tone = "neutral",
  label,
  value,
  detail,
  detailTone,
}: {
  icon: MetricIcon;
  tone?: MetricTone;
  label: string;
  value: string | number;
  detail: string;
  detailTone?: "subdued" | "caution";
}) {
  return (
    <s-box
      padding="base"
      background="base"
      borderRadius="base"
      borderWidth="base"
      borderColor="base"
    >
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <MetricIconChip icon={icon} tone={tone} />

          <s-text color="subdued">{label}</s-text>
        </s-stack>

        <s-heading>{String(value)}</s-heading>

        {detailTone === "caution" ? (
          <s-text tone="caution">{detail}</s-text>
        ) : (
          <s-text color="subdued">{detail}</s-text>
        )}
      </s-stack>
    </s-box>
  );
}
