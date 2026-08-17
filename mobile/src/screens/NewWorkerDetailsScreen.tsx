import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ApiError, createWorker } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "NewWorkerDetails">;

// This screen IS the manual-correction UI -- every field below started
// from whatever OCR extracted (possibly nothing) and is fully editable
// before save. Nothing here is presented as final until the owner saves it.
export default function NewWorkerDetailsScreen({ route, navigation }: Props) {
  const { ocrFields } = route.params;
  const { token } = useAuth();

  const [name, setName] = useState(ocrFields.name ?? "");
  const [dob, setDob] = useState(ocrFields.dob ?? "");
  const [gender, setGender] = useState(ocrFields.gender ?? "");
  const [aadhaarNumber, setAadhaarNumber] = useState(ocrFields.aadhaar_number ?? "");
  const [currentAddress, setCurrentAddress] = useState(ocrFields.current_address ?? "");
  const [mobile, setMobile] = useState("");
  const [saving, setSaving] = useState(false);

  const ocrMissed = {
    name: !ocrFields.name,
    dob: !ocrFields.dob,
    gender: !ocrFields.gender,
    aadhaar_number: !ocrFields.aadhaar_number,
    current_address: !ocrFields.current_address,
  };

  async function handleSave() {
    if (!name.trim() || !aadhaarNumber.trim()) {
      Alert.alert("Missing required fields", "Name and Aadhaar number are required.");
      return;
    }
    if (!token) return;

    setSaving(true);
    try {
      await createWorker(token, {
        name: name.trim(),
        aadhaar_number: aadhaarNumber.replace(/\s/g, ""),
        dob: dob.trim() || undefined,
        gender: gender.trim() || undefined,
        mobile: mobile.trim() || undefined,
        current_address: currentAddress.trim() || undefined,
      });
      Alert.alert("Saved", `${name} has been registered.`);
      navigation.navigate("Dashboard");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.";
      Alert.alert("Save failed", message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Worker Details</Text>
      <Text style={styles.subtitle}>Review what was scanned and fix anything that's wrong.</Text>

      <Text style={styles.sectionLabelTeal}>From Aadhaar</Text>
      <Field label="Name" value={name} onChangeText={setName} needsReview={ocrMissed.name} />
      <Field
        label="Date of birth (YYYY-MM-DD)"
        value={dob}
        onChangeText={setDob}
        needsReview={ocrMissed.dob}
        placeholder="1985-03-14"
      />
      <Field label="Gender" value={gender} onChangeText={setGender} needsReview={ocrMissed.gender} />
      <Field
        label="Aadhaar number"
        value={aadhaarNumber}
        onChangeText={setAadhaarNumber}
        needsReview={ocrMissed.aadhaar_number}
        keyboardType="number-pad"
      />
      <Field
        label="Current address"
        value={currentAddress}
        onChangeText={setCurrentAddress}
        needsReview={ocrMissed.current_address}
      />

      <Text style={styles.sectionLabelAmber}>Owner adds</Text>
      <Field label="Mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />

      <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
        {saving ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.buttonText}>Save Worker</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  needsReview,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  needsReview?: boolean;
  placeholder?: string;
  keyboardType?: "default" | "number-pad" | "phone-pad";
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>
        {label}
        {needsReview ? "  · not found by scan, please fill in" : ""}
      </Text>
      <TextInput
        style={[styles.input, needsReview && styles.inputNeedsReview]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, backgroundColor: colors.white, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4, color: colors.navy },
  subtitle: { fontSize: 13, color: colors.muted, marginBottom: spacing.lg },
  sectionLabelTeal: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.teal,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
  },
  sectionLabelAmber: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.amber,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
  },
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
  inputNeedsReview: { borderWidth: 1.5, borderColor: colors.amber, backgroundColor: "#FFF8EC" },
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
