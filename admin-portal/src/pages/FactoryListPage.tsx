import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, getDashboard, listFactories } from "../api";
import type { AdminDashboard, Factory, FactoryStatus } from "../api";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../auth";

type SortKey = "name" | "status" | "plan_tier" | "active_employee_count" | "enrolled_at";

const STATUS_OPTIONS: (FactoryStatus | "all")[] = ["all", "trial", "active", "payment_overdue", "suspended", "churned"];

export default function FactoryListPage() {
  const { token, logout } = useAuth();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [factories, setFactories] = useState<Factory[]>([]);
  const [statusFilter, setStatusFilter] = useState<FactoryStatus | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("enrolled_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([getDashboard(token), listFactories(token, statusFilter === "all" ? undefined : statusFilter)])
      .then(([d, f]) => {
        setDashboard(d);
        setFactories(f);
        setError(null);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          logout();
          navigate("/login");
          return;
        }
        setError(e instanceof ApiError ? e.message : "Couldn't reach the server.");
      })
      .finally(() => setLoading(false));
  }, [token, statusFilter]);

  const sorted = useMemo(() => {
    const copy = [...factories];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [factories, sortKey, sortAsc]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function sortArrow(key: SortKey) {
    if (key !== sortKey) return "";
    return sortAsc ? " ▲" : " ▼";
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Labour Lens Admin</h1>
        <button className="ghost" onClick={() => { logout(); navigate("/login"); }}>
          Sign out
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      {dashboard && (
        <div className="summary-cards">
          <div className="card">
            <div className="card-value">{dashboard.total_factories}</div>
            <div className="card-label">Total factories</div>
          </div>
          <div className="card">
            <div className="card-value">{dashboard.total_active_employees}</div>
            <div className="card-label">Active employees (all factories)</div>
          </div>
          {(["active", "trial", "payment_overdue", "suspended"] as const).map((s) => (
            <div className="card" key={s}>
              <div className="card-value">{dashboard.counts_by_status[s] ?? 0}</div>
              <div className="card-label">
                <StatusBadge status={s} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="toolbar">
        <label>
          Status:{" "}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FactoryStatus | "all")}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All" : s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="muted">Loading...</p>
      ) : (
        <table className="factory-table">
          <thead>
            <tr>
              <th onClick={() => handleSort("name")}>Factory{sortArrow("name")}</th>
              <th onClick={() => handleSort("status")}>Status{sortArrow("status")}</th>
              <th onClick={() => handleSort("plan_tier")}>Plan{sortArrow("plan_tier")}</th>
              <th onClick={() => handleSort("active_employee_count")}>Active employees{sortArrow("active_employee_count")}</th>
              <th onClick={() => handleSort("enrolled_at")}>Enrolled{sortArrow("enrolled_at")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No factories match this filter.
                </td>
              </tr>
            ) : (
              sorted.map((f) => (
                <tr key={f.id} onClick={() => navigate(`/factories/${f.id}`)} className="clickable-row">
                  <td>
                    <Link to={`/factories/${f.id}`}>{f.name}</Link>
                  </td>
                  <td>
                    <StatusBadge status={f.status} />
                  </td>
                  <td>{f.plan_tier ?? "-"}</td>
                  <td>{f.active_employee_count}</td>
                  <td>{new Date(f.enrolled_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
