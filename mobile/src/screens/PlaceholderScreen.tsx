// Shared shell for screens not built yet -- proves navigation works today
// without claiming functionality that doesn't exist. Each real screen
// (Days 2 and 4) replaces its corresponding placeholder.
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";

export default function PlaceholderScreen({ title, day }: { title: string; day: string }) {
  const { owner, logout } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>Coming {day} — this is a navigation placeholder, not the real screen.</Text>
      {owner && <Text style={styles.owner}>Signed in as {owner.name} ({owner.factory_name})</Text>}
      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  note: { fontSize: 14, color: "#888", textAlign: "center", marginBottom: 24 },
  owner: { fontSize: 13, color: "#444", marginBottom: 24 },
  logoutButton: { padding: 12 },
  logoutText: { color: "#c0392b", fontSize: 14, fontWeight: "600" },
});
