import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  Attendance,
  AttendanceStatus,
  LeaveEntry,
  ShiftConfig,
  WorkerWage,
  createLeaveEntry,
  deactivateWorker,
  deleteLeaveEntry,
  getWorkerWageComputation,
  listShiftConfigs,
  listWorkerAttendanceMonth,
  listWorkerLeaveRange,
  markAttendance,
} from "../api/client";
import DayAttendanceRow from "../components/DayAttendanceRow";
import ErrorState from "../components/ErrorState";
import OtHoursModal from "../components/OtHoursModal";
import { ListSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "WorkerAttendance">;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// The one-day-at-a-time Dashboard is fine for marking today's shift,
// but reviewing or fixing a specific worker's record over a month meant
// stepping through days one at a time -- this shows every day of a
// chosen month for just this worker, in one screen, so the owner can
// scan down and fix whatever's wrong.
export default function WorkerAttendanceScreen({ route, navigation }: Props) {
  const { workerId, workerName, workerStatus, deactivatedAt } = route.params;
  const isActive = workerStatus === "active";
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leave, setLeave] = useState<LeaveEntry[]>([]);
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [wage, setWage] = useState<WorkerWage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [otModalDate, setOtModalDate] = useState<string | null>(null);

  const monthStart = `${year}-${pad(month)}-01`;
  const monthEnd = `${year}-${pad(month)}-${pad(daysInMonth(month, year))}`;

  const load = useCallback(async () => {
    if (!token) return;
    const [a, l, s, w] = await Promise.all([
      listWorkerAttendanceMonth(token, workerId, month, year),
      listWorkerLeaveRange(token, workerId, monthStart, monthEnd),
      listShiftConfigs(token),
      getWorkerWageComputation(token, workerId, month, year),
    ]);
    setAttendance(a);
    setLeave(l);
    setShifts(s);
    setWage(w);
  }, [token, workerId, month, year, monthStart, monthEnd]);

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
      // Keep whatever's already on screen -- see Dashboard's identical note.
    } finally {
      setRefreshing(false);
    }
  }

  const attendanceByDateSlot = useMemo(() => {
    const map = new Map<string, Attendance>();
    for (const a of attendance) map.set(`${a.date}:${a.slot}`, a);
    return map;
  }, [attendance]);

  function isDateOnLeave(dateStr: string): boolean {
    return leave.some((l) => l.date_from <= dateStr && l.date_to >= dateStr);
  }

  function leaveEntryForDate(dateStr: string): LeaveEntry | undefined {
    return leave.find((l) => l.date_from === dateStr && l.date_to === dateStr);
  }

  const canonicalOtShift = shifts[shifts.length - 1];

  function getDayOtHours(dateStr: string): number {
    return shifts.reduce((sum, s) => sum + (attendanceByDateSlot.get(`${dateStr}:${s.slot_key}`)?.overtime_hours ?? 0), 0);
  }

  async function refreshWage() {
    if (!token) return;
    try {
      setWage(await getWorkerWageComputation(token, workerId, month, year));
    } catch {
      // Non-critical -- the attendance edit itself already succeeded.
    }
  }

  async function handleSetStatus(dateStr: string, slotKey: string, status: AttendanceStatus) {
    if (!token) return;
    const key = `${dateStr}:${slotKey}`;
    const current = attendanceByDateSlot.get(key);
    try {
      const updated = await markAttendance(token, workerId, dateStr, slotKey, status, current?.overtime_hours ?? 0);
      setAttendance((prev) => [...prev.filter((a) => !(a.date === dateStr && a.slot === slotKey)), updated]);
      if (status === "present") {
        const existingLeave = leaveEntryForDate(dateStr);
        if (existingLeave) {
          await deleteLeaveEntry(token, existingLeave.id);
          setLeave((prev) => prev.filter((l) => l.id !== existingLeave.id));
        }
      }
      await refreshWage();
    } catch {
      Alert.alert("Could not update attendance", "Please try again.");
    }
  }

  async function handleToggleLeave(dateStr: string) {
    if (!token) return;
    const existing = leaveEntryForDate(dateStr);
    try {
      if (existing) {
        await deleteLeaveEntry(token, existing.id);
        setLeave((prev) => prev.filter((l) => l.id !== existing.id));
      } else {
        const presentShifts = shifts.filter((s) => attendanceByDateSlot.get(`${dateStr}:${s.slot_key}`)?.status === "present");
        for (const shift of presentShifts) {
          const cleared = await markAttendance(token, workerId, dateStr, shift.slot_key, "absent", 0);
          setAttendance((prev) => [...prev.filter((a) => !(a.date === dateStr && a.slot === shift.slot_key)), cleared]);
        }
        const created = await createLeaveEntry(token, workerId, { leave_type: "earned", date_from: dateStr, date_to: dateStr, days: 1 });
        setLeave((prev) => [...prev, created]);
      }
      await refreshWage();
    } catch {
      Alert.alert("Could not update leave", "Please try again.");
    }
  }

  async function handleSetDayOt(dateStr: string, hours: number) {
    if (!token || !canonicalOtShift) return;
    try {
      for (const shift of shifts) {
        if (shift.slot_key === canonicalOtShift.slot_key) continue;
        const current = attendanceByDateSlot.get(`${dateStr}:${shift.slot_key}`);
        if (current && current.overtime_hours) {
          const cleared = await markAttendance(token, workerId, dateStr, shift.slot_key, current.status, 0);
          setAttendance((prev) => [...prev.filter((a) => !(a.date === dateStr && a.slot === shift.slot_key)), cleared]);
        }
      }
      const currentCanonical = attendanceByDateSlot.get(`${dateStr}:${canonicalOtShift.slot_key}`);
      const updated = await markAttendance(token, workerId, dateStr, canonicalOtShift.slot_key, currentCanonical?.status ?? "absent", hours);
      setAttendance((prev) => [...prev.filter((a) => !(a.date === dateStr && a.slot === canonicalOtShift.slot_key)), updated]);
      await refreshWage();
    } catch {
      Alert.alert("Could not update overtime", "Please try again.");
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

  function handleDeactivate() {
    Alert.alert(
      "Deactivate worker?",
      `${workerName} will be marked deactivated and removed from the Labour Portal on the next sync. Their records are kept, not deleted. This needs confirmation before it happens.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deactivate",
          style: "destructive",
          onPress: async () => {
            if (!token) return;
            try {
              await deactivateWorker(token, workerId);
              navigation.goBack();
            } catch {
              Alert.alert("Could not deactivate", "Please try again.");
            }
          },
        },
      ],
    );
  }

  const days = useMemo(() => {
    const total = daysInMonth(month, year);
    const list: { dateStr: string; day: number; weekday: string }[] = [];
    for (let d = 1; d <= total; d++) {
      const dateStr = `${year}-${pad(month)}-${pad(d)}`;
      list.push({ dateStr, day: d, weekday: WEEKDAY_NAMES[new Date(year, month - 1, d).getDay()] });
    }
    return list;
  }, [month, year]);

  const summary = useMemo(() => {
    let present = 0;
    let absent = 0;
    let leaveDays = 0;
    let otHours = 0;
    for (const { dateStr } of days) {
      const dayRecords = attendance.filter((a) => a.date === dateStr);
      const isPresent = dayRecords.some((a) => a.status === "present");
      const onLeave = isDateOnLeave(dateStr);
      if (isPresent) present += 1;
      else if (onLeave) leaveDays += 1;
      else if (dayRecords.length > 0) absent += 1;
      otHours += dayRecords.filter((a) => a.status === "present").reduce((sum, a) => sum + (a.overtime_hours || 0), 0);
    }
    return { present, absent, leaveDays, otHours };
  }, [days, attendance, leave]);

  if (loading || !token) {
    return (
      <View style={styles.container}>
        <ListSkeleton rows={5} variant="simple" />
      </View>
    );
  }

  if (loadError) {
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
        data={days}
        keyExtractor={(d) => d.dateStr}
        contentContainerStyle={{ paddingBottom: spacing.xl * 2 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.teal]} tintColor={colors.teal} />}
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.workerName}>{workerName}</Text>
                {!isActive && (
                  <Text style={styles.deactivatedText}>
                    Deactivated{deactivatedAt ? ` · ${deactivatedAt.slice(0, 10)}` : ""}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                style={styles.editButton}
                onPress={() =>
                  navigation.navigate("WorkerEdit", { workerId, workerName, workerStatus, deactivatedAt })
                }
              >
                <Text style={styles.editButtonText}>✎ Edit</Text>
              </TouchableOpacity>
              {isActive && (
                <TouchableOpacity style={styles.deactivateButton} onPress={handleDeactivate}>
                  <Text style={styles.deactivateButtonText}>Deactivate</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.monthRow}>
              <TouchableOpacity style={styles.monthArrow} onPress={() => changeMonth(-1)}>
                <Text style={styles.monthArrowText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.monthLabel}>
                📅 {MONTH_NAMES[month - 1]} {year}
              </Text>
              <TouchableOpacity style={styles.monthArrow} onPress={() => changeMonth(1)}>
                <Text style={styles.monthArrowText}>›</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.summaryRow}>
              <View style={[styles.statCard, { backgroundColor: colors.tealLight }]}>
                <Text style={[styles.statValue, { color: colors.tealDark }]}>{summary.present}</Text>
                <Text style={styles.statLabel}>Present</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.dangerLight }]}>
                <Text style={[styles.statValue, { color: colors.danger }]}>{summary.absent}</Text>
                <Text style={styles.statLabel}>Absent</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.amberLight }]}>
                <Text style={[styles.statValue, { color: colors.amberDark }]}>{summary.leaveDays}</Text>
                <Text style={styles.statLabel}>Leave</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.violetLight }]}>
                <Text style={[styles.statValue, { color: colors.violet }]}>{summary.otHours}h</Text>
                <Text style={styles.statLabel}>Overtime</Text>
              </View>
            </View>

            <View style={styles.wageCard}>
              {wage && wage.has_rate ? (
                <>
                  <View style={styles.wageTopRow}>
                    <Text style={styles.wageLabel}>Total Wages this month</Text>
                    {wage.paid && (
                      <View style={styles.paidBadge}>
                        <Text style={styles.paidBadgeText}>Paid</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.wageValue}>₹{wage.net_wage.toFixed(2)}</Text>
                  <Text style={styles.wageDetail}>
                    Gross ₹{wage.gross_wage.toFixed(2)} · {wage.days_worked} day{wage.days_worked === 1 ? "" : "s"} worked
                  </Text>
                </>
              ) : (
                <Text style={styles.wageEmpty}>No wage rate set yet -- add one from Edit to see wages here.</Text>
              )}
            </View>

            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Date</Text>
              <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Attendance</Text>
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const isToday = item.dateStr === `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
          return (
            <View style={[styles.dayRow, isToday && styles.dayRowToday]}>
              <View style={styles.dateRow}>
                <Text style={styles.dateNumber}>{pad(item.day)}</Text>
                <Text style={styles.dateWeekday}>{item.weekday}</Text>
              </View>
              <DayAttendanceRow
                shifts={shifts}
                getShiftStatus={(slotKey) => attendanceByDateSlot.get(`${item.dateStr}:${slotKey}`)?.status}
                getShiftSource={(slotKey) => attendanceByDateSlot.get(`${item.dateStr}:${slotKey}`)?.source}
                onSetShiftStatus={(slotKey, status) => handleSetStatus(item.dateStr, slotKey, status)}
                isOnLeave={isDateOnLeave(item.dateStr)}
                onToggleLeave={() => handleToggleLeave(item.dateStr)}
                otHours={getDayOtHours(item.dateStr)}
                onOpenOt={() => setOtModalDate(item.dateStr)}
              />
            </View>
          );
        }}
      />
      <OtHoursModal
        visible={otModalDate !== null}
        initialHours={otModalDate ? getDayOtHours(otModalDate) : 0}
        onConfirm={async (hours) => {
          if (otModalDate) await handleSetDayOt(otModalDate, hours);
          setOtModalDate(null);
        }}
        onCancel={() => setOtModalDate(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  headerRow: { flexDirection: "row", alignItems: "center", padding: spacing.md, gap: spacing.sm },
  workerName: { fontSize: 20, fontWeight: "700", color: colors.navy },
  deactivatedText: { fontSize: 12, color: colors.muted, marginTop: 2 },
  editButton: { borderWidth: 1.5, borderColor: colors.teal, borderRadius: radius.sm, paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm },
  editButtonText: { color: colors.teal, fontSize: 13, fontWeight: "700" },
  deactivateButton: { backgroundColor: colors.dangerLight, borderRadius: radius.sm, paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm },
  deactivateButtonText: { color: colors.danger, fontSize: 13, fontWeight: "700" },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.fieldBg,
    marginHorizontal: spacing.md,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  monthArrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  monthArrowText: { fontSize: 18, fontWeight: "700", color: colors.navy },
  monthLabel: { fontSize: 15, fontWeight: "700", color: colors.navy },
  summaryRow: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.md, marginTop: spacing.md },
  statCard: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "700" },
  statLabel: { fontSize: 10, color: colors.muted, marginTop: 2, fontWeight: "600" },
  wageCard: {
    backgroundColor: colors.navy,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  wageTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  wageLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "700" },
  paidBadge: { backgroundColor: colors.teal, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  paidBadgeText: { color: colors.white, fontSize: 10, fontWeight: "700" },
  wageValue: { color: colors.white, fontSize: 28, fontWeight: "700", marginTop: 4 },
  wageDetail: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 },
  wageEmpty: { color: "rgba(255,255,255,0.85)", fontSize: 13 },
  tableHeaderRow: { flexDirection: "row", paddingHorizontal: spacing.md, marginTop: spacing.lg, marginBottom: spacing.xs },
  tableHeaderCell: { fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase" },
  dayRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.fieldBg,
  },
  dayRowToday: { backgroundColor: colors.tealLight },
  // Full-width tile row directly under a compact date header, not a
  // side-by-side column split -- squeezing the tiles into a narrow
  // column (flex: 2 of 3) was forcing them to wrap onto a second line,
  // which read as an oversized gap between the date and the shifts.
  dateRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs, marginBottom: spacing.xs },
  dateNumber: { fontSize: 15, fontWeight: "700", color: colors.navy },
  dateWeekday: { fontSize: 11, color: colors.muted },
});
