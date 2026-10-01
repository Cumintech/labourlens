import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { avatarColors, font } from "../theme";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Initials avatar, colored by hash(workerId) % 5 against the fixed
// 5-color avatar palette (theme.ts) -- decorative identification only,
// never a status signal.
export default function Avatar({ name, workerId, size = 36 }: { name: string; workerId: number; size?: number }) {
  const { bg, text } = avatarColors(workerId);
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      <Text style={[styles.text, { color: text, fontSize: size * 0.4 }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  text: { fontFamily: font.semiBold },
});
