import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  Attendance,
  AttendanceStatus,
  ShiftConfig,
  WorkerWage,
  deactivateWorker,
  getWorkerWageComputation,
  listShiftConfigs,
  listWorkerAttendanceMonth,
  markAttendance,
} from "../api/client";
import ShiftPresentAbsentRow from "../components/ShiftPresentAbsentRow";
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
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [wage, setWage] = useState<WorkerWage | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    const [a, s, w] = await Promise.all([
      listWorkerAttendanceMonth(token, workerId, month, year),
      listShiftConfigs(token),
      getWorkerWageComputation(token, workerId, month, year),
    ]);
    setAttendance(a);
    setShifts(s);
    setWage(w);
  }, [token, workerId, month, year]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [load]),
  );

  const attendanceByDateSlot = useMemo(() => {
    const map = new Map<string, Attendance>();
    for (const a of attendance) map.set(`${a.date}:${a.slot}`, a);
    return map;
  }, [attendance]);

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
      await refreshWage();
    } catch {
      Alert.alert("Could not update attendance", "Please try again.");
    }
  }

  async function handleSetOtHours(dateStr: string, slotKey: string, hours: number) {
    if (!token) return;
    try {
      const updated = await markAttendance(token, workerId, dateStr, slotKey, "present", hours);
      setAttendance((prev) => [...prev.filter((a) => !(a.date === dateStr && a.slot === slotKey)), updated]);
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
    let otHours = 0;
    for (const { dateStr } of days) {
      const dayRecords = attendance.filter((a) => a.date === dateStr);
      const isPresent = dayRecords.some((a) => a.status === "present");
      if (isPresent) present += 1;
      else absent += 1;
      otHours += dayRecords.filter((a) => a.status === "present").reduce((sum, a) => sum + (a.overtime_hours || 0), 0);
    }
    return { present, absent, otHours };
  }, [days, attendance]);

  if (loading || !token) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.teal} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={days}
      keyExtractor={(d) => d.dateStr}
      contentContainerStyle={{ paddingBottom: spacing.xl }}
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
              <Text style={[styles.statValue, { color: "#0F6E56" }]}>{summary.present}</Text>
              <Text style={styles.statLabel}>Present</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.dangerLight }]}>
              <Text style={[styles.statValue, { color: colors.danger }]}>{summary.absent}</Text>
              <Text style={styles.statLabel}>Absent</Text>
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
            <View style={styles.dateCol}>
              <Text style={styles.dateNumber}>{pad(item.day)}</Text>
              <Text style={styles.dateWeekday}>{item.weekday}</Text>
            </View>
            <View style={styles.chipsCol}>
              <ShiftPresentAbsentRow
                shifts={shifts}
                getStatus={(slotKey) => attendanceByDateSlot.get(`${item.dateStr}:${slotKey}`)?.status}
                getOtHours={(slotKey) => attendanceByDateSlot.get(`${item.dateStr}:${slotKey}`)?.overtime_hours ?? 0}
                onSetStatus={(slotKey, status) => handleSetStatus(item.dateStr, slotKey, status)}
                onSetOtHours={(slotKey, hours) => handleSetOtHours(item.dateStr, slotKey, hours)}
              />
            </View>
          </View>
        );
      }}
    />
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
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.fieldBg,
  },
  dayRowToday: { backgroundColor: colors.tealLight },
  dateCol: { flex: 1, justifyContent: "center" },
  dateNumber: { fontSize: 15, fontWeight: "700", color: colors.navy },
  dateWeekday: { fontSize: 11, color: colors.muted },
  chipsCol: { flex: 2 },
});
