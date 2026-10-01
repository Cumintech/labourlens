import React from "react";
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle } from "react-native";
import { colors, font, radius, MIN_TOUCH_TARGET } from "../theme";

export type SegmentOption<T extends string> = { label: string; value: T };

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: ViewStyle | ViewStyle[];
}) {
  return (
    <View style={[styles.track, style]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(opt.value)}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: colors.segmentTrack,
    borderRadius: radius.control,
    padding: 3,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET - 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.control - 3,
  },
  segmentActive: { backgroundColor: colors.primary },
  label: { fontSize: 14, fontFamily: font.semiBold, color: colors.muted },
  labelActive: { color: colors.white },
});
