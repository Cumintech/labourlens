import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
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
import Avatar from "../components/Avatar";
import Button from "../components/Button";
import DateField, { isoDate } from "../components/DateField";
import ErrorState from "../components/ErrorState";
import Icon from "../components/Icon";
import ScreenHeader from "../components/ScreenHeader";
import SegmentedControl from "../components/SegmentedControl";
import { ListSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { formatINR, formatMonthYear } from "../format";
import { colors, font, radius, spacing } from "../theme";
import { workerLabel } from "../workerLabel";

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };
type Section = "payroll" | "rates";
type Period = "daily" | "monthly";

function todayString() {
  return isoDate(new Date());
}
function byEmployeeIdAscending(a: Worker, b: Worker): number {
  const aCode = a.numeric_employee_code ? parseInt(a.numeric_employee_code, 10) : Infinity;
  const bCode = b.numeric_employee_code ? parseInt(b.numeric_employee_code, 10) : Infinity;
  return aCode - bCode;
}

// Wages: Payroll (what's owed/paid this period, per worker) and Rates
// (each worker's standing pay rate) -- two previously separate screens,
// merged behind one segmented control since they're two views on the
// same underlying concept (a worker's pay), not two different features.
export default function WageCalculationScreen({ navigation }: Props) {
  const { token, owner } = useAuth();
  const insets = useSafeAreaInsets();
  const [section, setSection] = useState<Section>("payroll");

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]} stickyHeaderIndices={[]}>
        <ScreenHeader title="Wages" subtitle={owner?.factory_name} />
        <SegmentedControl
          options={[{ label: "Payroll", value: "payroll" }, { label: "Rates", value: "rates" }]}
          value={section}
          onChange={setSection}
          style={{ marginTop: spacing.md }}
        />
        {section === "payroll" ? <PayrollView navigation={navigation} /> : <RatesView navigation={navigation} />}
      </ScrollView>
    </View>
  );
}

// --- Payroll ------------------------------------------------------------

function PayrollView({ navigation }: Props) {
  const { token } = useAuth();
  const today = useMemo(() => new Date(), []);
  const [period, setPeriod] = useState<Period>("monthly");
  const [date, setDate] = useState(todayString());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [monthlySummary, setMonthlySummary] = useState<WageSummary | null>(null);
  const [dailySummary, setDailySummary] = useState<DailyWageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showZero, setShowZero] = useState(false);
  const [recordingAll, setRecordingAll] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<{ workerId: number; workerName: string } | null>(null);
  const [paymentDate, setPaymentDate] = useState(todayString());
  const [paymentReference, setPaymentReference] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [detailTarget, setDetailTarget] = useState<WorkerWage | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    if (period === "monthly") setMonthlySummary(await getWageSummary(token, month, year));
    else setDailySummary(await getDailyWageSummary(token, date));
  }, [token, period, month, year, date]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false));
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
      setLoadError(false);
    } catch {
      // Keep what's on screen.
    } finally {
      setRefreshing(false);
    }
  }

  function changeMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y += 1; } else if (m < 1) { m = 12; y -= 1; }
    setMonth(m);
    setYear(y);
  }

  async function handleRecordPayment() {
    if (!token || !paymentTarget) return;
    setSavingPayment(true);
    try {
      await recordWagePayment(token, paymentTarget.workerId, {
        month, year,
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

  function confirmRecordAll(unpaid: WorkerWage[]) {
    Alert.alert(
      "Record payment for all?",
      `Mark ${unpaid.length} worker${unpaid.length === 1 ? "" : "s"} as paid for ${formatMonthYear(month, year)}, dated today.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Record", onPress: () => doRecordAll(unpaid) },
      ],
    );
  }

  async function doRecordAll(unpaid: WorkerWage[]) {
    if (!token) return;
    setRecordingAll(true);
    try {
      await Promise.all(unpaid.map((w) => recordWagePayment(token, w.worker_id, { month, year, date_of_payment: todayString() })));
      await load();
    } catch {
      Alert.alert("Could not record all payments", "Some workers may not have been recorded. Please check and try again.");
    } finally {
      setRecordingAll(false);
    }
  }

  if (loading) return <ListSkeleton rows={4} variant="simple" />;
  if (loadError) {
    return <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />;
  }

  const rows = period === "monthly" ? (monthlySummary?.workers.filter((w) => w.has_rate) ?? []) : [];
  const sortedRows = [...rows].sort((a, b) => b.net_wage - a.net_wage);
  const zeroRows = sortedRows.filter((w) => w.net_wage <= 0);
  const nonZeroRows = sortedRows.filter((w) => w.net_wage > 0);
  const totalAmount = period === "monthly" ? monthlySummary?.total_net ?? 0 : dailySummary?.total_daily_cost ?? 0;
  const totalWorkers = period === "monthly" ? monthlySummary?.total_workers ?? 0 : dailySummary?.total_workers_present ?? 0;
  const unpaid = sortedRows.filter((w) => !w.paid);
  // `rows`/`sortedRows` already excludes anyone with no wage rate set at
  // all -- the hero's `totalWorkers` count (every active worker) is
  // otherwise silently larger than everyone visible below, with no
  // explanation why. Surfaced separately from the zero-net-wage
  // collapsible, which is a different case (has a rate, worked out to ₹0).
  const noRateCount = period === "monthly" ? (monthlySummary?.workers.filter((w) => !w.has_rate).length ?? 0) : 0;

  return (
    <View>
      <View style={styles.periodRow}>
        <SegmentedControl options={[{ label: "Daily", value: "daily" }, { label: "Monthly", value: "monthly" }]} value={period} onChange={setPeriod} style={{ flex: 1 }} />
        {period === "monthly" ? (
          <View style={styles.monthNav}>
            <TouchableOpacity style={styles.monthArrow} onPress={() => changeMonth(-1)}>
              <Icon name="chevronLeft" size={16} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.monthLabel}>{formatMonthYear(month, year)}</Text>
            <TouchableOpacity style={styles.monthArrow} onPress={() => changeMonth(1)}>
              <Icon name="chevronRight" size={16} color={colors.text} />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
      {period === "daily" && (
        <View style={{ marginTop: spacing.sm }}>
          <DateField label="" value={date} onChange={setDate} />
        </View>
      )}

      <View style={styles.hero}>
        <Text style={styles.heroLabel}>
          Total {period === "monthly" ? "net wage" : "labour cost"} · {period === "monthly" ? formatMonthYear(month, year) : date}
        </Text>
        <View style={styles.heroAmountRow}>
          <Text style={styles.heroAmount}>{formatINR(totalAmount)}</Text>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.heroWorkersValue}>{totalWorkers}</Text>
            <Text style={styles.heroWorkersLabel}>workers</Text>
          </View>
        </View>
        {period === "monthly" && unpaid.length > 0 && (
          <TouchableOpacity style={[styles.heroCta, recordingAll && { opacity: 0.6 }]} onPress={() => confirmRecordAll(unpaid)} disabled={recordingAll}>
            {recordingAll ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.heroCtaText}>Record payment for all ({unpaid.length})</Text>}
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.sectionLabel}>{period === "monthly" ? "Net wage by worker" : "Cost by worker"}</Text>
      {noRateCount > 0 && (
        <Text style={styles.noRateNote}>
          {noRateCount} worker{noRateCount === 1 ? "" : "s"} have no wage rate set and aren't included below.
        </Text>
      )}

      {period === "daily" ? (
        (dailySummary?.workers.filter((w) => w.present) ?? []).length === 0 ? (
          <Text style={styles.empty}>No workers present on this date.</Text>
        ) : (
          <View style={styles.card}>
            {(dailySummary?.workers.filter((w) => w.present) ?? [])
              .sort((a, b) => b.daily_cost - a.daily_cost)
              .map((w, i, arr) => (
                <View key={w.worker_id}>
                  <View style={styles.row}>
                    <Avatar name={w.worker_name} workerId={w.worker_id} />
                    <View style={styles.rowText}>
                      <Text style={styles.name}>{w.worker_name}</Text>
                      <Text style={styles.meta}>{w.numeric_employee_code ? `#${w.numeric_employee_code}` : "no code yet"}</Text>
                    </View>
                    <Text style={styles.amount}>{formatINR(w.daily_cost)}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={styles.rowDivider} />}
                </View>
              ))}
          </View>
        )
      ) : nonZeroRows.length === 0 && zeroRows.length === 0 ? (
        <Text style={styles.empty}>No workers with a wage rate and activity this month.</Text>
      ) : (
        <View style={styles.card}>
          {nonZeroRows.map((w, i) => (
            <View key={w.worker_id}>
              <WageRow w={w} totalAmount={totalAmount} onViewCalculation={() => setDetailTarget(w)} onPay={() => { setPaymentDate(todayString()); setPaymentReference(""); setPaymentTarget({ workerId: w.worker_id, workerName: w.worker_name }); }} />
              {i < nonZeroRows.length - 1 && <View style={styles.rowDivider} />}
            </View>
          ))}
          {zeroRows.length > 0 && (
            <View>
              {nonZeroRows.length > 0 && <View style={styles.rowDivider} />}
              <TouchableOpacity style={styles.collapseRow} onPress={() => setShowZero((v) => !v)}>
                <Text style={styles.collapseText}>No wages this period ({zeroRows.length})</Text>
                <Icon name={showZero ? "chevronDown" : "chevronRight"} size={16} color={colors.muted} />
              </TouchableOpacity>
              {showZero &&
                zeroRows.map((w, i) => (
                  <View key={w.worker_id}>
                    <View style={styles.rowDivider} />
                    <WageRow w={w} totalAmount={totalAmount} onViewCalculation={() => setDetailTarget(w)} onPay={() => { setPaymentDate(todayString()); setPaymentReference(""); setPaymentTarget({ workerId: w.worker_id, workerName: w.worker_name }); }} />
                  </View>
                ))}
            </View>
          )}
        </View>
      )}

      <Modal visible={paymentTarget !== null} transparent animationType="fade" onRequestClose={() => setPaymentTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Record payment</Text>
            <Text style={styles.modalSubtitle}>{paymentTarget?.workerName}</Text>
            <DateField label="Date of payment" value={paymentDate} onChange={setPaymentDate} />
            <Text style={styles.modalLabel}>Bank transaction ID / reference</Text>
            <TextInput style={styles.modalInput} value={paymentReference} onChangeText={setPaymentReference} placeholder="Optional" placeholderTextColor={colors.muted} />
            <View style={styles.modalButtonRow}>
              <Button label="Cancel" variant="outline" onPress={() => setPaymentTarget(null)} style={{ flex: 1 }} />
              <Button label="Save" onPress={handleRecordPayment} loading={savingPayment} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={detailTarget !== null} transparent animationType="fade" onRequestClose={() => setDetailTarget(null)}>
        <View style={styles.modalBackdrop}>
          <ScrollView style={styles.modalCard}>
            {detailTarget && (
              <>
                <Text style={styles.modalTitle}>{detailTarget.worker_name}</Text>
                <Text style={styles.modalSubtitle}>
                  {formatMonthYear(month, year)} · {formatINR(detailTarget.rate_amount)}/{detailTarget.rate_type}
                </Text>
                <View style={styles.daysRow}>
                  <View style={[styles.dayStat, { backgroundColor: colors.primarySoft }]}>
                    <Text style={[styles.dayStatValue, { color: colors.primary }]}>{detailTarget.days_worked}</Text>
                    <Text style={styles.dayStatLabel}>Days Worked</Text>
                  </View>
                  <View style={[styles.dayStat, { backgroundColor: colors.divider }]}>
                    <Text style={[styles.dayStatValue, { color: colors.absent }]}>{detailTarget.days_absent}</Text>
                    <Text style={styles.dayStatLabel}>Days Absent</Text>
                  </View>
                </View>
                <View style={styles.detailDivider} />
                <DetailRow label="Basic Wages" formula={detailTarget.rate_type === "daily" ? `${detailTarget.days_worked} days × ${formatINR(detailTarget.rate_amount)}` : `${formatINR(detailTarget.rate_amount)} / month`} value={formatINR(detailTarget.basic_wage)} />
                <DetailRow label="Dearness Allowance" value={formatINR(detailTarget.da)} />
                <DetailRow label="House Rent Allowance" value={formatINR(detailTarget.hra)} />
                <DetailRow label="Other Allowances" value={formatINR(detailTarget.other_allowances)} />
                <DetailRow label="Overtime Wages" value={formatINR(detailTarget.ot_wages)} />
                <DetailRow label="Leave Wages" value={formatINR(detailTarget.leave_wages)} />
                <View style={styles.detailRowTotal}>
                  <Text style={styles.detailLabelBold}>Gross Wages</Text>
                  <Text style={styles.detailValueBold}>{formatINR(detailTarget.gross_wage)}</Text>
                </View>
                <View style={styles.detailDivider} />
                <DetailRow label="Provident Fund" formula={`${detailTarget.pf_rate}% of ${formatINR(detailTarget.pf_base)} (Basic+DA)`} value={`-${formatINR(detailTarget.pf)}`} negative />
                <DetailRow label="Employees State Insurance" formula={`${detailTarget.esi_rate}% of ${formatINR(detailTarget.esi_base)} (Gross)`} value={`-${formatINR(detailTarget.esi)}`} negative />
                <DetailRow label="Labour Welfare Fund" value={`-${formatINR(detailTarget.lwf)}`} negative />
                <View style={styles.detailDivider} />
                <View style={styles.detailRowTotal}>
                  <Text style={styles.detailLabelBold}>Net Wages</Text>
                  <Text style={[styles.detailValueBold, { color: colors.primary }]}>{formatINR(detailTarget.net_wage)}</Text>
                </View>
                <Button label="Close" variant="outline" onPress={() => setDetailTarget(null)} style={{ marginTop: spacing.md }} />
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function WageRow({ w, totalAmount, onViewCalculation, onPay }: { w: WorkerWage; totalAmount: number; onViewCalculation: () => void; onPay: () => void }) {
  const pct = totalAmount > 0 ? (w.net_wage / totalAmount) * 100 : 0;
  return (
    <View style={styles.row}>
      <Avatar name={w.worker_name} workerId={w.worker_id} />
      <View style={styles.rowText}>
        <Text style={styles.name}>
          {w.worker_name} <Text style={styles.meta}>{w.numeric_employee_code ? `#${w.numeric_employee_code}` : "no code"}</Text>
        </Text>
        <View style={styles.shareBarTrack}>
          <View style={[styles.shareBarFill, { width: `${Math.min(pct, 100)}%` }]} />
        </View>
        <TouchableOpacity onPress={onViewCalculation}>
          <Text style={styles.viewCalcLink}>View calculation</Text>
        </TouchableOpacity>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={styles.amount}>{formatINR(w.net_wage)}</Text>
        <Text style={styles.pct}>{pct.toFixed(0)}%</Text>
        {w.paid ? (
          <View style={styles.paidBadge}>
            <Text style={styles.paidBadgeText}>Paid</Text>
          </View>
        ) : (
          <Button label="Pay" variant="outline" small onPress={onPay} style={{ marginTop: 6 }} />
        )}
      </View>
    </View>
  );
}

function DetailRow({ label, formula, value, negative }: { label: string; formula?: string; value: string; negative?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.detailLabel}>{label}</Text>
        {formula && <Text style={styles.detailFormula}>{formula}</Text>}
      </View>
      <Text style={negative ? styles.detailValueNegative : styles.detailValue}>{value}</Text>
    </View>
  );
}

// --- Rates ----------------------------------------------------------------

function RatesView({ navigation }: Props) {
  const { token } = useAuth();
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
          if (e instanceof ApiError && e.status === 404) return [worker.id, null];
          throw e;
        }
      }),
    );
    setRates(Object.fromEntries(rateEntries));
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false));
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
      setLoadError(false);
    } catch {
      // Keep what's on screen.
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <ListSkeleton rows={5} variant="simple" />;
  if (loadError) {
    return <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />;
  }

  return (
    <View>
      <View style={styles.ratesHeaderRow}>
        <Text style={styles.ratesCount}>{workers.length} active workers</Text>
        <TouchableOpacity onPress={() => navigation.navigate("WorkerTypes")}>
          <Text style={styles.typesLink}>Worker Types →</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.infoNote}>
        <Text style={styles.infoNoteText}>
          If a worker's device ID isn't mapped yet, their attendance won't clock from the fingerprint machine -- map them from
          Biometric Devices.
        </Text>
      </View>

      {workers.length === 0 ? (
        <Text style={styles.empty}>No active workers yet.</Text>
      ) : (
        <View style={styles.card}>
          {workers.map((item, i) => {
            const type = workerTypes.find((t) => t.id === item.worker_type_id);
            const rate = rates[item.id];
            return (
              <View key={item.id}>
                <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("WageRateWorkerDetail", { workerId: item.id, workerName: item.name })}>
                  <Avatar name={item.name} workerId={item.id} />
                  <View style={styles.rowText}>
                    <Text style={styles.name}>{workerLabel(item)}</Text>
                    <Text style={styles.meta}>
                      {type ? type.name : "No type"} · {rate ? `${formatINR(rate.basic)} / ${rate.rate_type === "daily" ? "day" : "month"}` : "no rate set"}
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={16} color={colors.muted} />
                </TouchableOpacity>
                {i < workers.length - 1 && <View style={styles.rowDivider} />}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },

  periodRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  monthNav: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.card, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.xs },
  monthArrow: { padding: spacing.xs + 2 },
  monthLabel: { fontSize: 13.5, fontFamily: font.semiBold, color: colors.text, paddingHorizontal: 4 },

  hero: { backgroundColor: colors.primary, borderRadius: radius.hero, padding: spacing.lg, marginTop: spacing.md },
  heroLabel: { color: colors.onPrimaryMuted, fontSize: 12.5, fontFamily: font.medium },
  heroAmountRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: spacing.xs },
  heroAmount: { color: colors.white, fontSize: 30, fontFamily: font.bold },
  heroWorkersValue: { color: colors.white, fontSize: 18, fontFamily: font.bold },
  heroWorkersLabel: { color: colors.onPrimaryMuted, fontSize: 11, fontFamily: font.medium },
  heroCta: { backgroundColor: colors.white, borderRadius: radius.control, paddingVertical: spacing.sm + 6, alignItems: "center", marginTop: spacing.md },
  heroCtaText: { color: colors.primary, fontSize: 14.5, fontFamily: font.semiBold },

  sectionLabel: { fontSize: 12, fontFamily: font.semiBold, color: colors.muted, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.5 },
  noRateNote: { fontSize: 11.5, color: colors.muted, marginBottom: spacing.sm, fontStyle: "italic" },
  empty: { textAlign: "center", color: colors.muted, marginTop: spacing.lg },

  card: { backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.sm + 4, gap: spacing.sm },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: 14.5, fontFamily: font.semiBold, color: colors.text },
  meta: { fontSize: 11.5, color: colors.muted, fontFamily: font.regular },
  rowDivider: { height: 1, backgroundColor: colors.divider, marginLeft: 14 },
  amount: { fontSize: 15, fontFamily: font.bold, color: colors.text },
  pct: { fontSize: 11, color: colors.muted, marginTop: 1 },

  shareBarTrack: { height: 4, backgroundColor: colors.divider, borderRadius: 2, marginTop: 6, marginBottom: 6, width: "90%" },
  shareBarFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  viewCalcLink: { fontSize: 11.5, color: colors.primary, fontFamily: font.semiBold },

  paidBadge: { backgroundColor: colors.primarySoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginTop: 6 },
  paidBadgeText: { color: colors.primary, fontSize: 11, fontFamily: font.semiBold },

  collapseRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.sm + 4 },
  collapseText: { fontSize: 13, fontFamily: font.semiBold, color: colors.muted },

  ratesHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.sm },
  ratesCount: { fontSize: 13, color: colors.muted, fontFamily: font.medium },
  typesLink: { color: colors.primary, fontSize: 13, fontFamily: font.semiBold },
  infoNote: { backgroundColor: colors.primarySoft, borderRadius: radius.control, padding: spacing.sm + 4, marginBottom: spacing.md },
  infoNoteText: { color: colors.primary, fontSize: 12, lineHeight: 17 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  modalCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.lg, width: "85%", maxHeight: "80%" },
  modalTitle: { fontSize: 17, fontFamily: font.semiBold, color: colors.text },
  modalSubtitle: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  modalLabel: { fontSize: 12, fontFamily: font.medium, color: colors.muted, marginBottom: spacing.xs, marginTop: spacing.sm },
  modalInput: { backgroundColor: colors.bg, borderRadius: radius.control, padding: 12, fontSize: 14, color: colors.text },
  modalButtonRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },

  daysRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  dayStat: { flex: 1, borderRadius: radius.control, paddingVertical: spacing.sm, alignItems: "center" },
  dayStatValue: { fontSize: 20, fontFamily: font.bold },
  dayStatLabel: { fontSize: 10, color: colors.muted, marginTop: 2, fontFamily: font.medium },
  detailDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  detailLabel: { fontSize: 13, color: colors.muted },
  detailValue: { fontSize: 13, color: colors.text, fontFamily: font.medium },
  detailValueNegative: { fontSize: 13, color: colors.absent, fontFamily: font.medium },
  detailFormula: { fontSize: 10, color: colors.muted, marginTop: 1 },
  detailRowTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  detailLabelBold: { fontSize: 14, color: colors.text, fontFamily: font.semiBold },
  detailValueBold: { fontSize: 14, color: colors.text, fontFamily: font.semiBold },
});
