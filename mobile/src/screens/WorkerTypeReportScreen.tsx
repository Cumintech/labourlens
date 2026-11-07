import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Worker, listWorkers } from "../api/client";
import PieChart from "../components/PieChart";
import { useAuth } from "../context/AuthContext";
import { colors, radius, spacing } from "../theme";

// Worker-type report: totals by Permanent / Temporary / Contractor,
// plus inter-state migrant (ISM) workers by gender and home state.
// Counts active workers only; computed client-side from the worker list.
export default function WorkerTypeReportScreen() {
  const { token } = useAuth();
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setWorkers((await listWorkers(token)).filter((w) => w.status === "active"));
    } catch {
      setWorkers((prev) => prev ?? []);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const stats = useMemo(() => {
    const list = workers ?? [];
    const count = (t: string) => list.filter((w) => w.employment_type === t).length;
    const ism = list.filter((w) => w.is_ism);
    const g = (x: string) => ism.filter((w) => (w.gender ?? "").toLowerCase() === x).length;
    const male = g("male");
    const female = g("female");
    const states: Record<string, number> = {};
    ism.forEach((w) => {
      const s = w.home_state?.trim() || "Not set";
      states[s] = (states[s] ?? 0) + 1;
    });
    return {
      total: list.length,
      permanent: count("permanent"),
      temporary: count("temporary"),
      contract: count("contract"),
      notSet: list.filter((w) => !w.employment_type).length,
      ism: ism.length,
      male,
      female,
      otherGender: ism.length - male - female,
      states: Object.entries(states).sort((a, b) => b[1] - a[1]),
    };
  }, [workers]);

  if (workers === null) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />;

  const maxState = Math.max(1, ...stats.states.map(([, n]) => n));
  const palette = [colors.primary, colors.skyBlue, colors.violet, colors.warning, colors.present, colors.teal];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.ground }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={styles.totalCard}>
        <Text style={styles.totalNum}>{stats.total}</Text>
        <Text style={styles.totalLabel}>Total active workers</Text>
      </View>

      <View style={styles.tiles}>
        <Tile label="Permanent" value={stats.permanent} color={colors.primary} />
        <Tile label="Temporary" value={stats.temporary} color={colors.skyBlue} />
        <Tile label="Contractor" value={stats.contract} color={colors.violet} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Workers by type</Text>
        <PieChart
          slices={[
            { label: "Permanent", value: stats.permanent, color: colors.primary },
            { label: "Temporary", value: stats.temporary, color: colors.skyBlue },
            { label: "Contractor", value: stats.contract, color: colors.violet },
            ...(stats.notSet > 0 ? [{ label: "Not set", value: stats.notSet, color: colors.muted }] : []),
          ]}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Inter-state migrant (ISM) workers: {stats.ism}</Text>
        <PieChart
          slices={[
            { label: "Male", value: stats.male, color: colors.skyBlue },
            { label: "Female", value: stats.female, color: colors.violet },
            ...(stats.otherGender > 0 ? [{ label: "Other / not set", value: stats.otherGender, color: colors.muted }] : []),
          ]}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>ISM workers by home state</Text>
        {stats.states.length === 0 ? (
          <Text style={styles.empty}>No inter-state migrant workers yet.</Text>
        ) : (
          <>
            <PieChart slices={stats.states.map(([s, n], i) => ({ label: s, value: n, color: palette[i % palette.length] }))} />
            <View style={{ marginTop: spacing.md, gap: 8 }}>
              {stats.states.map(([s, n], i) => (
                <View key={s}>
                  <View style={styles.barLabelRow}>
                    <Text style={styles.barLabel}>{s}</Text>
                    <Text style={styles.barCount}>{n}</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${(n / maxState) * 100}%`, backgroundColor: palette[i % palette.length] }]} />
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Tile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.tile, { borderTopColor: color }]}>
      <Text style={[styles.tileNum, { color }]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: 60, gap: spacing.md },
  totalCard: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg, alignItems: "center" },
  totalNum: { fontSize: 40, fontWeight: "800", color: colors.white },
  totalLabel: { fontSize: 13, color: colors.white, opacity: 0.9 },
  tiles: { flexDirection: "row", gap: spacing.sm },
  tile: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderTopWidth: 4, padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  tileNum: { fontSize: 26, fontWeight: "800" },
  tileLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: "600" },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 14, fontWeight: "700", color: colors.navy, marginBottom: spacing.md },
  empty: { color: colors.textSecondary, fontSize: 13 },
  barLabelRow: { flexDirection: "row", justifyContent: "space-between" },
  barLabel: { fontSize: 13, color: colors.navy, fontWeight: "600" },
  barCount: { fontSize: 13, color: colors.navy, fontWeight: "800" },
  barTrack: { height: 8, backgroundColor: colors.fieldBg, borderRadius: 4, marginTop: 3 },
  barFill: { height: 8, borderRadius: 4 },
});
