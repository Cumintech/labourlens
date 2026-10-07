import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect, useRoute } from "@react-navigation/native";
import { Calendar, Check, ChevronLeft, ChevronRight, Copy, Search } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  flushAttendanceQueue,
  subscribeAttendanceSynced,
} from "../api/client";
import PendingSyncBanner from "../components/PendingSyncBanner";
import AttendanceRowCard from "../components/AttendanceRowCard";
import DateField, { isoDate } from "../components/DateField";
import YearMonthDayPicker from "../components/YearMonthDayPicker";
import AttendanceArt from "../components/AttendanceArt";
import DayAttendanceRow from "../components/DayAttendanceRow";
import ErrorState from "../components/ErrorState";
import OtHoursModal from "../components/OtHoursModal";
import { ListSkeleton } from "../components/Skeleton";
import { BlueHeader, Chip, SegmentedControl, useToast } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing, type } from "../theme";
import { workerLabel } from "../workerLabel";

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };
type Mode = "day" | "range";

// A different accent per shift dot, cycling if there are more shifts
// than colors -- purely visual, decorative multi-hue palette (see
// theme.ts), not a status color.
const SLOT_ACCENTS = [
  { dot: colors.primary, fg: colors.primary },
  { dot: colors.skyBlue, fg: colors.skyBlue },
  { dot: colors.violet, fg: colors.violet },
  { dot: colors.coral, fg: colors.coral },
];

const MAX_RANGE_DAYS = 31;

function todayString() {
  return isoDate(new Date());
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return isoDate(d);
}

// Merges the old standalone Dashboard (single-day marking) and
// AttendanceRangeScreen (multi-day review/fix) into one Attendance tab,
// per the v2 redesign spec -- a Day|Range SegmentedControl instead of a
// separate "Edit multiple days" destination. Day and Range each keep
// their original screen's logic close to verbatim (own data fetching,
// own OT modal instance) rather than sharing state, since they were
// never the same screen and forcing a shared model would be riskier
// than keeping two well-tested pieces side by side.
export default function AttendanceScreen({ navigation }: Props) {
  const { owner } = useAuth();
  const route = useRoute<{ key: string; name: string; params?: { mode?: Mode } }>();
  const [mode, setMode] = useState<Mode>(route.params?.mode === "range" ? "range" : "day");

  return (
    <View style={styles.container}>
      <BlueHeader
        title="Attendance"
        subtitle={owner?.factory_name ?? undefined}
        right={
          <View style={styles.headerRight}>
          <AttendanceArt size={48} />
          <View style={styles.modePill} accessibilityRole="tablist">
            {(["day", "range"] as Mode[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.modePillOption, mode === m && styles.modePillOptionActive]}
                onPress={() => setMode(m)}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
              >
                <Text style={[styles.modePillText, mode === m && styles.modePillTextActive]}>{m === "day" ? "Day" : "Range"}</Text>
              </TouchableOpacity>
            ))}
          </View>
          </View>
        }
      />
      {mode === "day" ? <DayView navigation={navigation} /> : <RangeView />}
    </View>
  );
}

// ---------------------------------------------------------------------
// Day view -- ported from the old DashboardScreen.tsx almost verbatim.
// The factory-name/"Edit multiple days" header row is gone (factory name
// now lives once in the shared header above; Range is a mode, not a
// separate destination to link to).
// ---------------------------------------------------------------------
function DayView({ navigation }: { navigation: NativeStackNavigationProp<RootStackParamList> }) {
  const { token } = useAuth();
  const { show: showToast } = useToast();
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
  const [shiftFilter, setShiftFilter] = useState<string | "all">("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusTab, setStatusTab] = useState<"active" | "deactivated">("active");
  const [bulkBusy, setBulkBusy] = useState(false);
  // A single shared OT popup instance for the whole screen, not one per
  // row -- mounting a Modal inside every FlatList row was the likely
  // cause of the reported "Attendance page isn't scrollable" bug.
  const [otModalWorker, setOtModalWorker] = useState<Worker | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    // Replay marks saved offline before reading, so the fetch reflects them
    // (the app-root useAttendanceQueueSync also does this on foreground).
    await flushAttendanceQueue(token).catch(() => {});
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

  // Reload once marks queued offline (and synced by the app-root hook) land.
  useEffect(() => subscribeAttendanceSynced(() => { load().catch(() => {}); }), [load]);

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
      if (updated.source === "pending") {
        showToast("No signal -- saved on this phone, will sync when online");
        return;
      }
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
  //
  // Snapshots each active worker's pre-bulk morning-shift record (and
  // any leave entry the bulk action would clear) so the Undo toast
  // action can revert it. The backend only ever stores present/absent
  // (see Attendance.status) -- there is no "delete this row" endpoint,
  // so a worker who had no record at all before the bulk action reverts
  // to "absent" on Undo, not back to fully unmarked. That's the closest
  // available approximation, not a perfect round-trip.
  async function doBulkPresent() {
    if (!token || !morningShift) return;
    setBulkBusy(true);
    const activeWorkersNow = workers.filter((w) => w.status === "active");
    const preBulk = activeWorkersNow.map((worker) => ({
      worker,
      prevRecord: attendanceByWorkerSlot.get(`${worker.id}:${morningShift.slot_key}`) ?? null,
      prevLeave: leaveByWorker.get(worker.id) ?? null,
    }));
    try {
      let changedCount = 0;
      await Promise.all(
        activeWorkersNow.map(async (worker) => {
          const current = attendanceByWorkerSlot.get(`${worker.id}:${morningShift.slot_key}`);
          if (current?.status === "present") return;
          changedCount += 1;
          await markAttendance(token, worker.id, selectedDate, morningShift.slot_key, "present", current?.overtime_hours ?? 0);
          const existingLeave = leaveByWorker.get(worker.id);
          if (existingLeave) await deleteLeaveEntry(token, existingLeave.id);
        }),
      );
      await load();
      if (changedCount > 0) {
        showToast(`Marked ${changedCount} worker${changedCount === 1 ? "" : "s"} present`, {
          actionLabel: "Undo",
          onAction: () => undoBulkPresent(preBulk),
        });
      }
    } catch {
      Alert.alert("Could not mark everyone present", "Some workers may not have been updated. Please check and try again.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function undoBulkPresent(
    preBulk: { worker: Worker; prevRecord: Attendance | null; prevLeave: LeaveEntry | null }[],
  ) {
    if (!token || !morningShift) return;
    setBulkBusy(true);
    try {
      await Promise.all(
        preBulk.map(async ({ worker, prevRecord, prevLeave }) => {
          await markAttendance(
            token,
            worker.id,
            selectedDate,
            morningShift.slot_key,
            prevRecord?.status ?? "absent",
            prevRecord?.overtime_hours ?? 0,
          );
          if (prevLeave) {
            await createLeaveEntry(token, worker.id, {
              leave_type: prevLeave.leave_type as any,
              date_from: prevLeave.date_from,
              date_to: prevLeave.date_to,
              days: 1,
            });
          }
        }),
      );
      await load();
    } catch {
      Alert.alert("Could not undo", "Please check attendance and fix manually if needed.");
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

  // For the sticky "x of y marked" bar -- counts the Morning shift only,
  // the same shift Mark All acts on (see handleBulkPresent above).
  const morningMarkedCount = morningShift
    ? activeWorkers.filter((w) => attendanceByWorkerSlot.get(`${w.id}:${morningShift.slot_key}`)?.status).length
    : 0;
  const morningPendingCount = activeWorkers.length - morningMarkedCount;

  if (loading) {
    return (
      <View style={styles.dayContainer}>
        <ListSkeleton rows={4} />
      </View>
    );
  }

  if (loadError && workers.length === 0) {
    return (
      <View style={styles.dayContainer}>
        <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />
      </View>
    );
  }

  return (
    <View style={styles.dayContainer}>
      <View style={styles.weekBand}>
        <View style={styles.monthRow}>
          <TouchableOpacity style={styles.weekNavButton} onPress={() => setSelectedDate((d) => addDays(d, -7))} accessibilityLabel="Previous week">
            <ChevronLeft size={18} color={colors.surface} />
          </TouchableOpacity>
          <View style={styles.monthCenter}>
            <TouchableOpacity style={styles.monthLabelButton} onPress={() => setPickerOpen(true)} accessibilityLabel="Open date picker">
              <Calendar size={18} color={colors.surface} />
              <Text style={styles.monthLabel}>{formatMonthLabel(selectedDate)}</Text>
            </TouchableOpacity>
            {!isToday && (
              <TouchableOpacity style={styles.todayPill} onPress={() => setSelectedDate(today)}>
                <Text style={styles.todayPillText}>Today</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={[styles.weekNavButton, isToday && styles.weekNavButtonDisabled]}
            onPress={() => !isToday && setSelectedDate((d) => { const n = addDays(d, 7); return n > today ? today : n; })}
            disabled={isToday}
            accessibilityLabel="Next week"
          >
            <ChevronRight size={18} color={colors.surface} />
          </TouchableOpacity>
        </View>
        <View style={styles.weekRow}>
          {weekDates(selectedDate).map((d) => {
            const selected = d === selectedDate;
            const future = d > today;
            return (
              <TouchableOpacity
                key={d}
                style={[styles.dayCell, selected && styles.dayCellSelected]}
                onPress={() => setSelectedDate(d)}
                disabled={future}
                accessibilityState={{ selected, disabled: future }}
                accessibilityLabel={d}
              >
                <Text style={[styles.dayCellDow, selected && styles.dayCellDowSelected, future && styles.dayCellFuture]}>{weekdayShort(d)}</Text>
                <Text style={[styles.dayCellNum, selected && styles.dayCellNumSelected, future && styles.dayCellFuture]}>{Number(d.slice(8, 10))}</Text>
                <View style={[styles.dayCellDot, d === today && !selected && styles.dayCellDotToday, d === today && selected && styles.dayCellDotTodaySel]} />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      <YearMonthDayPicker
        visible={pickerOpen}
        initialDate={new Date(selectedDate)}
        onSelect={(d) => { setPickerOpen(false); setSelectedDate(isoDate(d)); }}
        onClose={() => setPickerOpen(false)}
      />
      <PendingSyncBanner />
      <FlatList
        style={{ flex: 1 }}
        data={filtered}
        keyExtractor={(w) => String(w.id)}
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <View style={styles.summaryCard}>
              <View style={styles.summaryTopRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryCaption}>
                    {formatSummaryDate(selectedDate)} · {summary?.total_workers ?? 0} workers
                  </Text>
                  <Text style={styles.summaryTitle}>
                    {morningMarkedCount} of {activeWorkers.length} marked
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.copyButton}
                  onPress={handleCopyYesterday}
                  disabled={bulkBusy}
                  accessibilityLabel="Copy yesterday's attendance"
                >
                  {bulkBusy ? <ActivityIndicator color={colors.primary} size="small" /> : <Copy size={18} color={colors.primary} />}
                </TouchableOpacity>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${activeWorkers.length ? Math.round((morningMarkedCount / activeWorkers.length) * 100) : 0}%` as `${number}%` },
                  ]}
                />
              </View>
              <View style={styles.tileRow}>
                <StatTileBox value={summary?.present_today ?? 0} label="Present" fg={colors.present} bg={colors.presentTint} />
                {(summary?.slots ?? []).map((s, i) => {
                  const accent = TILE_ACCENTS[i % TILE_ACCENTS.length];
                  return <StatTileBox key={s.slot} value={s.present} label={s.slot} fg={accent.fg} bg={accent.bg} />;
                })}
                <StatTileBox value={leave.length} label="Leave" fg={colors.leave} bg={colors.leaveTint} />
              </View>
            </View>

            {isSunday && <Text style={styles.sundayNote}>Sunday defaults to Absent unless you mark a shift present.</Text>}

            <View style={styles.searchWrap}>
              <Search size={18} color={colors.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search workers"
                placeholderTextColor={colors.textSecondary}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
              />
            </View>

            {shifts.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shiftFilterRow}>
                {[{ key: "all", label: "All shifts" }, ...shifts.map((s) => ({ key: s.slot_key, label: s.label }))].map((c) => {
                  const selected = shiftFilter === c.key;
                  return (
                    <TouchableOpacity
                      key={c.key}
                      style={[styles.filterChip, selected && styles.filterChipSelected]}
                      onPress={() => setShiftFilter(c.key)}
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>{c.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {statusTab === "active" ? "No active workers match your search." : "No deactivated workers."}
          </Text>
        }
        renderItem={({ item }) => (
          <AttendanceRowCard
            worker={item}
            shifts={shiftFilter === "all" ? shifts : shifts.filter((s) => s.slot_key === shiftFilter)}
            getShiftStatus={(slotKey) => attendanceByWorkerSlot.get(`${item.id}:${slotKey}`)?.status}
            getShiftSource={(slotKey) => attendanceByWorkerSlot.get(`${item.id}:${slotKey}`)?.source}
            onSetShiftStatus={(slotKey, status) => handleSetShiftStatus(item, slotKey, status)}
            isOnLeave={leaveByWorker.has(item.id)}
            onToggleLeave={() => handleToggleLeave(item)}
            otHours={getDayOtHours(item)}
            onOpenOt={() => setOtModalWorker(item)}
            onDeactivate={() => handleDeactivate(item)}
            onPressDetail={() =>
              navigation.navigate("WorkerProfile", {
                workerId: item.id,
                workerName: item.name,
                workerStatus: item.status,
                deactivatedAt: item.deactivated_at,
              })
            }
          />
        )}
      />

      {statusTab === "active" && activeWorkers.length > 0 && (
        <TouchableOpacity
          style={[styles.markAllFab, bulkBusy && { opacity: 0.7 }]}
          onPress={handleBulkPresent}
          disabled={bulkBusy}
          accessibilityRole="button"
          accessibilityLabel={`Mark all present, ${morningPendingCount} pending`}
        >
          {bulkBusy ? <ActivityIndicator color={colors.surface} size="small" /> : <Check size={18} color={colors.surface} strokeWidth={2.6} />}
          <Text style={styles.markAllFabText}>Mark all</Text>
        </TouchableOpacity>
      )}

      <OtHoursModal
        visible={otModalWorker !== null}
        initialHours={otModalWorker ? getDayOtHours(otModalWorker) : 0}
        onConfirm={async (hours) => {
          if (otModalWorker) await handleSetDayOt(otModalWorker, hours);
          setOtModalWorker(null);
        }}
        onCancel={() => setOtModalWorker(null)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------
// Range view -- ported from the old AttendanceRangeScreen.tsx verbatim.
// ---------------------------------------------------------------------
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

const TILE_ACCENTS = [
  { fg: colors.primary, bg: colors.primaryTint },
  { fg: colors.evening, bg: colors.violetLight },
  { fg: colors.skyBlue, bg: colors.skyBlueLight },
  { fg: colors.coral, bg: colors.coralLight },
];

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Mon..Sun of the week containing `iso` (display only).
function weekDates(iso: string): string[] {
  const offset = (localDate(iso).getDay() + 6) % 7;
  const monday = addDays(iso, -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function weekdayShort(iso: string): string {
  return DOW_SHORT[localDate(iso).getDay()];
}

function formatMonthLabel(iso: string): string {
  const d = localDate(iso);
  return `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

function formatSummaryDate(iso: string): string {
  const d = localDate(iso);
  return `${DOW_SHORT[d.getDay()]}, ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

function StatTileBox({ value, label, fg, bg }: { value: number; label: string; fg: string; bg: string }) {
  return (
    <View style={[styles.tile, { backgroundColor: bg }]}>
      <Text style={[styles.tileValue, { color: fg }]}>{value}</Text>
      <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function formatJoinedLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

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
      {workers.map((worker) => {
        // Backend hard-rejects this anyway (main.py's mark_attendance) --
        // showing it as disabled here is purely so the owner isn't left
        // tapping tiles that silently fail one at a time.
        const notYetJoined = !!worker.date_of_joining && date < worker.date_of_joining;
        return (
          <View key={worker.id} style={styles.workerRow}>
            <Text style={styles.workerName}>{workerLabel(worker)}</Text>
            {notYetJoined ? (
              <View style={styles.notJoinedRow}>
                <Text style={styles.notJoinedText}>Joined {formatJoinedLabel(worker.date_of_joining!)}</Text>
              </View>
            ) : (
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
            )}
          </View>
        );
      })}
    </View>
  );
}

function RangeView() {
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
      // Keep whatever's already on screen -- see Day view's identical note.
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
      <View style={styles.dayContainer}>
        <ListSkeleton rows={3} variant="simple" />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.dayContainer}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl * 2 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        <Text style={styles.rangeSubtitle}>
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
  modePill: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.16)", borderRadius: radius.pill, padding: 3 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  modePillOption: { minHeight: 36, paddingHorizontal: 12, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  modePillOptionActive: { backgroundColor: colors.surface },
  modePillText: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 13, color: colors.surface },
  modePillTextActive: { fontFamily: "IBMPlexSans_700Bold", color: colors.primary },
  weekBand: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    gap: 10,
  },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthCenter: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  monthLabelButton: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.xs },
  monthLabel: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.surface },
  todayPill: { backgroundColor: "rgba(255,255,255,0.18)", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  todayPillText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.surface },
  weekNavButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" },
  weekNavButtonDisabled: { opacity: 0.35 },
  weekRow: { flexDirection: "row", gap: 6 },
  dayCell: { flex: 1, height: 62, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 2, backgroundColor: "rgba(255,255,255,0.10)" },
  dayCellSelected: { backgroundColor: colors.surface, elevation: 4, shadowColor: colors.primaryDark, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  dayCellDow: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 11, color: colors.onPrimaryMuted },
  dayCellDowSelected: { color: colors.primary },
  dayCellNum: { fontFamily: "IBMPlexSans_700Bold", fontSize: 17, color: colors.surface },
  dayCellNumSelected: { color: colors.primaryDark },
  dayCellFuture: { opacity: 0.5 },
  dayCellDot: { width: 5, height: 5, borderRadius: 3 },
  dayCellDotToday: { backgroundColor: colors.surface },
  dayCellDotTodaySel: { backgroundColor: colors.primary },
  listHeader: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: 12 },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
    elevation: 1,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  summaryTopRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  summaryCaption: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 12, color: colors.textSecondary, letterSpacing: 0.4, textTransform: "uppercase" },
  summaryTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.navy, marginTop: 2 },
  copyButton: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.ground, alignItems: "center", justifyContent: "center" },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.divider, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.present },
  tileRow: { flexDirection: "row", gap: spacing.sm },
  tile: { flex: 1, borderRadius: 12, paddingVertical: spacing.sm, paddingHorizontal: 4, alignItems: "center" },
  tileValue: { fontFamily: "IBMPlexSans_700Bold", fontSize: 20, fontVariant: ["tabular-nums"] },
  tileLabel: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 11, color: colors.textSecondary },
  filterChip: { height: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  filterChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 13, color: colors.navy },
  filterChipTextSelected: { color: colors.surface },
  markAllFab: {
    position: "absolute",
    right: spacing.md,
    bottom: 12,
    height: 48,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    elevation: 6,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  markAllFabText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.surface },
  container: { flex: 1, backgroundColor: colors.ground },
  header: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  subtitle: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  modeWrap: {},
  dayContainer: { flex: 1, backgroundColor: colors.ground },

  dateNavCard: { backgroundColor: colors.primary, marginHorizontal: spacing.md, marginTop: spacing.md, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  dateNavRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dateNavButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.heroDivider,
    alignItems: "center",
    justifyContent: "center",
  },
  dateNavButtonDisabled: { opacity: 0.3 },
  dateNavButtonText: { color: colors.surface, fontSize: 16, fontWeight: "700" },
  dateNavField: { flex: 1 },
  todayLink: { paddingHorizontal: spacing.sm, paddingVertical: 5, backgroundColor: colors.primary, borderRadius: radius.sm },
  todayLinkText: { color: colors.surface, fontSize: 11, fontWeight: "700" },
  statBlock: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  statBlockText: { flex: 1 },
  statPrimaryRow: { flexDirection: "row", gap: spacing.md, alignItems: "baseline" },
  statPrimaryItem: { fontSize: 18, fontWeight: "800", color: colors.navy },
  statPrimaryLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  statSecondaryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm + 2, rowGap: 4, marginTop: 6 },
  statDot: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statSecondaryText: { fontSize: 12, fontWeight: "600", color: colors.navy },
  copyChip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.ground,
    alignItems: "center",
    justifyContent: "center",
  },
  sundayNote: { color: colors.textSecondary, fontSize: 12, textAlign: "center" },
  complianceBanner: {
    backgroundColor: colors.warningTint,
    borderColor: colors.warningBorder,
    borderWidth: 1,
    borderRadius: radius.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  complianceBannerText: { color: colors.navy, fontSize: 12, fontWeight: "700" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 44,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, fontFamily: "IBMPlexSans_500Medium", fontSize: 14, color: colors.navy, paddingVertical: 0 },
  shiftFilterRow: { flexDirection: "row", gap: spacing.sm, paddingBottom: 2 },
  statusTabRow: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.xs },
  statusTab: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.sm, paddingVertical: spacing.sm - 2, alignItems: "center" },
  statusTabActive: { backgroundColor: colors.primary },
  statusTabActiveMuted: { backgroundColor: colors.primary },
  statusTabText: { fontSize: 12.5, fontWeight: "700", color: colors.textSecondary },
  statusTabTextActive: { color: colors.surface },
  statusTabTextActiveMuted: { color: colors.surface },
  empty: { textAlign: "center", color: colors.textSecondary, marginTop: 40 },
  stickyBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    shadowColor: colors.navy,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
    elevation: 6,
  },
  stickyBarText: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 13, color: colors.textSecondary },
  stickyBarButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stickyBarButtonText: { color: colors.surface, fontFamily: "IBMPlexSans_700Bold", fontSize: 13 },

  // Range view
  rangeSubtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
  rangeRow: { flexDirection: "row", gap: spacing.sm },
  warning: { fontSize: 12, color: colors.danger, marginTop: spacing.xs, marginBottom: spacing.sm },
  dayBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginTop: spacing.md,
  },
  dayTitle: { fontSize: 13, fontWeight: "700", color: colors.navy, marginBottom: spacing.sm },
  workerRow: { marginBottom: spacing.sm },
  workerName: { fontSize: 13, fontWeight: "600", color: colors.navy, marginBottom: 4 },
  notJoinedRow: { backgroundColor: colors.unmarkedTint, borderRadius: radius.sm, paddingVertical: spacing.sm + 2, alignItems: "center" },
  notJoinedText: { fontSize: 12, fontWeight: "700", color: colors.unmarked },
});
