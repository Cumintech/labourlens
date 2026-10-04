import { Check, Clock, Fingerprint, MoreVertical, UserX } from "lucide-react-native";
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AttendanceStatus, ShiftConfig, Worker } from "../api/client";
import { Avatar, EmploymentChip } from "./ui";
import { colors, radius, spacing } from "../theme";

type Props = {
  worker: Worker;
  shifts: ShiftConfig[];
  getShiftStatus: (slotKey: string) => AttendanceStatus | undefined;
  getShiftSource: (slotKey: string) => string | null | undefined;
  onSetShiftStatus: (slotKey: string, status: AttendanceStatus) => void;
  isOnLeave: boolean;
  onToggleLeave: () => void;
  otHours: number;
  onOpenOt: () => void;
  onDeactivate: () => void;
  onPressDetail: () => void;
};

// Layout per the Attendance redesign mockup: identity row (avatar, name,
// code + day detail, status pill, ⋯ menu) over equal-width shift/Leave
// buttons. Behaviour unchanged. Earlier history: redesigned per attendance-mockup.html (batch 3) -- collapses what
// used to be up to 4 full-width buttons per shift/leave/OT plus an
// always-visible "Deactivate" link into: an avatar, a colored left-edge
// strip for at-a-glance scanning, a one-line identity (name + employee
// ID badge + a tap-for-detail device-mapping dot instead of a second
// permanent text line), one compact segmented toggle covering every
// configured shift plus Leave, and a "⋯" menu for the two
// lower-frequency actions (OT, Deactivate) that don't need to compete
// visually with daily shift-marking.
export default function AttendanceRowCard({
  worker,
  shifts,
  getShiftStatus,
  getShiftSource,
  onSetShiftStatus,
  isOnLeave,
  onToggleLeave,
  otHours,
  onOpenOt,
  onDeactivate,
  onPressDetail,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);

  const presentShifts = shifts.filter((s) => getShiftStatus(s.slot_key) === "present");
  const anyPresent = presentShifts.length > 0;
  const isMapped = !!worker.device_user_id;
  const code = worker.numeric_employee_code ? `#${worker.numeric_employee_code}` : "No code yet";
  const dayDetail = isOnLeave
    ? "On leave"
    : !anyPresent
      ? ""
      : presentShifts.length === shifts.length && shifts.length > 1
        ? "Full day"
        : presentShifts.length === 1
          ? `${presentShifts[0].label} only`
          : presentShifts.map((s) => s.label).join(" + ");
  const pill = isOnLeave
    ? { text: "On leave", style: styles.pillLeave, textStyle: styles.pillTextLeave }
    : anyPresent
      ? { text: "Present", style: styles.pillPresent, textStyle: styles.pillTextPresent }
      : { text: "Not marked", style: styles.pillLeave, textStyle: styles.pillTextLeave };

  return (
    <View style={[styles.card, menuOpen && styles.cardRaised]}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={onPressDetail} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
          <Avatar workerId={worker.id} name={worker.name} size={40} />
        </TouchableOpacity>

        <View style={styles.identity}>
          <View style={styles.nameRow}>
            <TouchableOpacity onPress={onPressDetail} style={styles.nameTouchable}>
              <Text style={styles.name} numberOfLines={1}>
                {worker.name}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              onPress={() => setTipOpen((v) => !v)}
              accessibilityLabel={isMapped ? "Biometric device mapped" : "No biometric device mapped"}
            >
              <View style={[styles.mapDot, { backgroundColor: isMapped ? colors.present : colors.amber }]} />
            </TouchableOpacity>
          </View>
          <Text style={styles.codeLine} numberOfLines={1}>
            {code}
            {dayDetail ? ` · ${dayDetail}` : ""}
          </Text>
        </View>

        {worker.status === "active" ? (
          <>
            <EmploymentChip w={worker} />
            <View style={[styles.pill, pill.style]}>
              <Text style={[styles.pillText, pill.textStyle]}>{pill.text}</Text>
            </View>
          </>
        ) : (
          <View style={styles.inactiveBadge}>
            <Text style={styles.inactiveBadgeText}>Deactivated</Text>
          </View>
        )}

        {worker.status === "active" && (
          <TouchableOpacity style={styles.kebab} onPress={() => setMenuOpen((v) => !v)} accessibilityLabel="More actions">
            <MoreVertical size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {tipOpen && (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipText}>
            {isMapped
              ? `Device ID: ${worker.device_user_id} — mapped and clocking normally.`
              : "Device ID: no device mapped yet — attendance won't clock from the fingerprint machine until mapped."}
          </Text>
        </View>
      )}

      {worker.status === "active" && (
        <View style={styles.segRow}>
          {shifts.map((shift) => {
            const status = getShiftStatus(shift.slot_key);
            const isPresent = status === "present";
            const isBiometric = isPresent && getShiftSource?.(shift.slot_key) === "biometric";
            const segStyle = isOnLeave ? styles.segLeaveCovered : isPresent ? styles.segPresent : styles.segNeutral;
            const fg = isOnLeave ? colors.amberDark : isPresent ? colors.present : colors.navy;
            return (
              <TouchableOpacity
                key={shift.slot_key}
                style={[styles.seg, segStyle]}
                onPress={() => onSetShiftStatus(shift.slot_key, isPresent ? "absent" : "present")}
                accessibilityState={{ selected: isPresent }}
              >
                {isPresent && <Check size={15} color={fg} strokeWidth={2.8} />}
                <Text style={[styles.segText, { color: fg }]} numberOfLines={1}>
                  {shift.label}
                </Text>
                {isBiometric && <Fingerprint size={14} color={fg} accessibilityLabel="Biometric punch" />}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.seg, isOnLeave ? styles.segLeave : styles.segNeutral]}
            onPress={onToggleLeave}
            accessibilityState={{ selected: isOnLeave }}
          >
            {isOnLeave && <Check size={15} color={colors.leave} strokeWidth={2.8} />}
            <Text style={[styles.segText, { color: isOnLeave ? colors.leave : colors.navy }]} numberOfLines={1}>
              Leave
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {menuOpen && (
        <>
          <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuOpen(false)} />
          <View style={styles.menu}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                onOpenOt();
              }}
            >
              <Clock size={18} color={colors.primary} />
              <Text style={styles.menuItemText}>{otHours > 0 ? `Mark OT (${otHours}h)` : "Mark OT"}</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                onDeactivate();
              }}
            >
              <UserX size={18} color={colors.danger} />
              <Text style={[styles.menuItemText, styles.menuItemDanger]}>Deactivate</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 10,
    marginHorizontal: spacing.md,
    marginTop: 10,
    overflow: "visible",
  },
  // Lift the card whose menu is open above its siblings so the menu overlays the next card.
  cardRaised: { zIndex: 50, elevation: 8 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  identity: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  nameTouchable: { flexShrink: 1 },
  name: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.navy },
  codeLine: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  mapDot: { width: 8, height: 8, borderRadius: 4 },
  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 11 },
  pillPresent: { backgroundColor: colors.presentTint },
  pillTextPresent: { color: colors.present },
  pillLeave: { backgroundColor: colors.leaveTint },
  pillTextLeave: { color: colors.leave },
  inactiveBadge: { backgroundColor: colors.muted, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  inactiveBadgeText: { color: colors.white, fontSize: 10, fontWeight: "700" },
  kebab: { width: 36, height: 44, alignItems: "center", justifyContent: "center", marginRight: -6 },
  tooltip: { backgroundColor: colors.primary, borderRadius: radius.sm, padding: spacing.sm, zIndex: 40 },
  tooltipText: { color: colors.white, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  segRow: { flexDirection: "row", gap: 6 },
  seg: { flex: 1, height: 44, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 4 },
  segText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, flexShrink: 1 },
  segNeutral: { backgroundColor: colors.ground, borderWidth: 1, borderColor: colors.border },
  segPresent: { backgroundColor: colors.presentTint, borderWidth: 1.5, borderColor: "#A7DDB9" },
  segLeave: { backgroundColor: colors.leaveTint, borderWidth: 1.5, borderColor: colors.warningBorder },
  // Shift segments while Leave is active for the day -- "covered by leave".
  segLeaveCovered: { backgroundColor: colors.amberPale, borderWidth: 1, borderColor: colors.warningBorder },
  menuBackdrop: { position: "absolute", top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 45 },
  menu: {
    position: "absolute",
    right: 10,
    top: 56,
    width: 196,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
    zIndex: 50,
    elevation: 10,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 10, height: 44, paddingHorizontal: 10, borderRadius: 10 },
  menuItemText: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 14, color: colors.navy },
  menuItemDanger: { color: colors.danger },
  menuDivider: { height: 1, backgroundColor: colors.divider, marginHorizontal: 6, marginVertical: 2 },
});
