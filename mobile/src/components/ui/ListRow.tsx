import { ChevronRight, LucideIcon } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../../theme";

export default function ListRow({
  icon: Icon,
  left,
  title,
  subtitle,
  onPress,
  showChevron = true,
  right,
}: {
  icon?: LucideIcon;
  // Overrides `icon` when given -- e.g. an Avatar for a worker row.
  left?: React.ReactNode;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  showChevron?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <Pressable accessibilityRole={onPress ? "button" : undefined} onPress={onPress} style={styles.row}>
      {left ??
        (Icon && (
          <View style={styles.iconChip}>
            <Icon size={20} color={colors.primary} />
          </View>
        ))}
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
      {showChevron && onPress && <ChevronRight size={18} color={colors.textSecondary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm + 4, gap: spacing.sm },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTint,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: { flex: 1 },
  title: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.navy },
  subtitle: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
