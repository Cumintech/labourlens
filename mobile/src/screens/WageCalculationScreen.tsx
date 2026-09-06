import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  DailyWageSummary,
  WageSummary,
  WorkerWage,
  getDailyWageSummary,
  getWageSummary,
  recordWagePayment,
} from "../api/client";
import DateField, { isoDate } from "../components/DateField";
import DonutChart from "../components/DonutChart";
import { useAuth } from "../context/AuthContext";
import { colors, radius, spacing } from "../theme";

type Mode = "daily" | "monthly";

const SLICE_COLORS = [
  colors.teal, colors.skyBlue, colors.violet, colors.amber,
  colors.coral, colors.danger, "#0F6E56", "#8A5A14", "#2B4C7E",
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function todayString() {
  return isoDate(new Date());
}

type Row = { workerId: number; workerName: string; amount: number; hasRate: boolean; paid?: boolean; present?: boolean };

// A dedicated place to answer "what's this month/day costing me, and
// who's it going to" -- previously this figure only existed buried
// inside Form 15's PDF, one worker's wage slip at a time, or a mental
// sum across each worker's own screen. Also the only place payments get
// recorded for more than one worker without opening each of their
// screens individually.
export default function WageCalculationScreen() {
  const { token } = useAuth();
  const today = useMemo(() => new Date(), []);
  const [mode, setMode] = useState<Mode>("monthly");
  const [date, setDate] = useState(todayString());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [monthlySummary, setMonthlySummary] = useState<WageSummary | null>(null);
  const [dailySummary, setDailySummary] = useState<DailyWageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [paymentTarget, setPaymentTarget] = useState<{ workerId: number; workerName: string } | null>(null);
  const [paymentDate, setPaymentDate] = useState(todayString());
  const [paymentReference, setPaymentReference] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);

  const [detailTarget, setDetailTarget] = useState<WorkerWage | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    if (mode === "monthly") {
      setMonthlySummary(await getWageSummary(token, month, year));
    } else {
      setDailySummary(await getDailyWageSummary(token, date));
    }
  }, [token, mode, month, year, date]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [load]),
  );

  function changeMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m > 12) {
      m = 1;
      y += 1;
    } else if (m < 1) {
      m = 12;
      y -= 1;
    }
    setMonth(m);
    setYear(y);
  }

  function openDetail(workerId: number) {
    const detail = monthlySummary?.workers.find((w) => w.worker_id === workerId);
    if (detail) setDetailTarget(detail);
  }

  function openPaymentModal(workerId: number, workerName: string) {
    setPaymentDate(todayString());
    setPaymentReference("");
    setPaymentTarget({ workerId, workerName });
  }

  async function handleRecordPayment() {
    if (!token || !paymentTarget) return;
    setSavingPayment(true);
    try {
      await recordWagePayment(token, paymentTarget.workerId, {
        month,
        year,
        date_of_payment: paymentDate.trim() || undefined,
        payment_reference: paymentReference.trim() || undefined,
      });
      setPaymentTarget(null);
      await load();
    } catch (e: any) {
      Alert.alert("Could not record payment", e?.message ?? "Please try again.");
    } finally {
      setSavingPayment(false);
    }
  }

  const rows: Row[] = useMemo(() => {
    if (mode === "monthly" && monthlySummary) {
      return monthlySummary.workers
        .filter((w) => w.has_rate)
        .sort((a, b) => b.net_wage - a.net_wage)
        .map((w) => ({ workerId: w.worker_id, workerName: w.worker_name, amount: w.net_wage, hasRate: true, paid: w.paid }));
    }
    if (mode === "daily" && dailySummary) {
      return dailySummary.workers
        .filter((w) => w.present)
        .sort((a, b) => b.daily_cost - a.daily_cost)
        .map((w) => ({ workerId: w.worker_id, workerName: w.worker_name, amount: w.daily_cost, hasRate: w.has_rate, present: w.present }));
    }
    return [];
  }, [mode, monthlySummary, dailySummary]);

  const noRateCount =
    mode === "monthly" && monthlySummary ? monthlySummary.workers.filter((w) => !w.has_rate).length : 0;
  const totalLabourers = mode === "monthly" ? monthlySummary?.total_workers ?? 0 : dailySummary?.total_workers_present ?? 0;
  const totalAmount = mode === "monthly" ? monthlySummary?.total_net ?? 0 : dailySummary?.total_daily_cost ?? 0;

  const slices = rows.map((r, i) => ({ value: r.amount, color: SLICE_COLORS[i % SLICE_COLORS.length] }));

  if (loading || !token) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.teal} />
      </View>
    );
  }

  return (
    <>
    <FlatList
      style={styles.container}
      data={rows}
      keyExtractor={(r) => String(r.workerId)}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
      ListHeaderComponent={
        <View>
          <Text style={styles.title}>Wage Calculation</Text>

          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeButton, mode === "daily" && styles.modeButtonActive]}
              onPress={() => setMode("daily")}
            >
              <Text style={[styles.modeText, mode === "daily" && styles.modeTextActive]}>Daily</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeButton, mode === "monthly" && styles.modeButtonActive]}
              onPress={() => setMode("monthly")}
            >
              <Text style={[styles.modeText, mode === "monthly" && styles.modeTextActive]}>Monthly</Text>
            </TouchableOpacity>
          </View>

          {mode === "monthly" ? (
            <View style={styles.periodRow}>
              <TouchableOpacity style={styles.periodArrow} onPress={() => changeMonth(-1)}>
                <Text style={styles.periodArrowText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.periodLabel}>
                📅 {MONTH_NAMES[month - 1]} {year}
              </Text>
              <TouchableOpacity style={styles.periodArrow} onPress={() => changeMonth(1)}>
                <Text style={styles.periodArrowText}>›</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.periodRow}>
              <View style={{ flex: 1 }}>
                <DateField label="" value={date} onChange={setDate} />
              </View>
            </View>
          )}

          <View style={styles.summaryCard}>
            <View style={styles.summaryStatRow}>
              <View style={styles.summaryStat}>
                <Text style={styles.summaryStatValue}>{totalLabourers}</Text>
                <Text style={styles.summaryStatLabel}>Labourers Contributed</Text>
              </View>
              <View style={styles.summaryStat}>
                <Text style={styles.summaryStatValue}>₹{totalAmount.toFixed(0)}</Text>
                <Text style={styles.summaryStatLabel}>{mode === "monthly" ? "Total Net Wage" : "Total Labour Cost"}</Text>
              </View>
            </View>
          </View>

          {rows.length > 0 && (
            <View style={styles.chartCard}>
              <DonutChart slices={slices} />
              <View style={styles.legend}>
                {rows.map((r, i) => (
                  <View key={r.workerId} style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }]} />
                    <Text style={styles.legendName} numberOfLines={1}>
                      {r.workerName}
                    </Text>
                    <Text style={styles.legendPercent}>{totalAmount > 0 ? ((r.amount / totalAmount) * 100).toFixed(0) : 0}%</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {noRateCount > 0 && (
            <Text style={styles.noRateNote}>
              {noRateCount} worker{noRateCount === 1 ? "" : "s"} have no wage rate set and aren't included above.
            </Text>
          )}

          <Text style={styles.sectionLabel}>{mode === "monthly" ? "Net wage by worker" : "Cost by worker"}</Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          {mode === "monthly" ? "No workers with a wage rate and activity this month." : "No workers present on this date."}
        </Text>
      }
      renderItem={({ item }) => (
        <View style={styles.workerRow}>
          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={() => (mode === "monthly" ? openDetail(item.workerId) : undefined)}
            disabled={mode !== "monthly"}
          >
            <Text style={styles.workerName}>{item.workerName}</Text>
            <Text style={styles.workerAmount}>₹{item.amount.toFixed(2)}</Text>
            {mode === "monthly" && <Text style={styles.workerDetailLink}>View calculation →</Text>}
          </TouchableOpacity>
          {mode === "monthly" &&
            (item.paid ? (
              <View style={styles.paidBadge}>
                <Text style={styles.paidBadgeText}>Paid</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.recordButton} onPress={() => openPaymentModal(item.workerId, item.workerName)}>
                <Text style={styles.recordButtonText}>Record Payment</Text>
              </TouchableOpacity>
            ))}
        </View>
      )}
      ListFooterComponent={
        <Modal visible={paymentTarget !== null} transparent animationType="fade" onRequestClose={() => setPaymentTarget(null)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Record payment</Text>
              <Text style={styles.modalSubtitle}>{paymentTarget?.workerName}</Text>
              <DateField label="Date of payment" value={paymentDate} onChange={setPaymentDate} />
              <Text style={styles.modalLabel}>Bank transaction ID / reference</Text>
              <TextInput
                style={styles.modalInput}
                value={paymentReference}
                onChangeText={setPaymentReference}
                placeholder="Optional"
                placeholderTextColor={colors.muted}
              />
              <View style={styles.modalButtonRow}>
                <TouchableOpacity style={styles.modalCancelButton} onPress={() => setPaymentTarget(null)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirmButton, savingPayment && { opacity: 0.6 }]}
                  onPress={handleRecordPayment}
                  disabled={savingPayment}
                >
                  {savingPayment ? <ActivityIndicator color={colors.white} /> : <Text style={styles.modalConfirmText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      }
    />

    <Modal visible={detailTarget !== null} transparent animationType="fade" onRequestClose={() => setDetailTarget(null)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          {detailTarget && (
            <>
              <Text style={styles.modalTitle}>{detailTarget.worker_name}</Text>
              <Text style={styles.modalSubtitle}>
                {MONTH_NAMES[month - 1]} {year} · ₹{detailTarget.rate_amount.toFixed(2)}/{detailTarget.rate_type}
              </Text>

              <View style={styles.daysRow}>
                <View style={[styles.dayStat, { backgroundColor: colors.tealLight }]}>
                  <Text style={[styles.dayStatValue, { color: "#0F6E56" }]}>{detailTarget.days_worked}</Text>
                  <Text style={styles.dayStatLabel}>Days Worked</Text>
                </View>
                <View style={[styles.dayStat, { backgroundColor: colors.dangerLight }]}>
                  <Text style={[styles.dayStatValue, { color: colors.danger }]}>{detailTarget.days_absent}</Text>
                  <Text style={styles.dayStatLabel}>Days Absent</Text>
                </View>
              </View>

              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailLabel}>Basic Wages</Text>
                  <Text style={styles.detailFormula}>
                    {detailTarget.rate_type === "daily"
                      ? `${detailTarget.days_worked} days × ₹${detailTarget.rate_amount.toFixed(2)}`
                      : `₹${detailTarget.rate_amount.toFixed(2)} / month`}
                  </Text>
                </View>
                <Text style={styles.detailValue}>₹{detailTarget.basic_wage.toFixed(2)}</Text>
              </View>
              {[
                ["Dearness Allowance", detailTarget.da],
                ["House Rent Allowance", detailTarget.hra],
                ["Other Allowances", detailTarget.other_allowances],
                ["Overtime Wages", detailTarget.ot_wages],
                ["Leave Wages", detailTarget.leave_wages],
              ].map(([label, value]) => (
                <View key={label as string} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{label}</Text>
                  <Text style={styles.detailValue}>₹{(value as number).toFixed(2)}</Text>
                </View>
              ))}
              <View style={styles.detailRowTotal}>
                <Text style={styles.detailLabelBold}>Gross Wages</Text>
                <Text style={styles.detailValueBold}>₹{detailTarget.gross_wage.toFixed(2)}</Text>
              </View>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailLabel}>Provident Fund</Text>
                  <Text style={styles.detailFormula}>
                    {detailTarget.pf_rate}% of ₹{detailTarget.pf_base.toFixed(2)} (Basic+DA)
                  </Text>
                </View>
                <Text style={styles.detailValueNegative}>-₹{detailTarget.pf.toFixed(2)}</Text>
              </View>
              <View style={styles.detailRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailLabel}>Employees State Insurance</Text>
                  <Text style={styles.detailFormula}>
                    {detailTarget.esi_rate}% of ₹{detailTarget.esi_base.toFixed(2)} (Gross)
                  </Text>
                </View>
                <Text style={styles.detailValueNegative}>-₹{detailTarget.esi.toFixed(2)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Labour Welfare Fund</Text>
                <Text style={styles.detailValueNegative}>-₹{detailTarget.lwf.toFixed(2)}</Text>
              </View>
              <View style={styles.detailDivider} />
              <View style={styles.detailRowTotal}>
                <Text style={styles.detailLabelBold}>Net Wages</Text>
                <Text style={[styles.detailValueBold, { color: colors.teal }]}>₹{detailTarget.net_wage.toFixed(2)}</Text>
              </View>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setDetailTarget(null)}>
                <Text style={styles.modalCancelText}>Close</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy, marginBottom: spacing.md },
  modeRow: { flexDirection: "row", backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: 4, marginBottom: spacing.md },
  modeButton: { flex: 1, paddingVertical: spacing.sm + 2, alignItems: "center", borderRadius: radius.sm - 2 },
  modeButtonActive: { backgroundColor: colors.teal },
  modeText: { fontSize: 14, fontWeight: "700", color: colors.muted },
  modeTextActive: { color: colors.white },
  periodRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  periodArrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.fieldBg, alignItems: "center", justifyContent: "center" },
  periodArrowText: { fontSize: 18, fontWeight: "700", color: colors.navy },
  periodLabel: { fontSize: 15, fontWeight: "700", color: colors.navy },
  summaryCard: { backgroundColor: colors.navy, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  summaryStatRow: { flexDirection: "row" },
  summaryStat: { flex: 1, alignItems: "center" },
  summaryStatValue: { color: colors.white, fontSize: 24, fontWeight: "700" },
  summaryStatLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 4, textAlign: "center" },
  chartCard: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginBottom: spacing.md,
  },
  legend: { width: "100%", marginTop: spacing.md },
  legendRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.xs },
  legendName: { flex: 1, fontSize: 12, color: colors.navy, fontWeight: "600" },
  legendPercent: { fontSize: 12, color: colors.muted, fontWeight: "700" },
  noRateNote: { fontSize: 11, color: colors.muted, marginBottom: spacing.sm, fontStyle: "italic" },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.navy, marginTop: spacing.sm, marginBottom: spacing.xs },
  empty: { textAlign: "center", color: colors.muted, marginTop: 40 },
  workerRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: spacing.sm + 4,
    marginBottom: spacing.xs,
  },
  workerName: { fontSize: 14, fontWeight: "700", color: colors.navy },
  workerAmount: { fontSize: 16, fontWeight: "700", color: colors.teal, marginTop: 2 },
  workerDetailLink: { fontSize: 11, color: colors.skyBlue, fontWeight: "700", marginTop: 4 },
  daysRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  dayStat: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
  dayStatValue: { fontSize: 20, fontWeight: "700" },
  dayStatLabel: { fontSize: 10, color: colors.muted, marginTop: 2, fontWeight: "600" },
  detailFormula: { fontSize: 10, color: colors.muted, marginTop: 1 },
  detailDivider: { height: 1, backgroundColor: colors.fieldBg, marginVertical: spacing.sm },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  detailLabel: { fontSize: 13, color: colors.muted },
  detailValue: { fontSize: 13, color: colors.navy, fontWeight: "600" },
  detailValueNegative: { fontSize: 13, color: colors.danger, fontWeight: "600" },
  detailRowTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  detailLabelBold: { fontSize: 14, color: colors.navy, fontWeight: "700" },
  detailValueBold: { fontSize: 14, color: colors.navy, fontWeight: "700" },
  paidBadge: { backgroundColor: colors.tealLight, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  paidBadgeText: { color: "#0F6E56", fontSize: 12, fontWeight: "700" },
  recordButton: { backgroundColor: colors.teal, borderRadius: radius.sm, paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm },
  recordButtonText: { color: colors.white, fontSize: 12, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  modalCard: { backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.lg, width: "85%" },
  modalTitle: { fontSize: 17, fontWeight: "700", color: colors.navy },
  modalSubtitle: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  modalLabel: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs, marginTop: spacing.sm },
  modalInput: { backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: 12, fontSize: 14, color: colors.navy },
  modalButtonRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  modalCancelButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.fieldBg },
  modalCancelText: { color: colors.muted, fontWeight: "700" },
  modalConfirmButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.teal },
  modalConfirmText: { color: colors.white, fontWeight: "700" },
});
