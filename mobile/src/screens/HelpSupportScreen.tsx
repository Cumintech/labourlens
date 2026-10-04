import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronRight, MessageCircle } from "lucide-react-native";
import { useAuth } from "../context/AuthContext";
import { openWhatsApp } from "../support";
import { colors, radius, spacing } from "../theme";

const FAQS: { q: string; a: string }[] = [
  {
    q: "How do I mark attendance for a shift?",
    a: 'Open Labour Attendance from Home, tap the shift tile for a worker to toggle Present/Absent, and tap OT to add overtime hours. Use "Mark All Present" or "Copy Yesterday" to save time on routine days.',
  },
  {
    q: "The Aadhaar card isn't available -- can I still register a worker?",
    a: 'Yes. From the New Worker screen, tap "Aadhaar card not available? Enter details manually" and fill in the form yourself instead of scanning.',
  },
  {
    q: "How is a worker's wage calculated?",
    a: "Basic Wages = days worked x rate, plus DA/HRA/Other Allowances/Overtime/Leave Wages = Gross. PF, ESI, and LWF are then deducted to get Net Wages. See the calculation breakdown on the Wage Calc tab by tapping any worker.",
  },
  {
    q: "How do I download or email a statutory form?",
    a: "Go to the Forms & Reports tab, pick a form, choose a worker and period if needed, then Download or Send by email.",
  },
  {
    q: "I forgot my App Lock PIN.",
    a: 'On the PIN entry screen, tap "Forgot PIN?" -- this logs you out (you\'ll need your mobile number and password to log back in) and turns off App Lock, so you can set a new PIN from Settings afterward. A normal Settings logout does not reset App Lock.',
  },
];

export default function HelpSupportScreen() {
  const insets = useSafeAreaInsets();
  const { owner } = useAuth();
  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}>
      <Text style={styles.title}>Help & Support</Text>

      <Pressable
        style={({ pressed }) => [styles.waCard, pressed && { opacity: 0.85 }]}
        onPress={() => openWhatsApp(`Hi, I need help with Labour Lens (Factory: ${owner?.factory_name ?? "-"})`)}
        accessibilityRole="button"
        accessibilityLabel="Chat with us on WhatsApp"
      >
        <View style={styles.waTile}>
          <MessageCircle size={24} color={colors.white} />
        </View>
        <View style={styles.waBody}>
          <Text style={styles.waTitle}>Chat with us on WhatsApp</Text>
          <Text style={styles.waSub}>Usually replies within a few hours</Text>
        </View>
        <ChevronRight size={20} color={colors.muted} />
      </Pressable>

      {FAQS.map((item) => (
        <View key={item.q} style={styles.card}>
          <Text style={styles.question}>{item.q}</Text>
          <Text style={styles.answer}>{item.a}</Text>
        </View>
      ))}

      <Text style={styles.contactHeading}>Still need help?</Text>
      <View style={styles.contactCard}>
        <Text style={styles.contactText}>Email: ganeshprabu844@gmail.com</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy, marginBottom: spacing.md },
  waCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.whatsapp,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  waTile: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.whatsapp, alignItems: "center", justifyContent: "center" },
  waBody: { flex: 1 },
  waTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.navy },
  waSub: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  card: { backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: spacing.sm + 4, marginBottom: spacing.sm },
  question: { fontSize: 13, fontWeight: "700", color: colors.navy },
  answer: { fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 18 },
  contactHeading: { fontSize: 14, fontWeight: "700", color: colors.navy, marginTop: spacing.lg, marginBottom: spacing.xs },
  contactCard: { backgroundColor: colors.tealLight, borderRadius: radius.sm, padding: spacing.sm + 4 },
  contactText: { fontSize: 13, color: colors.tealDark, fontWeight: "600" },
});
