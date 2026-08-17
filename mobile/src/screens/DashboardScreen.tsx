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
  DashboardSummary,
  Worker,
  deactivateWorker,
  getDashboard,
  listAttendance,
  listWorkers,
  markAttendance,
} from "../api/client";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Dashboard">;

const SLOTS: AttendanceSlot[] = ["AM", "PM", "Evening"];

// Local device date, not UTC -- "today" for attendance means the day the
// owner is standing in, not the server's timezone.
function todayString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function DashboardScreen({ navigation }: Props) {
  const { token, owner } = useAuth();
  const today = useMemo(todayString, []);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    const [w, a, d] = await Promise.all([
      listWorkers(token),
      listAttendance(token, today),
      getDashboard(token, today),
    ]);
    setWorkers(w);
    setAttendance(a);
    setSummary(d);
  }, [token, today]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
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

  async function handleToggle(worker: Worker, slot: AttendanceSlot) {
    if (!token) return;
    const key = `${worker.id}:${slot}`;
    const current = attendanceByWorkerSlot.get(key);
    // Unmarked or absent -> present; present -> absent. Once marked it
    // just flips, matching how a supervisor corrects a mistaken tap.
    const nextStatus = current?.status === "present" ? "absent" : "present";
    try {
      const updated = await markAttendance(token, worker.id, today, slot, nextStatus);
      setAttendance((prev) => [...prev.filter((a) => !(a.worker_id === worker.id && a.slot === slot)), updated]);
      setSummary(await getDashboard(token, today));
    } catch {
      Alert.alert("Could not update attendance", "Please try again.");
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

  const filtered = workers.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()));

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
            <Text style={styles.dateText}>Today, {today}</Text>
            <View style={styles.summaryCard}>
              <View style={styles.summaryTopRow}>
                <Text style={styles.summaryNumber}>
                  {summary?.present_today ?? 0} / {summary?.total_workers ?? 0}
                </Text>
                <Text style={styles.summaryLabel}>present today</Text>
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
            <Text style={styles.sectionLabel}>Workers · {workers.length}</Text>
            <View style={styles.headerLinks}>
              <TouchableOpacity onPress={() => navigation.navigate("NewWorkerScan")}>
                <Text style={styles.addLink}>+ New Worker</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate("Report")}>
                <Text style={styles.reportLink}>6-month report</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>No workers match your search.</Text>}
      renderItem={({ item }) => {
        const isActive = item.status === "active";
        return (
          <View style={styles.row}>
            <View style={styles.rowTop}>
              <View>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>Aadhaar •••• •••• {item.aadhaar_last4}</Text>
              </View>
              {isActive ? (
                <TouchableOpacity onPress={() => handleDeactivate(item)}>
                  <Text style={styles.deactivateLink}>Deactivate</Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.badge, styles.badgeInactive]}>
                  <Text style={styles.badgeText}>Deactivated</Text>
                </View>
              )}
            </View>
            {isActive && (
              <View style={styles.chipRow}>
                {SLOTS.map((slot) => {
                  const rec = attendanceByWorkerSlot.get(`${item.id}:${slot}`);
                  const status = rec?.status;
                  const chipStyle =
                    status === "present" ? styles.chipPresent : status === "absent" ? styles.chipAbsent : styles.chipUnmarked;
                  const chipTextStyle =
                    status === "present"
                      ? styles.chipTextPresent
                      : status === "absent"
                      ? styles.chipTextAbsent
                      : styles.chipTextUnmarked;
                  const mark = status === "present" ? "P" : status === "absent" ? "A" : "–";
                  return (
                    <TouchableOpacity key={slot} style={[styles.chip, chipStyle]} onPress={() => handleToggle(item, slot)}>
                      <Text style={[styles.chipText, chipTextStyle]}>
                        {slot} · {mark}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
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
  dateText: { color: colors.tealPale, fontSize: 12, marginTop: 2 },
  summaryCard: { backgroundColor: colors.tealLight, borderRadius: radius.md, padding: spacing.sm + 6, marginTop: spacing.md },
  summaryTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  summaryNumber: { color: colors.navy, fontSize: 26, fontWeight: "700" },
  summaryLabel: { color: "#0F6E56", fontSize: 12, fontWeight: "700" },
  slotRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm },
  slotBox: { flex: 1, backgroundColor: colors.white, borderRadius: radius.sm, padding: spacing.xs + 4 },
  slotBoxLabel: { color: colors.muted, fontSize: 11 },
  slotBoxValue: { color: colors.navy, fontSize: 14, fontWeight: "700", marginTop: 2 },
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
  addLink: { color: colors.teal, fontSize: 12, fontWeight: "700" },
  reportLink: { color: colors.teal, fontSize: 12, fontWeight: "700" },
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
  chipRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm },
  chip: { flex: 1, borderRadius: 6, paddingVertical: spacing.xs + 2, alignItems: "center" },
  chipUnmarked: { backgroundColor: colors.white },
  chipPresent: { backgroundColor: colors.tealLight },
  chipAbsent: { backgroundColor: colors.dangerLight },
  chipText: { fontSize: 11, fontWeight: "700" },
  chipTextUnmarked: { color: colors.muted },
  chipTextPresent: { color: "#0F6E56" },
  chipTextAbsent: { color: "#993C1D" },
});
