import React, { useState } from "react";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { AttendanceStatus, ShiftConfig } from "../api/client";
import { colors, radius, spacing } from "../theme";

type Props = {
  shifts: ShiftConfig[];
  getStatus: (slotKey: string) => AttendanceStatus | undefined;
  getOtHours: (slotKey: string) => number;
  onSetStatus: (slotKey: string, status: AttendanceStatus) => void;
  onSetOtHours: (slotKey: string, hours: number) => void;
};

// Present / Absent / Leave used to be one button that cycled through
// all three -- easy to build, but it hides two of the three states at
// any given moment, which read as "Absent/Leave isn't here" on real
// devices. All three are now separate, always-visible buttons; OT is
// its own button that opens a small prompt for the hour count instead
// of an always-present inline text field, since most shifts have no
// overtime most days.
export default function ShiftAttendanceRow({ shifts, getStatus, getOtHours, onSetStatus, onSetOtHours }: Props) {
  const [otPromptSlot, setOtPromptSlot] = useState<string | null>(null);
  const [otDraft, setOtDraft] = useState("");

  function openOtPrompt(slotKey: string) {
    const current = getOtHours(slotKey);
    setOtDraft(current ? String(current) : "");
    setOtPromptSlot(slotKey);
  }

  function confirmOt() {
    if (!otPromptSlot) return;
    const hours = parseFloat(otDraft);
    onSetOtHours(otPromptSlot, isNaN(hours) || hours < 0 ? 0 : hours);
    setOtPromptSlot(null);
  }

  return (
    <View>
      {shifts.map((shift) => {
        const status = getStatus(shift.slot_key);
        const otHours = getOtHours(shift.slot_key);
        return (
          <View key={shift.slot_key} style={styles.shiftBlock}>
            <Text style={styles.shiftLabel}>{shift.label}</Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.statusButton, status === "present" ? styles.presentActive : styles.presentIdle]}
                onPress={() => onSetStatus(shift.slot_key, "present")}
              >
                <Text style={[styles.statusButtonText, status === "present" ? styles.textOnActive : styles.presentIdleText]}>P</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusButton, status === "absent" ? styles.absentActive : styles.absentIdle]}
                onPress={() => onSetStatus(shift.slot_key, "absent")}
              >
                <Text style={[styles.statusButtonText, status === "absent" ? styles.textOnActive : styles.absentIdleText]}>A</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusButton, status === "leave" ? styles.leaveActive : styles.leaveIdle]}
                onPress={() => onSetStatus(shift.slot_key, "leave")}
              >
                <Text style={[styles.statusButtonText, status === "leave" ? styles.textOnActive : styles.leaveIdleText]}>L</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.otButton, otHours > 0 ? styles.otActive : styles.otIdle]}
                onPress={() => openOtPrompt(shift.slot_key)}
              >
                <Text style={[styles.otButtonText, otHours > 0 ? styles.textOnActive : styles.otIdleText]}>
                  OT{otHours > 0 ? ` ${otHours}h` : ""}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      <Modal visible={otPromptSlot !== null} transparent animationType="fade" onRequestClose={() => setOtPromptSlot(null)}>
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Overtime hours</Text>
            <TextInput
              style={styles.modalInput}
              value={otDraft}
              onChangeText={setOtDraft}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.muted}
              autoFocus
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setOtPromptSlot(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmButton} onPress={confirmOt}>
                <Text style={styles.modalConfirmText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  shiftBlock: { marginBottom: spacing.sm },
  shiftLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, marginBottom: 4 },
  buttonRow: { flexDirection: "row", gap: spacing.xs },
  statusButton: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  statusButtonText: { fontSize: 16, fontWeight: "700" },
  textOnActive: { color: colors.white },
  presentIdle: { backgroundColor: colors.tealLight },
  presentIdleText: { color: "#0F6E56" },
  presentActive: { backgroundColor: colors.teal },
  absentIdle: { backgroundColor: colors.dangerLight },
  absentIdleText: { color: colors.danger },
  absentActive: { backgroundColor: colors.danger },
  leaveIdle: { backgroundColor: colors.amberLight },
  leaveIdleText: { color: "#8A5A14" },
  leaveActive: { backgroundColor: colors.amber },
  otButton: {
    flex: 1,
    height: 44,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  otButtonText: { fontSize: 13, fontWeight: "700" },
  otIdle: { backgroundColor: colors.violetLight },
  otIdleText: { color: colors.violet },
  otActive: { backgroundColor: colors.violet },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  modalCard: { backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.lg, width: "80%" },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.navy, marginBottom: spacing.md },
  modalInput: {
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 18,
    color: colors.navy,
    textAlign: "center",
  },
  modalButtonRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  modalCancelButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.fieldBg },
  modalCancelText: { color: colors.muted, fontWeight: "700" },
  modalConfirmButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.teal },
  modalConfirmText: { color: colors.white, fontWeight: "700" },
});
