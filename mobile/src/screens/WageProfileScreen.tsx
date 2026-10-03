import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Info } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ApiError,
  WageProfile,
  WageRateType,
  Worker,
  WorkerType,
  assignWorkerType,
  createWageProfile,
  getWageProfile,
  getWageProfileHistory,
  getWorker,
  listWorkerTypes,
} from "../api/client";
import DateField, { isoDate } from "../components/DateField";
import ErrorState from "../components/ErrorState";
import KeyboardScreen from "../components/KeyboardScreen";
import { ListSkeleton } from "../components/Skeleton";
import WorkerTypeSelect from "../components/WorkerTypeSelect";
import { BlueHeader } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { formatINR } from "../format";
import { colors, radius, spacing } from "../theme";
import { autofillFromWorkerType } from "../workerTypeAutofill";

type Props = NativeStackScreenProps<RootStackParamList, "WageProfile">;

// The backend stays append-only, deliberately: a new rate is always a
// new versioned row, never an edit of an existing one, so a wage slip
// for a past month keeps reflecting that month's rate even after a
// later correction -- see PHASE3_STATUTORY_FORMS_PLAN.md's Day 2
// section. This screen's UX still behaves like a normal edit form on
// top of that: it opens pre-filled with the worker's current effective
// rate (their own latest WageProfile, which already reflects any
// WorkerType default it was seeded from), and saving without changing
// any of those values is a no-op -- no redundant duplicate version is
// created, and nothing gets accidentally blanked out.
export default function WageProfileScreen({ route, navigation }: Props) {
  const { workerId, workerName, fromRegistration } = route.params;
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState<WageProfile[]>([]);
  const [currentRate, setCurrentRate] = useState<WageProfile | null>(null);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [workerTypes, setWorkerTypes] = useState<WorkerType[]>([]);
  const [selectedWorkerTypeId, setSelectedWorkerTypeId] = useState<number | null>(null);
  const [assigningType, setAssigningType] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [rateType, setRateType] = useState<WageRateType>("daily");
  const [basic, setBasic] = useState("");
  const [hra, setHra] = useState("");
  const [da, setDa] = useState("");
  const [otherAllowances, setOtherAllowances] = useState("");
  const [pfRate, setPfRate] = useState("");
  const [esiRate, setEsiRate] = useState("");
  const [lwfAmount, setLwfAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  function prefillFrom(rate: WageProfile | null) {
    setRateType(rate?.rate_type ?? "daily");
    setBasic(rate ? String(rate.basic) : "");
    setHra(rate ? String(rate.hra) : "");
    setDa(rate ? String(rate.da) : "");
    setOtherAllowances(rate ? String(rate.other_allowances) : "");
    setPfRate(rate ? String(rate.pf_rate) : "");
    setEsiRate(rate ? String(rate.esi_rate) : "");
    setLwfAmount(rate ? String(rate.lwf_amount) : "");
    // A correction takes effect from today, not the old row's date --
    // reusing the old effective_from would misrepresent when the new
    // rate actually starts applying.
    setEffectiveFrom(isoDate(new Date()));
  }

  const load = useCallback(async () => {
    if (!token) return;
    const [fullHistory, current, w, types] = await Promise.all([
      getWageProfileHistory(token, workerId),
      getWageProfile(token, workerId).catch((e) => {
        if (e instanceof ApiError && e.status === 404) return null; // no rate set yet -- not an error
        throw e;
      }),
      getWorker(token, workerId),
      listWorkerTypes(token),
    ]);
    setHistory(fullHistory);
    setCurrentRate(current);
    setWorker(w);
    setWorkerTypes(types);
    setSelectedWorkerTypeId(w.worker_type_id);
    prefillFrom(current);
  }, [token, workerId]);

  // Selecting a type here both assigns it to the worker (so it behaves
  // identically to picking one on the Worker Profile hub's Wages tab --
  // one worker type master list, used consistently everywhere it appears)
  // and auto-fills the rate/PF fields below from its defaults, still
  // fully editable afterward. Only pre-fills fields that are currently
  // blank/zero, so picking a type after already typing a custom basic
  // wage doesn't clobber it.
  async function handleSelectWorkerType(typeId: number | null) {
    if (!token) return;
    setSelectedWorkerTypeId(typeId);
    setAssigningType(true);
    try {
      await assignWorkerType(token, workerId, typeId);
      const type = workerTypes.find((t) => t.id === typeId);
      if (type) {
        const filled = autofillFromWorkerType(type, { basic, pfRate });
        setRateType(filled.rateType);
        setBasic(filled.basic);
        setPfRate(filled.pfRate);
      }
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server.";
      Alert.alert("Could not assign worker type", message);
    } finally {
      setAssigningType(false);
    }
  }

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
    try {
      await load();
      setLoadError(false);
    } catch {
      // Keep whatever's already on screen -- see Dashboard's identical note.
    } finally {
      setRefreshing(false);
    }
  }

  function toNumber(v: string): number {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function matchesCurrentRate(): boolean {
    if (!currentRate) return false;
    return (
      rateType === currentRate.rate_type &&
      toNumber(basic) === currentRate.basic &&
      toNumber(hra) === currentRate.hra &&
      toNumber(da) === currentRate.da &&
      toNumber(otherAllowances) === currentRate.other_allowances &&
      toNumber(pfRate) === currentRate.pf_rate &&
      toNumber(esiRate) === currentRate.esi_rate &&
      toNumber(lwfAmount) === currentRate.lwf_amount
    );
  }

  async function handleSave() {
    if (!token) return;
    if (!basic.trim() || !effectiveFrom.trim()) {
      Alert.alert("Missing fields", "Basic wage and effective-from date are required.");
      return;
    }
    // Nothing was actually changed from the pre-filled current rate --
    // a no-op, not a redundant duplicate version.
    if (matchesCurrentRate()) {
      Alert.alert("No changes", "These values match the current rate already -- nothing to save.");
      return;
    }
    setSaving(true);
    try {
      await createWageProfile(token, workerId, {
        rate_type: rateType,
        basic: toNumber(basic),
        hra: toNumber(hra),
        da: toNumber(da),
        other_allowances: toNumber(otherAllowances),
        pf_rate: toNumber(pfRate),
        esi_rate: toNumber(esiRate),
        lwf_amount: toNumber(lwfAmount),
        effective_from: effectiveFrom.trim(),
      });
      setBasic("");
      setHra("");
      setDa("");
      setOtherAllowances("");
      setPfRate("");
      setEsiRate("");
      setLwfAmount("");
      setEffectiveFrom("");
      Alert.alert(
        "Saved",
        fromRegistration ? `${workerName} has been registered with this wage rate.` : "New wage rate added.",
        [{ text: "OK", onPress: () => navigation.navigate("Home") }],
      );
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.";
      Alert.alert("Save failed", message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ListSkeleton rows={2} variant="simple" />
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

  // Display-only ordering -- newest first, and excludes the current rate
  // (shown separately in the hero card above) so it isn't shown twice.
  const olderHistory = [...history]
    .filter((h) => h.id !== currentRate?.id)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <KeyboardScreen
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        <BlueHeader
          title={workerName}
          subtitle="Wage rate"
          right={
            fromRegistration ? (
              <TouchableOpacity onPress={() => navigation.navigate("Home")}>
                <Text style={styles.skipLink}>Skip for now →</Text>
              </TouchableOpacity>
            ) : undefined
          }
        />

        <View style={styles.heroCard}>
          {currentRate ? (
            <>
              <View style={styles.heroTopRow}>
                <Text style={styles.heroAmount}>
                  ₹{formatINR(currentRate.basic)}
                  <Text style={styles.heroUnit}>/{currentRate.rate_type === "daily" ? "day" : "month"}</Text>
                </Text>
                <View style={styles.effectiveChip}>
                  <Text style={styles.effectiveChipText}>From {currentRate.effective_from}</Text>
                </View>
              </View>
              <View style={styles.heroStatRow}>
                <HeroStat label="Basic" value={`₹${formatINR(currentRate.basic)}`} />
                <HeroStat label="DA" value={`₹${formatINR(currentRate.da)}`} />
                <HeroStat label="HRA" value={`₹${formatINR(currentRate.hra)}`} />
              </View>
              <View style={styles.pillRow}>
                <StatutoryPill label="PF" value={`${currentRate.pf_rate}%`} />
                <StatutoryPill label="ESI" value={`${currentRate.esi_rate}%`} />
                <StatutoryPill label="LWF" value={`₹${formatINR(currentRate.lwf_amount)}`} />
              </View>
            </>
          ) : (
            <Text style={styles.empty}>No wage rate set yet.</Text>
          )}
        </View>

        {olderHistory.length > 0 && (
          <View style={styles.historyCard}>
            <Text style={styles.sectionLabel}>Rate history</Text>
            {olderHistory.map((h, i) => (
              <View key={h.id} style={styles.timelineRow}>
                <View style={styles.timelineDotCol}>
                  <View style={styles.timelineDot} />
                  {i < olderHistory.length - 1 && <View style={styles.timelineLine} />}
                </View>
                <View style={{ flex: 1, paddingBottom: spacing.md }}>
                  <Text style={styles.historyEffective}>From {h.effective_from}</Text>
                  <Text style={styles.historyDetail}>
                    ₹{formatINR(h.basic)}/{h.rate_type === "daily" ? "day" : "month"} · DA ₹{formatINR(h.da)} · HRA ₹{formatINR(h.hra)}
                  </Text>
                  <Text style={styles.historyDetail}>
                    PF {h.pf_rate}% · ESI {h.esi_rate}% · LWF ₹{formatINR(h.lwf_amount)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.addRateCard}>
          <Text style={styles.sectionLabel}>Add a new rate</Text>
          <View style={styles.explainerRow}>
            <Info size={14} color={colors.textSecondary} />
            <Text style={styles.explainerText}>Adds a new version from the date below; past rates stay unchanged.</Text>
          </View>

          <WorkerTypeSelect
            label="Worker Type"
            token={token ?? ""}
            workerTypes={workerTypes}
            value={selectedWorkerTypeId}
            onChange={handleSelectWorkerType}
            onCreated={(created) => setWorkerTypes((prev) => [...prev, created])}
            noneLabel="No type -- set a custom rate below"
            disabled={assigningType}
          />

          <View style={styles.segmentRow}>
            {(["daily", "monthly"] as const).map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.segmentOption, rateType === option && styles.segmentOptionSelected]}
                onPress={() => setRateType(option)}
              >
                <Text style={[styles.segmentText, rateType === option && styles.segmentTextSelected]}>
                  {option === "daily" ? "Daily" : "Monthly"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.gridRow}>
            <Field label="Basic wage" value={basic} onChangeText={setBasic} prefix="₹" />
            <Field label="DA" value={da} onChangeText={setDa} prefix="₹" />
          </View>
          <View style={styles.gridRow}>
            <Field label="HRA" value={hra} onChangeText={setHra} prefix="₹" />
            <Field label="Other allowances" value={otherAllowances} onChangeText={setOtherAllowances} prefix="₹" />
          </View>
          <View style={styles.gridRow}>
            <Field label="PF rate" value={pfRate} onChangeText={setPfRate} suffix="%" />
            <Field label="ESI rate" value={esiRate} onChangeText={setEsiRate} suffix="%" />
          </View>
          <View style={styles.gridRow}>
            <Field label="LWF (flat/month)" value={lwfAmount} onChangeText={setLwfAmount} prefix="₹" />
            <View style={styles.gridCell}>
              <DateField label="Effective from" value={effectiveFrom} onChange={setEffectiveFrom} />
            </View>
          </View>
        </View>
      </KeyboardScreen>

      <View style={[styles.stickyFooter, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.buttonText}>Add rate</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

function StatutoryPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statutoryPill}>
      <Text style={styles.statutoryPillLabel}>{label}</Text>
      <Text style={styles.statutoryPillValue}>{value}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  prefix,
  suffix,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <View style={styles.gridCell}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        {!!prefix && <Text style={styles.inputAffix}>{prefix}</Text>}
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholderTextColor={colors.textSecondary}
          keyboardType="numeric"
        />
        {!!suffix && <Text style={styles.inputAffix}>{suffix}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 110 },
  skipLink: { color: colors.surface, fontSize: 13, fontWeight: "700" },
  empty: { fontSize: 13, color: colors.textSecondary },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: -28,
    gap: spacing.sm,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  heroTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroAmount: { fontFamily: "IBMPlexSans_700Bold", fontSize: 28, color: colors.navy },
  heroUnit: { fontFamily: "IBMPlexSans_500Medium", fontSize: 14, color: colors.textSecondary },
  effectiveChip: { backgroundColor: colors.primaryTint, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  effectiveChipText: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 11, color: colors.primary },
  heroStatRow: { flexDirection: "row", gap: spacing.sm },
  heroStat: { flex: 1, backgroundColor: colors.ground, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: "center" },
  heroStatValue: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy },
  heroStatLabel: { fontFamily: "IBMPlexSans_500Medium", fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  pillRow: { flexDirection: "row", gap: spacing.sm },
  statutoryPill: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    gap: 4,
    backgroundColor: colors.warningTint,
    borderRadius: radius.pill,
    paddingVertical: 6,
  },
  statutoryPillLabel: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 11, color: colors.warningTintText },
  statutoryPillValue: { fontFamily: "IBMPlexSans_700Bold", fontSize: 11, color: colors.warningTintText },
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  sectionLabel: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy, marginBottom: spacing.sm },
  timelineRow: { flexDirection: "row", gap: spacing.sm },
  timelineDotCol: { alignItems: "center", width: 14 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 4 },
  timelineLine: { flex: 1, width: 2, backgroundColor: colors.divider, marginTop: 2 },
  historyEffective: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.navy },
  historyDetail: { fontFamily: "IBMPlexSans_500Medium", fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  addRateCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  explainerRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: spacing.md },
  explainerText: { flex: 1, fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary },
  segmentRow: {
    flexDirection: "row",
    backgroundColor: colors.ground,
    borderRadius: radius.pill,
    padding: 3,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    alignSelf: "flex-start",
  },
  segmentOption: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill },
  segmentOptionSelected: { backgroundColor: colors.primary },
  segmentText: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 13, color: colors.navy },
  segmentTextSelected: { color: colors.surface },
  gridRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  gridCell: { flex: 1 },
  label: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginBottom: spacing.xs },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.ground,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    minHeight: 48,
    gap: 4,
  },
  inputAffix: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 14, color: colors.textSecondary },
  input: { flex: 1, fontFamily: "IBMPlexSans_600SemiBold", fontSize: 15, color: colors.navy, paddingVertical: 12 },
  stickyFooter: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.surface },
});
