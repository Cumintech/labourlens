import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ApiError, WageProfile, WageRateType, createWageProfile, getWageProfileHistory } from "../api/client";
import DateField from "../components/DateField";
import KeyboardScreen from "../components/KeyboardScreen";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "WageProfile">;

// Append-only, deliberately: this screen only ever adds a new rate
// version, never edits an existing one. A wage slip for a past month
// must keep reflecting that month's rate even after a later correction
// -- see PHASE3_STATUTORY_FORMS_PLAN.md's Day 2 section.
export default function WageProfileScreen({ route, navigation }: Props) {
  const { workerId, workerName } = route.params;
  const { token } = useAuth();
  const [history, setHistory] = useState<WageProfile[]>([]);
  const [loading, setLoading] = useState(true);
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

  const load = useCallback(async () => {
    if (!token) return;
    setHistory(await getWageProfileHistory(token, workerId));
  }, [token, workerId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load()
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [load]),
  );

  function toNumber(v: string): number {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  async function handleSave() {
    if (!token) return;
    if (!basic.trim() || !effectiveFrom.trim()) {
      Alert.alert("Missing fields", "Basic wage and effective-from date are required.");
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
      Alert.alert("Saved", "New wage rate added.", [
        { text: "OK", onPress: () => navigation.navigate("Home") },
      ]);
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
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.teal} />
      </View>
    );
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>{workerName}</Text>
      <Text style={styles.subtitle}>Wage rate history</Text>

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
