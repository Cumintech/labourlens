import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, StyleSheet, Text } from "react-native";
import { colors, spacing } from "../theme";

// Describes what this specific app actually does with data -- not a
// generic template. Kept in sync with the real behavior: Aadhaar is
// encrypted at rest (only the last 4 digits are ever shown in the UI),
// everything else lives only on the owner's own backend, and nothing
// is shared with any third party by this app.
export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}>
      <Text style={styles.title}>Privacy Policy</Text>
      <Text style={styles.updated}>Last updated: 2026</Text>

      <Text style={styles.heading}>What we store</Text>
      <Text style={styles.body}>
        Worker Aadhaar numbers are encrypted before they're stored -- only the last 4 digits are ever shown on
        screen or in any downloaded form. Attendance, wage rates, and payment records are stored only on your
        own factory's account and are never shared with any other factory owner.
      </Text>

      <Text style={styles.heading}>Who can see it</Text>
      <Text style={styles.body}>
        Only your own login can see your factory's data. Every record is scoped to your account on the server --
        no other Labour Lens account can query or view it.
      </Text>

      <Text style={styles.heading}>Where it goes</Text>
      <Text style={styles.body}>
        Data stays on this app's backend unless you explicitly download or email a form or report yourself. We
        don't sell or share worker data with advertisers or other third parties.
      </Text>

      <Text style={styles.heading}>App Lock PIN</Text>
      <Text style={styles.body}>
        If you turn on App Lock, your 4-digit PIN is stored only on this device, in its secure hardware-backed
        storage (Android Keystore / iOS Keychain) -- it's never sent to our servers.
      </Text>

      <Text style={styles.heading}>Your control</Text>
      <Text style={styles.body}>
        You can deactivate a worker's record at any time from the app. Contact us via Help & Support if you need
        a worker's data corrected or removed.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy },
  updated: { fontSize: 12, color: colors.muted, marginTop: 4, marginBottom: spacing.md },
  heading: { fontSize: 14, fontWeight: "700", color: colors.navy, marginTop: spacing.md, marginBottom: spacing.xs },
  body: { fontSize: 13, color: colors.muted, lineHeight: 20 },
});
