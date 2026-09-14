import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { updateFactoryProfile } from "../api/client";
import KeyboardScreen from "../components/KeyboardScreen";
import SelectField from "../components/SelectField";
import { useAuth } from "../context/AuthContext";
import { INDIAN_STATE_OPTIONS } from "../indianStates";
import { INDUSTRY_OPTIONS } from "../industries";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

// Factory profile fields moved here from Shift Settings (Section 4) --
// they'd been living on a screen named for shift management, the same
// data editable from a place its own name didn't suggest. Shift
// Settings now links here instead of duplicating these fields; nothing
// about the underlying data (still Owner.factory_name/etc. via the same
// updateFactoryProfile call) changed, only which screen edits it.
export default function ProfileScreen({}: Props) {
  const { token, owner, updateOwner } = useAuth();
  const [factoryName, setFactoryName] = useState(owner?.factory_name ?? "");
  const [factoryAddress, setFactoryAddress] = useState(owner?.factory_address ?? "");
  const [factoryLicenceNo, setFactoryLicenceNo] = useState(owner?.factory_licence_no ?? "");
  const [state, setState] = useState(owner?.state ?? "");
  const [industry, setIndustry] = useState(owner?.industry ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!token) return;
    if (!factoryName.trim()) {
      Alert.alert("Factory name required", "This is the name shown on your Home screen and every statutory form.");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateFactoryProfile(
        token,
        factoryName.trim(),
        factoryAddress.trim() || undefined,
        factoryLicenceNo.trim() || undefined,
        state || undefined,
        industry || undefined,
      );
      await updateOwner(updated);
      Alert.alert("Saved", "Factory profile updated.");
    } catch (e: any) {
      Alert.alert("Could not save", e?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardScreen contentContainerStyle={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle}>Factory details used across Home, statutory forms, and reports.</Text>

      <Text style={styles.label}>Factory name</Text>
      <TextInput
        style={styles.input}
        value={factoryName}
        onChangeText={setFactoryName}
        placeholder="Your factory's name"
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.label}>Factory address</Text>
      <TextInput
        style={styles.input}
        value={factoryAddress}
        onChangeText={setFactoryAddress}
        placeholder="42 Industrial Estate, Madurai"
        placeholderTextColor={colors.muted}
        multiline
      />
      <Text style={styles.label}>Factory licence / registration no.</Text>
      <TextInput
        style={styles.input}
        value={factoryLicenceNo}
        onChangeText={setFactoryLicenceNo}
        placeholder="e.g. TN/MDU/1234"
        placeholderTextColor={colors.muted}
        autoCapitalize="characters"
      />
      <SelectField
        label="State (for statutory forms)"
        value={state || null}
        options={INDIAN_STATE_OPTIONS}
        onChange={setState}
        placeholder="Select your factory's state"
      />
      <SelectField
        label="Industry (sets your Home screen's background)"
        value={industry || null}
        options={INDUSTRY_OPTIONS}
        onChange={setIndustry}
        placeholder="Select your factory's industry"
      />
      <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Save profile</Text>}
      </TouchableOpacity>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, backgroundColor: colors.white, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.navy,
  },
  button: {
    backgroundColor: colors.teal,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
    marginTop: spacing.md,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 14, fontWeight: "700" },
});
