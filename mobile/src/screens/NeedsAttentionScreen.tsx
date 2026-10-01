import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { AlertTriangle, ChevronRight, Fingerprint, ListChecks, ShieldAlert } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HomeAlert, getHomeAlerts } from "../api/client";
import ErrorState from "../components/ErrorState";
import { ListSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing, type } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "NeedsAttention">;

const ALERT_ICON: Record<string, typeof AlertTriangle> = {
  missing_compliance: ListChecks,
  unmapped_devices: Fingerprint,
  not_marked_today: AlertTriangle,
  underage_workers: ShieldAlert,
};

// Reached only from HomeScreen's "Needs attention" summary card -- lists
// the same GET /home/alerts items that card used to show inline, each
// still routing to its own screen on tap.
export default function NeedsAttentionScreen({ navigation }: Props) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [alerts, setAlerts] = useState<HomeAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const result = await getHomeAlerts(token);
    setAlerts(result.alerts);
  }, [token]);

  const refresh = useCallback(() => {
    setLoading(true);
    load()
      .then(() => setLoadError(false))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [load]);

  useFocusEffect(useCallback(() => refresh(), [refresh]));

  function goToTab(tab: "WorkersTab" | "AttendanceTab") {
    (navigation as any).navigate("Home", { screen: tab });
  }

  function handlePress(alert: HomeAlert) {
    if (alert.code === "unmapped_devices") navigation.navigate("BiometricDevices");
    else if (alert.code === "missing_compliance" || alert.code === "underage_workers") goToTab("WorkersTab");
    else goToTab("AttendanceTab");
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ListSkeleton rows={4} variant="simple" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        <ErrorState onRetry={refresh} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}>
      <Text style={type.title}>Needs attention</Text>
      <Text style={styles.subtitle}>{alerts.length} {alerts.length === 1 ? "item needs" : "items need"} your attention</Text>

      {alerts.length === 0 ? (
        <Text style={styles.empty}>You're all caught up.</Text>
      ) : (
        alerts.map((alert) => {
          const Icon = ALERT_ICON[alert.code] ?? AlertTriangle;
          return (
            <Pressable key={alert.code} style={styles.alertRow} onPress={() => handlePress(alert)}>
              <View style={styles.alertIconWrap}>
                <Icon size={18} color={colors.warningTintText} />
              </View>
              <Text style={styles.alertMessage}>{alert.message}</Text>
              <ChevronRight size={18} color={colors.textSecondary} />
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  content: { padding: spacing.lg },
  subtitle: { ...type.small, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  empty: { fontSize: 13, color: colors.textSecondary },
  alertRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.warningTint,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginBottom: spacing.xs,
  },
  alertIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  alertMessage: { flex: 1, fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, color: colors.navy },
});
