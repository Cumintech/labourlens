import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { colors, spacing } from "../theme";

export type Slice = { label: string; value: number; color: string };

// Donut chart drawn with stroke-dasharray arcs, plus a legend with counts.
export default function PieChart({ slices, size = 120 }: { slices: Slice[]; size?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const stroke = size * 0.22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <View style={styles.row}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.fieldBg} strokeWidth={stroke} fill="none" />
            {total > 0 &&
              slices.map((s) => {
                const len = (s.value / total) * c;
                const el = (
                  <Circle
                    key={s.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke={s.color}
                    strokeWidth={stroke}
                    fill="none"
                    strokeDasharray={`${len} ${c - len}`}
                    strokeDashoffset={-offset}
                  />
                );
                offset += len;
                return el;
              })}
          </G>
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Text style={styles.total}>{total}</Text>
        </View>
      </View>
      <View style={styles.legend}>
        {slices.map((s) => (
          <View key={s.label} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: s.color }]} />
            <Text style={styles.legendText}>
              {s.label}: <Text style={styles.legendCount}>{s.value}</Text>
              {total > 0 ? ` (${Math.round((s.value / total) * 100)}%)` : ""}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  center: { alignItems: "center", justifyContent: "center" },
  total: { fontSize: 22, fontWeight: "800", color: colors.navy },
  legend: { flex: 1, gap: 6 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 13, color: colors.textSecondary },
  legendCount: { fontWeight: "800", color: colors.navy },
});
