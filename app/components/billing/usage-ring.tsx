// Shared with app._index.tsx (dashboard) and app.plans.tsx (Plans page)
// so the two stay visually identical — same ring, same color logic.
export function UsageRing({
  label,
  count,
  limit,
}: {
  label: string;
  count: number;
  limit: number | null;
}) {
  const radius = 26;

  const circumference = 2 * Math.PI * radius;

  const fraction = limit ? Math.min(1, count / limit) : 1;

  const pct = limit ? Math.round(fraction * 100) : 0;

  const strokeColor = !limit
    ? "#008060"
    : pct >= 100
      ? "#D82C0D"
      : pct >= 80
        ? "#B98900"
        : "#008060";

  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        role="img"
        aria-label={
          limit
            ? `${label}: ${count} of ${limit}`
            : `${label}: ${count}, unlimited`
        }
      >
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="#E3E5E8"
          strokeWidth="6"
        />

        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="6"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          strokeLinecap="round"
          transform="rotate(-90 32 32)"
        />

        <text
          x="32"
          y="36"
          textAnchor="middle"
          fontSize="13"
          fontWeight="600"
          fill={strokeColor}
        >
          {limit ? `${count}/${limit}` : count}
        </text>
      </svg>

      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>

        {!limit ? <s-text type="strong">Unlimited</s-text> : null}
      </s-stack>
    </s-stack>
  );
}
