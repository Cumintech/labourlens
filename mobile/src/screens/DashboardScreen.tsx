import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
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
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Dashboard">;

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
  const [otDrafts, setOtDrafts] = useState<Record<string, string>>({});

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

  // Cycle order per shift: unmarked/absent -> present -> leave -> absent.
  // Leave now lives on the shift chip itself (one state per shift) rather
  // than a separate whole-day toggle, so it's impossible to have a shift
  // both present and on-leave at once -- they're the same field.
  const NEXT_STATUS: Record<AttendanceStatus, AttendanceStatus> = {
    present: "leave",
    leave: "absent",
    absent: "present",
  };

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

  async function handleToggle(worker: Worker, slot: AttendanceSlot) {
    if (!token) return;
    const key = `${worker.id}:${slot}`;
    const current = attendanceByWorkerSlot.get(key);
    const nextStatus = current ? NEXT_STATUS[current.status] : "present";
    try {
      const updated = await markAttendance(token, worker.id, selectedDate, slot, nextStatus, current?.overtime_hours ?? 0);
      const attendanceAfter = [...attendance.filter((a) => !(a.worker_id === worker.id && a.slot === slot)), updated];
      setAttendance(attendanceAfter);
      if (nextStatus === "leave" || current?.status === "leave") {
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

  async function handleOvertimeSubmit(worker: Worker, slot: AttendanceSlot) {
    if (!token) return;
    const key = `${worker.id}:${slot}`;
    const draft = otDrafts[key];
    if (draft === undefined) return;
    const hours = parseFloat(draft);
    if (isNaN(hours) || hours < 0) return;
    const current = attendanceByWorkerSlot.get(key);
    if (!current || current.status !== "present") return;
    try {
      const updated = await markAttendance(token, worker.id, selectedDate, slot, "present", hours);
      setAttendance((prev) => [...prev.filter((a) => !(a.worker_id === worker.id && a.slot === slot)), updated]);
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

  function handleMissingCompliancePress() {
    if (!firstMissingWorker) return;
    navigation.navigate("WorkerEdit", {
      workerId: firstMissingWorker.id,
      workerName: firstMissingWorker.name,
      workerStatus: firstMissingWorker.status,
      deactivatedAt: firstMissingWorker.deactivated_at,
    });
  }

  // Active workers first, deactivated ones pushed to the bottom -- a
  // deactivated worker is rarely who the owner is looking for day to
  // day, and shouldn't compete for attention above the active list.
  // Array.prototype.sort is stable (guaranteed since ES2019, and Hermes
  // -- RN's JS engine -- follows that), so within each group the
  // original order (newest-registered first) is preserved.
  const filtered = workers
    .filter((w) => w.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active"));
  const activeCount = workers.filter((w) => w.status === "active").length;
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
            <View style={styles.headerTopRow}>
              <Text style={styles.factoryName}>{owner?.factory_name ?? "Dashboard"}</Text>
              <TouchableOpacity onPress={() => navigation.navigate("ShiftSettings")}>
                <Text style={styles.settingsLink}>Shifts & Profile</Text>
              </TouchableOpacity>
            </View>

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
                {(summary?.slots ?? []).map((s) => (
                  <View key={s.slot} style={styles.slotBox}>
                    <Text style={styles.slotBoxLabel}>{s.slot}</Text>
                    <Text style={styles.slotBoxValue}>
                      {s.present} / {s.total}
                    </Text>
                  </View>
                ))}
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

          <View style={styles.sectionLabelWrap}>
            <Text style={styles.sectionLabel}>Active Workers · {activeCount}</Text>
            <View style={styles.headerLinks}>
              <TouchableOpacity onPress={() => navigation.navigate("StatutoryForms")}>
                <Text style={styles.reportLink}>Forms</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate("Report")}>
                <Text style={styles.reportLink}>6-month report</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>No workers match your search.</Text>}
      renderItem={({ item, index }) => {
        const isActive = item.status === "active";
        const isFirstDeactivated = !isActive && (index === 0 || filtered[index - 1].status === "active");
        return (
          <View>
          {isFirstDeactivated && (
            <View style={styles.deactivatedDivider}>
              <Text style={styles.deactivatedDividerText}>Deactivated</Text>
            </View>
          )}
          <View style={styles.row}>
            <View style={styles.rowTop}>
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate("WorkerEdit", {
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
              <View>
                <View style={styles.chipRow}>
                  {shifts.map((shift) => {
                    const slot = shift.slot_key;
                    const rec = attendanceByWorkerSlot.get(`${item.id}:${slot}`);
                    const status = rec?.status;
                    const chipStyle =
                      status === "present"
                        ? styles.chipPresent
                        : status === "leave"
                        ? styles.chipLeave
                        : status === "absent"
                        ? styles.chipAbsent
                        : styles.chipUnmarked;
                    const chipTextStyle =
                      status === "present"
                        ? styles.chipTextPresent
                        : status === "leave"
                        ? styles.chipTextLeave
                        : status === "absent"
                        ? styles.chipTextAbsent
                        : styles.chipTextUnmarked;
                    const mark = status === "present" ? "P" : status === "leave" ? "L" : status === "absent" ? "A" : "–";
                    return (
                      <TouchableOpacity key={slot} style={[styles.chip, chipStyle]} onPress={() => handleToggle(item, slot)}>
                        <Text style={[styles.chipText, chipTextStyle]}>
                          {shift.label} · {mark}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.otRow}>
                  {shifts
                    .filter((shift) => attendanceByWorkerSlot.get(`${item.id}:${shift.slot_key}`)?.status === "present")
                    .map((shift) => {
                      const slot = shift.slot_key;
                      const key = `${item.id}:${slot}`;
                      const rec = attendanceByWorkerSlot.get(key);
                      const value = otDrafts[key] ?? (rec?.overtime_hours ? String(rec.overtime_hours) : "");
                      return (
                        <View key={slot} style={styles.otField}>
                          <Text style={styles.otLabel}>{shift.label} OT hrs</Text>
                          <TextInput
                            style={styles.otInput}
                            value={value}
                            onChangeText={(text) => setOtDrafts((prev) => ({ ...prev, [key]: text }))}
                            onEndEditing={() => handleOvertimeSubmit(item, slot)}
                            keyboardType="numeric"
                            placeholder="0"
                            placeholderTextColor={colors.muted}
                          />
                        </View>
                      );
                    })}
                </View>
              </View>
            )}
          </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  headerCard: { backgroundColor: colors.navy, padding: spacing.md, paddingBottom: spacing.lg },
  headerTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  factoryName: { color: colors.white, fontSize: 18, fontWeight: "700" },
  settingsLink: { color: colors.tealPale, fontSize: 12, fontWeight: "700" },
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
  summaryLabel: { color: "#0F6E56", fontSize: 12, fontWeight: "700" },
  slotRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm, flexWrap: "wrap" },
  slotBox: { flexGrow: 1, flexBasis: "30%", backgroundColor: colors.white, borderRadius: radius.sm, padding: spacing.xs + 4 },
  slotBoxLabel: { color: colors.muted, fontSize: 11 },
  slotBoxValue: { color: colors.navy, fontSize: 14, fontWeight: "700", marginTop: 2 },
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
  sectionLabelWrap: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 4,
    paddingBottom: spacing.xs,
  },
  sectionLabel: { color: colors.navy, fontSize: 13, fontWeight: "700" },
  headerLinks: { flexDirection: "row", gap: spacing.md },
  reportLink: { color: colors.teal, fontSize: 12, fontWeight: "700" },
  addWorkerButton: {
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingVertical: spacing.sm + 6,
    alignItems: "center",
  },
  addWorkerButtonText: { color: colors.white, fontSize: 15, fontWeight: "700" },
  deactivatedDivider: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
  deactivatedDividerText: { color: colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  empty: { textAlign: "center", color: colors.muted, marginTop: 40 },
  row: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: spacing.sm + 2,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 14, fontWeight: "700", color: colors.navy },
  meta: { fontSize: 11, color: colors.muted, marginTop: 1 },
  deactivateLink: { color: colors.danger, fontSize: 11, fontWeight: "700" },
  badge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  badgeInactive: { backgroundColor: colors.muted },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: "700" },
  chipRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm, flexWrap: "wrap" },
  chip: { flexGrow: 1, flexBasis: "30%", borderRadius: 6, paddingVertical: spacing.xs + 2, alignItems: "center" },
  chipUnmarked: { backgroundColor: colors.white },
  chipPresent: { backgroundColor: colors.tealLight },
  chipAbsent: { backgroundColor: colors.dangerLight },
  chipLeave: { backgroundColor: "#FFF8EC" },
  chipText: { fontSize: 11, fontWeight: "700" },
  chipTextUnmarked: { color: colors.muted },
  chipTextPresent: { color: "#0F6E56" },
  chipTextAbsent: { color: "#993C1D" },
  chipTextLeave: { color: "#8A5A14" },
  otRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.xs, flexWrap: "wrap" },
  otField: { flexDirection: "row", alignItems: "center", gap: 4 },
  otLabel: { fontSize: 10, color: colors.muted },
  otInput: {
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 11,
    color: colors.navy,
    minWidth: 32,
  },
});
