import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarX,
  CheckCircle2,
  ClipboardX,
  Fingerprint,
  Info,
  IndianRupee,
  Receipt,
  ShieldAlert,
  Sparkles,
  Tag,
} from "lucide-react-native";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AskAction, AskAnswer, AskChip, AskRow, getAskAnswer } from "../api/client";
import ErrorState from "../components/ErrorState";
import { ListSkeleton } from "../components/Skeleton";
import { Avatar } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Ask">;

const CHIP_DEFS: { key: AskChip; label: string; icon: typeof CalendarX }[] = [
  { key: "absent_month", label: "Absent this month", icon: CalendarX },
  { key: "not_marked_today", label: "Not marked today", icon: ClipboardX },
  { key: "wages_month", label: "Wages this month", icon: IndianRupee },
  { key: "unpaid_wages", label: "Unpaid wages", icon: Receipt },
  { key: "missing_form12", label: "Missing Form 12", icon: Info },
  { key: "no_wage_rate", label: "No wage rate", icon: Tag },
  { key: "under_age", label: "Under minimum age", icon: ShieldAlert },
  { key: "not_on_device", label: "Not on device", icon: Fingerprint },
];

const TONE_ICON = { good: CheckCircle2, warn: AlertTriangle, info: Info };
const TONE_COLOR = { good: colors.present, warn: colors.warning, info: colors.primary };
const TONE_TINT = { good: colors.presentTint, warn: colors.warningTint, info: colors.primaryTint };

// Tab screens are nested inside the "Home" stack entry (same pattern as
// HomeScreen's own goToTab) -- anything else navigates directly.
function navigateToAction(navigation: Props["navigation"], action: AskAction) {
  if (action.screen.endsWith("Tab")) {
    (navigation as any).navigate("Home", { screen: action.screen, params: action.params });
  } else {
    (navigation as any).navigate(action.screen, action.params);
  }
}

export default function AskScreen({ navigation }: Props) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<AskChip | null>(null);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [showAll, setShowAll] = useState(false);

  async function load(chip: AskChip) {
    if (!token) return;
    setSelected(chip);
    setAnswer(null);
    setShowAll(false);
    setLoading(true);
    setError(false);
    try {
      setAnswer(await getAskAnswer(token, chip));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function openWorker(row: AskRow) {
    navigation.navigate("WorkerProfile", {
      workerId: row.worker_id,
      workerName: row.name,
      workerStatus: row.status,
      deactivatedAt: row.deactivated_at,
    });
  }

  const ToneIcon = answer ? TONE_ICON[answer.tone] : null;
  const visibleRows = answer ? (showAll ? answer.rows : answer.rows.slice(0, 10)) : [];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
            <ArrowLeft size={22} color={colors.surface} />
          </Pressable>
          <View style={styles.headerTitleRow}>
            <Sparkles size={20} color={colors.surface} />
            <Text style={styles.headerTitle}>Ask Labour Lens</Text>
          </View>
          <Text style={styles.headerSubtitle}>Quick answers from your factory data</Text>
        </View>

        <View style={styles.chipGrid}>
          {CHIP_DEFS.map(({ key, label, icon: Icon }) => {
            const isSelected = selected === key;
            return (
              <Pressable
                key={key}
                style={[styles.chipCard, isSelected && styles.chipCardSelected]}
                onPress={() => load(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
              >
                <Icon size={20} color={isSelected ? colors.surface : colors.primary} />
                <Text style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {loading && (
          <View style={{ paddingHorizontal: spacing.md }}>
            <ListSkeleton rows={2} variant="simple" />
          </View>
        )}

        {error && !loading && (
          <View style={{ paddingHorizontal: spacing.md }}>
            <ErrorState onRetry={() => selected && load(selected)} />
          </View>
        )}

        {answer && !loading && !error && (
          <View style={styles.answerCard}>
            <View style={styles.answerHeaderRow}>
              <View style={[styles.toneIconWrap, { backgroundColor: TONE_TINT[answer.tone] }]}>
                {ToneIcon && <ToneIcon size={18} color={TONE_COLOR[answer.tone]} />}
              </View>
              <Text style={styles.answerHeadline}>{answer.headline}</Text>
            </View>

            {visibleRows.map((row, i) => (
              <Pressable
                key={row.worker_id}
                style={[styles.answerRow, i > 0 && styles.answerRowDivider]}
                onPress={() => openWorker(row)}
                accessibilityRole="button"
              >
                <Avatar workerId={row.worker_id} name={row.name} size={32} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.answerRowName} numberOfLines={1}>{row.name}</Text>
                  {!!row.code && <Text style={styles.answerRowCode}>#{row.code}</Text>}
                </View>
                <Text style={styles.answerRowValue}>{row.value}</Text>
              </Pressable>
            ))}

            {answer.rows.length > 10 && (
              <Pressable style={styles.showAllRow} onPress={() => setShowAll((v) => !v)} accessibilityRole="button">
                <Text style={styles.showAllText}>{showAll ? "Show less" : `Show all (${answer.rows.length})`}</Text>
              </Pressable>
            )}

            {answer.actions.length > 0 && (
              <View style={styles.actionsRow}>
                {answer.actions.map((a) => (
                  <Pressable key={a.label} style={styles.actionButton} onPress={() => navigateToAction(navigation, a)} accessibilityRole="button">
                    <Text style={styles.actionButtonText}>{a.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <Text style={styles.basedOn}>Based on {answer.based_on}</Text>
          </View>
        )}

        <View style={styles.askInputWrap}>
          <TextInput
            style={styles.askInput}
            editable={false}
            placeholder="Type a question — coming soon"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
      </ScrollView>
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
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.sm },
  headerTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 22, color: colors.surface },
  headerSubtitle: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.onPrimaryMuted, marginTop: 4 },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.lg },
  chipCard: {
    width: "47%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 14,
    minHeight: 44,
  },
  chipCardSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { flex: 1, fontFamily: "IBMPlexSans_600SemiBold", fontSize: 12, color: colors.navy },
  chipLabelSelected: { color: colors.surface },
  answerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  answerHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  toneIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  answerHeadline: { flex: 1, fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy },
  answerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 10 },
  answerRowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  answerRowName: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.navy },
  answerRowCode: { fontFamily: "IBMPlexSans_500Medium", fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  answerRowValue: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.navy },
  showAllRow: { alignItems: "center", paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  showAllText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.primary },
  actionsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  actionButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.sm, height: 44, alignItems: "center", justifyContent: "center" },
  actionButtonText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.surface },
  basedOn: { fontFamily: "IBMPlexSans_500Medium", fontSize: 11, color: colors.textSecondary, marginTop: spacing.sm, fontStyle: "italic" },
  askInputWrap: { paddingHorizontal: spacing.md, marginTop: spacing.lg },
  askInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    fontFamily: "IBMPlexSans_500Medium",
    fontSize: 13,
    color: colors.textSecondary,
    opacity: 0.7,
  },
});
