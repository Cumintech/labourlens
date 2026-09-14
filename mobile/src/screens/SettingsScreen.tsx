import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAppLock } from "../context/AppLockContext";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { displayPlanStatus } from "../planStatus";
import { colors, radius, spacing } from "../theme";

// Rendered as the Settings tab's content inside MainTabs -- see
// StatutoryFormsScreen for why the nav prop is typed this loosely.
type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

const PIN_PATTERN = /^\d{4}$/;

export default function SettingsScreen({ navigation }: Props) {
  const { owner, logout } = useAuth();
  const { isPinSet, setPin, clearPin, verifyPin } = useAppLock();
  const insets = useSafeAreaInsets();

  const [setPinModal, setSetPinModal] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const [disablePinModal, setDisablePinModal] = useState(false);
  const [disablePinInput, setDisablePinInput] = useState("");

  function handleLogout() {
    Alert.alert("Log out", "Log out of Labour Lens on this device?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: logout },
    ]);
  }

  function handleToggleAppLock(value: boolean) {
    if (value) {
      setNewPin("");
      setConfirmPin("");
      setSetPinModal(true);
    } else {
      setDisablePinInput("");
      setDisablePinModal(true);
    }
  }

  async function handleConfirmSetPin() {
    if (!PIN_PATTERN.test(newPin)) {
      Alert.alert("Enter a 4-digit PIN", "The PIN must be exactly 4 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      Alert.alert("PINs don't match", "Enter the same 4-digit PIN both times.");
      return;
    }
    await setPin(newPin);
    setSetPinModal(false);
    Alert.alert("App Lock enabled", "Labour Lens will now ask for this PIN whenever you open or return to the app.");
  }

  async function handleConfirmDisable() {
    if (!verifyPin(disablePinInput)) {
      Alert.alert("Incorrect PIN", "Enter your current App Lock PIN to turn it off.");
      return;
    }
    await clearPin();
    setDisablePinModal(false);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}>
      <Text style={styles.title}>Settings</Text>

      <Text style={styles.sectionLabel}>Profile Info</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowIcon}>👤</Text>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>Owner Name</Text>
            <Text style={styles.rowValue}>{owner?.name ?? "-"}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowIcon}>📞</Text>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>Mobile</Text>
            <Text style={styles.rowValue}>{owner?.mobile ?? "-"}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowIcon}>🏭</Text>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>Factory Name</Text>
            <Text style={styles.rowValue}>{owner?.factory_name ?? "-"}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowIcon}>💳</Text>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>Plan</Text>
            <Text style={styles.rowValue}>
              {displayPlanStatus(owner?.plan_status)}
              {owner?.plan_status === "trial" && owner.trial_days_remaining != null
                ? ` -- ${owner.trial_days_remaining} day${owner.trial_days_remaining === 1 ? "" : "s"} left`
                : ""}
            </Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowIcon}>🔒</Text>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>App Lock</Text>
            <Text style={styles.rowValue}>{isPinSet ? "On" : "Off"}</Text>
          </View>
          <Switch value={isPinSet} onValueChange={handleToggleAppLock} trackColor={{ true: colors.teal }} />
        </View>
      </View>

      <Text style={styles.sectionLabel}>General</Text>
      <View style={styles.card}>
        {/* Biometric Devices moved to its own Home page card (Batch 1) --
            removed here so it doesn't exist as a duplicate entry point. */}
        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("PrivacyPolicy")}>
          <Text style={styles.rowIcon}>📄</Text>
          <Text style={styles.rowValue}>Privacy Policy</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("HelpSupport")}>
          <Text style={styles.rowIcon}>❓</Text>
          <Text style={styles.rowValue}>Help & Support</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={handleLogout}>
          <Text style={styles.rowIcon}>🚪</Text>
          <Text style={[styles.rowValue, { color: colors.danger, fontWeight: "700" }]}>Log Out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>Labour Lens v1.0{"\n"}Tamil Nadu Factories Act compliance, made simple 🇮🇳</Text>

      <Modal visible={setPinModal} transparent animationType="fade" onRequestClose={() => setSetPinModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Set a 4-digit PIN</Text>
            <Text style={styles.modalLabel}>New PIN</Text>
            <TextInput
              style={styles.modalInput}
              value={newPin}
              onChangeText={(t) => setNewPin(t.replace(/\D/g, "").slice(0, 4))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              placeholder="••••"
              placeholderTextColor={colors.muted}
            />
            <Text style={styles.modalLabel}>Confirm PIN</Text>
            <TextInput
              style={styles.modalInput}
              value={confirmPin}
              onChangeText={(t) => setConfirmPin(t.replace(/\D/g, "").slice(0, 4))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              placeholder="••••"
              placeholderTextColor={colors.muted}
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setSetPinModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmButton} onPress={handleConfirmSetPin}>
                <Text style={styles.modalConfirmText}>Enable</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={disablePinModal} transparent animationType="fade" onRequestClose={() => setDisablePinModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Enter current PIN to disable App Lock</Text>
            <TextInput
              style={styles.modalInput}
              value={disablePinInput}
              onChangeText={(t) => setDisablePinInput(t.replace(/\D/g, "").slice(0, 4))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              placeholder="••••"
              placeholderTextColor={colors.muted}
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setDisablePinModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmButton} onPress={handleConfirmDisable}>
                <Text style={styles.modalConfirmText}>Disable</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy, marginBottom: spacing.md },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", marginBottom: spacing.xs, marginTop: spacing.md },
  card: { backgroundColor: colors.fieldBg, borderRadius: radius.md, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md },
  rowIcon: { fontSize: 20, marginRight: spacing.sm },
  rowTextWrap: { flex: 1 },
  rowLabel: { fontSize: 11, color: colors.muted },
  rowValue: { fontSize: 15, color: colors.navy, fontWeight: "600", marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.white, marginLeft: spacing.md + 28 },
  footer: { textAlign: "center", color: colors.muted, fontSize: 12, marginTop: spacing.xl, lineHeight: 18 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  modalCard: { backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.lg, width: "85%" },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.navy, marginBottom: spacing.sm },
  modalLabel: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs, marginTop: spacing.sm },
  modalInput: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 20,
    color: colors.navy,
    textAlign: "center",
    letterSpacing: 8,
  },
  modalButtonRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  modalCancelButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.fieldBg },
  modalCancelText: { color: colors.muted, fontWeight: "700" },
  modalConfirmButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.teal },
  modalConfirmText: { color: colors.white, fontWeight: "700" },
});
