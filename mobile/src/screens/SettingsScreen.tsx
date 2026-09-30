import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Building2, Clock, CreditCard, FileText, Fingerprint, HelpCircle, LogOut, Shield, Tag, Trash2 } from "lucide-react-native";
import React, { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ApiError, deleteAccount } from "../api/client";
import { ListRow } from "../components/ui";
import { useAppLock } from "../context/AppLockContext";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { displayPlanStatus, trialStatusText } from "../planStatus";
import { colors, radius, spacing, type } from "../theme";

// A real stack screen now, reached via the gear icon in Today's header
// -- no longer a tab (see MainTabs.tsx / RootNavigator.tsx).
type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

const PIN_PATTERN = /^\d{4}$/;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Phase 7 hub: an Owner identity card, then Factory / App / Account
// sections -- replaces the earlier flat "Profile Info" card (which mixed
// owner identity, factory name, plan, and App Lock in one place) plus
// the temporary safety-net rows Phases 1/2 added for screens that lost
// their drawer entry point (Shift Settings, Worker Types, Biometric
// Devices now have a permanent home in the Factory section below).
export default function SettingsScreen({ navigation }: Props) {
  const { owner, token, logout } = useAuth();
  const { isPinSet, setPin, clearPin, verifyPin } = useAppLock();
  const insets = useSafeAreaInsets();

  const [setPinModal, setSetPinModal] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const [disablePinModal, setDisablePinModal] = useState(false);
  const [disablePinInput, setDisablePinInput] = useState("");

  const [deletingAccount, setDeletingAccount] = useState(false);

  function handleLogout() {
    Alert.alert("Log out", "Log out of Labour Lens on this device?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: logout },
    ]);
  }

  function handleDeleteAccount() {
    Alert.alert(
      "Delete account",
      "This permanently deletes your Labour Lens login. You won't be able to sign in again with this mobile number. Worker attendance and compliance records are kept as required by the Tamil Nadu Factories Act.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete account", style: "destructive", onPress: confirmDeleteAccount },
      ],
    );
  }

  async function confirmDeleteAccount() {
    if (!token) return;
    setDeletingAccount(true);
    try {
      await deleteAccount(token);
      logout();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.";
      Alert.alert("Could not delete account", message);
    } finally {
      setDeletingAccount(false);
    }
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

  const planText = owner?.plan_status === "trial" ? trialStatusText(owner) : displayPlanStatus(owner?.plan_status);

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}>
      <Text style={type.display}>Settings</Text>

      <View style={styles.ownerCard}>
        <View style={styles.ownerAvatar}>
          <Text style={styles.ownerAvatarText}>{owner?.name ? initials(owner.name) : "?"}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.ownerName}>{owner?.name ?? "-"}</Text>
          <Text style={styles.ownerMeta}>
            {owner?.mobile ?? "-"} · {owner?.factory_name ?? "-"}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Factory</Text>
      <View style={styles.card}>
        <ListRow icon={Building2} title="Factory Profile" subtitle="Name, address, licence, state, industry" onPress={() => navigation.navigate("Profile")} />
        <View style={styles.divider} />
        <ListRow icon={Clock} title="Shift Settings" onPress={() => navigation.navigate("ShiftSettings")} />
        <View style={styles.divider} />
        <ListRow icon={Tag} title="Worker Types" onPress={() => navigation.navigate("WorkerTypes")} />
        <View style={styles.divider} />
        <ListRow icon={Fingerprint} title="Biometric Devices" onPress={() => navigation.navigate("BiometricDevices")} />
      </View>

      <Text style={styles.sectionLabel}>App</Text>
      <View style={styles.card}>
        <ListRow
          icon={Shield}
          title="App Lock"
          subtitle={isPinSet ? "On" : "Off"}
          showChevron={false}
          right={<Switch value={isPinSet} onValueChange={handleToggleAppLock} trackColor={{ true: colors.primary }} />}
        />
      </View>

      <Text style={styles.sectionLabel}>Account</Text>
      <View style={styles.card}>
        <ListRow icon={CreditCard} title="Plan" subtitle={planText} showChevron={false} />
        <View style={styles.divider} />
        <ListRow icon={HelpCircle} title="Help & Support" onPress={() => navigation.navigate("HelpSupport")} />
        <View style={styles.divider} />
        <ListRow icon={FileText} title="Privacy Policy" onPress={() => navigation.navigate("PrivacyPolicy")} />
        <View style={styles.divider} />
        <ListRow icon={LogOut} title="Log Out" onPress={handleLogout} showChevron={false} />
      </View>

      <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteAccount} disabled={deletingAccount}>
        {deletingAccount ? (
          <ActivityIndicator color={colors.danger} />
        ) : (
          <>
            <Trash2 size={16} color={colors.danger} />
            <Text style={styles.deleteButtonText}>Delete Account</Text>
          </>
        )}
      </TouchableOpacity>

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
              placeholderTextColor={colors.textSecondary}
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
              placeholderTextColor={colors.textSecondary}
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
              placeholderTextColor={colors.textSecondary}
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
  container: { flex: 1, backgroundColor: colors.ground },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  ownerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  ownerAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  ownerAvatarText: { color: colors.surface, fontFamily: "PlusJakartaSans_700Bold", fontSize: 16 },
  ownerName: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 16, color: colors.navy },
  ownerMeta: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  sectionLabel: { ...type.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, marginBottom: spacing.lg },
  divider: { height: 1, backgroundColor: colors.divider, marginLeft: 52 },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.sm,
    backgroundColor: colors.absentTint,
  },
  deleteButtonText: { color: colors.danger, fontFamily: "PlusJakartaSans_700Bold", fontSize: 14 },
  footer: { textAlign: "center", color: colors.textSecondary, fontSize: 12, marginTop: spacing.xl, lineHeight: 18 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, width: "85%" },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.navy, marginBottom: spacing.sm },
  modalLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.sm },
  modalInput: {
    backgroundColor: colors.ground,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 20,
    color: colors.navy,
    textAlign: "center",
    letterSpacing: 8,
  },
  modalButtonRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  modalCancelButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.ground },
  modalCancelText: { color: colors.textSecondary, fontWeight: "700" },
  modalConfirmButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.primary },
  modalConfirmText: { color: colors.surface, fontWeight: "700" },
});
