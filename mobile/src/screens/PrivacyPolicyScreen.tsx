import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrivacyPolicyContent, getPrivacyPolicy } from "../api/client";
import ErrorState from "../components/ErrorState";
import { colors, spacing } from "../theme";

// Content is fetched from the backend (GET /privacy-policy.json), not
// hardcoded here -- the same content backs the public HTML page at
// GET /privacy-policy (the URL Play Console/App Store Connect both
// require), so there's exactly one place this text is ever written.
// See backend/privacy_policy.py.
export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  const [content, setContent] = useState<PrivacyPolicyContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getPrivacyPolicy()
      .then((c) => {
        setContent(c);
        setLoadError(false);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.teal} />
      </View>
    );
  }

  if (loadError || !content) {
    return <ErrorState message="Couldn't load the Privacy Policy. Check your connection and try again." onRetry={load} />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}>
      <Text style={styles.title}>{content.title}</Text>
      <Text style={styles.updated}>{content.updated}</Text>

      {content.sections.map((s) => (
        <View key={s.heading}>
          <Text style={styles.heading}>{s.heading}</Text>
          <Text style={styles.body}>{s.body}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  title: { fontSize: 22, fontWeight: "700", color: colors.navy },
  updated: { fontSize: 12, color: colors.muted, marginTop: 4, marginBottom: spacing.md },
  heading: { fontSize: 14, fontWeight: "700", color: colors.navy, marginTop: spacing.md, marginBottom: spacing.xs },
  body: { fontSize: 13, color: colors.muted, lineHeight: 20 },
});
