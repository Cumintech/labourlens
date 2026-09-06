import React, { useState } from "react";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { AttendanceStatus, ShiftConfig } from "../api/client";
import { colors, radius, spacing } from "../theme";

type Props = {
  shifts: ShiftConfig[];
  isSunday: boolean;
  getStatus: (slotKey: string) => AttendanceStatus | undefined;
  getOtHours: (slotKey: string) => number;
  onSetStatus: (slotKey: string, status: AttendanceStatus) => void;
  onSetOtHours: (slotKey: string, hours: number) => void;
};

// The Dashboard lists every worker for the day, so each row needs to
// stay compact -- one line, one bigger tile per shift ("Morning P",
// "Evening P") instead of the full always-visible P/A/L/OT button grid
// used on the lower-traffic per-worker and multi-day screens. Tapping a
// tile opens the full set of options (still separate buttons, never a
// cycle -- hiding Absent/Leave behind a cycle was the exact complaint
// that led to them being split out in the first place).
export default function ShiftStatusLine({ shifts, isSunday, getStatus, getOtHours, onSetStatus, onSetOtHours }: Props) {
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [otDraft, setOtDraft] = useState("");

  function openSheet(slotKey: string) {
    const hours = getOtHours(slotKey);
    setOtDraft(hours ? String(hours) : "");
    setActiveSlot(slotKey);
  }

  function choose(status: AttendanceStatus) {
    if (activeSlot) onSetStatus(activeSlot, status);
    setActiveSlot(null);
  }

  function saveOt() {
    if (!activeSlot) return;
    const hours = parseFloat(otDraft);
    onSetOtHours(activeSlot, isNaN(hours) || hours < 0 ? 0 : hours);
    setActiveSlot(null);
  }

  const activeShift = shifts.find((s) => s.slot_key === activeSlot);

  return (
    <View style={styles.row}>
      {shifts.map((shift) => {
        const status = getStatus(shift.slot_key);
        const otHours = getOtHours(shift.slot_key);
        // Sunday defaults to a paid holiday when nothing's been marked --
        // wages are already counted for it either way (backend treats
        // every Sunday as counted-for-wages regardless of any mark), this
        // just labels that default instead of showing a bare "-".
        const showsAsHoliday = isSunday && !status;
        const tileStyle = showsAsHoliday
          ? styles.tileHoliday
          : status === "present"
          ? styles.tilePresent
          : status === "leave"
          ? styles.tileLeave
          : status === "absent"
          ? styles.tileAbsent
          : styles.tileUnmarked;
        const textStyle = showsAsHoliday
          ? styles.textHoliday
          : status === "present"
          ? styles.textPresent
          : status === "leave"
          ? styles.textLeave
          : status === "absent"
          ? styles.textAbsent
          : styles.textUnmarked;
        const mark = showsAsHoliday ? "Holiday" : status === "present" ? "P" : status === "leave" ? "L" : status === "absent" ? "A" : "–";
        return (
          <TouchableOpacity key={shift.slot_key} style={[styles.tile, tileStyle]} onPress={() => openSheet(shift.slot_key)}>
            <Text style={[styles.tileText, textStyle]} numberOfLines={1}>
              {shift.label} · {mark}
              {otHours > 0 ? ` +${otHours}h` : ""}
            </Text>
          </TouchableOpacity>
        );
      })}

      <Modal visible={activeSlot !== null} transparent animationType="fade" onRequestClose={() => setActiveSlot(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{activeShift?.label}</Text>
            <View style={styles.sheetButtonRow}>
              <TouchableOpacity style={[styles.sheetButton, styles.tilePresent]} onPress={() => choose("present")}>
                <Text style={[styles.sheetButtonText, styles.textPresent]}>Present</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.sheetButton, styles.tileAbsent]} onPress={() => choose("absent")}>
                <Text style={[styles.sheetButtonText, styles.textAbsent]}>Absent</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.sheetButton, styles.tileLeave]} onPress={() => choose("leave")}>
                <Text style={[styles.sheetButtonText, styles.textLeave]}>Leave</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.otLabel}>Overtime hours</Text>
            <TextInput
              style={styles.otInput}
              value={otDraft}
              onChangeText={setOtDraft}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.muted}
            />
            <View style={styles.sheetFooterRow}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setActiveSlot(null)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveOtButton} onPress={saveOt}>
                <Text style={styles.saveOtButtonText}>Save OT hours</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  tile: { flexGrow: 1, flexBasis: "45%", borderRadius: radius.sm, paddingVertical: spacing.sm + 4, alignItems: "center" },
  tileText: { fontSize: 13, fontWeight: "700" },
  tileUnmarked: { backgroundColor: colors.fieldBg },
  textUnmarked: { color: colors.muted },
  tilePresent: { backgroundColor: colors.tealLight },
  textPresent: { color: "#0F6E56" },
  tileAbsent: { backgroundColor: colors.dangerLight },
  textAbsent: { color: colors.danger },
  tileLeave: { backgroundColor: colors.amberLight },
  textLeave: { color: "#8A5A14" },
  tileHoliday: { backgroundColor: colors.violetLight },
  textHoliday: { color: colors.violet },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  sheet: { backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.lg, width: "85%" },
  sheetTitle: { fontSize: 16, fontWeight: "700", color: colors.navy, marginBottom: spacing.md },
  sheetButtonRow: { flexDirection: "row", gap: spacing.xs },
  sheetButton: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.sm + 4, alignItems: "center" },
  sheetButtonText: { fontSize: 13, fontWeight: "700" },
  otLabel: { fontSize: 12, fontWeight: "600", color: colors.muted, marginTop: spacing.md, marginBottom: spacing.xs },
  otInput: { backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: 12, fontSize: 16, color: colors.navy },
  sheetFooterRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  cancelButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.fieldBg },
  cancelButtonText: { color: colors.muted, fontWeight: "700" },
  saveOtButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.teal },
  saveOtButtonText: { color: colors.white, fontWeight: "700" },
});
