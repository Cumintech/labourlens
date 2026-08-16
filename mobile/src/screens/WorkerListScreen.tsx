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
        <ActivityIndicator style={{ marginTop: 40 }} />
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
              <Text style={styles.status}>{item.status}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  count: { fontSize: 16, fontWeight: "700" },
  addLink: { color: "#1a1a2e", fontWeight: "600" },
  empty: { textAlign: "center", color: "#888", marginTop: 40 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  name: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 12, color: "#888", marginTop: 2 },
  status: { fontSize: 12, color: "#2a9d5c", fontWeight: "600", textTransform: "capitalize" },
});
