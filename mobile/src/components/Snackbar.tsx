import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, font, radius, spacing } from "../theme";

// A single bottom toast with an optional action (e.g. "Undo") that
// auto-dismisses after `durationMs`. One instance per screen, shown via
// a `{visible: boolean, message: string} | null` piece of state -- see
// AttendanceScreen's "Mark all" flow for the one current use.
export default function Snackbar({
  visible,
  message,
  actionLabel,
  onAction,
  onDismiss,
  durationMs = 5000,
  bottomOffset = 0,
}: {
  visible: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  durationMs?: number;
  bottomOffset?: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm only when visibility toggles on
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.wrap, { opacity, bottom: bottomOffset + spacing.md }]} pointerEvents="box-none">
      <View style={styles.bar}>
        <Text style={styles.message} numberOfLines={2}>
          {message}
        </Text>
        {actionLabel && onAction ? (
          <TouchableOpacity
            onPress={() => {
              onAction();
              onDismiss();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.action}>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: spacing.md, right: spacing.md },
  bar: {
    backgroundColor: colors.text,
    borderRadius: radius.control,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  message: { color: colors.white, fontFamily: font.medium, fontSize: 13, flex: 1 },
  action: { color: colors.onPrimaryMuted, fontFamily: font.semiBold, fontSize: 13 },
});
