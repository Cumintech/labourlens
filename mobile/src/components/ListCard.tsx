import React, { ReactNode } from "react";
import { StyleSheet, TouchableOpacity, View, ViewStyle } from "react-native";
import { colors, radius } from "../theme";

// A rounded, bordered card whose rows are separated by a hairline divider
// -- the one shared list shape used by Today's "needs attention"/trial
// rows, Workers, and Attendance. Built as a plain `.map()` over `data`
// rather than a virtualized FlatList: every list in this app is capped at
// a small number of rows (50 workers per owner, max), so virtualization
// buys nothing and costs the ability to round the whole block's corners
// and separator cleanly. Pull-to-refresh lives on the screen's outer
// ScrollView, not here.
export default function ListCard<T>({
  data,
  keyExtractor,
  renderItem,
  empty,
  style,
}: {
  data: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  empty?: ReactNode;
  style?: ViewStyle | ViewStyle[];
}) {
  if (data.length === 0) {
    return <View style={[styles.card, style]}>{empty}</View>;
  }
  return (
    <View style={[styles.card, style]}>
      {data.map((item, i) => (
        <View key={keyExtractor(item)}>
          {renderItem(item, i)}
          {i < data.length - 1 && <View style={styles.divider} />}
        </View>
      ))}
    </View>
  );
}

export function ListCardRow({
  children,
  onPress,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
}) {
  if (onPress) {
    return (
      <TouchableOpacity style={[styles.row, style]} onPress={onPress} activeOpacity={0.7}>
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", padding: 14 },
  divider: { height: 1, backgroundColor: colors.divider, marginLeft: 14 },
});
