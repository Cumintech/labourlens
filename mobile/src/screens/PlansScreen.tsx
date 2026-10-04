import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ArrowLeft, Check, FileText, Lock, MapPin } from "lucide-react-native";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createUpgradeRequest } from "../api/client";
import { useToast } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { RootStackParamList } from "../navigation/RootNavigator";
import { formatINR } from "../format";
import { PLANS, yearlyPerMonth, yearlyTotal } from "../plans";
import { trialStatusText } from "../planStatus";
import { openWhatsApp } from "../support";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Plans">;


// Simple shield + check + crown mark, inline (no separate asset) --
// matches the other hero-art components' hand-drawn SVG style.
function PlanHeroArt() {
  return (
    <Svg width={90} height={90} viewBox="0 0 90 90">
      <Path
        d="M45 10 L75 20 V42 C75 60 62 73 45 80 C28 73 15 60 15 42 V20 Z"
        fill="rgba(255,255,255,0.14)"
        stroke={colors.surface}
        strokeWidth={2.5}
      />
      <Path d="M32 44 L41 53 L59 33" stroke={colors.surface} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={66} cy={14} r={9} fill="#FFB300" />
      <Path d="M61 14 L64 10 L66 13 L68 10 L71 14 L68 18 L64 18 Z" fill={colors.surface} />
    </Svg>
  );
}

export default function PlansScreen({ navigation }: Props) {
  const { token, owner } = useAuth();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [selected, setSelected] = useState<string>("growth");
  const [submitting, setSubmitting] = useState(false);

  const plan = PLANS.find((p) => p.id === selected) ?? PLANS[1];

  async function handleUpgrade() {
    setSubmitting(true);
    try {
      if (token) {
        try {
          await createUpgradeRequest(token, plan.id, cycle);
          toast.show("Request sent — we'll confirm shortly");
        } catch {
          // Still open WhatsApp below even if the request couldn't be recorded.
        }
      }
      const text = `Hi, I'd like the Labour Lens ${plan.name} plan (${cycle}) for ${owner?.factory_name ?? "my factory"}.`;
      await openWhatsApp(text);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={[styles.hero, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
            <ArrowLeft size={22} color={colors.surface} />
          </Pressable>
          <Text style={styles.heroTitle}>Plans</Text>

          <View style={styles.heroBody}>
            <View style={{ flex: 1 }}>
              {!!owner && owner.plan_status === "trial" && (
                <View style={styles.trialChip}>
                  <Text style={styles.trialChipText}>{trialStatusText(owner)}</Text>
                </View>
              )}
              <Text style={styles.heroHeadline}>Stay inspection-ready, every month</Text>
              <Text style={styles.heroSubtitle}>
                Attendance, wages and statutory registers for your factory, all in one place.
              </Text>
            </View>
            <PlanHeroArt />
          </View>
        </View>

        <View style={styles.toggleRow}>
          <Pressable style={[styles.toggleOption, cycle === "monthly" && styles.toggleOptionSelected]} onPress={() => setCycle("monthly")}>
            <Text style={[styles.toggleText, cycle === "monthly" && styles.toggleTextSelected]}>Monthly</Text>
          </Pressable>
          <Pressable style={[styles.toggleOption, cycle === "yearly" && styles.toggleOptionSelected]} onPress={() => setCycle("yearly")}>
            <Text style={[styles.toggleText, cycle === "yearly" && styles.toggleTextSelected]}>Yearly</Text>
            <View style={styles.freeTag}>
              <Text style={styles.freeTagText}>2 months free</Text>
            </View>
          </Pressable>
        </View>

        <View style={styles.plansWrap}>
          {PLANS.map((p) => {
            const isSelected = p.id === selected;
            const price = cycle === "monthly" ? p.monthly : yearlyPerMonth(p.monthly);
            return (
              <Pressable
                key={p.id}
                style={[styles.planCard, isSelected && styles.planCardSelected]}
                onPress={() => setSelected(p.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
              >
                {p.popular && (
                  <View style={styles.popularBadge}>
                    <Text style={styles.popularBadgeText}>Most popular</Text>
                  </View>
                )}
                <View style={styles.planTitleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planName}>{p.name}</Text>
                    <Text style={styles.planLimit}>{p.limit}</Text>
                  </View>
                  <View style={[styles.radio, isSelected && styles.radioSelected]}>
                    {isSelected && <View style={styles.radioDot} />}
                  </View>
                </View>

                <Text style={styles.planPrice}>
                  ₹{formatINR(price)}
                  <Text style={styles.planPriceUnit}>/month</Text>
                </Text>
                <Text style={styles.planBillingNote}>
                  {cycle === "monthly" ? "Billed monthly" : `Billed ₹${formatINR(yearlyTotal(p.monthly))} yearly`}
                </Text>

                <View style={styles.featureList}>
                  {p.features.map((f) => (
                    <View key={f} style={styles.featureRow}>
                      <Check size={14} color={colors.present} />
                      <Text style={styles.featureText}>{f}</Text>
                    </View>
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.trustRow}>
          <TrustTile icon={Lock} label="Secure payment" />
          <TrustTile icon={FileText} label="GST invoice" />
          <TrustTile icon={MapPin} label="Made for Indian factories" />
        </View>

        <Pressable
          style={styles.whatsappLink}
          onPress={() => openWhatsApp("Hi, I have a question about Labour Lens plans.")}
          accessibilityRole="button"
        >
          <Text style={styles.whatsappLinkText}>Questions? Talk to us on WhatsApp</Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.stickyFooter, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Pressable style={[styles.upgradeButton, submitting && styles.upgradeButtonDisabled]} onPress={handleUpgrade} disabled={submitting}>
          <Text style={styles.upgradeButtonText}>Upgrade to {plan.name}</Text>
        </Pressable>
        <Text style={styles.footerCaption}>Prices exclude GST · Cancel anytime · Your data stays yours</Text>
      </View>
    </View>
  );
}

function TrustTile({ icon: Icon, label }: { icon: typeof Lock; label: string }) {
  return (
    <View style={styles.trustTile}>
      <Icon size={18} color={colors.primary} />
      <Text style={styles.trustTileText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  hero: {
    backgroundColor: colors.primaryDark,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  heroTitle: { fontFamily: "IBMPlexSans_700Bold", fontSize: 16, color: colors.surface, marginTop: spacing.sm },
  heroBody: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.md },
  trialChip: { alignSelf: "flex-start", backgroundColor: colors.warningTint, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, marginBottom: spacing.sm },
  trialChipText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 11, color: colors.warningTintText },
  heroHeadline: { fontFamily: "IBMPlexSans_700Bold", fontSize: 24, lineHeight: 30, color: colors.surface },
  heroSubtitle: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.onPrimaryMuted, marginTop: spacing.sm },
  toggleRow: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 4,
    marginTop: -22,
    gap: 2,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  toggleOption: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.pill },
  toggleOptionSelected: { backgroundColor: colors.primary },
  toggleText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 14, color: colors.navy },
  toggleTextSelected: { color: colors.surface },
  freeTag: { backgroundColor: colors.presentTint, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  freeTagText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 10, color: colors.present },
  plansWrap: { paddingHorizontal: spacing.md, marginTop: spacing.lg, gap: spacing.md },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  planCardSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  popularBadge: { position: "absolute", top: -10, left: spacing.md, backgroundColor: "#F57C00", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  popularBadgeText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 10, color: colors.surface },
  planTitleRow: { flexDirection: "row", alignItems: "flex-start" },
  planName: { fontFamily: "IBMPlexSans_700Bold", fontSize: 16, color: colors.navy },
  planLimit: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.primary },
  planPrice: { fontFamily: "IBMPlexSans_700Bold", fontSize: 26, color: colors.navy, marginTop: spacing.sm },
  planPriceUnit: { fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.textSecondary },
  planBillingNote: { fontFamily: "IBMPlexSans_500Medium", fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  featureList: { marginTop: spacing.sm, gap: 6 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureText: { flex: 1, fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.navy },
  trustRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.lg },
  trustTile: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
  },
  trustTileText: { fontFamily: "IBMPlexSans_600SemiBold", fontSize: 11, color: colors.navy, textAlign: "center" },
  whatsappLink: { alignItems: "center", marginTop: spacing.lg },
  whatsappLinkText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.primary },
  stickyFooter: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  upgradeButton: { backgroundColor: colors.primary, borderRadius: radius.sm, height: 50, alignItems: "center", justifyContent: "center" },
  upgradeButtonDisabled: { opacity: 0.6 },
  upgradeButtonText: { fontFamily: "IBMPlexSans_700Bold", fontSize: 15, color: colors.surface },
  footerCaption: { fontFamily: "IBMPlexSans_500Medium", fontSize: 11, color: colors.textSecondary, textAlign: "center", marginTop: spacing.xs },
});
