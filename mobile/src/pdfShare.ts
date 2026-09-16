import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Alert } from "react-native";

// One shared "what do we do with a generated PDF's bytes" step, used by
// every screen that generates a document (Forms & Reports, the ID Card
// flows in Add Worker and Wage Rate detail) -- previously only existed
// inlined in StatutoryFormsScreen's own download handler.
export async function sharePdfBytes(bytes: Uint8Array, filenamePrefix: string): Promise<void> {
  const destination = new File(Paths.cache, `${filenamePrefix}_${Date.now()}.pdf`);
  destination.create({ overwrite: true });
  destination.write(bytes);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(destination.uri);
  } else {
    Alert.alert("Downloaded", `Saved to ${destination.uri}`);
  }
}
