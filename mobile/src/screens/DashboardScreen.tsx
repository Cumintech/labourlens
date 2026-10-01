import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  Attendance,
  AttendanceSlot,
  AttendanceStatus,
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
import Avatar from "../components/Avatar";
import Button from "../components/Button";
import DateField, { isoDate } from "../components/DateField";
import DayAttendanceRow from "../components/DayAttendanceRow";
import ErrorState from "../components/ErrorState";
import FilterChip from "../components/FilterChip";
import Icon from "../components/Icon";
import OtHoursModal from "../components/OtHoursModal";
import ScreenHeader from "../components/ScreenHeader";
import SegmentedControl from "../components/SegmentedControl";
import { ListSkeleton } from "../components/Skeleton";
import Snackbar from "../components/Snackbar";
import YearMonthDayPicker from "../components/YearMonthDayPicker";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { formatDateWithWeekday } from "../format";
import { colors, font, radius, spacing, MIN_TOUCH_TARGET } from "../theme";

// Mounted both as the "AttendanceTab" tab content (MainTabs.tsx) and as
// the "Dashboard" root-stack screen (RootNavigator.tsx, kept registered
// for back-compat) -- typed loosely against just `navigation` (never
// reads `route`) so it satisfies either mount point's prop shape, same
// pattern HomeScreen/WorkersScreen use for the same reason.
type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };
type Mode = "day" | "range";

function todayString() {
  return isoDate(new Date());
}
function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return isoDate(d);
}
function datesBetween(from: string, to: string, maxDays: number): string[] {
  const dates: string[] = [];
  let d = from;
  let guard = 0;
  while (d <= to && guard <= maxDays) {
    dates.push(d);
    d = addDays(d, 1);
    guard += 1;
  }
  return dates;
}

const MAX_RANGE_DAYS = 31;

// A past bulk-mark action's prior state, captured before it runs so
// "Undo" can replay every changed row's exact prior status. A worker with
// no prior row for the shift reverts to Absent on undo, not back to "no
// row" -- there is no delete-attendance endpoint on the backend to
// restore true unmarked-ness, and extending the API is out of scope for
// this pass (confirmed as the accepted tradeoff rather than adding one).
type PriorState = { priorAttendance: { status: AttendanceStatus; overtimeHours: number } | null; priorLeave: LeaveEntry | null };

export default function DashboardScreen({ navigation }: Props) {
  const { token, owner } = useAuth();
  const insets = useSafeAreaInsets();
  const today = useMemo(todayString, []);

  const [mode, setMode] = useState<Mode>("day");

  // --- Day mode state ---
  const [selectedDate, setSelectedDate] = useState(today);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leave, setLeave] = useState<LeaveEntry[]>([]);
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [missingComplianceCount, setMissingComplianceCount] = useState(0);
  const [firstMissingWorker, setFirstMissingWorker] = useState<Worker | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [otModalWorker, setOtModalWorker] = useState<Worker | null>(null);
  const [menuWorker, setMenuWorker] = useState<Worker | null>(null);

  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [shiftFilter, setShiftFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "deactivated">("active");

  const [shiftPickerOpen, setShiftPickerOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<{ message: string; undo: () => void } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const [w, a, s, missing, l] = await Promise.all([
      listWorkers(token),
      listAttendance(token, selectedDate),
      listShiftConfigs(token),
      listWorkersMissingCompliance(token),
      listLeaveForDate(token, selectedDate),
    ]);
    setWorkers(w);
    setAttendance(a);
    setShifts(s);
    setMissingComplianceCount(missing.length);
    setFirstMissingWorker(missing[0] ?? null);
    setLeave(l);
  }, [token, selectedDate]);

  useFocusEffect(
    useCallback(() => {
      if (mode !== "day") return;
      load()
        .then(() => setLoadError(false))
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false));
    }, [load, mode]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
      setLoadError(false);
    } catch {
      // Keep whatever's already on screen.
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

  const activeWorkers = workers.filter((w) => w.status === "active");
  const total = activeWorkers.length;
  const presentCount = activeWorkers.filter((w) => shifts.some((s) => attendanceByWorkerSlot.get(`${w.id}:${s.slot_key}`)?.status === "present")).length;
  const markedCount = activeWorkers.filter(
    (w) => leaveByWorker.has(w.id) || shifts.some((s) => attendanceByWorkerSlot.get(`${w.id}:${s.slot_key}`) !== undefined),
  ).length;
  const pendingCount = Math.max(total - markedCount, 0);

  async function handleSetShiftStatus(worker: Worker, slot: AttendanceSlot, status: AttendanceStatus) {
    if (!token) return;
    const key = `${worker.id}:${slot}`;
    const current = attendanceByWorkerSlot.get(key);
    try {
      const updated = await markAttendance(token, worker.id, selectedDate, slot, status, current?.overtime_hours ?? 0);
      setAttendance((prev) => [...prev.filter((a) => !(a.worker_id === worker.id && a.slot === slot)), updated]);
      if (status === "present") {
        const existingLeave = leaveByWorker.get(worker.id);
        if (existingLeave) {
          await deleteLeaveEntry(token, existingLeave.id);
          setLeave((prev) => prev.filter((l) => l.id !== existingLeave.id));
        }
      }
    } catch {
      Alert.alert("Could not update attendance", "Please try again.");
    }
  }

  // Tapping an already-present shift sets it Absent (not back to a true
  // "unmarked" 3rd state) -- the backend has no way to delete an
  // attendance row, only create/update present|absent, so a tap cycle
  // can only ever move between those two real states.
  function handleTapShift(worker: Worker, slot: AttendanceSlot) {
    const current = attendanceByWorkerSlot.get(`${worker.id}:${slot}`);
    const next: AttendanceStatus = current?.status === "present" ? "absent" : "present";
    handleSetShiftStatus(worker, slot, next);
  }

  async function handleToggleLeave(worker: Worker) {
    if (!token) return;
    const existing = leaveByWorker.get(worker.id);
    try {
      if (existing) {
        await deleteLeaveEntry(token, existing.id);
        setLeave((prev) => prev.filter((l) => l.id !== existing.id));
      } else {
        const presentShifts = shifts.filter((s) => attendanceByWorkerSlot.get(`${worker.id}:${s.slot_key}`)?.status === "present");
        for (const shift of presentShifts) {
          const cleared = await markAttendance(token, worker.id, selectedDate, shift.slot_key, "absent", 0);
          setAttendance((prev) => [...prev.filter((a) => !(a.worker_id === worker.id && a.slot === shift.slot_key)), cleared]);
        }
        const created = await createLeaveEntry(token, worker.id, { leave_type: "earned", date_from: selectedDate, date_to: selectedDate, days: 1 });
        setLeave((prev) => [...prev, created]);
      }
    } catch {
      Alert.alert("Could not update leave", "Please try again.");
    }
  }

  function getDayOtHours(worker: Worker): number {
    return shifts.reduce((sum, s) => sum + (attendanceByWorkerSlot.get(`${worker.id}:${s.slot_key}`)?.overtime_hours ?? 0), 0);
  }

  const canonicalOtShift = shifts[shifts.length - 1];

  async function handleSetDayOt(worker: Worker, hours: number) {
    if (!token || !canonicalOtShift) return;
    try {
      for (const shift of shifts) {
        if (shift.slot_key === canonicalOtShift.slot_key) continue;
        const current = attendanceByWorkerSlot.get(`${worker.id}:${shift.slot_key}`);
        if (current && current.overtime_hours) {
          const cleared = await markAttendance(token, worker.id, selectedDate, shift.slot_key, current.status, 0);
          setAttendance((prev) => [...prev.filter((a) => !(a.worker_id === worker.id && a.slot === shift.slot_key)), cleared]);
        }
      }
      const currentCanonical = attendanceByWorkerSlot.get(`${worker.id}:${canonicalOtShift.slot_key}`);
      const updated = await markAttendance(token, worker.id, selectedDate, canonicalOtShift.slot_key, currentCanonical?.status ?? "absent", hours);
      setAttendance((prev) => [...prev.filter((a) => !(a.worker_id === worker.id && a.slot === canonicalOtShift.slot_key)), updated]);
    } catch {
      Alert.alert("Could not update overtime", "Please try again.");
    }
  }

  function handleDeactivate(worker: Worker) {
    Alert.alert("Deactivate worker", `Deactivate ${worker.name}?`, [
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
    ]);
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

  function openShiftPicker() {
    setShiftPickerOpen(true);
  }

  async function runBulkPresent(shift: ShiftConfig) {
    if (!token) return;
    setShiftPickerOpen(false);
    setBulkBusy(true);
    const byWorker = new Map<number, PriorState>();
    for (const w of activeWorkers) {
      const row = attendanceByWorkerSlot.get(`${w.id}:${shift.slot_key}`);
      byWorker.set(w.id, {
        priorAttendance: row ? { status: row.status, overtimeHours: row.overtime_hours } : null,
        priorLeave: leaveByWorker.get(w.id) ?? null,
      });
    }

    try {
      let changedCount = 0;
      for (const worker of activeWorkers) {
        const prior = byWorker.get(worker.id);
        if (prior?.priorAttendance?.status === "present") continue;
        await markAttendance(token, worker.id, selectedDate, shift.slot_key, "present", prior?.priorAttendance?.overtimeHours ?? 0);
        const existingLeave = leaveByWorker.get(worker.id);
        if (existingLeave) await deleteLeaveEntry(token, existingLeave.id);
        changedCount += 1;
      }
      await load();
      setSnackbar({
        message: `Marked ${changedCount} worker${changedCount === 1 ? "" : "s"} present for ${shift.label}`,
        undo: () => undoBulkPresent(shift, byWorker),
      });
    } catch {
      Alert.alert("Could not mark everyone present", "Some workers may not have been updated. Please check and try again.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function undoBulkPresent(shift: ShiftConfig, byWorker: Map<number, PriorState>) {
    if (!token) return;
    setBulkBusy(true);
    try {
      for (const [workerId, prior] of byWorker.entries()) {
        if (prior.priorAttendance) {
          await markAttendance(token, workerId, selectedDate, shift.slot_key, prior.priorAttendance.status, prior.priorAttendance.overtimeHours);
        } else {
          // No delete-attendance endpoint exists -- the closest available
          // restoration of "had no record" is Absent, not a blank cell.
          await markAttendance(token, workerId, selectedDate, shift.slot_key, "absent", 0);
        }
        if (prior.priorLeave) {
          await createLeaveEntry(token, workerId, {
            leave_type: prior.priorLeave.leave_type,
            date_from: prior.priorLeave.date_from,
            date_to: prior.priorLeave.date_to,
            days: prior.priorLeave.days,
          });
        }
      }
      await load();
    } catch {
      Alert.alert("Could not undo", "Some workers may not have been reverted. Please check and try again.");
    } finally {
      setBulkBusy(false);
    }
  }

  function shiftStatusLabel(worker: Worker): string {
    if (leaveByWorker.has(worker.id)) return "On leave";
    const presentLabels = shifts.filter((s) => attendanceByWorkerSlot.get(`${worker.id}:${s.slot_key}`)?.status === "present").map((s) => s.label);
    if (presentLabels.length > 0) return presentLabels.join(", ");
    const anyAbsent = shifts.some((s) => attendanceByWorkerSlot.get(`${worker.id}:${s.slot_key}`)?.status === "absent");
    return anyAbsent ? "Absent" : "Not marked";
  }

  const deactivatedWorkers = workers.filter((w) => w.status !== "active");
  const visibleWorkers = (statusFilter === "active" ? activeWorkers : deactivatedWorkers).filter((w) => {
    if (shiftFilter !== "all" && statusFilter === "active") {
      const row = attendanceByWorkerSlot.get(`${w.id}:${shiftFilter}`);
      if (row?.status !== "present") return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return w.name.toLowerCase().includes(q) || (w.numeric_employee_code ?? "").toLowerCase().includes(q);
  });

  const isToday = selectedDate === today;
  const activeFilterCount = (shiftFilter !== "all" ? 1 : 0) + (statusFilter !== "active" ? 1 : 0);

  // First two configured shifts are shown as their own hero tiles
  // (Present + shift 1 + shift 2 + Leave = this hero's fixed 4-tile
  // layout) -- a factory with a 3rd/4th shift still gets full per-shift
  // breakdown in the row toggles and the filter sheet, just not a 5th
  // hero tile.
  const heroShifts = shifts.slice(0, 2);

  if (mode === "day" && loading) {
    return (
      <View style={styles.container}>
        <ListSkeleton rows={5} />
      </View>
    );
  }

  if (mode === "day" && loadError && workers.length === 0) {
    return (
      <View style={styles.container}>
        <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: (mode === "day" ? 90 : spacing.xl) + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader
          title="Attendance"
          subtitle={owner?.factory_name}
          right={
            <SegmentedControl
              options={[{ label: "Day", value: "day" }, { label: "Range", value: "range" }]}
              value={mode}
              onChange={setMode}
              style={{ width: 160 }}
            />
          }
        />

        {mode === "day" ? (
          <>
            <View style={styles.hero}>
              <View style={styles.dateNavRow}>
                <TouchableOpacity style={styles.dateNavButton} onPress={() => setSelectedDate((d) => addDays(d, -1))}>
                  <Icon name="chevronLeft" size={18} color={colors.white} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.dateLabel} onPress={() => setDatePickerOpen(true)}>
                  <Icon name="calendar" size={15} color={colors.white} />
                  <Text style={styles.dateLabelText}>{formatDateWithWeekday(selectedDate)}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.dateNavButton, isToday && styles.dateNavButtonDisabled]}
                  onPress={() => !isToday && setSelectedDate((d) => addDays(d, 1))}
                  disabled={isToday}
                >
                  <Icon name="chevronRight" size={18} color={colors.white} />
                </TouchableOpacity>
              </View>

              <View style={styles.tileRow}>
                <View style={[styles.tile, styles.tileSelected]}>
                  <Text style={[styles.tileValue, styles.tileValueSelected]}>
                    {presentCount}/{total}
                  </Text>
                  <Text style={[styles.tileLabel, styles.tileLabelSelected]}>Present</Text>
                </View>
                {heroShifts.map((shift) => (
                  <View key={shift.slot_key} style={styles.tile}>
                    <Text style={styles.tileValue}>{activeWorkers.filter((w) => attendanceByWorkerSlot.get(`${w.id}:${shift.slot_key}`)?.status === "present").length}</Text>
                    <Text style={styles.tileLabel}>{shift.label}</Text>
                  </View>
                ))}
                <View style={styles.tile}>
                  <Text style={styles.tileValue}>{leave.length}</Text>
                  <Text style={styles.tileLabel}>Leave</Text>
                </View>
              </View>
            </View>

            {missingComplianceCount > 0 && (
              <TouchableOpacity style={styles.warnRow} onPress={handleMissingCompliancePress}>
                <View style={styles.warnBadge}>
                  <Text style={styles.warnBadgeText}>{missingComplianceCount}</Text>
                </View>
                <Text style={styles.warnText}>
                  worker{missingComplianceCount === 1 ? "" : "s"} need{missingComplianceCount === 1 ? "s" : ""} Form 12 details
                </Text>
                <Icon name="chevronRight" size={16} color={colors.leave} />
              </TouchableOpacity>
            )}

            <View style={styles.searchFilterRow}>
              <View style={styles.searchRow}>
                <Icon name="search" size={16} color={colors.muted} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search workers"
                  placeholderTextColor={colors.muted}
                  value={search}
                  onChangeText={setSearch}
                  autoCapitalize="none"
                />
              </View>
              <TouchableOpacity style={styles.filterButton} onPress={() => setFilterSheetOpen(true)}>
                <Icon name="filter" size={17} color={colors.text} />
                {activeFilterCount > 0 && (
                  <View style={styles.filterBadge}>
                    <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {visibleWorkers.length === 0 ? (
              <Text style={styles.empty}>No workers match.</Text>
            ) : (
              <View style={styles.card}>
                {visibleWorkers.map((worker, i) => (
                  <View key={worker.id}>
                    <View style={styles.row}>
                      <TouchableOpacity
                        style={styles.rowMain}
                        onPress={() =>
                          navigation.navigate("WorkerAttendance", {
                            workerId: worker.id,
                            workerName: worker.name,
                            workerStatus: worker.status,
                            deactivatedAt: worker.deactivated_at,
                          })
                        }
                      >
                        <Avatar name={worker.name} workerId={worker.id} />
                        <View style={styles.rowText}>
                          <Text style={styles.name} numberOfLines={1}>
                            {worker.name}
                          </Text>
                          <Text style={styles.meta} numberOfLines={1}>
                            {worker.numeric_employee_code ? `#${worker.numeric_employee_code}` : "no code"} · {shiftStatusLabel(worker)}
                          </Text>
                        </View>
                      </TouchableOpacity>

                      {worker.status === "active" && (
                        <View style={styles.togglesRow}>
                          {shifts.map((shift) => {
                            const status = attendanceByWorkerSlot.get(`${worker.id}:${shift.slot_key}`)?.status;
                            const isPresent = status === "present";
                            return (
                              <TouchableOpacity
                                key={shift.slot_key}
                                style={[styles.toggle, isPresent && styles.toggleOn]}
                                onPress={() => handleTapShift(worker, shift.slot_key)}
                              >
                                <Text style={[styles.toggleText, isPresent && styles.toggleTextOn]}>{shift.label[0]?.toUpperCase()}</Text>
                              </TouchableOpacity>
                            );
                          })}
                          <TouchableOpacity
                            style={[styles.toggle, leaveByWorker.has(worker.id) && styles.toggleOnLeave]}
                            onPress={() => handleToggleLeave(worker)}
                          >
                            <Text style={[styles.toggleText, leaveByWorker.has(worker.id) && styles.toggleTextOn]}>L</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.toggle} onPress={() => setMenuWorker(worker)}>
                            <Text style={styles.toggleText}>⋯</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                    {i < visibleWorkers.length - 1 && <View style={styles.rowDivider} />}
                  </View>
                ))}
              </View>
            )}
          </>
        ) : (
          <RangeMode />
        )}
      </ScrollView>

      {mode === "day" && (
        <View style={[styles.stickyBar, { paddingBottom: spacing.sm + insets.bottom }]}>
          <View>
            <Text style={styles.stickyMain}>
              {markedCount} of {total} marked
            </Text>
            <Text style={styles.stickySub}>{pendingCount} pending</Text>
          </View>
          <Button label="Mark all" icon={<Icon name="check" size={15} color={colors.white} />} onPress={openShiftPicker} loading={bulkBusy} />
        </View>
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

      <YearMonthDayPicker
        visible={datePickerOpen}
        initialDate={new Date(selectedDate)}
        onSelect={(d) => {
          setDatePickerOpen(false);
          setSelectedDate(isoDate(d));
        }}
        onClose={() => setDatePickerOpen(false)}
      />

      {/* Per-row overflow menu: OT + Deactivate, the two lower-frequency
          actions that don't fit alongside the M/E/L toggles. */}
      <Modal visible={menuWorker !== null} transparent animationType="fade" onRequestClose={() => setMenuWorker(null)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuWorker(null)}>
          <View style={styles.menuSheet} onStartShouldSetResponder={() => true}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                const w = menuWorker;
                setMenuWorker(null);
                if (w) setOtModalWorker(w);
              }}
            >
              <Text style={styles.menuItemText}>{menuWorker && getDayOtHours(menuWorker) > 0 ? `Mark OT (${getDayOtHours(menuWorker)}h)` : "Mark OT"}</Text>
            </TouchableOpacity>
            <View style={styles.rowDivider} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                const w = menuWorker;
                setMenuWorker(null);
                if (w) handleDeactivate(w);
              }}
            >
              <Text style={[styles.menuItemText, { color: colors.absent }]}>Deactivate</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Shift picker for "Mark all". */}
      <Modal visible={shiftPickerOpen} transparent animationType="fade" onRequestClose={() => setShiftPickerOpen(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setShiftPickerOpen(false)}>
          <View style={styles.menuSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>Mark all present for which shift?</Text>
            {shifts.map((shift, i) => (
              <View key={shift.slot_key}>
                <TouchableOpacity style={styles.menuItem} onPress={() => runBulkPresent(shift)}>
                  <Text style={styles.menuItemText}>{shift.label}</Text>
                </TouchableOpacity>
                {i < shifts.length - 1 && <View style={styles.rowDivider} />}
              </View>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Filter bottom sheet. */}
      <Modal visible={filterSheetOpen} transparent animationType="fade" onRequestClose={() => setFilterSheetOpen(false)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setFilterSheetOpen(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>Shift</Text>
            <View style={styles.sheetChipsRow}>
              <FilterChip label="All" active={shiftFilter === "all"} onPress={() => setShiftFilter("all")} />
              {shifts.map((s) => (
                <FilterChip key={s.slot_key} label={s.label} active={shiftFilter === s.slot_key} onPress={() => setShiftFilter(s.slot_key)} />
              ))}
            </View>
            <Text style={[styles.sheetTitle, { marginTop: spacing.md }]}>Status</Text>
            <View style={styles.sheetChipsRow}>
              <FilterChip label="Active" active={statusFilter === "active"} onPress={() => setStatusFilter("active")} />
              <FilterChip label="Deactivated" active={statusFilter === "deactivated"} onPress={() => setStatusFilter("deactivated")} />
            </View>
            <Button label="Done" onPress={() => setFilterSheetOpen(false)} style={{ marginTop: spacing.lg }} />
          </View>
        </TouchableOpacity>
      </Modal>

      <Snackbar
        visible={snackbar !== null}
        message={snackbar?.message ?? ""}
        actionLabel="Undo"
        onAction={() => snackbar?.undo()}
        onDismiss={() => setSnackbar(null)}
        bottomOffset={mode === "day" ? 70 + insets.bottom : insets.bottom}
      />
    </View>
  );
}

// --- Range mode -------------------------------------------------------

function RangeMode() {
  const { token } = useAuth();
  const today = useMemo(todayString, []);
  const [fromDate, setFromDate] = useState(addDays(today, -6));
  const [toDate, setToDate] = useState(today);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);
  const [rangeLoading, setRangeLoading] = useState(true);
  const [rangeError, setRangeError] = useState(false);
  const [attendanceByDate, setAttendanceByDate] = useState<Record<string, Attendance[]>>({});
  const [leaveByDate, setLeaveByDate] = useState<Record<string, LeaveEntry[]>>({});
  const [otModalTarget, setOtModalTarget] = useState<{ date: string; worker: Worker } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      Promise.all([listWorkers(token), listShiftConfigs(token)])
        .then(([w, s]) => {
          setWorkers(w.filter((worker) => worker.status === "active"));
          setShifts(s);
        })
        .catch(() => {});
    }, [token]),
  );

  const rangeInvalid = toDate < fromDate;
  const dates = rangeInvalid ? [] : datesBetween(fromDate, toDate, MAX_RANGE_DAYS);
  const rangeTooLong = !rangeInvalid && dates.length > MAX_RANGE_DAYS;
  const datesKey = dates.join(",");

  const loadRange = useCallback(async () => {
    if (!token || dates.length === 0) return;
    const results = await Promise.all(
      dates.map((date) => Promise.all([listAttendance(token, date), listLeaveForDate(token, date)]).then(([a, l]) => [date, a, l] as const)),
    );
    const aMap: Record<string, Attendance[]> = {};
    const lMap: Record<string, LeaveEntry[]> = {};
    for (const [date, a, l] of results) {
      aMap[date] = a;
      lMap[date] = l;
    }
    setAttendanceByDate(aMap);
    setLeaveByDate(lMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, datesKey]);

  useEffect(() => {
    if (!token || rangeInvalid || rangeTooLong || dates.length === 0) return;
    let cancelled = false;
    setRangeLoading(true);
    loadRange()
      .then(() => !cancelled && setRangeError(false))
      .catch(() => !cancelled && setRangeError(true))
      .finally(() => !cancelled && setRangeLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token, loadRange, rangeInvalid, rangeTooLong, dates.length]);

  async function handleSetStatus(date: string, worker: Worker, slot: AttendanceSlot, status: AttendanceStatus) {
    if (!token) return;
    const dayRecords = attendanceByDate[date] ?? [];
    const current = dayRecords.find((a) => a.worker_id === worker.id && a.slot === slot);
    try {
      const updated = await markAttendance(token, worker.id, date, slot, status, current?.overtime_hours ?? 0);
      setAttendanceByDate((prev) => ({ ...prev, [date]: [...(prev[date] ?? []).filter((a) => !(a.worker_id === worker.id && a.slot === slot)), updated] }));
      if (status === "present") {
        const existingLeave = (leaveByDate[date] ?? []).find((l) => l.worker_id === worker.id);
        if (existingLeave) {
          await deleteLeaveEntry(token, existingLeave.id);
          setLeaveByDate((prev) => ({ ...prev, [date]: (prev[date] ?? []).filter((l) => l.id !== existingLeave.id) }));
        }
      }
    } catch {
      Alert.alert("Could not update attendance", "Please try again.");
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
          setAttendanceByDate((prev) => ({ ...prev, [date]: [...(prev[date] ?? []).filter((a) => !(a.worker_id === worker.id && a.slot === shift.slot_key)), cleared] }));
        }
        const created = await createLeaveEntry(token, worker.id, { leave_type: "earned", date_from: date, date_to: date, days: 1 });
        setLeaveByDate((prev) => ({ ...prev, [date]: [...(prev[date] ?? []), created] }));
      }
    } catch {
      Alert.alert("Could not update leave", "Please try again.");
    }
  }

  function getDayOtHours(date: string, worker: Worker): number {
    const dayRecords = attendanceByDate[date] ?? [];
    return shifts.reduce((sum, s) => sum + (dayRecords.find((a) => a.worker_id === worker.id && a.slot === s.slot_key)?.overtime_hours ?? 0), 0);
  }

  async function handleSetDayOt(date: string, worker: Worker, hours: number) {
    if (!token) return;
    const canonical = shifts[shifts.length - 1];
    if (!canonical) return;
    try {
      const dayRecords = attendanceByDate[date] ?? [];
      for (const shift of shifts) {
        if (shift.slot_key === canonical.slot_key) continue;
        const current = dayRecords.find((a) => a.worker_id === worker.id && a.slot === shift.slot_key);
        if (current && current.overtime_hours) {
          const cleared = await markAttendance(token, worker.id, date, shift.slot_key, current.status, 0);
          setAttendanceByDate((prev) => ({ ...prev, [date]: [...(prev[date] ?? []).filter((a) => !(a.worker_id === worker.id && a.slot === shift.slot_key)), cleared] }));
        }
      }
      const currentCanonical = dayRecords.find((a) => a.worker_id === worker.id && a.slot === canonical.slot_key);
      const updated = await markAttendance(token, worker.id, date, canonical.slot_key, currentCanonical?.status ?? "absent", hours);
      setAttendanceByDate((prev) => ({ ...prev, [date]: [...(prev[date] ?? []).filter((a) => !(a.worker_id === worker.id && a.slot === canonical.slot_key)), updated] }));
    } catch {
      Alert.alert("Could not update overtime", "Please try again.");
    }
  }

  return (
    <View>
      <Text style={styles.rangeSubtitle}>Pick a date range -- every day in it shows up as its own editable section.</Text>
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
        <ErrorState onRetry={() => setRangeLoading(true)} />
      ) : rangeLoading && !rangeInvalid && !rangeTooLong ? (
        <ListSkeleton rows={3} variant="simple" />
      ) : (
        !rangeInvalid &&
        !rangeTooLong &&
        dates.map((date) => {
          const dayAttendance = attendanceByDate[date] ?? [];
          const dayLeave = leaveByDate[date] ?? [];
          const byWorkerSlot = new Map<string, Attendance>();
          for (const a of dayAttendance) byWorkerSlot.set(`${a.worker_id}:${a.slot}`, a);
          const leaveWorkerIds = new Set(dayLeave.map((l) => l.worker_id));
          return (
            <View key={date} style={styles.dayBlock}>
              <Text style={styles.dayTitle}>{formatDateWithWeekday(date)}</Text>
              {workers.map((worker) => (
                <View key={worker.id} style={styles.dayWorkerRow}>
                  <Text style={styles.dayWorkerName}>
                    {worker.name} {worker.numeric_employee_code ? `#${worker.numeric_employee_code}` : ""}
                  </Text>
                  <DayAttendanceRow
                    shifts={shifts}
                    getShiftStatus={(slotKey) => byWorkerSlot.get(`${worker.id}:${slotKey}`)?.status}
                    getShiftSource={(slotKey) => byWorkerSlot.get(`${worker.id}:${slotKey}`)?.source}
                    onSetShiftStatus={(slotKey, status) => handleSetStatus(date, worker, slotKey, status)}
                    isOnLeave={leaveWorkerIds.has(worker.id)}
                    onToggleLeave={() => handleToggleLeave(date, worker)}
                    otHours={getDayOtHours(date, worker)}
                    onOpenOt={() => setOtModalTarget({ date, worker })}
                  />
                </View>
              ))}
            </View>
          );
        })
      )}

      <OtHoursModal
        visible={otModalTarget !== null}
        initialHours={otModalTarget ? getDayOtHours(otModalTarget.date, otModalTarget.worker) : 0}
        onConfirm={async (hours) => {
          if (otModalTarget) await handleSetDayOt(otModalTarget.date, otModalTarget.worker, hours);
          setOtModalTarget(null);
        }}
        onCancel={() => setOtModalTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },

  hero: { backgroundColor: colors.primary, borderRadius: radius.hero, padding: spacing.md, marginTop: spacing.md },
  dateNavRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dateNavButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  dateNavButtonDisabled: { opacity: 0.35 },
  dateLabel: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  dateLabelText: { color: colors.white, fontSize: 15, fontFamily: font.semiBold },
  tileRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.md },
  tile: { flex: 1, backgroundColor: colors.primaryDark, borderRadius: radius.control, paddingVertical: spacing.sm + 2, alignItems: "center" },
  tileSelected: { backgroundColor: colors.white },
  tileValue: { color: colors.white, fontSize: 17, fontFamily: font.bold },
  tileValueSelected: { color: colors.primary },
  tileLabel: { color: colors.onPrimaryMuted, fontSize: 10.5, fontFamily: font.medium, marginTop: 2 },
  tileLabelSelected: { color: colors.primary },

  warnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.warnBg,
    borderRadius: radius.control,
    padding: spacing.sm + 4,
    marginTop: spacing.md,
  },
  warnBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.leave, alignItems: "center", justifyContent: "center" },
  warnBadgeText: { color: colors.white, fontSize: 12, fontFamily: font.bold },
  warnText: { flex: 1, color: colors.text, fontSize: 13, fontFamily: font.semiBold },

  searchFilterRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  searchRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    backgroundColor: colors.card,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm + 4,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: colors.text },
  filterButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.control,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadge: { position: "absolute", top: -4, right: -4, backgroundColor: colors.primary, borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  filterBadgeText: { color: colors.white, fontSize: 9.5, fontFamily: font.bold },

  empty: { textAlign: "center", color: colors.muted, marginTop: spacing.xl },
  card: { backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.sm + 4, gap: spacing.sm },
  rowMain: { flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0 },
  rowText: { flex: 1, marginLeft: spacing.sm, minWidth: 0 },
  name: { fontSize: 14.5, fontFamily: font.semiBold, color: colors.text },
  meta: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  rowDivider: { height: 1, backgroundColor: colors.divider, marginLeft: 14 },
  togglesRow: { flexDirection: "row", gap: 6 },
  toggle: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.divider, alignItems: "center", justifyContent: "center" },
  toggleOn: { backgroundColor: colors.primary },
  toggleOnLeave: { backgroundColor: colors.leave },
  toggleText: { fontSize: 12, fontFamily: font.bold, color: colors.muted },
  toggleTextOn: { color: colors.white },

  stickyBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stickyMain: { fontSize: 14, fontFamily: font.semiBold, color: colors.text },
  stickySub: { fontSize: 11.5, color: colors.muted, marginTop: 1 },

  menuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  menuSheet: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.sm, width: "78%" },
  menuItem: { paddingVertical: 14, paddingHorizontal: spacing.sm },
  menuItemText: { fontSize: 14.5, fontFamily: font.semiBold, color: colors.text },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.hero, borderTopRightRadius: radius.hero, padding: spacing.lg },
  sheetTitle: { fontSize: 12, fontFamily: font.semiBold, color: colors.muted, textTransform: "uppercase", marginBottom: spacing.sm },
  sheetChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs + 2 },

  rangeSubtitle: { fontSize: 13, color: colors.muted, marginTop: spacing.md, marginBottom: spacing.sm },
  rangeRow: { flexDirection: "row", gap: spacing.sm },
  warning: { fontSize: 12, color: colors.absent, marginTop: spacing.xs, marginBottom: spacing.sm },
  dayBlock: { backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: spacing.sm + 2, marginTop: spacing.md },
  dayTitle: { fontSize: 13, fontFamily: font.semiBold, color: colors.text, marginBottom: spacing.sm },
  dayWorkerRow: { marginBottom: spacing.sm },
  dayWorkerName: { fontSize: 13, fontFamily: font.semiBold, color: colors.text, marginBottom: 4 },
});
