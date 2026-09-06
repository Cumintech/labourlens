import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  Attendance,
  AttendanceSlot,
  AttendanceStatus,
  DashboardSummary,
  LeaveEntry,
  ShiftConfig,
  Worker,
  deactivateWorker,
  deleteLeaveEntry,
  createLeaveEntry,
  getDashboard,
  listAttendance,
  listLeaveForDate,
  listShiftConfigs,
  listWorkers,
  listWorkersMissingCompliance,
  markAttendance,
} from "../api/client";
import DateField, { isoDate } from "../components/DateField";
import ShiftStatusLine from "../components/ShiftStatusLine";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Dashboard">;

// A different accent per shift box, cycling if there are more shifts
// than colors -- purely visual, so the summary row reads at a glance
// instead of every shift looking identical.
const SLOT_ACCENTS = [
  { bg: colors.tealLight, fg: "#0F6E56" },
  { bg: colors.skyBlueLight, fg: colors.skyBlue },
  { bg: colors.amberLight, fg: "#8A5A14" },
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
  const [statusTab, setStatusTab] = useState<"active" | "deactivated">("active");
  const [bulkBusy, setBulkBusy] = useState(false);

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

  // Only the very first load shows the full-screen spinner -- every
  // refocus after that refreshes quietly in the background, so the
  // screen doesn't blank out and look unresponsive each time the owner
  // navigates back to it.
  useFocusEffect(
    useCallback(() => {
      load()
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [load]),
  );

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

  // The statutory forms (Form 15/25/25-B) compute paid leave from the
  // day-level LeaveEntry table, not from Attendance rows directly -- so
  // every time a shift's leave state changes, the day's LeaveEntry is
  // recreated to match how many of the worker's shifts are on leave that
  // day (a fractional day when only some shifts are). This dashboard is
  // the only place LeaveEntry rows are created in this app, so it's safe
  // to treat "the one entry for this worker+day" as fully owned here.
  async function syncDayLeave(worker: Worker, attendanceForDay: Attendance[]) {
    if (!token) return;
    const leaveCount = attendanceForDay.filter((a) => a.status === "leave").length;
    const totalShifts = shifts.length || 1;
    const existing = leaveByWorker.get(worker.id);
    if (existing) {
      await deleteLeaveEntry(token, existing.id);
      setLeave((prev) => prev.filter((l) => l.id !== existing.id));
    }
    if (leaveCount > 0) {
      const created = await createLeaveEntry(token, worker.id, {
        leave_type: "earned",
        date_from: selectedDate,
        date_to: selectedDate,
        days: leaveCount / totalShifts,
      });
      setLeave((prev) => [...prev, created]);
    }
  }

  async function handleSetStatus(worker: Worker, slot: AttendanceSlot, status: AttendanceStatus) {
    if (!token) return;
    const key = `${worker.id}:${slot}`;
    const current = attendanceByWorkerSlot.get(key);
    try {
      const updated = await markAttendance(token, worker.id, selectedDate, slot, status, current?.overtime_hours ?? 0);
      const attendanceAfter = [...attendance.filter((a) => !(a.worker_id === worker.id && a.slot === slot)), updated];
      setAttendance(attendanceAfter);
      if (status === "leave" || current?.status === "leave") {
        await syncDayLeave(
          worker,
          attendanceAfter.filter((a) => a.worker_id === worker.id),
        );
      }
      setSummary(await getDashboard(token, selectedDate));
    } catch {
      Alert.alert("Could not update attendance", "Please try again.");
    }
  }

  // Entering OT hours also marks the shift present -- there's no useful
  // reading of "4 hours overtime, but otherwise not present that day".
  async function handleSetOtHours(worker: Worker, slot: AttendanceSlot, hours: number) {
    if (!token) return;
    try {
      const updated = await markAttendance(token, worker.id, selectedDate, slot, "present", hours);
      setAttendance((prev) => [...prev.filter((a) => !(a.worker_id === worker.id && a.slot === slot)), updated]);
      setSummary(await getDashboard(token, selectedDate));
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

  // Sunday is treated as a default paid holiday -- the backend already
  // counts every Sunday toward wages regardless of whether anyone marks
  // attendance (see forms.py's _summarize_month), so this is purely
  // about not making the owner tap through every worker on a day that's
  // already correct by default.
  const isSunday = new Date(selectedDate).getDay() === 0;

  function handleBulkPresent() {
    const activeCount = workers.filter((w) => w.status === "active").length;
    const message = isSunday
      ? "Today is Sunday, a default holiday -- wages are already counted for everyone without marking attendance. Mark all active workers present anyway?"
      : `Mark all ${activeCount} active workers present, in every one of their shifts, for this day?`;
    Alert.alert(isSunday ? "Sunday is a default holiday" : "Mark everyone present?", message, [
      { text: "Cancel", style: "cancel" },
      { text: "Mark Present", onPress: doBulkPresent },
    ]);
  }

  async function doBulkPresent() {
    if (!token) return;
    setBulkBusy(true);
    try {
      const activeWorkersNow = workers.filter((w) => w.status === "active");
      await Promise.all(
        activeWorkersNow.flatMap((worker) =>
          shifts.map(async (shift) => {
            const current = attendanceByWorkerSlot.get(`${worker.id}:${shift.slot_key}`);
            if (current?.status === "present") return;
            await markAttendance(token, worker.id, selectedDate, shift.slot_key, "present", current?.overtime_hours ?? 0);
          }),
        ),
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
      "Copies every worker's shift status and overtime hours from yesterday to this day, overwriting anything already marked here.",
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
      const yesterdayAttendance = await listAttendance(token, yesterday);
      const updated = await Promise.all(
        yesterdayAttendance.map((a) => markAttendance(token, a.worker_id, selectedDate, a.slot, a.status, a.overtime_hours)),
      );
      const byWorker = new Map<number, Attendance[]>();
      for (const a of updated) {
        byWorker.set(a.worker_id, [...(byWorker.get(a.worker_id) ?? []), a]);
      }
      for (const [workerId, records] of byWorker) {
        const worker = workers.find((w) => w.id === workerId);
        if (worker) await syncDayLeave(worker, records);
      }
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
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.teal} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={filtered}
      keyExtractor={(w) => String(w.id)}
      contentContainerStyle={{ paddingBottom: spacing.lg }}
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

            {isSunday && (
              <View style={styles.sundayBanner}>
                <Text style={styles.sundayBannerText}>
                  🎉 Sunday is a default holiday -- wages are already counted for everyone. Mark a shift only if
                  someone actually worked.
                </Text>
              </View>
            )}

            <View style={styles.bulkRow}>
              <TouchableOpacity style={styles.bulkButton} onPress={handleBulkPresent} disabled={bulkBusy}>
                {bulkBusy ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={styles.bulkButtonText}>✓ Mark All Present</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.bulkButtonGhost} onPress={handleCopyYesterday} disabled={bulkBusy}>
                <Text style={styles.bulkButtonGhostText}>📋 Copy Yesterday</Text>
              </TouchableOpacity>
            </View>

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
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.addWorkerButton} onPress={() => navigation.navigate("NewWorkerScan")}>
            <Text style={styles.addWorkerButtonText}>+ Add New Worker</Text>
          </TouchableOpacity>

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
        return (
          <View style={styles.row}>
            <View style={styles.rowTop}>
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate("WorkerAttendance", {
                    workerId: item.id,
                    workerName: item.name,
                    workerStatus: item.status,
                    deactivatedAt: item.deactivated_at,
                  })
                }
              >
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>Aadhaar •••• •••• {item.aadhaar_last4}</Text>
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
              <ShiftStatusLine
                shifts={shifts}
                isSunday={isSunday}
                getStatus={(slotKey) => attendanceByWorkerSlot.get(`${item.id}:${slotKey}`)?.status}
                getOtHours={(slotKey) => attendanceByWorkerSlot.get(`${item.id}:${slotKey}`)?.overtime_hours ?? 0}
                onSetStatus={(slotKey, status) => handleSetStatus(item, slotKey, status)}
                onSetOtHours={(slotKey, hours) => handleSetOtHours(item, slotKey, hours)}
              />
            )}
          </View>
        );
      }}
    />
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
  sundayBanner: {
    backgroundColor: "rgba(124,92,191,0.18)",
    borderRadius: radius.sm,
    padding: spacing.sm + 2,
    marginTop: spacing.sm,
  },
  sundayBannerText: { color: colors.white, fontSize: 12, fontWeight: "600" },
  bulkRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  bulkButton: {
    flex: 1,
    backgroundColor: colors.teal,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
  },
  bulkButtonText: { color: colors.white, fontSize: 13, fontWeight: "700" },
  bulkButtonGhost: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
  },
  bulkButtonGhostText: { color: colors.white, fontSize: 13, fontWeight: "700" },
  summaryCard: { backgroundColor: colors.tealLight, borderRadius: radius.md, padding: spacing.sm + 6, marginTop: spacing.md },
  summaryTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  summaryNumber: { color: colors.navy, fontSize: 26, fontWeight: "700" },
  summaryLabel: { color: "#0F6E56", fontSize: 12, fontWeight: "700" },
  slotRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm, flexWrap: "wrap" },
  slotBox: { flexGrow: 1, flexBasis: "30%", borderRadius: radius.sm, padding: spacing.xs + 4 },
  slotBoxLabel: { fontSize: 11 },
  slotBoxValue: { fontSize: 14, fontWeight: "700", marginTop: 2 },
  addWorkerButton: {
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingVertical: spacing.sm + 8,
    alignItems: "center",
  },
  addWorkerButtonText: { color: colors.white, fontSize: 16, fontWeight: "700" },
  complianceBanner: {
    backgroundColor: "#FFF8EC",
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
