import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AttendanceStatus, ShiftConfig, Worker } from "../api/client";
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Redesigned per attendance-mockup.html (batch 3) -- collapses what
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

  const anyPresent = shifts.some((s) => getShiftStatus(s.slot_key) === "present");
  const edgeColor = isOnLeave ? colors.amber : anyPresent ? colors.teal : colors.neutral;
  const isMapped = !!worker.device_user_id;

  return (
    <View style={styles.card}>
      <View style={[styles.edge, { backgroundColor: edgeColor }]} />
      <TouchableOpacity onPress={onPressDetail} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(worker.name)}</Text>
        </View>
      </TouchableOpacity>

      <View style={styles.main}>
        <View style={styles.identityRow}>
          <TouchableOpacity onPress={onPressDetail} style={styles.nameTouchable}>
            <Text style={styles.name} numberOfLines={1}>
              {worker.name}
            </Text>
          </TouchableOpacity>
          <Text style={styles.idBadge}>{worker.numeric_employee_code ? `#${worker.numeric_employee_code}` : "no code yet"}</Text>
          <TouchableOpacity
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => setTipOpen((v) => !v)}
          >
            <View style={[styles.mapDot, { backgroundColor: isMapped ? colors.teal : colors.amber }]} />
          </TouchableOpacity>
          {worker.status !== "active" && (
            <View style={styles.inactiveBadge}>
              <Text style={styles.inactiveBadgeText}>Deactivated</Text>
            </View>
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
          <View style={styles.toggle}>
            {shifts.map((shift) => {
              const status = getShiftStatus(shift.slot_key);
              const isPresent = status === "present";
              const isBiometric = isPresent && getShiftSource?.(shift.slot_key) === "biometric";
              const segStyle = isOnLeave ? styles.segLeaveCovered : isPresent ? styles.segPresent : styles.segNeutral;
              const segTextStyle = isOnLeave ? styles.segTextLeaveCovered : isPresent ? styles.segTextPresent : styles.segTextNeutral;
              return (
                <TouchableOpacity
                  key={shift.slot_key}
                  style={[styles.seg, segStyle]}
                  onPress={() => onSetShiftStatus(shift.slot_key, isPresent ? "absent" : "present")}
                >
                  <Text style={[styles.segText, segTextStyle]} numberOfLines={1}>
                    {shift.label}
                    {isPresent ? " ✓" : ""}
                    {isBiometric ? " 👆" : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.seg, styles.segLast, isOnLeave ? styles.segLeave : styles.segNeutral]}
              onPress={onToggleLeave}
            >
              <Text style={[styles.segText, isOnLeave ? styles.segTextLeave : styles.segTextNeutral]} numberOfLines={1}>
                Leave{isOnLeave ? " ✓" : ""}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {worker.status === "active" && (
        <TouchableOpacity style={styles.kebab} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => setMenuOpen((v) => !v)}>
          <Text style={styles.kebabText}>⋯</Text>
        </TouchableOpacity>
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
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.fieldBg,
    paddingVertical: spacing.sm + 3,
    paddingRight: spacing.sm + 2,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    overflow: "visible",
  },
  edge: { width: 4, alignSelf: "stretch", borderRadius: 2, marginRight: spacing.sm },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  avatarText: { color: colors.white, fontSize: 13, fontWeight: "700" },
  main: { flex: 1, minWidth: 0 },
  identityRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  nameTouchable: { flexShrink: 1, maxWidth: "60%" },
  name: { fontSize: 14.5, fontWeight: "700", color: colors.navy, flexShrink: 1 },
  idBadge: {
    fontSize: 10.5,
    fontWeight: "700",
    color: colors.muted,
    backgroundColor: colors.fieldBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  mapDot: { width: 8, height: 8, borderRadius: 4 },
  inactiveBadge: { backgroundColor: colors.muted, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  inactiveBadgeText: { color: colors.white, fontSize: 9.5, fontWeight: "700" },
  tooltip: {
    backgroundColor: colors.navy,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.xs,
    maxWidth: 260,
    zIndex: 40,
  },
  tooltipText: { color: colors.white, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  toggle: { flexDirection: "row", borderWidth: 1, borderColor: colors.fieldBg, borderRadius: radius.sm, marginTop: spacing.xs, alignSelf: "flex-start", overflow: "hidden" },
  seg: { paddingVertical: 5, paddingHorizontal: 8, backgroundColor: colors.white, borderRightWidth: 1, borderRightColor: colors.fieldBg },
  segLast: { borderRightWidth: 0 },
  segText: { fontSize: 10.5, fontWeight: "700" },
  segPresent: { backgroundColor: colors.tealLight },
  segTextPresent: { color: colors.tealDark },
  segLeave: { backgroundColor: colors.amberLight },
  segTextLeave: { color: colors.amberDark },
  // Morning/Evening segments while Leave is active for the day -- a
  // muted amber tint (not the same solid fill as the Leave segment
  // itself) signals "covered by leave" without looking like a second
  // independently-marked state.
  segLeaveCovered: { backgroundColor: colors.amberPale },
  segTextLeaveCovered: { color: colors.amberDark },
  segNeutral: { backgroundColor: colors.white },
  segTextNeutral: { color: colors.muted },
  kebab: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  kebabText: { fontSize: 18, fontWeight: "800", color: colors.muted },
  menuBackdrop: { position: "absolute", top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 45 },
  menu: {
    position: "absolute",
    right: spacing.sm,
    top: 40,
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.fieldBg,
    width: 150,
    zIndex: 50,
    elevation: 8,
    shadowColor: colors.navy,
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  menuItem: { paddingVertical: 11, paddingHorizontal: 12 },
  menuItemText: { fontSize: 12.5, fontWeight: "600", color: colors.navy },
  menuItemDanger: { color: colors.danger },
  menuDivider: { height: 1, backgroundColor: colors.fieldBg },
});
