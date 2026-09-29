import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "../../theme";

export default function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={[type.caption, styles.title]}>{title}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  title: { color: colors.textSecondary },
});
