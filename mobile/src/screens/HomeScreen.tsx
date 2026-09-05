import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

// The landing hub after login -- previously the app dropped straight
// into Dashboard, which doubled as both the daily attendance screen and
// the launcher for every other feature. This pulls "where do I go" out
// to its own screen with three big, distinctly-colored tiles, and gives
// logout a home for the first time (it existed in AuthContext already
// but no screen ever called it).
export default function HomeScreen({ navigation }: Props) {
  const { owner, logout } = useAuth();

  function handleLogout() {
    Alert.alert("Log out", "Log out of Labour Lens on this device?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: logout },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <Text style={styles.heroEmoji}>🏭</Text>
          <TouchableOpacity onPress={handleLogout}>
            <Text style={styles.logoutLink}>Log out</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.factoryName}>{owner?.factory_name ?? "Labour Lens"}</Text>
        <Text style={styles.heroSubtitle}>Everything for today's shift floor, in one place.</Text>
      </View>

      <TouchableOpacity
        style={[styles.tile, { backgroundColor: colors.tealLight }]}
        onPress={() => navigation.navigate("Dashboard")}
      >
        <Text style={styles.tileEmoji}>📋</Text>
        <View style={styles.tileTextWrap}>
          <Text style={[styles.tileTitle, { color: "#0F6E56" }]}>Labour Attendance</Text>
          <Text style={styles.tileSubtitle}>Mark today's shifts, leave, and overtime</Text>
        </View>
        <Text style={[styles.tileArrow, { color: "#0F6E56" }]}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.tile, { backgroundColor: colors.skyBlueLight }]}
        onPress={() => navigation.navigate("NewWorkerScan")}
      >
        <Text style={styles.tileEmoji}>👷</Text>
        <View style={styles.tileTextWrap}>
          <Text style={[styles.tileTitle, { color: colors.skyBlue }]}>Add New Worker</Text>
          <Text style={styles.tileSubtitle}>Scan an Aadhaar card to register someone new</Text>
        </View>
        <Text style={[styles.tileArrow, { color: colors.skyBlue }]}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.tile, { backgroundColor: colors.violetLight }]}
        onPress={() => navigation.navigate("StatutoryForms")}
      >
        <Text style={styles.tileEmoji}>🗂️</Text>
        <View style={styles.tileTextWrap}>
          <Text style={[styles.tileTitle, { color: colors.violet }]}>Forms & Reports</Text>
          <Text style={styles.tileSubtitle}>Download or email statutory forms and reports</Text>
        </View>
        <Text style={[styles.tileArrow, { color: colors.violet }]}>›</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  hero: {
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroEmoji: { fontSize: 32 },
  logoutLink: { color: colors.tealPale, fontSize: 13, fontWeight: "700" },
  factoryName: { color: colors.white, fontSize: 22, fontWeight: "700", marginTop: spacing.sm },
  heroSubtitle: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 4 },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  tileEmoji: { fontSize: 34, marginRight: spacing.md },
  tileTextWrap: { flex: 1 },
  tileTitle: { fontSize: 17, fontWeight: "700" },
  tileSubtitle: { fontSize: 12, color: colors.muted, marginTop: 2 },
  tileArrow: { fontSize: 28, fontWeight: "700", marginLeft: spacing.sm },
});
