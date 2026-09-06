import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { colors, radius, spacing } from "../theme";

// A single pulsing placeholder block -- no new dependency, just RN's
// own Animated API looping opacity. Compose several of these into a
// screen-specific skeleton (see the *Skeleton components below) that
// mimics the real content's shape, so the layout doesn't jump once
// data arrives.
export function SkeletonBlock({ width, height, style }: { width: number | `${number}%`; height: number; style?: object }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.ease, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, easing: Easing.ease, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[{ width, height, borderRadius: radius.sm, backgroundColor: colors.fieldBg, opacity }, style]} />;
}

// Matches Dashboard/WageRateWorkers/WageCalculation's row shape: a name
// line, a meta line, and a row of tile-shaped controls underneath.
export function WorkerRowSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonBlock width="55%" height={16} style={{ marginBottom: spacing.xs }} />
      <SkeletonBlock width="35%" height={11} style={{ marginBottom: spacing.sm }} />
      <View style={styles.tileRow}>
        <SkeletonBlock width="22%" height={36} />
        <SkeletonBlock width="22%" height={36} />
        <SkeletonBlock width="22%" height={36} />
        <SkeletonBlock width="22%" height={36} />
      </View>
    </View>
  );
}

// A simpler two-line row -- Worker Types, Shift Settings, wage history.
export function SimpleRowSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonBlock width="60%" height={15} style={{ marginBottom: spacing.xs }} />
      <SkeletonBlock width="40%" height={11} />
    </View>
  );
}

export function ListSkeleton({ rows = 5, variant = "worker" }: { rows?: number; variant?: "worker" | "simple" }) {
  return (
    <View>
      {Array.from({ length: rows }).map((_, i) =>
        variant === "worker" ? <WorkerRowSkeleton key={i} /> : <SimpleRowSkeleton key={i} />,
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  tileRow: { flexDirection: "row", gap: spacing.xs },
});
