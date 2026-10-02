import { useFocusEffect, useRoute } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Briefcase, Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ApiError,
  DailyWageSummary,
  WageProfile,
  WageSummary,
  Worker,
  WorkerType,
  WorkerWage,
  getDailyWageSummary,
  getWageProfile,
  getWageSummary,
  listWorkerTypes,
  listWorkers,
  recordWagePayment,
} from "../api/client";
import DateField, { isoDate } from "../components/DateField";
import DonutChart from "../components/DonutChart";
import WagesHeroArt from "../components/WagesHeroArt";
import ErrorState from "../components/ErrorState";
import { ListSkeleton } from "../components/Skeleton";
import { Avatar, BlueHeader, SegmentedControl } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { formatINR } from "../format";
import { colors, radius, spacing, type } from "../theme";
import { workerLabel } from "../workerLabel";

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };
type Segment = "payroll" | "rates";
type PayrollMode = "daily" | "monthly";

// Wage-split chart palette: brand blues alternating with oranges (no red).
const SLICE_COLORS = ["#1565C0", "#F57C00", "#42A5F5", "#FFB74D", "#0D47A1", "#EF6C00", "#90CAF9", "#FFCC80"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function todayString() {
  return isoDate(new Date());
}

// Merges the old standalone WageCalculationScreen (Payroll: a period's
// total cost + per-worker breakdown + record-payment) and
// WageRateWorkersScreen (Rates: each active worker's assigned type and
// current rate) into one Wages tab with a Payroll|Rates
// SegmentedControl, per the v2 redesign spec -- Rates is no longer a
// standalone destination.
export default function WagesScreen({ navigation }: Props) {
  const route = useRoute<{ key: string; name: string; params?: { segment?: Segment } }>();
  const [segment, setSegment] = useState<Segment>(route.params?.segment === "rates" ? "rates" : "payroll");
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.heroArt} pointerEvents="none">
          <WagesHeroArt width={156} height={115} />
        </View>
        <Text style={styles.heroTitle} accessibilityRole="header">Wages</Text>
        <Text style={styles.heroSubtitle}>Fair pay, on time</Text>
        <View style={styles.heroPill} accessibilityRole="tablist">
          {(["payroll", "rates"] as Segment[]).map((sg) => (
            <TouchableOpacity
              key={sg}
              style={[styles.heroPillOption, segment === sg && styles.heroPillOptionActive]}
              onPress={() => setSegment(sg)}
              accessibilityRole="tab"
              accessibilityState={{ selected: segment === sg }}
            >
              <Text style={[styles.heroPillText, segment === sg && styles.heroPillTextActive]}>{sg === "payroll" ? "Payroll" : "Rates"}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {segment === "payroll" ? <PayrollView /> : <RatesView navigation={navigation} />}
    </View>
  );
}

// ---------------------------------------------------------------------
// Payroll -- ported from the old WageCalculationScreen.tsx verbatim,
// minus its own "Wage Calculation" title (the shared header above
// already reads "Wages").
// ---------------------------------------------------------------------
type Row = { workerId: number; workerName: string; name: string; code: string; amount: number; hasRate: boolean; paid?: boolean; present?: boolean };

function PayrollView() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const today = useMemo(() => new Date(), []);
  const [mode, setMode] = useState<PayrollMode>("monthly");
  const [date, setDate] = useState(todayString());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [monthlySummary, setMonthlySummary] = useState<WageSummary | null>(null);
  const [dailySummary, setDailySummary] = useState<DailyWageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [paymentTarget, setPaymentTarget] = useState<{ workerId: number; workerName: string } | null>(null);
  const [paymentDate, setPaymentDate] = useState(todayString());
  const [paymentReference, setPaymentReference] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);

  const [bulkPaymentOpen, setBulkPaymentOpen] = useState(false);
  const [bulkPaymentDate, setBulkPaymentDate] = useState(todayString());
  const [savingBulkPayment, setSavingBulkPayment] = useState(false);

  const [detailTarget, setDetailTarget] = useState<WorkerWage | null>(null);
  const [split, setSplit] = useState<"worker" | "type">("worker");
  // Worker id -> worker type name, only for the "By type" chart split.
  // Read-only lookup; a failure just leaves the type split as "No type set".
  const [typeByWorker, setTypeByWorker] = useState<Record<number, string>>({});

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
      if (token) {
        Promise.all([listWorkers(token), listWorkerTypes(token)])
          .then(([ws, types]) => {
            const names = Object.fromEntries(types.map((t) => [t.id, t.name]));
            setTypeByWorker(Object.fromEntries(ws.map((w) => [w.id, (w.worker_type_id && names[w.worker_type_id]) || ""])));
          })
          .catch(() => {});
      }
    }, [token]),
  );

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .then(() => setLoadError(false))
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false));
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
      setLoadError(false);
    } catch {
      // Keep whatever's already on screen -- see other screens' identical note.
    } finally {
      setRefreshing(false);
    }
  }

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

  async function handleBulkRecordPayment() {
    if (!token) return;
    const unpaid = rows.filter((r) => r.hasRate && !r.paid);
    if (unpaid.length === 0) return;
    setSavingBulkPayment(true);
    try {
      await Promise.all(
        unpaid.map((r) =>
          recordWagePayment(token, r.workerId, {
            month,
            year,
            date_of_payment: bulkPaymentDate.trim() || undefined,
          }),
        ),
      );
      setBulkPaymentOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert("Could not record payment for all", e?.message ?? "Please try again.");
    } finally {
      setSavingBulkPayment(false);
    }
  }

  const rows: Row[] = useMemo(() => {
    if (mode === "monthly" && monthlySummary) {
      return monthlySummary.workers
        .filter((w) => w.has_rate)
        .sort((a, b) => b.net_wage - a.net_wage)
        .map((w) => ({
          workerId: w.worker_id,
          workerName: `${w.worker_name} (${w.numeric_employee_code ? `#${w.numeric_employee_code}` : "no code yet"})`,
          name: w.worker_name,
          code: w.numeric_employee_code ? `#${w.numeric_employee_code}` : "no code yet",
          amount: w.net_wage,
          hasRate: true,
          paid: w.paid,
        }));
    }
    if (mode === "daily" && dailySummary) {
      return dailySummary.workers
        .filter((w) => w.present)
        .sort((a, b) => b.daily_cost - a.daily_cost)
        .map((w) => ({
          workerId: w.worker_id,
          workerName: `${w.worker_name} (${w.numeric_employee_code ? `#${w.numeric_employee_code}` : "no code yet"})`,
          name: w.worker_name,
          code: w.numeric_employee_code ? `#${w.numeric_employee_code}` : "no code yet",
          amount: w.daily_cost,
          hasRate: w.has_rate,
          present: w.present,
        }));
    }
    return [];
  }, [mode, monthlySummary, dailySummary]);

  const noRateCount =
    mode === "monthly" && monthlySummary ? monthlySummary.workers.filter((w) => !w.has_rate).length : 0;
  const totalLabourers = mode === "monthly" ? monthlySummary?.total_workers ?? 0 : dailySummary?.total_workers_present ?? 0;
  const totalAmount = mode === "monthly" ? monthlySummary?.total_net ?? 0 : dailySummary?.total_daily_cost ?? 0;

  // Chart split: per worker (top 5 + Others) or per worker type.
  const chartItems = useMemo(() => {
    const positive = rows.filter((r) => r.amount > 0);
    let items: { label: string; value: number }[];
    if (split === "type") {
      const byType = new Map<string, number>();
      for (const r of positive) {
        const t = typeByWorker[r.workerId] || "No type set";
        byType.set(t, (byType.get(t) ?? 0) + r.amount);
      }
      items = [...byType.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    } else {
      items = positive.map((r) => ({ label: r.name, value: r.amount }));
    }
    if (items.length > 6) {
      const rest = items.slice(5).reduce((sum, i) => sum + i.value, 0);
      items = [...items.slice(0, 5), { label: "Others", value: rest }];
    }
    return items.map((it, i) => ({ ...it, color: SLICE_COLORS[i % SLICE_COLORS.length] }));
  }, [rows, split, typeByWorker]);
  const chartTotal = chartItems.reduce((sum, i) => sum + i.value, 0);
  const earningCount = rows.filter((r) => r.amount > 0).length;
  const zeroCount = rows.length - earningCount;
  const unpaidCount = rows.filter((r) => r.hasRate && !r.paid).length;

  if (loading || !token) {
    return (
      <View style={styles.viewContainer}>
        <ListSkeleton rows={4} variant="simple" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.viewContainer}>
        <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />
      </View>
    );
  }

  return (
    <>
    <FlatList
      style={styles.viewContainer}
      data={rows}
      keyExtractor={(r) => String(r.workerId)}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl + insets.bottom }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      ListHeaderComponent={
        <View>
          <View style={styles.periodBar}>
            <View style={styles.modeRow}>
              {(["daily", "monthly"] as PayrollMode[]).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modeButton, mode === m && styles.modeButtonActive]}
                  onPress={() => setMode(m)}
                  accessibilityState={{ selected: mode === m }}
                >
                  <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{m === "daily" ? "Daily" : "Monthly"}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {mode === "monthly" && (
              <View style={styles.periodNav}>
                <TouchableOpacity style={styles.periodArrow} onPress={() => changeMonth(-1)} accessibilityLabel="Previous month">
                  <ChevronLeft size={16} color={colors.primary} />
                </TouchableOpacity>
                <Text style={styles.periodLabel}>
                  {MONTH_NAMES[month - 1].slice(0, 3)} {year}
                </Text>
                <TouchableOpacity style={styles.periodArrow} onPress={() => changeMonth(1)} accessibilityLabel="Next month">
                  <ChevronRight size={16} color={colors.primary} />
                </TouchableOpacity>
              </View>
            )}
          </View>
          {mode === "daily" && <DateField label="" value={date} onChange={setDate} />}

          <View style={styles.summaryCard}>
            <View style={styles.summaryTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryCaption}>
                  {mode === "monthly" ? `Total net wage · ${MONTH_NAMES[month - 1]}` : "Total labour cost"}
                </Text>
                <Text style={styles.summaryAmount}>₹{formatINR(totalAmount)}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.summaryCount}>{totalLabourers}</Text>
                <Text style={styles.summaryCountLabel}>{mode === "monthly" ? "workers" : "present"}</Text>
              </View>
            </View>
            {mode === "monthly" && unpaidCount > 0 && (
              <TouchableOpacity
                style={styles.bulkButton}
                onPress={() => {
                  setBulkPaymentDate(todayString());
                  setBulkPaymentOpen(true);
                }}
              >
                <Check size={18} color={colors.primaryDark} strokeWidth={2.6} />
                <Text style={styles.bulkButtonText}>Record payment for all ({unpaidCount})</Text>
              </TouchableOpacity>
            )}
          </View>

          {chartItems.length > 0 && (
            <View style={styles.chartCard}>
              <View style={styles.chartHeader}>
                <Text style={styles.chartTitle}>Wage split</Text>
                <View style={styles.splitToggle} accessibilityRole="tablist">
                  {(["worker", "type"] as const).map((k) => (
                    <TouchableOpacity
                      key={k}
                      style={[styles.splitOption, split === k && styles.splitOptionActive]}
                      onPress={() => setSplit(k)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: split === k }}
                    >
                      <Text style={[styles.splitText, split === k && styles.splitTextActive]}>{k === "worker" ? "By worker" : "By type"}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.chartBody}>
                <View style={styles.donutWrap}>
                  <DonutChart slices={chartItems.map((c) => ({ value: c.value, color: c.color }))} size={132} strokeWidth={20} />
                  <View style={styles.donutCenter} pointerEvents="none">
                    <Text style={styles.donutCenterValue}>
                      {split === "worker" ? `${earningCount} of ${rows.length}` : chartItems.length}
                    </Text>
                    <Text style={styles.donutCenterLabel}>{split === "worker" ? "earning" : chartItems.length === 1 ? "type" : "types"}</Text>
                  </View>
                </View>
                <View style={styles.legend}>
                  {chartItems.map((c) => (
                    <View key={c.label} style={styles.legendRow}>
                      <View style={[styles.legendDot, { backgroundColor: c.color }]} />
                      <Text style={styles.legendName} numberOfLines={1}>{c.label}</Text>
                      <Text style={styles.legendPercent}>{chartTotal > 0 ? Math.round((c.value / chartTotal) * 100) : 0}%</Text>
                    </View>
                  ))}
                  {split === "worker" && zeroCount > 0 && (
                    <Text style={styles.legendNote}>
                      {zeroCount} worker{zeroCount === 1 ? "" : "s"} at ₹0 {mode === "monthly" ? "this month" : "today"}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          )}

          {noRateCount > 0 && (
            <Text style={styles.noRateNote}>
              {noRateCount} worker{noRateCount === 1 ? "" : "s"} {noRateCount === 1 ? "has" : "have"} no wage rate set and {noRateCount === 1 ? "isn't" : "aren't"} included above.
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
      renderItem={({ item, index }) => (
        <View style={[styles.workerRow, index === 0 && styles.workerRowFirst, index === rows.length - 1 && styles.workerRowLast, index > 0 && styles.workerRowDivider]}>
          <Avatar workerId={item.workerId} name={item.name} size={40} />
          <TouchableOpacity
            style={{ flex: 1, minWidth: 0 }}
            onPress={() => (mode === "monthly" ? openDetail(item.workerId) : undefined)}
            disabled={mode !== "monthly"}
          >
            <View style={styles.workerTopLine}>
              <Text style={styles.workerName} numberOfLines={1}>
                {item.name} <Text style={styles.workerCode}>{item.code}</Text>
              </Text>
              <Text style={styles.workerAmount}>₹{formatINR(item.amount)}</Text>
            </View>
            {mode === "monthly" && <Text style={styles.workerDetailLink}>View calculation ›</Text>}
          </TouchableOpacity>
          {mode === "monthly" && (
            <TouchableOpacity
              style={[styles.recordButton, item.paid && styles.recordButtonDisabled]}
              onPress={() => openPaymentModal(item.workerId, item.workerName)}
              disabled={item.paid}
              accessibilityLabel={item.paid ? "Paid" : `Record payment for ${item.name}`}
            >
              <Text style={[styles.recordButtonText, item.paid && styles.recordButtonTextDisabled]}>
                {item.paid ? "Paid" : "Pay"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      ListFooterComponent={
        <>
        <Modal visible={bulkPaymentOpen} transparent animationType="fade" onRequestClose={() => setBulkPaymentOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Record payment for all</Text>
              <Text style={styles.modalSubtitle}>
                Marks all {unpaidCount} unpaid worker{unpaidCount === 1 ? "" : "s"} for {MONTH_NAMES[month - 1]} {year} as paid.
              </Text>
              <DateField label="Date of payment" value={bulkPaymentDate} onChange={setBulkPaymentDate} />
              <View style={styles.modalButtonRow}>
                <TouchableOpacity style={styles.modalCancelButton} onPress={() => setBulkPaymentOpen(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirmButton, savingBulkPayment && { opacity: 0.6 }]}
                  onPress={handleBulkRecordPayment}
                  disabled={savingBulkPayment}
                >
                  {savingBulkPayment ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.modalConfirmText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
                placeholderTextColor={colors.textSecondary}
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
                  {savingPayment ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.modalConfirmText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        </>
      }
    />

    <Modal visible={detailTarget !== null} transparent animationType="fade" onRequestClose={() => setDetailTarget(null)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          {detailTarget && (
            <>
              <Text style={styles.modalTitle}>{detailTarget.worker_name}</Text>
              <Text style={styles.modalSubtitle}>
                {MONTH_NAMES[month - 1]} {year} · ₹{formatINR(detailTarget.rate_amount)}/{detailTarget.rate_type}
              </Text>

              <View style={styles.daysRow}>
                <View style={[styles.dayStat, { backgroundColor: colors.presentTint }]}>
                  <Text style={[styles.dayStatValue, { color: colors.present }]}>{detailTarget.days_worked}</Text>
                  <Text style={styles.dayStatLabel}>Days Worked</Text>
                </View>
                <View style={[styles.dayStat, { backgroundColor: colors.absentTint }]}>
                  <Text style={[styles.dayStatValue, { color: colors.absentTintText }]}>{detailTarget.days_absent}</Text>
                  <Text style={styles.dayStatLabel}>Days Absent</Text>
                </View>
              </View>

              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailLabel}>Basic Wages</Text>
                  <Text style={styles.detailFormula}>
                    {detailTarget.rate_type === "daily"
                      ? `${detailTarget.days_worked} days × ₹${formatINR(detailTarget.rate_amount)}`
                      : `₹${formatINR(detailTarget.rate_amount)} / month`}
                  </Text>
                </View>
                <Text style={styles.detailValue}>₹{formatINR(detailTarget.basic_wage)}</Text>
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
                  <Text style={styles.detailValue}>₹{formatINR((value as number))}</Text>
                </View>
              ))}
              <View style={styles.detailRowTotal}>
                <Text style={styles.detailLabelBold}>Gross Wages</Text>
                <Text style={styles.detailValueBold}>₹{formatINR(detailTarget.gross_wage)}</Text>
              </View>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailLabel}>Provident Fund</Text>
                  <Text style={styles.detailFormula}>
                    {detailTarget.pf_rate}% of ₹{formatINR(detailTarget.pf_base)} (Basic+DA)
                  </Text>
                </View>
                <Text style={styles.detailValueNegative}>-₹{formatINR(detailTarget.pf)}</Text>
              </View>
              <View style={styles.detailRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailLabel}>Employees State Insurance</Text>
                  <Text style={styles.detailFormula}>
                    {detailTarget.esi_rate}% of ₹{formatINR(detailTarget.esi_base)} (Gross)
                  </Text>
                </View>
                <Text style={styles.detailValueNegative}>-₹{formatINR(detailTarget.esi)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Labour Welfare Fund</Text>
                <Text style={styles.detailValueNegative}>-₹{formatINR(detailTarget.lwf)}</Text>
              </View>
              <View style={styles.detailDivider} />
              <View style={styles.detailRowTotal}>
                <Text style={styles.detailLabelBold}>Net Wages</Text>
                <Text style={[styles.detailValueBold, { color: colors.primary }]}>₹{formatINR(detailTarget.net_wage)}</Text>
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

// ---------------------------------------------------------------------
// Rates -- ported from the old WageRateWorkersScreen.tsx verbatim,
// minus its own "Wage Rate" title (the shared header above already
// reads "Wages"). Navigates into the Worker Profile hub's Wages tab
// instead of the deleted WageRateWorkerDetail screen.
// ---------------------------------------------------------------------
function byEmployeeIdAscending(a: Worker, b: Worker): number {
  const aCode = a.numeric_employee_code ? parseInt(a.numeric_employee_code, 10) : Infinity;
  const bCode = b.numeric_employee_code ? parseInt(b.numeric_employee_code, 10) : Infinity;
  return aCode - bCode;
}

function RatesView({ navigation }: { navigation: NativeStackNavigationProp<RootStackParamList> }) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [workerTypes, setWorkerTypes] = useState<WorkerType[]>([]);
  const [rates, setRates] = useState<Record<number, WageProfile | null>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const [w, types] = await Promise.all([listWorkers(token), listWorkerTypes(token)]);
    const active = w.filter((worker) => worker.status === "active").sort(byEmployeeIdAscending);
    setWorkers(active);
    setWorkerTypes(types);
    const rateEntries = await Promise.all(
      active.map(async (worker): Promise<[number, WageProfile | null]> => {
        try {
          return [worker.id, await getWageProfile(token, worker.id)];
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return [worker.id, null]; // no rate set yet -- not an error
          throw e;
        }
      }),
    );
    setRates(Object.fromEntries(rateEntries));
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load()
        .then(() => setLoadError(false))
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false));
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
      setLoadError(false);
    } catch {
      // Keep whatever's already on screen -- see other screens' identical note.
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.viewContainer}>
        <ListSkeleton rows={5} variant="simple" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.viewContainer}>
        <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.viewContainer}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
      data={workers}
      keyExtractor={(w) => String(w.id)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 12 }}>
          <TouchableOpacity style={styles.typesCard} onPress={() => navigation.navigate("WorkerTypes")} accessibilityRole="button">
            <View style={styles.typesIcon}>
              <Briefcase size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.typesTitle}>Worker types &amp; default rates</Text>
              <Text style={styles.typesSub} numberOfLines={1}>
                {workerTypes.length ? workerTypes.map((t) => t.name).join(", ") : "Set up types like Carpenter, Helper"}
              </Text>
            </View>
            <ChevronRight size={16} color={colors.disabled} />
          </TouchableOpacity>
          <Text style={styles.sectionLabel}>Rate by worker</Text>
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>No active workers yet.</Text>}
      renderItem={({ item, index }) => {
        const wtype = workerTypes.find((t) => t.id === item.worker_type_id);
        const rate = rates[item.id];
        return (
          <TouchableOpacity
            style={[styles.row, index === 0 && styles.workerRowFirst, index === workers.length - 1 && styles.workerRowLast, index > 0 && styles.workerRowDivider]}
            onPress={() =>
              navigation.navigate("WorkerProfile", {
                workerId: item.id,
                workerName: item.name,
                workerStatus: item.status,
                deactivatedAt: item.deactivated_at,
                initialTab: "wages",
              })
            }
          >
            <Avatar workerId={item.id} name={item.name} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name} <Text style={styles.workerCode}>{item.numeric_employee_code ? `#${item.numeric_employee_code}` : "no code yet"}</Text>
              </Text>
              {wtype ? (
                <Text style={styles.meta}>{wtype.name}</Text>
              ) : (
                <View style={styles.noTypePill}>
                  <Text style={styles.noTypePillText}>No type set</Text>
                </View>
              )}
            </View>
            <Text style={rate ? styles.rateValue : styles.rateMissing}>
              {rate ? `₹${formatINR(Number(rate.basic))}` : "No rate"}
              {rate ? <Text style={styles.rateUnit}> /{rate.rate_type === "daily" ? "day" : "month"}</Text> : null}
            </Text>
            <ChevronRight size={16} color={colors.disabled} />
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  hero: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: "hidden", minHeight: 150 },
  heroArt: { position: "absolute", right: 4, bottom: 0 },
  heroTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 26, color: colors.surface },
  heroSubtitle: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.onPrimaryMuted, marginTop: 2, marginBottom: spacing.sm + 4 },
  heroPill: { flexDirection: "row", alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.16)", borderRadius: radius.pill, padding: 3 },
  heroPillOption: { minHeight: 36, paddingHorizontal: 18, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  heroPillOptionActive: { backgroundColor: colors.surface },
  heroPillText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.surface },
  heroPillTextActive: { color: colors.primary },
  viewContainer: { flex: 1, backgroundColor: colors.ground },

  // Payroll
  periodBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginBottom: 12 },
  modeRow: { flexDirection: "row", backgroundColor: colors.primaryTint, borderRadius: 10, padding: 3 },
  modeButton: { height: 36, paddingHorizontal: 12, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  modeButtonActive: { backgroundColor: colors.primary },
  modeText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.textSecondary },
  modeTextActive: { color: colors.surface },
  periodNav: { flexDirection: "row", alignItems: "center", gap: 4 },
  periodArrow: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  periodLabel: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy, minWidth: 72, textAlign: "center" },
  summaryCard: { backgroundColor: colors.primary, borderRadius: 18, padding: spacing.md, gap: 14, marginBottom: 12, elevation: 4, shadowColor: colors.primaryDark, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  summaryTopRow: { flexDirection: "row", alignItems: "flex-end" },
  summaryCaption: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase", color: colors.onPrimaryMuted },
  summaryAmount: { fontFamily: "IBMPlexSans_700Bold", fontSize: 32, color: colors.surface, fontVariant: ["tabular-nums"] },
  summaryCount: { fontFamily: "IBMPlexSans_700Bold", fontSize: 20, color: colors.surface },
  summaryCountLabel: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 12, color: colors.onPrimaryMuted },
  chartCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12, marginBottom: 12 },
  chartHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chartTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.navy },
  splitToggle: { flexDirection: "row", backgroundColor: colors.primaryTint, borderRadius: 10, padding: 3 },
  splitOption: { height: 34, paddingHorizontal: 12, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  splitOptionActive: { backgroundColor: colors.surface },
  splitText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.textSecondary },
  splitTextActive: { color: colors.primary },
  chartBody: { flexDirection: "row", alignItems: "center", gap: 14 },
  donutWrap: { width: 132, height: 132, alignItems: "center", justifyContent: "center" },
  donutCenter: { position: "absolute", alignItems: "center" },
  donutCenterValue: { fontFamily: "IBMPlexSans_700Bold", fontSize: 17, color: colors.navy },
  donutCenterLabel: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 11, color: colors.textSecondary },
  legend: { flex: 1, minWidth: 0, gap: 8 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendName: { flex: 1, fontFamily: "IBMPlexSans_600SemiBold", fontSize: 13, color: colors.navy },
  legendPercent: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.textSecondary },
  legendNote: { fontFamily: "IBMPlexSans_500Medium", fontSize: 11, color: colors.disabled, marginTop: 2 },
  noRateNote: { fontSize: 12, color: colors.textSecondary, marginBottom: 12 },
  sectionLabel: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", color: colors.textSecondary, marginBottom: spacing.sm },
  empty: { textAlign: "center", color: colors.textSecondary, marginTop: 40 },
  workerRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  workerRowFirst: { borderTopWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  workerRowLast: { borderBottomWidth: 1, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  workerRowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  workerTopLine: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
  workerName: { flex: 1, fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy },
  workerCode: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary },
  workerAmount: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.navy, fontVariant: ["tabular-nums"] },
  workerDetailLink: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 12, color: colors.primary, marginTop: 4 },
  daysRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  dayStat: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
  dayStatValue: { fontSize: 20, fontWeight: "700" },
  dayStatLabel: { fontSize: 10, color: colors.textSecondary, marginTop: 2, fontWeight: "600" },
  detailFormula: { fontSize: 10, color: colors.textSecondary, marginTop: 1 },
  detailDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  detailLabel: { fontSize: 13, color: colors.textSecondary },
  detailValue: { fontSize: 13, color: colors.navy, fontWeight: "600" },
  detailValueNegative: { fontSize: 13, color: colors.danger, fontWeight: "600" },
  detailRowTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  detailLabelBold: { fontSize: 14, color: colors.navy, fontWeight: "700" },
  detailValueBold: { fontSize: 14, color: colors.navy, fontWeight: "700" },
  recordButton: { minWidth: 60, height: 40, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  recordButtonText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.surface },
  recordButtonDisabled: { backgroundColor: colors.presentTint },
  recordButtonTextDisabled: { color: colors.present },
  bulkButton: { height: 46, borderRadius: 12, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  bulkButtonText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.primaryDark },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, width: "85%" },
  modalTitle: { fontSize: 17, fontWeight: "700", color: colors.navy },
  modalSubtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
  modalLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.sm },
  modalInput: { backgroundColor: colors.ground, borderRadius: radius.sm, padding: 12, fontSize: 14, color: colors.navy },
  modalButtonRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  modalCancelButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.ground },
  modalCancelText: { color: colors.textSecondary, fontWeight: "700" },
  modalConfirmButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.primary },
  modalConfirmText: { color: colors.surface, fontWeight: "700" },

  // Rates
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  typesCard: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12 },
  typesIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryTint, alignItems: "center", justifyContent: "center" },
  typesTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy },
  typesSub: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  name: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy },
  meta: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  noTypePill: { alignSelf: "flex-start", backgroundColor: colors.leaveTint, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginTop: 3 },
  noTypePillText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 11, color: colors.warningTintText },
  rateValue: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.navy },
  rateUnit: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 11, color: colors.textSecondary },
  rateMissing: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.warningTintText },
});
