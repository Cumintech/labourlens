import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AttendanceStatus, ShiftConfig } from "../api/client";
import { colors, radius, spacing } from "../theme";

type Props = {
  shifts: ShiftConfig[];
  getStatus: (slotKey: string) => AttendanceStatus | undefined;
  getOtHours: (slotKey: string) => number;
  onSetStatus: (slotKey: string, status: AttendanceStatus) => void;
  onSetOtHours: (slotKey: string, hours: number) => void;
};

// Only two statuses now (Present/Absent) -- Leave was removed, and with
// it the three-state chooser and its popup. Both the status tile and
// the OT tile are single-tap, no modal: tapping the status tile flips
// it straight to the other state, tapping OT advances to the next
// preset hour count. An unmarked shift displays as Absent, the same
// default used everywhere now that there's no separate Leave/Holiday
// concept (a real record is only ever written once something is
// tapped, but the *display* default is Absent, matching how Sundays
// are treated too).
const OT_PRESETS = [0, 1, 2, 3, 4, 5, 6];

export default function ShiftPresentAbsentRow({ shifts, getStatus, getOtHours, onSetStatus, onSetOtHours }: Props) {
  function toggleStatus(slotKey: string) {
    const current = getStatus(slotKey);
    onSetStatus(slotKey, current === "present" ? "absent" : "present");
  }

  function cycleOt(slotKey: string) {
    const current = getOtHours(slotKey);
    const index = OT_PRESETS.indexOf(current);
    const next = OT_PRESETS[(index + 1) % OT_PRESETS.length];
    onSetOtHours(slotKey, next);
  }

  return (
    <View style={styles.row}>
      {shifts.map((shift) => {
        const isPresent = getStatus(shift.slot_key) === "present";
        const otHours = getOtHours(shift.slot_key);
        return (
          <View key={shift.slot_key} style={styles.group}>
            <TouchableOpacity
              style={[styles.tile, isPresent ? styles.tilePresent : styles.tileAbsent]}
              onPress={() => toggleStatus(shift.slot_key)}
            >
              <Text style={[styles.tileText, isPresent ? styles.textPresent : styles.textAbsent]} numberOfLines={1}>
                {shift.label} · {isPresent ? "P" : "A"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.otTile, otHours > 0 && styles.otTileActive]} onPress={() => cycleOt(shift.slot_key)}>
              <Text style={[styles.otTileText, otHours > 0 && styles.otTileTextActive]}>{otHours > 0 ? `OT ${otHours}h` : "OT"}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  group: { flexGrow: 1, flexBasis: "45%", flexDirection: "row", gap: spacing.xs },
  tile: { flex: 2, borderRadius: radius.sm, paddingVertical: spacing.sm + 4, alignItems: "center" },
  tileText: { fontSize: 13, fontWeight: "700" },
  tilePresent: { backgroundColor: colors.tealLight },
  textPresent: { color: "#0F6E56" },
  tileAbsent: { backgroundColor: colors.dangerLight },
  textAbsent: { color: colors.danger },
  otTile: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.sm + 4, alignItems: "center", backgroundColor: colors.fieldBg },
  otTileActive: { backgroundColor: colors.violetLight },
  otTileText: { fontSize: 11, fontWeight: "700", color: colors.muted },
  otTileTextActive: { color: colors.violet },
});
