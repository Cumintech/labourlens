import { NativeStackScreenProps } from "@react-navigation/native-stack";
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
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

// Mirrors backend main.py's DEFAULT_PF_RATE_PERCENT -- EPF's statutory
// employee contribution rate, used here purely for the auto-fill
// convenience below (still an editable field afterward, same as the
// backend's own auto-created default). Keep both in sync if it changes.
const DEFAULT_PF_RATE_PERCENT = "12";

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
  // identically to picking one on WageRateWorkerDetailScreen -- one
  // worker type master list, used consistently everywhere it appears)
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
        setRateType(type.default_rate_type);
        if (!basic.trim() || toNumber(basic) === 0) setBasic(String(type.default_rate));
        if (!pfRate.trim() || toNumber(pfRate) === 0) setPfRate(DEFAULT_PF_RATE_PERCENT);
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

  return (
    <KeyboardScreen
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.teal]} tintColor={colors.teal} />}
    >
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{workerName}</Text>
          <Text style={styles.subtitle}>
            {fromRegistration ? "Set a wage rate to finish registration" : "Wage rate history"}
          </Text>
        </View>
        {fromRegistration && (
          <TouchableOpacity onPress={() => navigation.navigate("Home")}>
            <Text style={styles.skipLink}>Skip for now →</Text>
          </TouchableOpacity>
        )}
      </View>

      {history.length === 0 ? (
        <Text style={styles.empty}>No wage rate set yet.</Text>
      ) : (
        history.map((h) => (
          <View key={h.id} style={styles.historyRow}>
            <Text style={styles.historyEffective}>From {h.effective_from}</Text>
            <Text style={styles.historyDetail}>
              Basic ₹{h.basic}/{h.rate_type === "daily" ? "day" : "month"} · DA ₹{h.da} · HRA ₹{h.hra}
            </Text>
            <Text style={styles.historyDetail}>
              PF {h.pf_rate}% · ESI {h.esi_rate}% · LWF ₹{h.lwf_amount}
            </Text>
          </View>
        ))
      )}

      <Text style={styles.sectionLabel}>Add a new rate</Text>
      <Text style={styles.helper}>
        This adds a new version effective from the date below -- it never changes past rates, so wage slips
        already issued for earlier months stay correct.
      </Text>

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
      <Text style={styles.helper}>Selecting a type fills in its default rate and PF % below -- both stay editable.</Text>

      <View style={styles.toggleRow}>
        {(["daily", "monthly"] as const).map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.toggleOption, rateType === option && styles.toggleOptionSelected]}
            onPress={() => setRateType(option)}
          >
            <Text style={[styles.toggleText, rateType === option && styles.toggleTextSelected]}>
              {option === "daily" ? "Daily rate" : "Monthly rate"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Field label="Basic wage" value={basic} onChangeText={setBasic} keyboardType="numeric" />
      <Field label="HRA" value={hra} onChangeText={setHra} keyboardType="numeric" />
      <Field label="DA" value={da} onChangeText={setDa} keyboardType="numeric" />
      <Field label="Other allowances" value={otherAllowances} onChangeText={setOtherAllowances} keyboardType="numeric" />
      <Field label="PF rate (%)" value={pfRate} onChangeText={setPfRate} keyboardType="numeric" />
      <Field label="ESI rate (%)" value={esiRate} onChangeText={setEsiRate} keyboardType="numeric" />
      <Field label="LWF amount (flat, per month)" value={lwfAmount} onChangeText={setLwfAmount} keyboardType="numeric" />
      <DateField label="Effective from" value={effectiveFrom} onChange={setEffectiveFrom} />

      <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Add rate</Text>}
      </TouchableOpacity>
    </KeyboardScreen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric";
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, backgroundColor: colors.white, flexGrow: 1 },
  titleRow: { flexDirection: "row", alignItems: "flex-start" },
  skipLink: { color: colors.teal, fontSize: 13, fontWeight: "700", marginTop: spacing.xs },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4, color: colors.navy },
  subtitle: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  empty: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  historyRow: { backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: spacing.sm + 2, marginBottom: spacing.xs },
  historyEffective: { fontSize: 13, fontWeight: "700", color: colors.navy },
  historyDetail: { fontSize: 11, color: colors.muted, marginTop: 2 },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.navy, marginTop: spacing.lg, marginBottom: spacing.xs },
  helper: { fontSize: 12, color: colors.muted, marginBottom: spacing.sm },
  toggleRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  toggleOption: { flex: 1, backgroundColor: colors.fieldBg, borderRadius: radius.sm, paddingVertical: 12, alignItems: "center" },
  toggleOptionSelected: { backgroundColor: colors.teal },
  toggleText: { fontSize: 13, fontWeight: "600", color: colors.navy },
  toggleTextSelected: { color: colors.white },
  fieldWrap: { marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs },
  input: {
    borderWidth: 0,
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 16,
    color: colors.navy,
  },
  button: {
    backgroundColor: colors.teal,
    borderRadius: radius.sm,
    padding: 16,
    alignItems: "center",
    marginTop: spacing.md,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: "700" },
});
