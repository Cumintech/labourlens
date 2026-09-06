import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  Attendance,
  AttendanceSlot,
  AttendanceStatus,
  ShiftConfig,
  Worker,
  listAttendance,
  listShiftConfigs,
  listWorkers,
  markAttendance,
} from "../api/client";
import DateField, { isoDate } from "../components/DateField";
import ShiftPresentAbsentRow from "../components/ShiftPresentAbsentRow";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "AttendanceRange">;

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAttendance(token, date)
      .then((a) => {
        if (cancelled) return;
        setAttendance(a);
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

  async function handleSetStatus(worker: Worker, slot: AttendanceSlot, status: AttendanceStatus) {
    const key = `${worker.id}:${slot}`;
    const current = attendanceByWorkerSlot.get(key);
    try {
      const updated = await markAttendance(token, worker.id, date, slot, status, current?.overtime_hours ?? 0);
      setAttendance((prev) => [...prev.filter((a) => !(a.worker_id === worker.id && a.slot === slot)), updated]);
    } catch {
      Alert.alert("Could not update attendance", `Please try again (${formatDateLabel(date)}).`);
    }
  }

  async function handleSetOtHours(worker: Worker, slot: AttendanceSlot, hours: number) {
    try {
      const updated = await markAttendance(token, worker.id, date, slot, "present", hours);
      setAttendance((prev) => [...prev.filter((a) => !(a.worker_id === worker.id && a.slot === slot)), updated]);
    } catch {
      Alert.alert("Could not update overtime", `Please try again (${formatDateLabel(date)}).`);
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
            <ShiftPresentAbsentRow
              shifts={shifts}
              getStatus={(slotKey) => attendanceByWorkerSlot.get(`${worker.id}:${slotKey}`)?.status}
              getOtHours={(slotKey) => attendanceByWorkerSlot.get(`${worker.id}:${slotKey}`)?.overtime_hours ?? 0}
              onSetStatus={(slotKey, status) => handleSetStatus(worker, slotKey, status)}
              onSetOtHours={(slotKey, hours) => handleSetOtHours(worker, slotKey, hours)}
            />
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
});
