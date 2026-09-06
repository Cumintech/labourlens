import React, { ReactElement } from "react";
import { RefreshControlProps, StyleProp, ViewStyle } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Real feedback from device testing: fields below the fold (e.g. PF rate
// on Wage Rate) were unreachable because the keyboard covered them and
// the screen never scrolled to compensate. A plain ScrollView +
// KeyboardAvoidingView (RN's own building blocks, the same pattern
// LoginScreen used successfully for its 2-field form) turned out not to
// reliably auto-scroll a focused input into view on a longer form --
// confirmed still broken on a real device after that fix. This library
// explicitly measures the focused input's position and scrolls it above
// the keyboard, which is the part RN's own components don't do for you.
//
// Extra bottom padding equal to the device's safe-area inset is added
// here, once, rather than in every screen's own contentContainerStyle
// -- every screen using KeyboardScreen gets it automatically, which is
// the actual fix for "the last button is unreachable/clipped on a short
// device" (a real, confirmed instance of that bug was a plain View with
// no scroll container at all elsewhere; this covers the more common
// variant, not enough bottom clearance past the home indicator/gesture
// bar).
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
    <KeyboardAwareScrollView
      style={style}
      contentContainerStyle={[contentContainerStyle, { paddingBottom: insets.bottom + 24 }]}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      extraScrollHeight={20}
      refreshControl={refreshControl}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
