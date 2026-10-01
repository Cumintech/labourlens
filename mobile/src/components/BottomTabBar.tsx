import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon, { IconName } from "./Icon";
import { colors, font, radius, spacing } from "../theme";

const TAB_ICON: Record<string, IconName> = {
  TodayTab: "grid",
  WorkersTab: "people",
  AttendanceTab: "calendarCheck",
  WagesTab: "document", // overridden below with the ₹ glyph
  ReportsTab: "document",
};

// White bar, active tab = a primarySoft pill behind the icon + primary
// label text, inactive = muted icon/label, no pill -- replaces React
// Navigation's default tab bar entirely (passed as Tab.Navigator's
// `tabBar` prop) so the active state can look like a pill, not a plain
// color change.
export default function BottomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label = (options.title ?? route.name) as string;
        const focused = state.index === index;

        function onPress() {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        }

        return (
          <TouchableOpacity key={route.key} style={styles.tab} onPress={onPress} activeOpacity={0.75}>
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
              {route.name === "WagesTab" ? (
                <Text style={[styles.rupee, { color: focused ? colors.primary : colors.muted }]}>₹</Text>
              ) : (
                <Icon name={TAB_ICON[route.name] ?? "grid"} size={20} color={focused ? colors.primary : colors.muted} />
              )}
            </View>
            <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  tab: { flex: 1, alignItems: "center", gap: 4 },
  iconWrap: { width: 44, height: 28, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  iconWrapActive: { backgroundColor: colors.primarySoft },
  rupee: { fontSize: 17, fontFamily: font.semiBold },
  label: { fontSize: 11, fontFamily: font.medium, color: colors.muted },
  labelActive: { color: colors.primary, fontFamily: font.semiBold },
});
