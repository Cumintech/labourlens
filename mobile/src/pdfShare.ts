import { File, Paths } from "expo-file-system";
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
  const destination = new File(Paths.cache, `${filenamePrefix}_${Date.now()}.pdf`);
  destination.create({ overwrite: true });
  destination.write(bytes);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(destination.uri);
  } else {
    Alert.alert("Downloaded", `Saved to ${destination.uri}`);
  }
}
