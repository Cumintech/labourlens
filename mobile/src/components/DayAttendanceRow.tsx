import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AttendanceStatus, ShiftConfig } from "../api/client";
import { colors, radius, spacing } from "../theme";

type Props = {
  shifts: ShiftConfig[];
  getShiftStatus: (slotKey: string) => AttendanceStatus | undefined;
  onSetShiftStatus: (slotKey: string, status: AttendanceStatus) => void;
  isOnLeave: boolean;
  onToggleLeave: () => void;
  otHours: number;
  onOpenOt: () => void;
};

// Exactly the control set requested: one Present/Absent tile per
// configured shift (Morning P, Evening P, ...), then one day-level
// Leave toggle, then one day-level OT tile. Deliberately does NOT own
// the OT popup itself -- mounting a Modal per row (one per worker per
// day) was a likely cause of the "Attendance page isn't scrollable"
// report; the OT modal is a single shared instance owned by the
// screen, and this component just calls onOpenOt() to ask for it.
export default function DayAttendanceRow({ shifts, getShiftStatus, onSetShiftStatus, isOnLeave, onToggleLeave, otHours, onOpenOt }: Props) {
  return (
    <View style={styles.row}>
      {shifts.map((shift) => {
        const isPresent = getShiftStatus(shift.slot_key) === "present";
        return (
          <TouchableOpacity
            key={shift.slot_key}
            style={[styles.tile, isPresent ? styles.tilePresent : styles.tileAbsent]}
            onPress={() => onSetShiftStatus(shift.slot_key, isPresent ? "absent" : "present")}
          >
            <Text style={[styles.tileText, isPresent ? styles.textPresent : styles.textAbsent]} numberOfLines={1}>
              {shift.label} {isPresent ? "P" : "A"}
            </Text>
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity style={[styles.tile, isOnLeave ? styles.tileLeave : styles.tileNeutral]} onPress={onToggleLeave}>
        <Text style={[styles.tileText, isOnLeave ? styles.textLeave : styles.textNeutral]} numberOfLines={1}>
          {isOnLeave ? "Leave ✓" : "Leave"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.tile, otHours > 0 ? styles.tileOt : styles.tileNeutral]} onPress={onOpenOt}>
        <Text style={[styles.tileText, otHours > 0 ? styles.textOt : styles.textNeutral]} numberOfLines={1}>
          {otHours > 0 ? `OT ${otHours}h` : "OT"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  tile: { flexGrow: 1, flexBasis: "22%", borderRadius: radius.sm, paddingVertical: spacing.sm + 2, alignItems: "center" },
  tileText: { fontSize: 12, fontWeight: "700" },
  tilePresent: { backgroundColor: colors.tealLight },
  textPresent: { color: "#0F6E56" },
  tileAbsent: { backgroundColor: colors.dangerLight },
  textAbsent: { color: colors.danger },
  tileLeave: { backgroundColor: colors.amberLight },
  textLeave: { color: "#8A5A14" },
  tileOt: { backgroundColor: colors.violetLight },
  textOt: { color: colors.violet },
  tileNeutral: { backgroundColor: colors.fieldBg },
  textNeutral: { color: colors.muted },
});
