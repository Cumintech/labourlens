import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { ApiError, scanAadhaar } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "NewWorkerScan">;

export default function NewWorkerScanScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [backUri, setBackUri] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  async function captureImage(setter: (uri: string) => void) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera permission needed", "Enable camera access to scan the Aadhaar card.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      base64: false,
    });
    if (!result.canceled && result.assets[0]) {
      setter(result.assets[0].uri);
    }
  }

  async function handleScanNow() {
    if (!frontUri) {
      Alert.alert("Front side required", "Scan the front of the Aadhaar card first.");
      return;
    }
    if (!token) return;

    setScanning(true);
    try {
      const fields = await scanAadhaar(token, frontUri, backUri);
      navigation.navigate("NewWorkerDetails", { ocrFields: fields });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection.";
      Alert.alert("Scan failed", message);
    } finally {
      setScanning(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>New Worker</Text>

      <TouchableOpacity style={styles.scanBox} onPress={() => captureImage(setFrontUri)}>
        {frontUri ? (
          <Image source={{ uri: frontUri }} style={styles.preview} />
        ) : (
          <Text style={styles.scanBoxLabel}>Scan Front</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.scanBox} onPress={() => captureImage(setBackUri)}>
        {backUri ? (
          <Image source={{ uri: backUri }} style={styles.preview} />
        ) : (
          <Text style={styles.scanBoxLabel}>Scan Back</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.hint}>
        Position the card within the frame. Both sides help extraction, but only the front is
        required.
      </Text>

      <TouchableOpacity
        style={[styles.button, (scanning || !frontUri) && styles.buttonDisabled]}
        onPress={handleScanNow}
        disabled={scanning || !frontUri}
      >
        {scanning ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.buttonText}>Scan Now</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, backgroundColor: colors.white, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: spacing.lg, color: colors.navy },
  scanBox: {
    height: 160,
    borderWidth: 1.5,
    borderColor: colors.teal,
    backgroundColor: colors.tealLight,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  scanBoxLabel: { fontSize: 16, color: colors.teal, fontWeight: "700" },
  preview: { width: "100%", height: "100%" },
  hint: { fontSize: 13, color: colors.muted, marginBottom: spacing.lg, textAlign: "center" },
  button: {
    backgroundColor: colors.teal,
    borderRadius: radius.sm,
    padding: 16,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: "700" },
});
