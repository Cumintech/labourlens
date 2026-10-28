import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Alert, Platform } from "react-native";

// One shared "what do we do with a generated PDF's bytes" step, used by
// every screen that generates a document (Forms & Reports, the ID Card
// flows in Add Worker and Wage Rate detail) -- previously only existed
// inlined in StatutoryFormsScreen's own download handler.
//
// expo-file-system's File/Paths have no web implementation at all (confirmed
// live: silently logs "expo-file-system is not supported on web" and never
// writes anything), so the native branch below left every PDF download a
// silent no-op when running in a browser -- no error, no file, nothing. Web
// gets its own branch using the plain browser download pattern (Blob +
// object URL + a throwaway <a download> click) instead.
export async function sharePdfBytes(bytes: Uint8Array, filenamePrefix: string): Promise<void> {
  if (Platform.OS === "web") {
    // .slice() guarantees a plain ArrayBuffer-backed copy -- bytes' own
    // buffer is typed ArrayBufferLike (could in principle be a
    // SharedArrayBuffer), which Blob's constructor type doesn't accept.
    const blob = new Blob([bytes.slice()], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filenamePrefix}_${Date.now()}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }
  // Let the user choose: save to the device, or share (WhatsApp etc.).
  const choice = await new Promise<"save" | "share" | null>((resolve) => {
    Alert.alert("Download or share", "What would you like to do with this file?", [
      { text: "Save to device", onPress: () => resolve("save") },
      { text: "Share / WhatsApp", onPress: () => resolve("share") },
      { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
  if (choice === null) return;
  if (choice === "save" && Platform.OS === "android") {
    try {
      const dir = await Directory.pickDirectoryAsync();
      const saved = dir.createFile(`${filenamePrefix}_${Date.now()}`, "application/pdf");
      saved.write(bytes);
      Alert.alert("Saved", `${saved.name || filenamePrefix} saved to ${dir.name || "the selected folder"}.`);
      return;
    } catch {
      // cancelled or folder not writable -- fall through to the share sheet
    }
  }
  const destination = new File(Paths.cache, `${filenamePrefix}_${Date.now()}.pdf`);
  destination.create({ overwrite: true });
  destination.write(bytes);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(destination.uri);
  } else {
    Alert.alert("Downloaded", `Saved to ${destination.uri}`);
  }
}
