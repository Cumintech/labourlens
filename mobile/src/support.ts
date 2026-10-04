import { Linking } from "react-native";

// Sales/support WhatsApp number: country code + number, digits only.
// Overridable via EXPO_PUBLIC_SALES_WHATSAPP; the default keeps builds working
// when the env var isn't set (e.g. EAS, where .env isn't uploaded).
export const SALES_WHATSAPP = (process.env.EXPO_PUBLIC_SALES_WHATSAPP || "919941851295").replace(/\D/g, "");

// Click-to-WhatsApp, no API. Opens WhatsApp (or WhatsApp Business) with the text
// prefilled; if neither is installed, falls back to the phone dialer. We use the
// whatsapp:// scheme rather than wa.me because wa.me always "opens" (in the
// browser), so the dialer fallback would never trigger.
export async function openWhatsApp(text = ""): Promise<void> {
  const num = SALES_WHATSAPP;
  if (!num) return;
  const q = text ? `&text=${encodeURIComponent(text)}` : "";
  const attempts = [`whatsapp://send?phone=${num}${q}`, `tel:+${num}`];
  for (const url of attempts) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // try the next option
    }
  }
}
