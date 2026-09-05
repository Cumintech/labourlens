import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  Attendance,
  AttendanceSlot,
  AttendanceStatus,
  LeaveEntry,
  ShiftConfig,
  Worker,
  createLeaveEntry,
  deleteLeaveEntry,
  listAttendance,
  listLeaveForDate,
  listShiftConfigs,
  listWorkers,
  markAttendance,
} from "../api/client";
import DateField, { isoDate } from "../components/DateField";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "AttendanceRange">;

// Same three-way cycle as the Dashboard's single-day chips (present ->
// leave -> absent), duplicated rather than shared so this screen can't
// accidentally destabilize the single-day Dashboard, which has already
// been through several rounds of real-device testing.
const NEXT_STATUS: Record<AttendanceStatus, AttendanceStatus> = {
  present: "leave",
  leave: "absent",
  absent: "present",
};

const MAX_RANGE_DAYS = 31;

function todayString() {
  return isoDate(new Date());
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return isoDate(d);
}

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  let d = from;
  let guard = 0;
  while (d <= to && guard <= MAX_RANGE_DAYS) {
    dates.push(d);
    d = addDays(d, 1);
    guard += 1;
  }
  return dates;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

// One self-contained day's worth of attendance -- fetches and manages
// its own state so several of these can sit on screen together, each
// independently editable, which is the whole point of this screen.
function DayBlock({ token, date, workers, shifts }: { token: string; date: string; workers: Worker[]; shifts: ShiftConfig[] }) {
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leave, setLeave] = useState<LeaveEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([listAttendance(token, date), listLeaveForDate(token, date)])
      .then(([a, l]) => {
        if (cancelled) return;
        setAttendance(a);
        setLeave(l);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, date]);

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

  async function syncDayLeave(worker: Worker, attendanceForDay: Attendance[]) {
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
        date_from: date,
        date_to: date,
        days: leaveCount / totalShifts,
      });
      setLeave((prev) => [...prev, created]);
    }
  }

  async function handleToggle(worker: Worker, slot: AttendanceSlot) {
    const key = `${worker.id}:${slot}`;
    const current = attendanceByWorkerSlot.get(key);
    const nextStatus = current ? NEXT_STATUS[current.status] : "present";
    try {
      const updated = await markAttendance(token, worker.id, date, slot, nextStatus, current?.overtime_hours ?? 0);
      const attendanceAfter = [...attendance.filter((a) => !(a.worker_id === worker.id && a.slot === slot)), updated];
      setAttendance(attendanceAfter);
      if (nextStatus === "leave" || current?.status === "leave") {
        await syncDayLeave(worker, attendanceAfter.filter((a) => a.worker_id === worker.id));
      }
    } catch {
      Alert.alert("Could not update attendance", `Please try again (${formatDateLabel(date)}).`);
    }
  }

  return (
    <View style={styles.dayBlock}>
      <Text style={styles.dayTitle}>{formatDateLabel(date)}</Text>
      {loading ? (
        <ActivityIndicator color={colors.teal} style={{ marginVertical: spacing.md }} />
      ) : (
        workers.map((worker) => (
          <View key={worker.id} style={styles.workerRow}>
            <Text style={styles.workerName}>{worker.name}</Text>
            <View style={styles.chipRow}>
              {shifts.map((shift) => {
                const rec = attendanceByWorkerSlot.get(`${worker.id}:${shift.slot_key}`);
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
                  <TouchableOpacity
                    key={shift.slot_key}
                    style={[styles.chip, chipStyle]}
                    onPress={() => handleToggle(worker, shift.slot_key)}
                  >
                    <Text style={[styles.chipText, chipTextStyle]}>
                      {shift.label} · {mark}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

// "Choose multiple dates to view/edit in one screen" -- rather than a
// grid (unreadable on a phone once shifts and workers both grow), this
// lists a full day's worth of chips per date, stacked, all on one
// scroll. Each DayBlock owns its own attendance/leave fetch and toggle
// logic, so editing one day never refetches or re-renders the others.
export default function AttendanceRangeScreen({}: Props) {
  const { token } = useAuth();
  const today = useMemo(todayString, []);
  const [fromDate, setFromDate] = useState(addDays(today, -6));
  const [toDate, setToDate] = useState(today);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    const [w, s] = await Promise.all([listWorkers(token), listShiftConfigs(token)]);
    setWorkers(w.filter((worker) => worker.status === "active"));
    setShifts(s);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load()
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [load]),
  );

  const rangeInvalid = toDate < fromDate;
  const dates = rangeInvalid ? [] : datesBetween(fromDate, toDate);
  const rangeTooLong = !rangeInvalid && datesBetween(fromDate, toDate).length > MAX_RANGE_DAYS;

  if (loading || !token) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.teal} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}>
      <Text style={styles.subtitle}>
        Pick a date range below -- every day in it shows up as its own editable section, so you can review or fix
        several days of attendance without leaving this screen.
      </Text>
      <View style={styles.rangeRow}>
        <View style={{ flex: 1 }}>
          <DateField label="From" value={fromDate} onChange={setFromDate} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label="To" value={toDate} onChange={setToDate} />
        </View>
      </View>

      {rangeInvalid && <Text style={styles.warning}>"To" must be on or after "From".</Text>}
      {rangeTooLong && <Text style={styles.warning}>Pick a range of {MAX_RANGE_DAYS} days or fewer.</Text>}

      {workers.length === 0 ? (
        <Text style={styles.empty}>No active workers yet.</Text>
      ) : (
        !rangeInvalid &&
        !rangeTooLong &&
        dates.map((date) => <DayBlock key={date} token={token} date={date} workers={workers} shifts={shifts} />)
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  subtitle: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  rangeRow: { flexDirection: "row", gap: spacing.sm },
  warning: { fontSize: 12, color: colors.danger, marginTop: spacing.xs, marginBottom: spacing.sm },
  empty: { textAlign: "center", color: colors.muted, marginTop: 40 },
  dayBlock: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginTop: spacing.md,
  },
  dayTitle: { fontSize: 13, fontWeight: "700", color: colors.navy, marginBottom: spacing.sm },
  workerRow: { marginBottom: spacing.sm },
  workerName: { fontSize: 13, fontWeight: "600", color: colors.navy, marginBottom: 4 },
  chipRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  chip: { flexGrow: 1, flexBasis: "30%", borderRadius: 6, paddingVertical: spacing.xs + 2, alignItems: "center", backgroundColor: colors.white },
  chipUnmarked: { backgroundColor: colors.white },
  chipPresent: { backgroundColor: colors.tealLight },
  chipAbsent: { backgroundColor: colors.dangerLight },
  chipLeave: { backgroundColor: "#FFF8EC" },
  chipText: { fontSize: 11, fontWeight: "700" },
  chipTextUnmarked: { color: colors.muted },
  chipTextPresent: { color: "#0F6E56" },
  chipTextAbsent: { color: "#993C1D" },
  chipTextLeave: { color: "#8A5A14" },
});
