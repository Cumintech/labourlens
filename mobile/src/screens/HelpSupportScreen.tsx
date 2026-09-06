import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
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
    a: "Log out and log back in with your mobile number and password -- this resets App Lock, and you can set a new PIN from Settings.",
  },
];

export default function HelpSupportScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Help & Support</Text>

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
  card: { backgroundColor: colors.fieldBg, borderRadius: radius.sm, padding: spacing.sm + 4, marginBottom: spacing.sm },
  question: { fontSize: 13, fontWeight: "700", color: colors.navy },
  answer: { fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 18 },
  contactHeading: { fontSize: 14, fontWeight: "700", color: colors.navy, marginTop: spacing.lg, marginBottom: spacing.xs },
  contactCard: { backgroundColor: colors.tealLight, borderRadius: radius.sm, padding: spacing.sm + 4 },
  contactText: { fontSize: 13, color: "#0F6E56", fontWeight: "600" },
});
