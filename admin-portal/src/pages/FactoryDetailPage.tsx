import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  createFactoryPayment,
  getFactoryDetail,
  updateFactory,
  updateFactoryPayment,
} from "../api";
import type { FactoryDetail, FactoryPayment, FactoryStatus } from "../api";
import StatusBadge from "../components/StatusBadge";
import EmployeeTrendChart from "../components/EmployeeTrendChart";
import { useAuth } from "../auth";

const STATUS_OPTIONS: FactoryStatus[] = ["trial", "active", "payment_overdue", "suspended", "churned"];

export default function FactoryDetailPage() {
  const { token, logout } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const factoryId = Number(id);

  const [detail, setDetail] = useState<FactoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<FactoryStatus>("trial");
  const [planTier, setPlanTier] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [showAddPayment, setShowAddPayment] = useState(false);
  const [newAmount, setNewAmount] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [addingPayment, setAddingPayment] = useState(false);

  function load() {
    if (!token || !factoryId) return;
    setLoading(true);
    getFactoryDetail(token, factoryId)
      .then((d) => {
        setDetail(d);
        setStatus(d.factory.status);
        setPlanTier(d.factory.plan_tier ?? "");
        setNotes(d.factory.notes ?? "");
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
  }

  useEffect(load, [token, factoryId]);

  async function handleSave() {
    if (!token) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      await updateFactory(token, factoryId, { status, plan_tier: planTier || null, notes: notes || null });
      setSaveMessage("Saved.");
      load();
    } catch (e) {
      setSaveMessage(e instanceof ApiError ? `Save failed: ${e.message}` : "Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !newAmount || !newDueDate) return;
    setAddingPayment(true);
    try {
      await createFactoryPayment(token, factoryId, {
        amount: parseFloat(newAmount),
        due_date: newDueDate,
        status: "pending",
      });
      setNewAmount("");
      setNewDueDate("");
      setShowAddPayment(false);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach the server.");
    } finally {
      setAddingPayment(false);
    }
  }

  async function handleMarkPaid(payment: FactoryPayment) {
    if (!token) return;
    try {
      await updateFactoryPayment(token, factoryId, payment.id, {
        amount: payment.amount,
        due_date: payment.due_date,
        paid_date: new Date().toISOString().slice(0, 10),
        status: "paid",
      });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach the server.");
    }
  }

  if (loading) return <div className="page"><p className="muted">Loading...</p></div>;
  if (error || !detail) return <div className="page"><p className="error">{error ?? "Not found."}</p></div>;

  const { factory, payments, employee_trend } = detail;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Link to="/" className="back-link">← All factories</Link>
          <h1>{factory.name}</h1>
        </div>
        <StatusBadge status={factory.status} />
      </header>

      <section className="detail-grid">
        <div className="panel">
          <h2>Factory info</h2>
          <dl className="info-list">
            <dt>Owner</dt>
            <dd>{factory.owner_name}</dd>
            <dt>Contact</dt>
            <dd>{factory.owner_contact}</dd>
            <dt>Enrolled</dt>
            <dd>{new Date(factory.enrolled_at).toLocaleDateString()}</dd>
            <dt>Active employees (current)</dt>
            <dd>{factory.active_employee_count}</dd>
          </dl>

          <h3>Status &amp; plan</h3>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as FactoryStatus)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Plan tier
            <input value={planTier} onChange={(e) => setPlanTier(e.target.value)} placeholder="e.g. pro" />
          </label>
          <label>
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
          </label>
          <button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </button>
          {saveMessage && <p className="muted">{saveMessage}</p>}
        </div>

        <div className="panel">
          <h2>Employee trend</h2>
          <EmployeeTrendChart data={employee_trend} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header-row">
          <h2>Payment history</h2>
          <button className="ghost" onClick={() => setShowAddPayment(!showAddPayment)}>
            {showAddPayment ? "Cancel" : "+ Add payment"}
          </button>
        </div>

        {showAddPayment && (
          <form className="inline-form" onSubmit={handleAddPayment}>
            <label>
              Amount
              <input type="number" step="0.01" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} required />
            </label>
            <label>
              Due date
              <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} required />
            </label>
            <button type="submit" disabled={addingPayment}>
              {addingPayment ? "Adding..." : "Add"}
            </button>
          </form>
        )}

        {payments.length === 0 ? (
          <p className="muted">No payments recorded yet.</p>
        ) : (
          <table className="factory-table">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Due date</th>
                <th>Paid date</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className={p.is_overdue ? "row-overdue" : undefined}>
                  <td>₹{p.amount.toLocaleString()}</td>
                  <td>{p.due_date}</td>
                  <td>{p.paid_date ?? "-"}</td>
                  <td>{p.is_overdue ? <span className="overdue-flag">OVERDUE</span> : p.status}</td>
                  <td>
                    {p.status !== "paid" && (
                      <button className="ghost small" onClick={() => handleMarkPaid(p)}>
                        Mark paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
