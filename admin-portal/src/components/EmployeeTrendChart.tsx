import type { EmployeeSnapshot } from "../api";

// A hand-rolled bar chart -- a handful of monthly data points doesn't
// justify a charting library dependency for a single-user internal
// tool. Current month renders in a distinct color per spec.
export default function EmployeeTrendChart({ data }: { data: EmployeeSnapshot[] }) {
  if (data.length === 0) {
    return <p className="muted">No employee snapshots recorded yet -- the monthly job populates this over time.</p>;
  }

  const max = Math.max(...data.map((d) => d.active_employee_count), 1);
  const barWidth = 36;
  const gap = 16;
  const chartHeight = 140;
  const width = data.length * (barWidth + gap) + gap;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={Math.max(width, 200)} height={chartHeight + 40} role="img" aria-label="Active employees per month">
        {data.map((d, i) => {
          const barHeight = (d.active_employee_count / max) * chartHeight;
          const x = gap + i * (barWidth + gap);
          const y = chartHeight - barHeight;
          return (
            <g key={d.month}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={3}
                fill={d.is_current_month ? "#2f6fed" : "#c7d2e8"}
              />
              <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize={12} fill="#333">
                {d.active_employee_count}
              </text>
              <text x={x + barWidth / 2} y={chartHeight + 18} textAnchor="middle" fontSize={11} fill="#666">
                {d.month}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
