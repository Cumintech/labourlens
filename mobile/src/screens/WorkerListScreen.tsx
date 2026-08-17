import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { listWorkers, Worker } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

// Real list wired to the backend -- not a placeholder. Search and
// Deactivate (per the mockups) are Day 4 scope; this proves Day 2's save
// flow actually persisted data, which is its whole purpose today.
type Props = NativeStackScreenProps<RootStackParamList, "WorkerList">;

export default function WorkerListScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      setLoading(true);
      listWorkers(token)
        .then(setWorkers)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [token]),
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.count}>Workers · {workers.length} active</Text>
        <TouchableOpacity onPress={() => navigation.navigate("NewWorkerScan")}>
          <Text style={styles.addLink}>+ New Worker</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.teal} />
      ) : workers.length === 0 ? (
        <Text style={styles.empty}>No workers registered yet.</Text>
      ) : (
        <FlatList
          data={workers}
          keyExtractor={(w) => String(w.id)}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>Aadhaar •••• •••• {item.aadhaar_last4}</Text>
              </View>
              <View style={[styles.badge, item.status === "active" ? styles.badgeActive : styles.badgeInactive]}>
                <Text style={styles.badgeText}>
                  {item.status === "active" ? "Active" : "Deactivated"}
                </Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white, padding: spacing.md },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  count: { fontSize: 16, fontWeight: "700", color: colors.navy },
  addLink: { color: colors.teal, fontWeight: "700" },
  empty: { textAlign: "center", color: colors.muted, marginTop: 40 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  name: { fontSize: 15, fontWeight: "700", color: colors.navy },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  badge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  badgeActive: { backgroundColor: colors.teal },
  badgeInactive: { backgroundColor: colors.muted },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: "700" },
});
