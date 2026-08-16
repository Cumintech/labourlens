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
  const [mobile, setMobile] = useState("");
  const [currentAddress, setCurrentAddress] = useState("");
  const [saving, setSaving] = useState(false);

  const ocrMissed = {
    name: !ocrFields.name,
    dob: !ocrFields.dob,
    gender: !ocrFields.gender,
    aadhaar_number: !ocrFields.aadhaar_number,
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

      <Text style={styles.sectionLabel}>Owner adds</Text>
      <Field label="Mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
      <Field label="Current address" value={currentAddress} onChangeText={setCurrentAddress} />

      <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Worker</Text>}
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
  container: { padding: 24, backgroundColor: "#fff", flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#888", marginBottom: 24 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#666", marginTop: 8, marginBottom: 8 },
  fieldWrap: { marginBottom: 16 },
  label: { fontSize: 12, fontWeight: "600", color: "#666", marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  inputNeedsReview: { borderColor: "#e0a030", backgroundColor: "#fff8ec" },
  button: {
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginTop: 16,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
