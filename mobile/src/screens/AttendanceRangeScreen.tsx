import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
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
import DayAttendanceRow from "../components/DayAttendanceRow";
import ErrorState from "../components/ErrorState";
import OtHoursModal from "../components/OtHoursModal";
import { ListSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";
import { workerLabel } from "../workerLabel";

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

// Purely presentational -- attendance/leave for every date in the range
// live in the parent screen's state (see AttendanceRangeScreen below),
// so the single shared OT popup can read and write any date's figure
// without each DayBlock owning its own copy the parent can't reach.
function DayBlock({
  date,
  workers,
  shifts,
  attendance,
  leave,
  onSetStatus,
  onToggleLeave,
  onOpenOt,
}: {
  date: string;
  workers: Worker[];
  shifts: ShiftConfig[];
  attendance: Attendance[];
  leave: LeaveEntry[];
  onSetStatus: (date: string, worker: Worker, slot: AttendanceSlot, status: AttendanceStatus) => void;
  onToggleLeave: (date: string, worker: Worker) => void;
  onOpenOt: (date: string, worker: Worker) => void;
}) {
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

  function dayOtHours(worker: Worker): number {
    return shifts.reduce((sum, s) => sum + (attendanceByWorkerSlot.get(`${worker.id}:${s.slot_key}`)?.overtime_hours ?? 0), 0);
  }

  return (
    <View style={styles.dayBlock}>
      <Text style={styles.dayTitle}>{formatDateLabel(date)}</Text>
      {workers.map((worker) => (
        <View key={worker.id} style={styles.workerRow}>
          <Text style={styles.workerName}>{workerLabel(worker)}</Text>
          <DayAttendanceRow
            shifts={shifts}
            getShiftStatus={(slotKey) => attendanceByWorkerSlot.get(`${worker.id}:${slotKey}`)?.status}
            getShiftSource={(slotKey) => attendanceByWorkerSlot.get(`${worker.id}:${slotKey}`)?.source}
            onSetShiftStatus={(slotKey, status) => onSetStatus(date, worker, slotKey, status)}
            isOnLeave={leaveByWorker.has(worker.id)}
            onToggleLeave={() => onToggleLeave(date, worker)}
            otHours={dayOtHours(worker)}
            onOpenOt={() => onOpenOt(date, worker)}
          />
        </View>
      ))}
    </View>
  );
}

// "Choose multiple dates to view/edit in one screen" -- rather than a
// grid (unreadable on a phone once shifts and workers both grow), this
// lists a full day's worth of controls per date, stacked, all on one
// scroll. Attendance/leave for the whole range is fetched once into
// this screen's state (keyed by date) rather than per DayBlock, so the
// one shared OT popup below can read and update any date/worker pair.
export default function AttendanceRangeScreen({}: Props) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const today = useMemo(todayString, []);
  const [fromDate, setFromDate] = useState(addDays(today, -6));
  const [toDate, setToDate] = useState(today);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeLoading, setRangeLoading] = useState(true);
  const [rangeError, setRangeError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [attendanceByDate, setAttendanceByDate] = useState<Record<string, Attendance[]>>({});
  const [leaveByDate, setLeaveByDate] = useState<Record<string, LeaveEntry[]>>({});
  const [otModalTarget, setOtModalTarget] = useState<{ date: string; worker: Worker } | null>(null);

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
  const rangeTooLong = !rangeInvalid && dates.length > MAX_RANGE_DAYS;
  const datesKey = dates.join(",");

  const loadRange = useCallback(async () => {
    if (!token || dates.length === 0) return;
    const results = await Promise.all(
      dates.map((date) =>
        Promise.all([listAttendance(token, date), listLeaveForDate(token, date)]).then(([a, l]) => [date, a, l] as const),
      ),
    );
    const aMap: Record<string, Attendance[]> = {};
    const lMap: Record<string, LeaveEntry[]> = {};
    for (const [date, a, l] of results) {
      aMap[date] = a;
      lMap[date] = l;
    }
    setAttendanceByDate(aMap);
    setLeaveByDate(lMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- datesKey stands in for the dates array's identity
  }, [token, datesKey]);

  useEffect(() => {
    if (!token || rangeInvalid || rangeTooLong || dates.length === 0) return;
    let cancelled = false;
    setRangeLoading(true);
    loadRange()
      .then(() => {
        if (!cancelled) setRangeError(false);
      })
      .catch(() => {
        if (!cancelled) setRangeError(true);
      })
      .finally(() => {
        if (!cancelled) setRangeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, loadRange, rangeInvalid, rangeTooLong, dates.length]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadRange();
      setRangeError(false);
    } catch {
      // Keep whatever's already on screen -- see Dashboard's identical note.
    } finally {
      setRefreshing(false);
    }
  }

  function canonicalOtShift() {
    return shifts[shifts.length - 1];
  }

  async function handleSetStatus(date: string, worker: Worker, slot: AttendanceSlot, status: AttendanceStatus) {
    if (!token) return;
    const dayRecords = attendanceByDate[date] ?? [];
    const current = dayRecords.find((a) => a.worker_id === worker.id && a.slot === slot);
    try {
      const updated = await markAttendance(token, worker.id, date, slot, status, current?.overtime_hours ?? 0);
      setAttendanceByDate((prev) => ({
        ...prev,
        [date]: [...(prev[date] ?? []).filter((a) => !(a.worker_id === worker.id && a.slot === slot)), updated],
      }));
      if (status === "present") {
        const existingLeave = (leaveByDate[date] ?? []).find((l) => l.worker_id === worker.id);
        if (existingLeave) {
          await deleteLeaveEntry(token, existingLeave.id);
          setLeaveByDate((prev) => ({ ...prev, [date]: (prev[date] ?? []).filter((l) => l.id !== existingLeave.id) }));
        }
      }
    } catch {
      Alert.alert("Could not update attendance", `Please try again (${formatDateLabel(date)}).`);
    }
  }

  async function handleToggleLeave(date: string, worker: Worker) {
    if (!token) return;
    const existing = (leaveByDate[date] ?? []).find((l) => l.worker_id === worker.id);
    try {
      if (existing) {
        await deleteLeaveEntry(token, existing.id);
        setLeaveByDate((prev) => ({ ...prev, [date]: (prev[date] ?? []).filter((l) => l.id !== existing.id) }));
      } else {
        const dayRecords = attendanceByDate[date] ?? [];
        const presentShifts = shifts.filter((s) => dayRecords.find((a) => a.worker_id === worker.id && a.slot === s.slot_key)?.status === "present");
        for (const shift of presentShifts) {
          const cleared = await markAttendance(token, worker.id, date, shift.slot_key, "absent", 0);
          setAttendanceByDate((prev) => ({
            ...prev,
            [date]: [...(prev[date] ?? []).filter((a) => !(a.worker_id === worker.id && a.slot === shift.slot_key)), cleared],
          }));
        }
        const created = await createLeaveEntry(token, worker.id, { leave_type: "earned", date_from: date, date_to: date, days: 1 });
        setLeaveByDate((prev) => ({ ...prev, [date]: [...(prev[date] ?? []), created] }));
      }
    } catch {
      Alert.alert("Could not update leave", `Please try again (${formatDateLabel(date)}).`);
    }
  }

  function getDayOtHours(date: string, worker: Worker): number {
    const dayRecords = attendanceByDate[date] ?? [];
    return shifts.reduce((sum, s) => sum + (dayRecords.find((a) => a.worker_id === worker.id && a.slot === s.slot_key)?.overtime_hours ?? 0), 0);
  }

  async function handleSetDayOt(date: string, worker: Worker, hours: number) {
    if (!token) return;
    const canonical = canonicalOtShift();
    if (!canonical) return;
    try {
      const dayRecords = attendanceByDate[date] ?? [];
      for (const shift of shifts) {
        if (shift.slot_key === canonical.slot_key) continue;
        const current = dayRecords.find((a) => a.worker_id === worker.id && a.slot === shift.slot_key);
        if (current && current.overtime_hours) {
          const cleared = await markAttendance(token, worker.id, date, shift.slot_key, current.status, 0);
          setAttendanceByDate((prev) => ({
            ...prev,
            [date]: [...(prev[date] ?? []).filter((a) => !(a.worker_id === worker.id && a.slot === shift.slot_key)), cleared],
          }));
        }
      }
      const currentCanonical = dayRecords.find((a) => a.worker_id === worker.id && a.slot === canonical.slot_key);
      const updated = await markAttendance(token, worker.id, date, canonical.slot_key, currentCanonical?.status ?? "absent", hours);
      setAttendanceByDate((prev) => ({
        ...prev,
        [date]: [...(prev[date] ?? []).filter((a) => !(a.worker_id === worker.id && a.slot === canonical.slot_key)), updated],
      }));
    } catch {
      Alert.alert("Could not update overtime", `Please try again (${formatDateLabel(date)}).`);
    }
  }

  if (loading || !token) {
    return (
      <View style={styles.container}>
        <ListSkeleton rows={3} variant="simple" />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl * 2 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.teal]} tintColor={colors.teal} />}
      >
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
        ) : rangeError && !rangeInvalid && !rangeTooLong ? (
          <ErrorState onRetry={handleRefresh} />
        ) : rangeLoading && !rangeInvalid && !rangeTooLong ? (
          <ListSkeleton rows={3} variant="simple" />
        ) : (
          !rangeInvalid &&
          !rangeTooLong &&
          dates.map((date) => (
            <DayBlock
              key={date}
              date={date}
              workers={workers}
              shifts={shifts}
              attendance={attendanceByDate[date] ?? []}
              leave={leaveByDate[date] ?? []}
              onSetStatus={handleSetStatus}
              onToggleLeave={handleToggleLeave}
              onOpenOt={(d, worker) => setOtModalTarget({ date: d, worker })}
            />
          ))
        )}
      </ScrollView>
      <OtHoursModal
        visible={otModalTarget !== null}
        initialHours={otModalTarget ? getDayOtHours(otModalTarget.date, otModalTarget.worker) : 0}
        onConfirm={async (hours) => {
          if (otModalTarget) await handleSetDayOt(otModalTarget.date, otModalTarget.worker, hours);
          setOtModalTarget(null);
        }}
        onCancel={() => setOtModalTarget(null)}
      />
    </>
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
