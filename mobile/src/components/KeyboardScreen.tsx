import React from "react";
import { StyleProp, ViewStyle } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";

// Real feedback from device testing: fields below the fold (e.g. PF rate
// on Wage Rate) were unreachable because the keyboard covered them and
// the screen never scrolled to compensate. A plain ScrollView +
// KeyboardAvoidingView (RN's own building blocks, the same pattern
// LoginScreen used successfully for its 2-field form) turned out not to
// reliably auto-scroll a focused input into view on a longer form --
// confirmed still broken on a real device after that fix. This library
// explicitly measures the focused input's position and scrolls it above
// the keyboard, which is the part RN's own components don't do for you.
export default function KeyboardScreen({
  children,
  contentContainerStyle,
  style,
}: {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <KeyboardAwareScrollView
      style={style}
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      extraScrollHeight={20}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
