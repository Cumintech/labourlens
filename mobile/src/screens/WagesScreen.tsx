import { useFocusEffect, useRoute } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
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
import ErrorState from "../components/ErrorState";
import { ListSkeleton } from "../components/Skeleton";
import { SegmentedControl } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing, type } from "../theme";
import { workerLabel } from "../workerLabel";

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };
type Segment = "payroll" | "rates";
type PayrollMode = "daily" | "monthly";

const SLICE_COLORS = [
  colors.primary, colors.skyBlue, colors.violet, colors.warning,
  colors.coral, colors.danger, colors.primaryPressed, "#2B4C7E",
];

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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={type.display}>Wages</Text>
        <View style={styles.segmentWrap}>
          <SegmentedControl<Segment>
            options={[
              { label: "Payroll", value: "payroll" },
              { label: "Rates", value: "rates" },
            ]}
            value={segment}
            onChange={setSegment}
          />
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
type Row = { workerId: number; workerName: string; amount: number; hasRate: boolean; paid?: boolean; present?: boolean };

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

  const slices = rows.map((r, i) => ({ value: r.amount, color: SLICE_COLORS[i % SLICE_COLORS.length] }));
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
                {MONTH_NAMES[month - 1]} {year}
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

          {mode === "monthly" && unpaidCount > 0 && (
            <TouchableOpacity
              style={styles.bulkButton}
              onPress={() => {
                setBulkPaymentDate(todayString());
                setBulkPaymentOpen(true);
              }}
            >
              <Text style={styles.bulkButtonText}>Record Payment for All ({unpaidCount})</Text>
            </TouchableOpacity>
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
          {mode === "monthly" && (
            <TouchableOpacity
              style={[styles.recordButton, item.paid && styles.recordButtonDisabled]}
              onPress={() => openPaymentModal(item.workerId, item.workerName)}
              disabled={item.paid}
            >
              <Text style={[styles.recordButtonText, item.paid && styles.recordButtonTextDisabled]}>
                {item.paid ? "Paid" : "Record Payment"}
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
                {MONTH_NAMES[month - 1]} {year} · ₹{detailTarget.rate_amount.toFixed(2)}/{detailTarget.rate_type}
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
                <Text style={[styles.detailValueBold, { color: colors.primary }]}>₹{detailTarget.net_wage.toFixed(2)}</Text>
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
        <>
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.typesLink} onPress={() => navigation.navigate("WorkerTypes")}>
              <Text style={styles.typesLinkText}>Worker Types →</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.infoNote}>
            <Text style={styles.infoNoteText}>
              If a worker's device ID isn't mapped yet, their attendance won't be clocked automatically from the fingerprint
              machine — map them from the Biometric Mapping screen.
            </Text>
          </View>
        </>
      }
      ListEmptyComponent={<Text style={styles.empty}>No active workers yet.</Text>}
      renderItem={({ item }) => {
        const wtype = workerTypes.find((t) => t.id === item.worker_type_id);
        const rate = rates[item.id];
        return (
          <TouchableOpacity
            style={styles.row}
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
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{workerLabel(item)}</Text>
              <Text style={styles.meta}>
                {wtype ? wtype.name : "No type"} · {rate ? `₹${rate.basic} / ${rate.rate_type === "daily" ? "day" : "month"}` : "no rate set"}
              </Text>
            </View>
            <View style={[styles.dot, item.device_user_id ? styles.dotGreen : styles.dotAmber]} />
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  header: { backgroundColor: colors.surface, padding: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  segmentWrap: { marginTop: spacing.md },
  viewContainer: { flex: 1, backgroundColor: colors.ground },

  // Payroll
  modeRow: { flexDirection: "row", backgroundColor: colors.ground, borderRadius: radius.sm, padding: 4, marginBottom: spacing.md },
  modeButton: { flex: 1, paddingVertical: spacing.sm + 2, alignItems: "center", borderRadius: radius.sm - 2 },
  modeButtonActive: { backgroundColor: colors.primary },
  modeText: { fontSize: 14, fontWeight: "700", color: colors.textSecondary },
  modeTextActive: { color: colors.surface },
  periodRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  periodArrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  periodArrowText: { fontSize: 18, fontWeight: "700", color: colors.navy },
  periodLabel: { fontSize: 15, fontWeight: "700", color: colors.navy },
  summaryCard: { backgroundColor: colors.navy, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  summaryStatRow: { flexDirection: "row" },
  summaryStat: { flex: 1, alignItems: "center" },
  summaryStatValue: { color: colors.surface, fontSize: 24, fontWeight: "700" },
  summaryStatLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 4, textAlign: "center" },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginBottom: spacing.md,
  },
  legend: { width: "100%", marginTop: spacing.md },
  legendRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.xs },
  legendName: { flex: 1, fontSize: 12, color: colors.navy, fontWeight: "600" },
  legendPercent: { fontSize: 12, color: colors.textSecondary, fontWeight: "700" },
  noRateNote: { fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm, fontStyle: "italic" },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.navy, marginTop: spacing.sm, marginBottom: spacing.xs },
  empty: { textAlign: "center", color: colors.textSecondary, marginTop: 40 },
  workerRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.sm + 4,
    marginBottom: spacing.xs,
  },
  workerName: { fontSize: 14, fontWeight: "700", color: colors.navy },
  workerAmount: { fontSize: 16, fontWeight: "700", color: colors.primary, marginTop: 2 },
  workerDetailLink: { fontSize: 11, color: colors.skyBlue, fontWeight: "700", marginTop: 4 },
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
  recordButton: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm },
  recordButtonText: { color: colors.surface, fontSize: 12, fontWeight: "700" },
  recordButtonDisabled: { backgroundColor: colors.ground },
  recordButtonTextDisabled: { color: colors.textSecondary },
  bulkButton: {
    backgroundColor: colors.navy,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 2,
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  bulkButtonText: { color: colors.surface, fontSize: 13, fontWeight: "700" },
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
  headerRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", marginBottom: spacing.sm },
  typesLink: { paddingVertical: spacing.xs },
  typesLinkText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  infoNote: { backgroundColor: colors.primaryTint, borderRadius: radius.sm, padding: spacing.sm + 4, marginBottom: spacing.md },
  infoNoteText: { color: colors.primaryPressed, fontSize: 12, lineHeight: 17 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.sm + 4,
    marginBottom: spacing.xs,
  },
  name: { fontSize: 15, fontWeight: "700", color: colors.navy },
  meta: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  dotGreen: { backgroundColor: colors.primary },
  dotAmber: { backgroundColor: colors.warning },
  arrow: { fontSize: 22, color: colors.textSecondary },
});
