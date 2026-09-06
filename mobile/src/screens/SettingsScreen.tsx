import React from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { colors, radius, spacing } from "../theme";

// Settings tab -- previously logout had no home anywhere in the app at
// all. App Lock is a placeholder toggle (no such feature exists in the
// backend yet) so it's disabled rather than wired to nothing; Shifts &
// Profile lives on the Home tab's icon row instead of here, per request.
export default function SettingsScreen() {
  const { owner, logout } = useAuth();

  function handleLogout() {
    Alert.alert("Log out", "Log out of Labour Lens on this device?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: logout },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>

      <Text style={styles.sectionLabel}>Profile Info</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowIcon}>👤</Text>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>Owner Name</Text>
            <Text style={styles.rowValue}>{owner?.name ?? "-"}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowIcon}>📞</Text>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>Mobile</Text>
            <Text style={styles.rowValue}>{owner?.mobile ?? "-"}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowIcon}>🏭</Text>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>Factory Name</Text>
            <Text style={styles.rowValue}>{owner?.factory_name ?? "-"}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowIcon}>🔒</Text>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>App Lock</Text>
          </View>
          <Switch value={false} disabled trackColor={{ true: colors.teal }} />
        </View>
      </View>

      <Text style={styles.sectionLabel}>General</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.row} onPress={handleLogout}>
          <Text style={styles.rowIcon}>🚪</Text>
          <Text style={[styles.rowValue, { color: colors.danger, fontWeight: "700" }]}>Log Out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>Labour Lens v1.0{"\n"}Tamil Nadu Factories Act compliance, made simple 🇮🇳</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy, marginBottom: spacing.md },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase", marginBottom: spacing.xs, marginTop: spacing.md },
  card: { backgroundColor: colors.fieldBg, borderRadius: radius.md, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md },
  rowIcon: { fontSize: 20, marginRight: spacing.sm },
  rowTextWrap: { flex: 1 },
  rowLabel: { fontSize: 11, color: colors.muted },
  rowValue: { fontSize: 15, color: colors.navy, fontWeight: "600", marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.white, marginLeft: spacing.md + 28 },
  footer: { textAlign: "center", color: colors.muted, fontSize: 12, marginTop: spacing.xl, lineHeight: 18 },
});
