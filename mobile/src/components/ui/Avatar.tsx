import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { avatarPalette } from "../../theme";

// Deterministic per-worker color from a small 5-color palette -- same
// worker always gets the same avatar color across screens/sessions,
// without storing a color choice anywhere.
function paletteFor(workerId: number) {
  return avatarPalette[Math.abs(workerId) % avatarPalette.length];
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({
  workerId,
  name,
  size = 40,
}: {
  workerId: number;
  name: string;
  size?: number;
}) {
  const { bg, text } = paletteFor(workerId);
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      <Text style={[styles.text, { color: text, fontSize: size * 0.38 }]}>{initialsFor(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  text: { fontFamily: "IBMPlexSans_700Bold" },
});
