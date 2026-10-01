import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Camera, Images } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, Alert, FlatList, Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  ApiError,
  Attendance,
  AttendanceStatus,
  LeaveEntry,
  ShiftConfig,
  WageProfile as WageProfileRow,
  Worker,
  WorkerCompliance,
  WorkerType,
  WorkerWage,
  assignWorkerType,
  createLeaveEntry,
  deactivateWorker,
  deleteLeaveEntry,
  generateAppointmentLetter,
  generateIdCard,
  getWageProfileHistory,
  getWorker,
  getWorkerCompliance,
  getWorkerWageComputation,
  listShiftConfigs,
  listWorkerAttendanceMonth,
  listWorkerLeaveRange,
  listWorkerTypes,
  markAttendance,
  uploadWorkerPhoto,
} from "../api/client";
import DayAttendanceRow from "../components/DayAttendanceRow";
import ErrorState from "../components/ErrorState";
import OtHoursModal from "../components/OtHoursModal";
import { ListSkeleton } from "../components/Skeleton";
import WorkerTypeSelect from "../components/WorkerTypeSelect";
import { SegmentedControl } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { sharePdfBytes } from "../pdfShare";
import { colors, radius, spacing, type } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "WorkerProfile">;
type Tab = "overview" | "attendance" | "wages" | "documents";

// Mirrors AddWorkerScreen's ID photo capture sizing exactly.
const ID_PHOTO_WIDTH = 400;
const ID_PHOTO_HEIGHT = 500;
const ID_PHOTO_JPEG_QUALITY = 0.65;

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

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const monthDiff = today.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate())) age -= 1;
  return age;
}

// Consolidates what used to be 3 separate destinations (WorkerAttendance,
// the old WageRateWorkerDetail, and a chunk of WorkerEdit's own display-only
// fields) into one hub with a SegmentedControl, per the v2 redesign spec.
// WorkerEdit and WageProfile still exist as their own screens -- reached
// from here via "Edit"/"Set rate" links -- since those are genuine forms,
// not just display, and duplicating a whole form inline here would just
// create a second place the same fields could drift out of sync.
//
// Hard requirement from the spec: never render the worker's Aadhaar number
// anywhere in this hub. `Worker.aadhaar_last4` (last 4 digits only) is
// deliberately not read or shown by any tab below.
export default function WorkerProfileScreen({ route, navigation }: Props) {
  const { workerId, workerName, workerStatus, deactivatedAt, initialTab } = route.params;
  const isActive = workerStatus === "active";
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>(initialTab ?? "overview");
  const [compliance, setCompliance] = useState<WorkerCompliance | null>(null);
  const [complianceLoaded, setComplianceLoaded] = useState(false);

  const loadCompliance = useCallback(async () => {
    if (!token) return;
    try {
      setCompliance(await getWorkerCompliance(token, workerId));
    } catch {
      setCompliance(null); // no Form 12 record yet -- not an error
    } finally {
      setComplianceLoaded(true);
    }
  }, [token, workerId]);

  useFocusEffect(
    useCallback(() => {
      loadCompliance();
    }, [loadCompliance]),
  );

  const completeness = useMemo(() => {
    const fields = compliance
      ? [compliance.father_or_spouse_name, compliance.designation_or_nature_of_work, compliance.epf_uan_no, compliance.esic_no, compliance.date_of_joining]
      : [];
    const filled = fields.filter((f) => !!f && f.trim() !== "").length;
    return { filled, total: 5, complete: filled === 5 };
  }, [compliance]);

  return (
    <View style={styles.container}>
      <View style={styles.headerCard}>
        <Text style={type.title}>{workerName}</Text>
        {!isActive && (
          <Text style={styles.deactivatedText}>
            Deactivated{deactivatedAt ? ` · ${deactivatedAt.slice(0, 10)}` : ""}
          </Text>
        )}
      </View>

      {complianceLoaded && (
        <TouchableOpacity
          style={styles.complianceCard}
          onPress={() => navigation.navigate("WorkerEdit", { workerId, workerName, workerStatus, deactivatedAt })}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.complianceTitle}>Form 12 details</Text>
            <Text style={styles.complianceSubtitle}>
              {completeness.complete ? "All details on file" : `${completeness.filled} of ${completeness.total} details filled`}
            </Text>
          </View>
          <Text style={styles.complianceLink}>{completeness.complete ? "View ›" : "Complete ›"}</Text>
        </TouchableOpacity>
      )}

      <View style={styles.segmentWrap}>
        <SegmentedControl<Tab>
          options={[
            { label: "Overview", value: "overview" },
            { label: "Attendance", value: "attendance" },
            { label: "Wages", value: "wages" },
            { label: "Documents", value: "documents" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      <View style={{ flex: 1 }}>
        {tab === "overview" && (
          <OverviewTab workerId={workerId} workerName={workerName} workerStatus={workerStatus} deactivatedAt={deactivatedAt} navigation={navigation} />
        )}
        {tab === "attendance" && <AttendanceTab workerId={workerId} />}
        {tab === "wages" && <WagesTab workerId={workerId} workerName={workerName} isActive={isActive} navigation={navigation} />}
        {tab === "documents" && <DocumentsTab workerId={workerId} />}
      </View>
    </View>
  );
}

function OverviewTab({
  workerId,
  workerName,
  workerStatus,
  deactivatedAt,
  navigation,
}: {
  workerId: number;
  workerName: string;
  workerStatus: string;
  deactivatedAt: string | null;
  navigation: Props["navigation"];
}) {
  const isActive = workerStatus === "active";
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [worker, setWorker] = useState<Worker | null>(null);
  const [workerTypes, setWorkerTypes] = useState<WorkerType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const [w, types] = await Promise.all([getWorker(token, workerId), listWorkerTypes(token)]);
    setWorker(w);
    setWorkerTypes(types);
  }, [token, workerId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false));
    }, [load]),
  );

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

  if (loading) return <ListSkeleton rows={2} variant="simple" />;
  if (loadError || !worker) {
    return <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />;
  }

  const age = ageFromDob(worker.dob);
  const workerTypeName = workerTypes.find((t) => t.id === worker.worker_type_id)?.name ?? "Not assigned";

  return (
    <ScrollView style={styles.tabScroll} contentContainerStyle={[styles.tabContent, { paddingBottom: spacing.xl + insets.bottom }]}>
      <View style={styles.infoCard}>
        <InfoRow label="Age" value={age !== null ? `${age} years` : "-"} />
        <InfoRow label="Gender" value={worker.gender ?? "-"} />
        <InfoRow label="Mobile" value={worker.mobile ?? "-"} />
        <InfoRow label="Worker type" value={workerTypeName} warn={!worker.worker_type_id} />
        <InfoRow label="Employee code" value={worker.numeric_employee_code ? `#${worker.numeric_employee_code}` : "Not assigned yet"} />
        <InfoRow label="Device ID" value={worker.device_user_id ?? "Not mapped"} warn={!worker.device_user_id} />
      </View>

      <TouchableOpacity
        style={styles.editButton}
        onPress={() => navigation.navigate("WorkerEdit", { workerId, workerName, workerStatus, deactivatedAt })}
      >
        <Text style={styles.editButtonText}>Edit Form 12 details &amp; payments</Text>
      </TouchableOpacity>

      {isActive && (
        <TouchableOpacity style={styles.deactivateButton} onPress={handleDeactivate}>
          <Text style={styles.deactivateButtonText}>Deactivate worker</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function InfoRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, warn && styles.infoValueWarn]}>{value}</Text>
    </View>
  );
}

// Body ported from the old standalone WorkerAttendanceScreen -- same
// month switcher, stat cards, this-month wage summary, and per-day
// DayAttendanceRow list -- minus the name/Edit/Deactivate header row,
// which now lives once at the hub level (see OverviewTab) instead of
// being duplicated per tab.
function AttendanceTab({ workerId }: { workerId: number }) {
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
  const [dateOfJoining, setDateOfJoining] = useState<string | null>(null);

  const monthStart = `${year}-${pad(month)}-01`;
  const monthEnd = `${year}-${pad(month)}-${pad(daysInMonth(month, year))}`;

  const load = useCallback(async () => {
    if (!token) return;
    const [a, l, s, w, worker] = await Promise.all([
      listWorkerAttendanceMonth(token, workerId, month, year),
      listWorkerLeaveRange(token, workerId, monthStart, monthEnd),
      listShiftConfigs(token),
      getWorkerWageComputation(token, workerId, month, year),
      getWorker(token, workerId),
    ]);
    setAttendance(a);
    setLeave(l);
    setShifts(s);
    setWage(w);
    setDateOfJoining(worker.date_of_joining);
  }, [token, workerId, month, year, monthStart, monthEnd]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false));
    }, [load]),
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

  if (loading || !token) return <ListSkeleton rows={5} variant="simple" />;
  if (loadError) {
    return <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />;
  }

  return (
    <>
      <FlatList
        style={styles.tabScroll}
        data={days}
        keyExtractor={(d) => d.dateStr}
        contentContainerStyle={{ paddingBottom: spacing.xl * 2 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View>
            <View style={styles.monthRow}>
              <TouchableOpacity style={styles.monthArrow} onPress={() => changeMonth(-1)}>
                <Text style={styles.monthArrowText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.monthLabel}>{MONTH_NAMES[month - 1]} {year}</Text>
              <TouchableOpacity style={styles.monthArrow} onPress={() => changeMonth(1)}>
                <Text style={styles.monthArrowText}>›</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.summaryRow}>
              <View style={[styles.statCard, { backgroundColor: colors.presentTint }]}>
                <Text style={[styles.statValue, { color: colors.present }]}>{summary.present}</Text>
                <Text style={styles.statLabel}>Present</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.absentTint }]}>
                <Text style={[styles.statValue, { color: colors.absentTintText }]}>{summary.absent}</Text>
                <Text style={styles.statLabel}>Absent</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.leaveTint }]}>
                <Text style={[styles.statValue, { color: colors.leave }]}>{summary.leaveDays}</Text>
                <Text style={styles.statLabel}>Leave</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.violetLight }]}>
                <Text style={[styles.statValue, { color: colors.violet }]}>{summary.otHours}h</Text>
                <Text style={styles.statLabel}>Overtime</Text>
              </View>
            </View>

            <View style={styles.monthWageCard}>
              {wage && wage.has_rate ? (
                <>
                  <View style={styles.monthWageTopRow}>
                    <Text style={styles.monthWageLabel}>Total wages this month</Text>
                    {wage.paid && (
                      <View style={styles.paidBadge}>
                        <Text style={styles.paidBadgeText}>Paid</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.monthWageValue}>₹{wage.net_wage.toFixed(2)}</Text>
                  <Text style={styles.monthWageDetail}>
                    Gross ₹{wage.gross_wage.toFixed(2)} · {wage.days_worked} day{wage.days_worked === 1 ? "" : "s"} worked
                  </Text>
                </>
              ) : (
                <Text style={styles.monthWageEmpty}>No wage rate set yet -- add one from the Wages tab to see wages here.</Text>
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
          // Backend hard-rejects this anyway (main.py's mark_attendance) --
          // showing it as disabled here is purely so the owner isn't left
          // tapping tiles that silently fail one at a time.
          const notYetJoined = !!dateOfJoining && item.dateStr < dateOfJoining;
          return (
            <View style={[styles.dayRow, isToday && styles.dayRowToday]}>
              <View style={styles.dateRow}>
                <Text style={styles.dateNumber}>{pad(item.day)}</Text>
                <Text style={styles.dateWeekday}>{item.weekday}</Text>
              </View>
              {notYetJoined ? (
                <View style={styles.notJoinedRow}>
                  <Text style={styles.notJoinedText}>
                    Joined {new Date(dateOfJoining!).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </Text>
                </View>
              ) : (
                <>
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
                  <View style={styles.shiftTagsRow}>
                    {shifts.map((shift) => {
                      const on = attendanceByDateSlot.get(`${item.dateStr}:${shift.slot_key}`)?.status === "present";
                      return (
                        <View key={shift.slot_key} style={[styles.shiftTag, on ? styles.shiftTagOn : styles.shiftTagOff]}>
                          <Text style={[styles.shiftTagText, on ? styles.shiftTagTextOn : styles.shiftTagTextOff]}>{shift.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
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

// Ported from the old WageRateWorkerDetailScreen -- worker-type
// assignment + current-rate display. Designation editing is dropped here
// (it now lives solely in WorkerEdit's Form 12 form, via the "Edit"
// link above) so there's exactly one editable surface for that field
// instead of two that could silently drift apart.
function WagesTab({
  workerId,
  workerName,
  isActive,
  navigation,
}: {
  workerId: number;
  workerName: string;
  isActive: boolean;
  navigation: Props["navigation"];
}) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [worker, setWorker] = useState<Worker | null>(null);
  const [workerTypes, setWorkerTypes] = useState<WorkerType[]>([]);
  const [wageHistory, setWageHistory] = useState<WageProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const [w, types, history] = await Promise.all([
      getWorker(token, workerId),
      listWorkerTypes(token),
      getWageProfileHistory(token, workerId),
    ]);
    setWorker(w);
    setWorkerTypes(types);
    setWageHistory(history);
  }, [token, workerId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false));
    }, [load]),
  );

  const currentRate = wageHistory[0]; // newest-first

  async function handleAssignType(typeId: number | null) {
    if (!token) return;
    setAssigning(true);
    try {
      const updated = await assignWorkerType(token, workerId, typeId);
      setWorker(updated);
      await load(); // an auto-created wage profile from the type's default may now exist
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server.";
      Alert.alert("Could not assign worker type", message);
    } finally {
      setAssigning(false);
    }
  }

  if (loading) return <ListSkeleton rows={2} variant="simple" />;
  if (loadError || !worker) {
    return <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />;
  }

  return (
    <ScrollView style={styles.tabScroll} contentContainerStyle={[styles.tabContent, { paddingBottom: spacing.xl + insets.bottom }]}>
      <View style={styles.rateSectionCard}>
        <View style={styles.rateSectionHead}>
          <Text style={styles.rateSectionTitle}>Worker type &amp; rate</Text>
          <TouchableOpacity onPress={() => navigation.navigate("WageProfile", { workerId, workerName })}>
            <Text style={styles.rateSectionEdit}>{currentRate ? "Edit / history" : "Set rate"}</Text>
          </TouchableOpacity>
        </View>
        <WorkerTypeSelect
          label="Worker type"
          token={token ?? ""}
          workerTypes={workerTypes}
          value={worker.worker_type_id}
          onChange={handleAssignType}
          onCreated={(created) => setWorkerTypes((prev) => [...prev, created])}
          noneLabel="No type assigned"
          disabled={assigning || !isActive}
        />
        <Text style={styles.helper}>Assigning a type sets this worker's rate to the type's default, unless they already have one.</Text>

        {currentRate ? (
          <View style={styles.rateCard}>
            <Text style={styles.rateValue}>
              ₹{currentRate.basic} / {currentRate.rate_type === "daily" ? "day" : "month"}
            </Text>
            <Text style={styles.rateDetail}>Effective from {currentRate.effective_from}</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.rateCardEmpty} onPress={() => navigation.navigate("WageProfile", { workerId, workerName })}>
            <Text style={styles.empty}>No wage rate set yet -- tap Set rate to add one.</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

// New tab -- neither the ID card nor the appointment letter had a home
// on the old WorkerAttendance/WageRateWorkerDetail screens (ID card was
// buried in WageRateWorkerDetail's profile card; the appointment letter
// endpoint existed on the backend but no screen called it at all).
function DocumentsTab({ workerId }: { workerId: number }) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [worker, setWorker] = useState<Worker | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [generatingCard, setGeneratingCard] = useState(false);
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [capturingPhoto, setCapturingPhoto] = useState(false);
  const [rawPhotoUri, setRawPhotoUri] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setWorker(await getWorker(token, workerId));
  }, [token, workerId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false));
    }, [load]),
  );

  // Same action either way -- there's no separately-stored PDF to "view"
  // vs. "reprint" (backend generates fresh from the stored photo every
  // call), so both states route through this one handler.
  async function handleGenerateCard() {
    if (!token) return;
    setGeneratingCard(true);
    try {
      const bytes = await generateIdCard(token, workerId);
      await sharePdfBytes(bytes, "id_card");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server.";
      Alert.alert("Could not generate ID card", message);
    } finally {
      setGeneratingCard(false);
    }
  }

  async function pickPhoto(source: "camera" | "gallery") {
    const permission =
      source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        source === "camera" ? "Camera permission needed" : "Photo library permission needed",
        `Enable ${source === "camera" ? "camera" : "photo library"} access to add an ID photo.`,
      );
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: "images",
      quality: 1,
      allowsEditing: true,
      aspect: [ID_PHOTO_WIDTH, ID_PHOTO_HEIGHT],
    };
    const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets[0]) return;
    setRawPhotoUri(result.assets[0].uri);
  }

  // Captures + uploads the missing photo, then falls straight into the
  // normal generate flow -- the whole point of this path is "the ID card
  // can't exist without a photo", not "stop and tell the user to go find
  // one elsewhere".
  async function handleConfirmPhotoThenGenerate() {
    if (!rawPhotoUri || !token) return;
    setUploadingPhoto(true);
    try {
      const rendered = await ImageManipulator.manipulate(rawPhotoUri).resize({ width: ID_PHOTO_WIDTH, height: ID_PHOTO_HEIGHT }).renderAsync();
      const saved = await rendered.saveAsync({ compress: ID_PHOTO_JPEG_QUALITY, format: SaveFormat.JPEG });
      await uploadWorkerPhoto(token, workerId, saved.uri);
      setCapturingPhoto(false);
      setRawPhotoUri(null);
      await load();
      await handleGenerateCard();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't process or upload that photo.";
      Alert.alert("Photo upload failed", message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleGenerateLetter() {
    if (!token) return;
    setGeneratingLetter(true);
    try {
      const bytes = await generateAppointmentLetter(token, workerId);
      await sharePdfBytes(bytes, "appointment_letter");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server.";
      Alert.alert("Could not generate appointment letter", message);
    } finally {
      setGeneratingLetter(false);
    }
  }

  if (loading) return <ListSkeleton rows={2} variant="simple" />;
  if (loadError || !worker) {
    return <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />;
  }

  return (
    <ScrollView style={styles.tabScroll} contentContainerStyle={[styles.tabContent, { paddingBottom: spacing.xl + insets.bottom }]}>
      <View style={{ marginBottom: spacing.sm }}>
        <View style={styles.docRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.docTitle}>ID Card</Text>
            <Text style={[styles.docStatus, worker.photo_key ? styles.docStatusOk : styles.docStatusWarn]}>
              {worker.photo_key ? "Generated from the photo on file" : "No ID photo on file yet"}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => (worker.photo_key ? handleGenerateCard() : setCapturingPhoto(true))}
            disabled={generatingCard}
            style={styles.docButton}
          >
            {generatingCard ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={styles.docButtonText}>{worker.photo_key ? "View / Reprint" : "Add photo & generate"}</Text>
            )}
          </TouchableOpacity>
        </View>

        {capturingPhoto && !rawPhotoUri && (
          <View style={styles.photoCaptureRow}>
            <TouchableOpacity style={styles.photoCaptureOption} onPress={() => pickPhoto("camera")}>
              <Camera size={22} color={colors.teal} />
              <Text style={styles.photoCaptureLabel}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoCaptureOption} onPress={() => pickPhoto("gallery")}>
              <Images size={22} color={colors.teal} />
              <Text style={styles.photoCaptureLabel}>Choose from Gallery</Text>
            </TouchableOpacity>
          </View>
        )}

        {rawPhotoUri && (
          <View style={styles.photoPreviewWrap}>
            <Image source={{ uri: rawPhotoUri }} style={styles.photoPreview} resizeMode="cover" />
            <View style={styles.photoPreviewActions}>
              <TouchableOpacity onPress={() => setRawPhotoUri(null)} disabled={uploadingPhoto}>
                <Text style={styles.docButtonText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.docButton, uploadingPhoto && styles.buttonDisabled]}
                onPress={handleConfirmPhotoThenGenerate}
                disabled={uploadingPhoto}
              >
                {uploadingPhoto ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={styles.docButtonText}>Confirm & Generate</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={styles.docRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.docTitle}>Appointment Letter</Text>
          <Text style={styles.docStatus}>Generated fresh each time from current details</Text>
        </View>
        <TouchableOpacity onPress={handleGenerateLetter} disabled={generatingLetter} style={styles.docButton}>
          {generatingLetter ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={styles.docButtonText}>Generate</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  headerCard: { backgroundColor: colors.surface, padding: spacing.lg, paddingBottom: spacing.sm },
  deactivatedText: { ...type.small, color: colors.textSecondary, marginTop: 2 },
  complianceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  complianceTitle: { ...type.small, fontFamily: "PlusJakartaSans_700Bold", color: colors.navy },
  complianceSubtitle: { ...type.small, color: colors.textSecondary, marginTop: 2 },
  complianceLink: { ...type.small, fontFamily: "PlusJakartaSans_700Bold", color: colors.primary },
  segmentWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.ground },
  tabScroll: { flex: 1, backgroundColor: colors.ground },
  tabContent: { padding: spacing.lg },

  // Overview
  infoCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  infoLabel: { ...type.small, color: colors.textSecondary },
  infoValue: { ...type.small, fontFamily: "PlusJakartaSans_700Bold", color: colors.navy },
  infoValueWarn: { fontSize: 11.5, fontFamily: "PlusJakartaSans_700Bold", color: colors.warningTintText },
  editButton: { borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.sm, paddingVertical: spacing.sm + 4, alignItems: "center", marginTop: spacing.md },
  editButtonText: { ...type.small, fontFamily: "PlusJakartaSans_700Bold", color: colors.primary },
  deactivateButton: { backgroundColor: colors.absentTint, borderRadius: radius.sm, paddingVertical: spacing.sm + 4, alignItems: "center", marginTop: spacing.sm },
  deactivateButtonText: { ...type.small, fontFamily: "PlusJakartaSans_700Bold", color: colors.absentTintText },

  // Attendance
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  monthArrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.ground, alignItems: "center", justifyContent: "center" },
  monthArrowText: { fontSize: 18, fontFamily: "PlusJakartaSans_700Bold", color: colors.navy },
  monthLabel: { ...type.small, fontFamily: "PlusJakartaSans_700Bold", color: colors.navy },
  summaryRow: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  statCard: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center" },
  statValue: { fontSize: 20, fontFamily: "PlusJakartaSans_700Bold" },
  statLabel: { fontSize: 10, color: colors.textSecondary, marginTop: 2, fontFamily: "PlusJakartaSans_700Bold" },
  monthWageCard: {
    backgroundColor: colors.navy,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  monthWageTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  monthWageLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "PlusJakartaSans_700Bold" },
  paidBadge: { backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  paidBadgeText: { color: colors.surface, fontSize: 10, fontFamily: "PlusJakartaSans_700Bold" },
  monthWageValue: { color: colors.surface, fontSize: 28, fontFamily: "PlusJakartaSans_700Bold", marginTop: 4 },
  monthWageDetail: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 },
  monthWageEmpty: { color: "rgba(255,255,255,0.85)", fontSize: 13 },
  tableHeaderRow: { flexDirection: "row", paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.xs },
  tableHeaderCell: { fontSize: 11, fontFamily: "PlusJakartaSans_700Bold", color: colors.textSecondary, textTransform: "uppercase" },
  dayRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  dayRowToday: { backgroundColor: colors.presentTint },
  dateRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs, marginBottom: spacing.xs },
  dateNumber: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: colors.navy },
  dateWeekday: { fontSize: 11, color: colors.textSecondary },
  notJoinedRow: { flex: 1, backgroundColor: colors.unmarkedTint, borderRadius: radius.sm, paddingVertical: spacing.sm + 2, alignItems: "center" },
  notJoinedText: { fontSize: 12, fontFamily: "PlusJakartaSans_700Bold", color: colors.unmarked },
  shiftTagsRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.xs },
  shiftTag: { paddingHorizontal: spacing.xs + 2, paddingVertical: 3, borderRadius: 6 },
  shiftTagOn: { backgroundColor: colors.navy },
  shiftTagOff: { backgroundColor: colors.ground },
  shiftTagText: { fontSize: 9.5, fontFamily: "PlusJakartaSans_800ExtraBold" },
  shiftTagTextOn: { color: colors.surface },
  shiftTagTextOff: { color: colors.unmarked },

  // Wages
  rateSectionCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  rateSectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  rateSectionTitle: { fontSize: 13, fontFamily: "PlusJakartaSans_800ExtraBold", color: colors.navy, textTransform: "uppercase" },
  rateSectionEdit: { fontSize: 12.5, fontFamily: "PlusJakartaSans_700Bold", color: colors.primary },
  helper: { fontSize: 11, color: colors.textSecondary, marginTop: -spacing.sm, marginBottom: spacing.sm },
  rateCard: { backgroundColor: colors.primaryTint, borderRadius: radius.md, padding: spacing.sm + 4 },
  rateValue: { fontSize: 20, fontFamily: "PlusJakartaSans_700Bold", color: colors.primaryPressed },
  rateDetail: { fontSize: 12, color: colors.primaryPressed, marginTop: 2 },
  rateCardEmpty: { backgroundColor: colors.ground, borderRadius: radius.md, padding: spacing.sm + 4, alignItems: "center" },
  empty: { fontSize: 13, color: colors.textSecondary },

  // Documents
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  docTitle: { ...type.small, fontFamily: "PlusJakartaSans_700Bold", color: colors.navy },
  docStatus: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  docStatusOk: { color: colors.present },
  docStatusWarn: { color: colors.warningTintText },
  docButton: { borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm },
  docButtonText: { fontSize: 12.5, fontFamily: "PlusJakartaSans_700Bold", color: colors.primary },
  buttonDisabled: { opacity: 0.5 },
  photoCaptureRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  photoCaptureOption: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  photoCaptureLabel: { fontSize: 11.5, fontFamily: "PlusJakartaSans_700Bold", color: colors.navy },
  photoPreviewWrap: { marginTop: spacing.xs, alignItems: "center" },
  photoPreview: { width: 120, height: 150, borderRadius: radius.sm },
  photoPreviewActions: { flexDirection: "row", gap: spacing.md, alignItems: "center", marginTop: spacing.sm },
});
