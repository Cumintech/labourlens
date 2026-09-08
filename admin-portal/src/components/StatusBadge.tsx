import type { FactoryStatus } from "../api";

const LABELS: Record<FactoryStatus, string> = {
  trial: "Trial",
  active: "Active",
  payment_overdue: "Payment Overdue",
  suspended: "Suspended",
  churned: "Churned",
};

const COLORS: Record<FactoryStatus, { bg: string; fg: string }> = {
  trial: { bg: "#e8ecf5", fg: "#3a4a6b" },
  active: { bg: "#dff5e6", fg: "#1e7a3d" },
  payment_overdue: { bg: "#fdecd2", fg: "#9a5a00" },
  suspended: { bg: "#fde2e2", fg: "#a11d1d" },
  churned: { bg: "#e8e8e8", fg: "#5a5a5a" },
};

export default function StatusBadge({ status }: { status: FactoryStatus }) {
  const color = COLORS[status] ?? COLORS.trial;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        backgroundColor: color.bg,
        color: color.fg,
        whiteSpace: "nowrap",
      }}
    >
      {LABELS[status] ?? status}
    </span>
  );
}
