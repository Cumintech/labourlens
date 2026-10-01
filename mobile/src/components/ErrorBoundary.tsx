import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../theme";

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

// Without this, a single uncaught render error anywhere in the app
// (RootNavigator and everything below it) crashes to a blank screen
// with no recovery -- a real risk during App Store review, which runs
// a fixed pass over the app on a real device. Deliberately minimal: no
// error-reporting SDK, just a fallback screen and a way to retry
// rendering without force-quitting the app.
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (__DEV__) {
      console.error("ErrorBoundary caught:", error);
    }
  }

  reset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            Labour Lens ran into a problem and couldn't continue. Try again -- if it keeps happening, close and
            reopen the app.
          </Text>
          <TouchableOpacity style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, backgroundColor: colors.white },
  title: { fontSize: 18, fontWeight: "700", color: colors.navy, marginBottom: spacing.sm, textAlign: "center" },
  body: { fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 20, marginBottom: spacing.lg },
  button: { backgroundColor: colors.teal, borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: spacing.lg },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: "700" },
});
