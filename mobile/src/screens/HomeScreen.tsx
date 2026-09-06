import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { DashboardSummary, getDashboard } from "../api/client";
import { isoDate } from "../components/DateField";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

// Rendered as the "Home" tab's content inside MainTabs -- navigation
// here is the composite prop React Navigation hands a screen nested
// inside a tab that itself sits inside the root stack; typing it as a
// plain root-stack nav prop is enough since every call here is a bare
// `.navigate("SomeRootRoute")`, which React Navigation resolves by
// walking up to the parent stack automatically.
type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

// Labour Attendance stays the one big, prominent entry point (it's the
// daily task); Add Worker and Shifts & Profile are lower-frequency
// actions, so they sit together as a smaller icon row underneath
// instead of matching it in size. Logout moved to the Settings tab.
export default function HomeScreen({ navigation }: Props) {
  const { token, owner } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      getDashboard(token, isoDate(new Date()))
        .then(setSummary)
        .catch(() => {});
    }, [token]),
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <Text style={styles.heroEmoji}>🏭</Text>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>FACTORY</Text>
          </View>
        </View>
        <Text style={styles.factoryName}>{owner?.factory_name ?? "Labour Lens"}</Text>
        <Text style={styles.heroSubtitle}>Everything for today's shift floor, in one place.</Text>
        <View style={styles.heroAccentBar} />
      </View>

      <TouchableOpacity
        style={[styles.bigTile, { backgroundColor: colors.tealLight }]}
        onPress={() => navigation.navigate("Dashboard")}
      >
        <Text style={styles.bigTileEmoji}>📋</Text>
        <View style={styles.tileTextWrap}>
          <Text style={[styles.bigTileTitle, { color: "#0F6E56" }]}>Labour Attendance</Text>
          <Text style={styles.tileSubtitle}>
            {summary ? `${summary.present_today}/${summary.total_workers} active workers present today` : "Mark today's shifts, leave, and overtime"}
          </Text>
        </View>
        <Text style={[styles.tileArrow, { color: "#0F6E56" }]}>›</Text>
      </TouchableOpacity>

      <View style={styles.smallRow}>
        <TouchableOpacity
          style={[styles.smallTile, { backgroundColor: colors.skyBlueLight }]}
          onPress={() => navigation.navigate("NewWorkerScan")}
        >
          <Text style={styles.smallTileEmoji}>👷</Text>
          <Text style={[styles.smallTileTitle, { color: colors.skyBlue }]}>Add Worker</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.smallTile, { backgroundColor: colors.amberLight }]}
          onPress={() => navigation.navigate("ShiftSettings")}
        >
          <Text style={styles.smallTileEmoji}>⚙️</Text>
          <Text style={[styles.smallTileTitle, { color: "#8A5A14" }]}>Shifts & Profile</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  hero: {
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    overflow: "hidden",
  },
  heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroEmoji: { fontSize: 32 },
  heroBadge: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  heroBadgeText: { color: colors.tealPale, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  factoryName: { color: colors.white, fontSize: 24, fontWeight: "700", marginTop: spacing.sm },
  heroSubtitle: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 4 },
  heroAccentBar: { height: 4, backgroundColor: colors.teal, borderRadius: 2, marginTop: spacing.md, width: 56 },
  bigTile: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bigTileEmoji: { fontSize: 34, marginRight: spacing.md },
  tileTextWrap: { flex: 1 },
  bigTileTitle: { fontSize: 17, fontWeight: "700" },
  tileSubtitle: { fontSize: 12, color: colors.muted, marginTop: 2 },
  tileArrow: { fontSize: 28, fontWeight: "700", marginLeft: spacing.sm },
  smallRow: { flexDirection: "row", gap: spacing.sm },
  smallTile: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    alignItems: "center",
  },
  smallTileEmoji: { fontSize: 22, marginBottom: 4 },
  smallTileTitle: { fontSize: 11, fontWeight: "700", textAlign: "center" },
});
