import React, { ReactElement } from "react";
import { KeyboardAvoidingView, Platform, RefreshControlProps, ScrollView, StyleProp, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Real feedback from device testing: fields below the fold (e.g. PF rate
// on Wage Rate) were unreachable because the keyboard covered them and
// the screen never scrolled to compensate. This used to be built on
// react-native-keyboard-aware-scroll-view, but that library predates
// React Native's New Architecture (the Fabric renderer Expo SDK 57
// defaults to) and its keyboard/measurement logic doesn't reliably work
// under it -- confirmed on a real device as a much worse regression:
// the screen didn't scroll AT ALL, making the save button on every
// screen using this component unreachable, not just fields near the
// keyboard. Rebuilt on RN's own KeyboardAvoidingView + ScrollView --
// actively maintained, works correctly under Fabric -- with an
// explicit flex:1 on the outer view, which is what actually bounds the
// ScrollView to the screen so it has something to scroll within (the
// missing piece before: no caller ever passed a `style` prop, so the
// scroll container had no fixed height to scroll inside of).
//
// Trade-off worth knowing: this doesn't auto-scroll a focused input
// exactly above the keyboard the way the old library aimed to -- but a
// screen that scrolls manually is strictly better than one that
// doesn't scroll at all, which is the failure this replaces.
//
// Extra bottom padding equal to the device's safe-area inset is added
// here, once, rather than in every screen's own contentContainerStyle
// -- every screen using KeyboardScreen gets it automatically, which is
// the actual fix for "the last button is unreachable/clipped on a short
// device" past the home indicator/gesture bar.
export default function KeyboardScreen({
  children,
  contentContainerStyle,
  style,
  refreshControl,
}: {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[contentContainerStyle, { flexGrow: 1, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
