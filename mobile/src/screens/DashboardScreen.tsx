import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  Attendance,
  AttendanceSlot,
  AttendanceStatus,
  DashboardSummary,
  LeaveEntry,
  ShiftConfig,
  Worker,
  createLeaveEntry,
  deactivateWorker,
  deleteLeaveEntry,
  getDashboard,
  listAttendance,
  listLeaveForDate,
  listShiftConfigs,
  listWorkers,
  listWorkersMissingCompliance,
  markAttendance,
} from "../api/client";
import DateField, { isoDate } from "../components/DateField";
import DayAttendanceRow from "../components/DayAttendanceRow";
import ErrorState from "../components/ErrorState";
import OtHoursModal from "../components/OtHoursModal";
import { ListSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";
import { workerLabel } from "../workerLabel";

type Props = NativeStackScreenProps<RootStackParamList, "Dashboard">;

// A different accent per shift box, cycling if there are more shifts
// than colors -- purely visual, so the summary row reads at a glance
// instead of every shift looking identical.
const SLOT_ACCENTS = [
  { bg: colors.tealLight, fg: colors.tealDark },
  { bg: colors.skyBlueLight, fg: colors.skyBlue },
  { bg: colors.amberLight, fg: colors.amberDark },
  { bg: colors.violetLight, fg: colors.violet },
  { bg: colors.coralLight, fg: colors.coral },
];

// Local device date, not UTC -- "today" for attendance means the day the
// owner is standing in, not the server's timezone.
function todayString() {
  return isoDate(new Date());
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return isoDate(d);
}

export default function DashboardScreen({ navigation }: Props) {
  const { token, owner } = useAuth();
  const insets = useSafeAreaInsets();
  const today = useMemo(todayString, []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leave, setLeave] = useState<LeaveEntry[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [missingComplianceCount, setMissingComplianceCount] = useState(0);
  const [firstMissingWorker, setFirstMissingWorker] = useState<Worker | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusTab, setStatusTab] = useState<"active" | "deactivated">("active");
  const [bulkBusy, setBulkBusy] = useState(false);
  // A single shared OT popup instance for the whole screen, not one per
  // row -- mounting a Modal inside every FlatList row was the likely
  // cause of the reported "Attendance page isn't scrollable" bug.
  const [otModalWorker, setOtModalWorker] = useState<Worker | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const [w, a, d, s, missing, l] = await Promise.all([
      listWorkers(token),
      listAttendance(token, selectedDate),
      getDashboard(token, selectedDate),
      listShiftConfigs(token),
      listWorkersMissingCompliance(token),
      listLeaveForDate(token, selectedDate),
    ]);
    setWorkers(w);
    setAttendance(a);
    setSummary(d);
    setShifts(s);
    setMissingComplianceCount(missing.length);
    setFirstMissingWorker(missing[0] ?? null);
    setLeave(l);
  }, [token, selectedDate]);

  // Only the very first load shows the full-screen skeleton -- every
  // refocus after that refreshes quietly in the background, so the
  // screen doesn't blank out and look unresponsive each time the owner
  // navigates back to it. A failure on that *first* load (nothing to
  // show yet) surfaces a retry affordance instead of a blank screen; a
  // failed background refresh just leaves the existing data as-is.
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
      // Pull-to-refresh failing silently keeps whatever was already on
      // screen -- there's no "nothing to show" case here like the
      // initial load, so no retry banner needed, just no visible change.
    } finally {
      setRefreshing(false);
    }
  }

  const attendanceByWorkerSlot = useMemo(() => {
    const map = new Map<string, Attendance>();
    for (const a of attendance) map.set(`${a.worker_id}:${a.slot}`, a);
    return map;
  }, [attendance]);

  const leaveByWorker = useMemo(() => {
    const map = new Map<number, LeaveEntry>();
    for (const l of leave) map.set(l.worker_id, l);
    return map;
  }, [leave]);

  // The shift returned last (sort_order-wise) is where a day's single OT
  // figure lives under the hood -- Attendance still has OT per shift row
  // on the backend, but the UI now presents exactly one OT control per
  // day, so it needs one canonical place to store that number. Any other
  // shift's OT is zeroed out when the day's OT is set, so the two views
  // (one control vs. per-row storage) never disagree about the total.
  const canonicalOtShift = shifts[shifts.length - 1];

  function getDayOtHours(worker: Worker): number {
    return shifts.reduce((sum, s) => sum + (attendanceByWorkerSlot.get(`${worker.id}:${s.slot_key}`)?.overtime_hours ?? 0), 0);
  }

  async function handleSetShiftStatus(worker: Worker, slot: AttendanceSlot, status: AttendanceStatus) {
    if (!token) return;
    const key = `${worker.id}:${slot}`;
    const current = attendanceByWorkerSlot.get(key);
    try {
      const updated = await markAttendance(token, worker.id, selectedDate, slot, status, current?.overtime_hours ?? 0);
      setAttendance((prev) => [...prev.filter((a) => !(a.worker_id === worker.id && a.slot === slot)), updated]);
      // Present and on-leave are mutually exclusive for the same day --
      // marking a shift present while on leave doesn't make sense.
      if (status === "present") {
        const existingLeave = leaveByWorker.get(worker.id);
        if (existingLeave) {
          await deleteLeaveEntry(token, existingLeave.id);
          setLeave((prev) => prev.filter((l) => l.id !== existingLeave.id));
        }
      }
      setSummary(await getDashboard(token, selectedDate));
    } catch {
      Alert.alert("Could not update attendance", "Please try again.");
    }
  }

  async function handleToggleLeave(worker: Worker) {
    if (!token) return;
    const existing = leaveByWorker.get(worker.id);
    try {
      if (existing) {
        await deleteLeaveEntry(token, existing.id);
        setLeave((prev) => prev.filter((l) => l.id !== existing.id));
      } else {
        // Turning leave on clears any shift already marked present that
        // day, the same rule enforced in the other direction above.
        const presentShifts = shifts.filter((s) => attendanceByWorkerSlot.get(`${worker.id}:${s.slot_key}`)?.status === "present");
        for (const shift of presentShifts) {
          const cleared = await markAttendance(token, worker.id, selectedDate, shift.slot_key, "absent", 0);
          setAttendance((prev) => [...prev.filter((a) => !(a.worker_id === worker.id && a.slot === shift.slot_key)), cleared]);
        }
        const created = await createLeaveEntry(token, worker.id, {
          leave_type: "earned",
          date_from: selectedDate,
          date_to: selectedDate,
          days: 1,
        });
        setLeave((prev) => [...prev, created]);
      }
      setSummary(await getDashboard(token, selectedDate));
    } catch {
      Alert.alert("Could not update leave", "Please try again.");
    }
  }

  async function handleSetDayOt(worker: Worker, hours: number) {
    if (!token || !canonicalOtShift) return;
    try {
      // Zero out OT on every other shift so the day's total is exactly
      // the one number just entered, never a leftover from before this
      // screen collapsed OT down to a single day-level control.
      for (const shift of shifts) {
        if (shift.slot_key === canonicalOtShift.slot_key) continue;
        const current = attendanceByWorkerSlot.get(`${worker.id}:${shift.slot_key}`);
        if (current && current.overtime_hours) {
          const cleared = await markAttendance(token, worker.id, selectedDate, shift.slot_key, current.status, 0);
          setAttendance((prev) => [...prev.filter((a) => !(a.worker_id === worker.id && a.slot === shift.slot_key)), cleared]);
        }
      }
      const currentCanonical = attendanceByWorkerSlot.get(`${worker.id}:${canonicalOtShift.slot_key}`);
      const updated = await markAttendance(
        token,
        worker.id,
        selectedDate,
        canonicalOtShift.slot_key,
        currentCanonical?.status ?? "absent",
        hours,
      );
      setAttendance((prev) => [...prev.filter((a) => !(a.worker_id === worker.id && a.slot === canonicalOtShift.slot_key)), updated]);
    } catch {
      Alert.alert("Could not update overtime", "Please try again.");
    }
  }

  function handleDeactivate(worker: Worker) {
    Alert.alert(
      "Deactivate worker",
      `Deactivate ${worker.name}? This also removes them from the Labour Portal on the next sync.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deactivate",
          style: "destructive",
          onPress: async () => {
            if (!token) return;
            try {
              await deactivateWorker(token, worker.id);
              load();
            } catch {
              Alert.alert("Could not deactivate", "Please try again.");
            }
          },
        },
      ],
    );
  }

  const isSunday = new Date(selectedDate).getDay() === 0;
  const morningShift = shifts[0];

  function handleBulkPresent() {
    const activeCount = workers.filter((w) => w.status === "active").length;
    Alert.alert(
      "Mark everyone present?",
      `Mark all ${activeCount} active workers present for the ${morningShift?.label ?? "first"} shift. Evening (and any other shift) still needs marking separately per worker.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Mark Present", onPress: doBulkPresent },
      ],
    );
  }

  // Only the Morning shift -- Evening presence is a separate, explicit
  // action per worker, not something a single bulk tap should assume.
  async function doBulkPresent() {
    if (!token || !morningShift) return;
    setBulkBusy(true);
    try {
      const activeWorkersNow = workers.filter((w) => w.status === "active");
      await Promise.all(
        activeWorkersNow.map(async (worker) => {
          const current = attendanceByWorkerSlot.get(`${worker.id}:${morningShift.slot_key}`);
          if (current?.status === "present") return;
          await markAttendance(token, worker.id, selectedDate, morningShift.slot_key, "present", current?.overtime_hours ?? 0);
          const existingLeave = leaveByWorker.get(worker.id);
          if (existingLeave) await deleteLeaveEntry(token, existingLeave.id);
        }),
      );
      await load();
    } catch {
      Alert.alert("Could not mark everyone present", "Some workers may not have been updated. Please check and try again.");
    } finally {
      setBulkBusy(false);
    }
  }

  function handleCopyYesterday() {
    Alert.alert(
      "Copy yesterday's attendance?",
      "Copies every worker's shift status, leave, and overtime hours from yesterday to this day, overwriting anything already marked here.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Copy", onPress: doCopyYesterday },
      ],
    );
  }

  async function doCopyYesterday() {
    if (!token) return;
    setBulkBusy(true);
    try {
      const yesterday = addDays(selectedDate, -1);
      const [yesterdayAttendance, yesterdayLeave] = await Promise.all([
        listAttendance(token, yesterday),
        listLeaveForDate(token, yesterday),
      ]);
      await Promise.all(
        yesterdayAttendance.map((a) => markAttendance(token, a.worker_id, selectedDate, a.slot, a.status, a.overtime_hours)),
      );
      await Promise.all(
        yesterdayLeave.map((l) =>
          createLeaveEntry(token, l.worker_id, { leave_type: l.leave_type as any, date_from: selectedDate, date_to: selectedDate, days: 1 }),
        ),
      );
      await load();
    } catch {
      Alert.alert("Could not copy yesterday's attendance", "Please try again.");
    } finally {
      setBulkBusy(false);
    }
  }

  function handleMissingCompliancePress() {
    if (!firstMissingWorker) return;
    navigation.navigate("WorkerEdit", {
      workerId: firstMissingWorker.id,
      workerName: firstMissingWorker.name,
      workerStatus: firstMissingWorker.status,
      deactivatedAt: firstMissingWorker.deactivated_at,
    });
  }

  const activeWorkers = workers.filter((w) => w.status === "active");
  const deactivatedWorkers = workers.filter((w) => w.status !== "active");
  const filtered = (statusTab === "active" ? activeWorkers : deactivatedWorkers).filter((w) =>
    w.name.toLowerCase().includes(search.toLowerCase()),
  );
  const isToday = selectedDate === today;

  if (loading) {
    return (
      <View style={styles.container}>
        <ListSkeleton rows={4} />
      </View>
    );
  }

  if (loadError && workers.length === 0) {
    return (
      <View style={styles.container}>
        <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />
      </View>
    );
  }

  return (
    <>
      <FlatList
        style={styles.container}
        data={filtered}
        keyExtractor={(w) => String(w.id)}
        contentContainerStyle={{ paddingBottom: spacing.xl * 2 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.teal]} tintColor={colors.teal} />}
        ListHeaderComponent={
          <View>
            <View style={styles.headerCard}>
              <Text style={styles.factoryName}>{owner?.factory_name ?? "Dashboard"}</Text>

              <View style={styles.dateNavRow}>
                <TouchableOpacity style={styles.dateNavButton} onPress={() => setSelectedDate((d) => addDays(d, -1))}>
                  <Text style={styles.dateNavButtonText}>‹</Text>
                </TouchableOpacity>
                <View style={styles.dateNavField}>
                  <DateField label="" value={selectedDate} onChange={setSelectedDate} />
                </View>
                <TouchableOpacity
                  style={[styles.dateNavButton, isToday && styles.dateNavButtonDisabled]}
                  onPress={() => !isToday && setSelectedDate((d) => addDays(d, 1))}
                  disabled={isToday}
                >
                  <Text style={styles.dateNavButtonText}>›</Text>
                </TouchableOpacity>
                {!isToday && (
                  <TouchableOpacity style={styles.todayLink} onPress={() => setSelectedDate(today)}>
                    <Text style={styles.todayLinkText}>Today</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity onPress={() => navigation.navigate("AttendanceRange")}>
                <Text style={styles.rangeLink}>Edit multiple days →</Text>
              </TouchableOpacity>

              <View style={styles.summaryCard}>
                <View style={styles.summaryTopRow}>
                  <Text style={styles.summaryNumber}>
                    {summary?.present_today ?? 0} / {summary?.total_workers ?? 0}
                  </Text>
                  <Text style={styles.summaryLabel}>present {isToday ? "today" : "this day"}</Text>
                </View>
                <View style={styles.slotRow}>
                  {(summary?.slots ?? []).map((s, i) => {
                    const accent = SLOT_ACCENTS[i % SLOT_ACCENTS.length];
                    return (
                      <View key={s.slot} style={[styles.slotBox, { backgroundColor: accent.bg }]}>
                        <Text style={[styles.slotBoxLabel, { color: accent.fg }]}>{s.slot}</Text>
                        <Text style={[styles.slotBoxValue, { color: accent.fg }]}>
                          {s.present} / {s.total}
                        </Text>
                      </View>
                    );
                  })}
                  <View style={[styles.slotBox, { backgroundColor: colors.amberLight }]}>
                    <Text style={[styles.slotBoxLabel, { color: colors.amberDark }]}>Leave</Text>
                    <Text style={[styles.slotBoxValue, { color: colors.amberDark }]}>{leave.length}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.bulkRow}>
                <TouchableOpacity style={styles.bulkButton} onPress={handleBulkPresent} disabled={bulkBusy}>
                  {bulkBusy ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <Text style={styles.bulkButtonText}>✓ Mark All Present ({morningShift?.label ?? "Morning"})</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.bulkButtonGhost} onPress={handleCopyYesterday} disabled={bulkBusy}>
                  <Text style={styles.bulkButtonGhostText}>📋 Copy Yesterday</Text>
                </TouchableOpacity>
              </View>
              {isSunday && <Text style={styles.sundayNote}>Sunday defaults to Absent unless you mark a shift present.</Text>}
            </View>

            {missingComplianceCount > 0 && (
              <TouchableOpacity style={styles.complianceBanner} onPress={handleMissingCompliancePress}>
                <Text style={styles.complianceBannerText}>
                  {missingComplianceCount} worker{missingComplianceCount === 1 ? "" : "s"} need Form 12 details
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.searchWrap}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search workers"
                placeholderTextColor={colors.muted}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.statusTabRow}>
              <TouchableOpacity
                style={[styles.statusTab, statusTab === "active" && styles.statusTabActive]}
                onPress={() => setStatusTab("active")}
              >
                <Text style={[styles.statusTabText, statusTab === "active" && styles.statusTabTextActive]}>
                  Active · {activeWorkers.length}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusTab, statusTab === "deactivated" && styles.statusTabActiveMuted]}
                onPress={() => setStatusTab("deactivated")}
              >
                <Text style={[styles.statusTabText, statusTab === "deactivated" && styles.statusTabTextActiveMuted]}>
                  Deactivated · {deactivatedWorkers.length}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {statusTab === "active" ? "No active workers match your search." : "No deactivated workers."}
          </Text>
        }
        renderItem={({ item }) => {
          const isActive = item.status === "active";
          const onLeave = leaveByWorker.has(item.id);
          return (
            <View style={styles.row}>
              <View style={styles.rowTop}>
                <TouchableOpacity
                  style={{ flex: 1 }}
                  onPress={() =>
                    navigation.navigate("WorkerAttendance", {
                      workerId: item.id,
                      workerName: item.name,
                      workerStatus: item.status,
                      deactivatedAt: item.deactivated_at,
                    })
                  }
                >
                  <Text style={styles.name}>{workerLabel(item)}</Text>
                  <Text style={styles.meta}>
                    Device ID: {item.device_user_id ?? "Not mapped"} · Aadhaar •••• •••• {item.aadhaar_last4}
                  </Text>
                </TouchableOpacity>
                {isActive ? (
                  <TouchableOpacity onPress={() => handleDeactivate(item)}>
                    <Text style={styles.deactivateLink}>Deactivate</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.badge, styles.badgeInactive]}>
                    <Text style={styles.badgeText}>
                      Deactivated{item.deactivated_at ? ` · ${item.deactivated_at.slice(0, 10)}` : ""}
                    </Text>
                  </View>
                )}
              </View>
              {isActive && (
                <DayAttendanceRow
                  shifts={shifts}
                  getShiftStatus={(slotKey) => attendanceByWorkerSlot.get(`${item.id}:${slotKey}`)?.status}
                  getShiftSource={(slotKey) => attendanceByWorkerSlot.get(`${item.id}:${slotKey}`)?.source}
                  onSetShiftStatus={(slotKey, status) => handleSetShiftStatus(item, slotKey, status)}
                  isOnLeave={onLeave}
                  onToggleLeave={() => handleToggleLeave(item)}
                  otHours={getDayOtHours(item)}
                  onOpenOt={() => setOtModalWorker(item)}
                />
              )}
            </View>
          );
        }}
      />
      <OtHoursModal
        visible={otModalWorker !== null}
        initialHours={otModalWorker ? getDayOtHours(otModalWorker) : 0}
        onConfirm={async (hours) => {
          if (otModalWorker) await handleSetDayOt(otModalWorker, hours);
          setOtModalWorker(null);
        }}
        onCancel={() => setOtModalWorker(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  headerCard: { backgroundColor: colors.navy, padding: spacing.md, paddingBottom: spacing.lg },
  factoryName: { color: colors.white, fontSize: 18, fontWeight: "700" },
  dateNavRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm },
  dateNavButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  dateNavButtonDisabled: { opacity: 0.3 },
  dateNavButtonText: { color: colors.white, fontSize: 18, fontWeight: "700" },
  dateNavField: { flex: 1 },
  todayLink: { paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: colors.teal, borderRadius: radius.sm },
  todayLinkText: { color: colors.white, fontSize: 11, fontWeight: "700" },
  rangeLink: { color: colors.tealPale, fontSize: 12, fontWeight: "700", marginTop: spacing.sm },
  summaryCard: { backgroundColor: colors.tealLight, borderRadius: radius.md, padding: spacing.sm + 6, marginTop: spacing.md },
  summaryTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  summaryNumber: { color: colors.navy, fontSize: 26, fontWeight: "700" },
  summaryLabel: { color: colors.tealDark, fontSize: 12, fontWeight: "700" },
  slotRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm, flexWrap: "wrap" },
  slotBox: { flexGrow: 1, flexBasis: "30%", borderRadius: radius.sm, padding: spacing.xs + 4 },
  slotBoxLabel: { fontSize: 11 },
  slotBoxValue: { fontSize: 14, fontWeight: "700", marginTop: 2 },
  bulkRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  bulkButton: {
    flex: 1,
    backgroundColor: colors.teal,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  bulkButtonText: { color: colors.white, fontSize: 12, fontWeight: "700" },
  bulkButtonGhost: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  bulkButtonGhostText: { color: colors.white, fontSize: 12, fontWeight: "700" },
  sundayNote: { color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: spacing.sm, textAlign: "center" },
  complianceBanner: {
    backgroundColor: colors.amberPale,
    borderColor: colors.amber,
    borderWidth: 1,
    borderRadius: radius.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.sm + 2,
  },
  complianceBannerText: { color: colors.navy, fontSize: 12, fontWeight: "700" },
  searchWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  searchInput: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    fontSize: 13,
    color: colors.navy,
  },
  statusTabRow: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.md, marginTop: spacing.md },
  statusTab: { flex: 1, backgroundColor: colors.fieldBg, borderRadius: radius.sm, paddingVertical: spacing.sm + 2, alignItems: "center" },
  statusTabActive: { backgroundColor: colors.teal },
  statusTabActiveMuted: { backgroundColor: colors.navy },
  statusTabText: { fontSize: 13, fontWeight: "700", color: colors.muted },
  statusTabTextActive: { color: colors.white },
  statusTabTextActiveMuted: { color: colors.white },
  empty: { textAlign: "center", color: colors.muted, marginTop: 40 },
  row: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  name: { fontSize: 15, fontWeight: "700", color: colors.navy },
  meta: { fontSize: 11, color: colors.muted, marginTop: 1 },
  deactivateLink: { color: colors.danger, fontSize: 11, fontWeight: "700" },
  badge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  badgeInactive: { backgroundColor: colors.muted },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: "700" },
});
