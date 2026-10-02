import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { CalendarCheck, CheckCircle2, Circle, FileText, IndianRupee } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MonthEndStep, getMonthEnd } from "../api/client";
import { Button, Card } from "../components/ui";
import ErrorState from "../components/ErrorState";
import { ListSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing, type } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "MonthEnd">;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STEP_ICON: Record<string, typeof CalendarCheck> = {
  attendance: CalendarCheck,
  wages: IndianRupee,
  payments: IndianRupee,
  forms: FileText,
};

// Always the current calendar month -- there's no year/month picker
// here, since this is a guided "close out this month" flow, not a
// historical report. HomeScreen's month-end card (visible from day 25
// onward) is the only entry point.
export default function MonthEndScreen({ navigation }: Props) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const today = useMemo(() => new Date(), []);
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  const [steps, setSteps] = useState<MonthEndStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const result = await getMonthEnd(token, year, month);
    setSteps(result.steps);
  }, [token, year, month]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false));
    }, [load]),
  );

  // Switches to a sibling tab from a screen pushed on the root stack --
  // same navigate("Home", { screen, params }) pattern HomeScreen's own
  // goToTab uses, since this screen sits on the same root stack.
  function goToTab(tab: "AttendanceTab" | "WagesTab" | "ReportsTab") {
    (navigation as any).navigate("Home", { screen: tab });
  }

  function actionFor(step: MonthEndStep): { label: string; onPress: () => void } {
    switch (step.key) {
      case "attendance":
        return { label: "Go to Attendance", onPress: () => goToTab("AttendanceTab") };
      case "wages":
      case "payments":
        return { label: "Go to Wages", onPress: () => goToTab("WagesTab") };
      case "forms":
        return { label: "Go to Reports", onPress: () => goToTab("ReportsTab") };
      default:
        return { label: "Open", onPress: () => {} };
    }
  }

  const completeCount = steps.filter((s) => s.complete).length;

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
        <ErrorState onRetry={() => { setLoading(true); load().then(() => setLoadError(false)).catch(() => setLoadError(true)).finally(() => setLoading(false)); }} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}>
      <Text style={type.title}>{MONTH_NAMES[month - 1]} {year}</Text>
      <Text style={styles.subtitle}>{completeCount} of {steps.length} steps done</Text>

      {steps.map((step, i) => {
        const Icon = STEP_ICON[step.key] ?? Circle;
        const action = actionFor(step);
        return (
          <Card key={step.key} style={styles.stepCard}>
            <View style={styles.stepHead}>
              <View style={[styles.stepIconWrap, step.complete && styles.stepIconWrapDone]}>
                {step.complete ? <CheckCircle2 size={20} color={colors.present} /> : <Icon size={20} color={colors.primary} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepLabel}>{i + 1}. {step.label}</Text>
                <Text style={styles.stepDetail}>{step.detail}</Text>
              </View>
            </View>
            {!step.complete && (
              <Button title={action.label} variant="secondary-outline" onPress={action.onPress} style={styles.stepButton} />
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  content: { padding: spacing.lg },
  subtitle: { ...type.small, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  stepCard: { marginBottom: spacing.sm },
  stepHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stepIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTint,
    alignItems: "center",
    justifyContent: "center",
  },
  stepIconWrapDone: { backgroundColor: colors.presentTint },
  stepLabel: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.navy },
  stepDetail: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  stepButton: { marginTop: spacing.sm },
});
