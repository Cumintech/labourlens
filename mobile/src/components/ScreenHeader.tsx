import React, { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, font, spacing } from "../theme";

// The one page-title row shape every screen uses: a large title (+
// optional muted subtitle) on the left, an optional action on the right
// (a button, a link, an icon) vertically centered against it.
export default function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.textCol}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  textCol: { flex: 1 },
  title: { fontSize: 26, fontFamily: font.semiBold, color: colors.text },
  subtitle: { fontSize: 13, fontFamily: font.regular, color: colors.muted, marginTop: 2 },
});
