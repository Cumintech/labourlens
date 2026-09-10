import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AttendanceStatus, ShiftConfig } from "../api/client";
import { colors, radius, spacing } from "../theme";

type Props = {
  shifts: ShiftConfig[];
  getShiftStatus: (slotKey: string) => AttendanceStatus | undefined;
  // "manual" | "biometric" | null/undefined -- optional so screens that
  // don't have this data yet (or don't care) can omit it; when present,
  // never shown as a bare Present tick with no origin.
  getShiftSource?: (slotKey: string) => string | null | undefined;
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
export default function DayAttendanceRow({
  shifts,
  getShiftStatus,
  getShiftSource,
  onSetShiftStatus,
  isOnLeave,
  onToggleLeave,
  otHours,
  onOpenOt,
}: Props) {
  return (
    <View style={styles.row}>
      {shifts.map((shift) => {
        // A slot with no attendance row yet (never marked) is a real
        // third state, not the same as explicitly marked Absent -- the
        // backend only ever stores "present"|"absent" (see
        // Attendance.status), so "never marked" is representable only as
        // the row's absence, and this is the one place that distinction
        // must not get collapsed into a color. Tapping an unmarked or
        // absent tile marks it present; tapping present marks it absent
        // -- there's no tap gesture back to "unmarked" once set, matching
        // existing behavior before this fix.
        const status = getShiftStatus(shift.slot_key);
        const isPresent = status === "present";
        const isAbsent = status === "absent";
        const isBiometric = isPresent && getShiftSource?.(shift.slot_key) === "biometric";
        const tileStyle = isPresent ? styles.tilePresent : isAbsent ? styles.tileAbsent : styles.tileNeutral;
        const textStyle = isPresent ? styles.textPresent : isAbsent ? styles.textAbsent : styles.textNeutral;
        const letter = isPresent ? "P" : isAbsent ? "A" : "—";
        return (
          <TouchableOpacity
            key={shift.slot_key}
            style={[styles.tile, tileStyle]}
            onPress={() => onSetShiftStatus(shift.slot_key, isPresent ? "absent" : "present")}
          >
            <Text style={[styles.tileText, textStyle]} numberOfLines={1}>
              {shift.label} {letter}
              {isBiometric ? " 👆" : ""}
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
  textPresent: { color: colors.tealDark },
  tileAbsent: { backgroundColor: colors.dangerLight },
  textAbsent: { color: colors.danger },
  tileLeave: { backgroundColor: colors.amberLight },
  textLeave: { color: colors.amberDark },
  tileOt: { backgroundColor: colors.violetLight },
  textOt: { color: colors.violet },
  // Not yet marked / no data -- a real status (see the 3-state switch
  // above), not a generic field background, so it gets its own token
  // rather than reusing fieldBg/muted.
  tileNeutral: { backgroundColor: colors.neutralLight },
  textNeutral: { color: colors.neutral },
});
