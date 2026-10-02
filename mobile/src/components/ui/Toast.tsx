import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "../../theme";

type ToastOptions = { actionLabel?: string; onAction?: () => void; duration?: number };
type ToastState = { message: string } & ToastOptions;

const ToastContext = createContext<{ show: (message: string, opts?: ToastOptions) => void } | null>(null);

// Replaces a success Alert.alert popup -- a bottom banner that
// auto-dismisses, with an optional action (e.g. "Undo") rather than a
// modal the owner has to tap through for something that already
// succeeded. Destructive confirmations still use Alert.alert -- those
// need an explicit yes/no before anything happens, which a
// self-dismissing toast can't provide.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, opts: ToastOptions = {}) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setToast({ message, ...opts });
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => setToast(null));
    }, opts.duration ?? 3000);
  }, [opacity]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <Animated.View style={[styles.wrap, { opacity, bottom: insets.bottom + spacing.lg }]}>
          <Text style={styles.message}>{toast.message}</Text>
          {toast.actionLabel && (
            <Pressable
              onPress={() => {
                toast.onAction?.();
                if (hideTimer.current) clearTimeout(hideTimer.current);
                Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => setToast(null));
              }}
            >
              <Text style={styles.action}>{toast.actionLabel}</Text>
            </Pressable>
          )}
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  message: { flex: 1, fontFamily: "IBMPlexSans_500Medium", fontSize: 13, color: colors.surface },
  action: { fontFamily: "IBMPlexSans_700Bold", fontSize: 13, color: colors.primaryTint },
});
