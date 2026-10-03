import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { AlertTriangle, ArrowLeft, CheckCircle2, Info, RotateCcw } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ComplianceCheck, ComplianceItem, getComplianceCheck } from "../api/client";
import ErrorState from "../components/ErrorState";
import { ListSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ComplianceCheck">;

const SEVERITY_COLOR: Record<string, string> = {
  critical: colors.danger,
  important: colors.warning,
  minor: colors.primary,
};
const SEVERITY_TINT: Record<string, string> = {
  critical: colors.dangerLight,
  important: colors.warningTint,
  minor: colors.primaryTint,
};

function bandLabel(band: string): string {
  if (band === "ready") return "Inspection ready";
  if (band === "good") return "Good, almost there";
  return "Act soon";
}

function formatCheckedAt(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return isToday ? `Checked today, ${time}` : `Checked ${d.toLocaleDateString()}, ${time}`;
}

// Deep-links "Fix" / entry-point taps to wherever an item's action points.
// "Workers" has no top-level route -- it's a tab nested inside the "Home"
// stack entry, same pattern HomeScreen's own goToTab helper uses.
function navigateToAction(navigation: Props["navigation"], action: ComplianceItem["action"]) {
  if (!action) return;
  if (action.screen === "Workers") {
    (navigation as any).navigate("Home", { screen: "WorkersTab", params: action.params });
  } else if (action.screen === "WorkerEdit") {
    navigation.navigate("WorkerEdit", action.params as RootStackParamList["WorkerEdit"]);
  } else if (action.screen === "BiometricDevices") {
    navigation.navigate("BiometricDevices");
  } else if (action.screen === "ShiftSettings") {
    navigation.navigate("ShiftSettings");
  } else if (action.screen === "Profile") {
    navigation.navigate("Profile");
  } else if (action.screen === "WagesTab") {
    (navigation as any).navigate("Home", { screen: "WagesTab" });
  }
}

export default function ComplianceCheckScreen({ navigation }: Props) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<ComplianceCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [showAllPassed, setShowAllPassed] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setData(await getComplianceCheck(token));
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .then(() => setLoadError(false))
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false));
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ListSkeleton rows={4} variant="simple" />
      </View>
    );
  }

  if (loadError || !data) {
    return (
      <View style={styles.container}>
        <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />
      </View>
    );
  }

  const failed = data.items.filter((i) => !i.passed).sort((a, b) => b.weight - a.weight || b.affected - a.affected);
  const passed = data.items.filter((i) => i.passed);
  const visiblePassed = showAllPassed ? passed : passed.slice(0, 5);
  const r = 44;
  const c = 2 * Math.PI * r;

  return (
    <View style={styles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.surface} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
      >
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <View style={styles.headerTopRow}>
            <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
              <ArrowLeft size={22} color={colors.surface} />
            </Pressable>
            <Text style={styles.headerTitle}>Compliance check</Text>
            <Pressable onPress={() => setInfoOpen(true)} accessibilityRole="button" accessibilityLabel="How your score is calculated" hitSlop={10}>
              <Info size={20} color={colors.surface} />
            </Pressable>
          </View>

          <View style={styles.scoreRow}>
            <View style={styles.ringWrap}>
              <Svg width={100} height={100} viewBox="0 0 100 100" style={{ transform: [{ rotate: "-90deg" }] }}>
                <Circle cx={50} cy={50} r={r} stroke={colors.heroDivider} strokeWidth={9} fill="none" />
                <Circle
                  cx={50}
                  cy={50}
                  r={r}
                  stroke={colors.surface}
                  strokeWidth={9}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${(c * data.score) / 100} ${c}`}
                />
              </Svg>
              <View style={styles.ringTextWrap}>
                <Text style={styles.ringScore}>{data.score}%</Text>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bandLabel}>{bandLabel(data.band)}</Text>
              <Text style={styles.subLabel}>{failed.length} thing{failed.length === 1 ? "" : "s"} to fix · {passed.length} checks passed</Text>
              <Text style={styles.checkedAt}>{formatCheckedAt(data.checked_at)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.categoriesCard}>
          {data.categories.map((cat) => (
            <View key={cat.key} style={styles.categoryRow}>
              <Text style={styles.categoryLabel}>{cat.label}</Text>
              <View style={styles.categoryTrack}>
                <View style={[styles.categoryFill, { width: `${cat.score}%` as `${number}%`, backgroundColor: cat.score >= 90 ? colors.present : cat.score >= 70 ? colors.primary : colors.warning }]} />
              </View>
              <Text style={styles.categoryPct}>{cat.score}%</Text>
            </View>
          ))}
        </View>

        {failed.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Fix these first</Text>
            <View style={styles.listCard}>
              {failed.map((item, i) => (
                <View key={item.key} style={[styles.itemRow, i > 0 && styles.itemRowDivider]}>
                  <View style={[styles.itemIcon, { backgroundColor: SEVERITY_TINT[item.severity] }]}>
                    <AlertTriangle size={16} color={SEVERITY_COLOR[item.severity]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemLabel}>{item.label}</Text>
                    <Text style={styles.itemDetail}>{item.detail}</Text>
                  </View>
                  {!!item.action && (
                    <Pressable style={styles.fixButton} onPress={() => navigateToAction(navigation, item.action)} accessibilityRole="button">
                      <Text style={styles.fixButtonText}>Fix</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {passed.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>All good · {passed.length}</Text>
            <View style={styles.listCard}>
              {visiblePassed.map((item, i) => (
                <View key={item.key} style={[styles.itemRow, i > 0 && styles.itemRowDivider]}>
                  <CheckCircle2 size={18} color={colors.present} />
                  <Text style={[styles.itemLabel, { flex: 1 }]}>{item.detail}</Text>
                </View>
              ))}
              {passed.length > 5 && (
                <Pressable style={styles.showAllRow} onPress={() => setShowAllPassed((v) => !v)} accessibilityRole="button">
                  <Text style={styles.showAllText}>{showAllPassed ? "Show less" : `Show all ${passed.length}`}</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        <Pressable style={styles.runAgainButton} onPress={handleRefresh} accessibilityRole="button">
          <RotateCcw size={16} color={colors.primary} />
          <Text style={styles.runAgainText}>Run check again</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setInfoOpen(false)}>
          <Pressable style={[styles.modalSheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>How your score is calculated</Text>
            <Text style={styles.modalParagraph}>
              Every active worker's records are checked across a few categories. Each check carries a weight based on
              how serious it is, and your score is the share of that total weight your records currently satisfy.
            </Text>
            <View style={styles.weightRow}>
              <Text style={styles.weightLabel}>Critical · weight 3</Text>
              <Text style={styles.weightExample}>e.g. under minimum age, no wage rate, unpaid wages</Text>
            </View>
            <View style={styles.weightRow}>
              <Text style={styles.weightLabel}>Important · weight 2</Text>
              <Text style={styles.weightExample}>e.g. Form 12 incomplete, attendance not marked</Text>
            </View>
            <View style={styles.weightRow}>
              <Text style={styles.weightLabel}>Good to have · weight 1</Text>
              <Text style={styles.weightExample}>e.g. missing photo, no worker type</Text>
            </View>
            <View style={styles.bandChipRow}>
              <View style={[styles.bandChip, { backgroundColor: colors.presentTint }]}>
                <Text style={[styles.bandChipText, { color: colors.present }]}>90-100 Ready</Text>
              </View>
              <View style={[styles.bandChip, { backgroundColor: colors.primaryTint }]}>
                <Text style={[styles.bandChipText, { color: colors.primary }]}>70-89 Good</Text>
              </View>
              <View style={[styles.bandChip, { backgroundColor: colors.warningTint }]}>
                <Text style={[styles.bandChipText, { color: colors.warningTintText }]}>Below 70 Act</Text>
              </View>
            </View>
            <Text style={styles.modalFootnote}>
              The score is a guide to your records in Labour Lens, not a legal certificate.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  header: {
    backgroundColor: colors.primary,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  headerTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 16, color: colors.surface },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.lg },
  ringWrap: { width: 100, height: 100, alignItems: "center", justifyContent: "center" },
  ringTextWrap: { position: "absolute", alignItems: "center" },
  ringScore: { fontFamily: "IBMPlexSans_700Bold", fontSize: 26, color: colors.surface },
  bandLabel: { fontFamily: "IBMPlexSans_700Bold", fontSize: 18, color: colors.surface },
  subLabel: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.onPrimaryMuted, marginTop: 4 },
  checkedAt: { fontFamily: "IBMPlexSans_500Medium", fontSize: 11, color: colors.onPrimaryMuted, marginTop: 6 },
  categoriesCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: -20,
    gap: spacing.sm,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  categoryLabel: { width: 96, fontFamily: "IBMPlexSans_600SemiBold", fontSize: 12, color: colors.navy },
  categoryTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.divider, overflow: "hidden" },
  categoryFill: { height: 8, borderRadius: 4 },
  categoryPct: { width: 36, textAlign: "right", fontFamily: "IBMPlexSans_600SemiBold", fontSize: 12, color: colors.textSecondary },
  section: { marginTop: spacing.lg, paddingHorizontal: spacing.md },
  sectionLabel: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.textSecondary, textTransform: "uppercase", marginBottom: spacing.sm },
  listCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  itemRowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  itemIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  itemLabel: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.navy },
  itemDetail: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  fixButton: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
  fixButtonText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12, color: colors.surface },
  showAllRow: { alignItems: "center", padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  showAllText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.primary },
  runAgainButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    height: 48,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  runAgainText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.primary },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, gap: spacing.sm },
  modalTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 17, color: colors.navy },
  modalParagraph: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  weightRow: { marginTop: spacing.xs },
  weightLabel: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.navy },
  weightExample: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  bandChipRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  bandChip: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  bandChipText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 12 },
  modalFootnote: { fontFamily: "IBMPlexSans_500Medium", fontSize: 11, color: colors.textSecondary, marginTop: spacing.sm, fontStyle: "italic" },
});
