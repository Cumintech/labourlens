import { Flame, Hammer, HardHat, LucideIcon, Paintbrush, ShieldCheck, Truck, Wrench, Zap } from "lucide-react-native";
import React from "react";
import { View } from "react-native";

// Picks a trade illustration from a worker-type name (e.g. "Carpenter" ->
// hammer). Purely visual; unknown types fall back to a hard hat.
const TRADES: { match: RegExp; icon: LucideIcon; fg: string; bg: string }[] = [
  { match: /carpent|wood|joiner/i, icon: Hammer, fg: "#B45309", bg: "#FFF0D9" },
  { match: /plumb|pipe|fitter/i, icon: Wrench, fg: "#1565C0", bg: "#E3EEFD" },
  { match: /watch|guard|secur/i, icon: ShieldCheck, fg: "#0D47A1", bg: "#DCEBFA" },
  { match: /electric|wire/i, icon: Zap, fg: "#EF6C00", bg: "#FFF3E0" },
  { match: /weld|fabricat/i, icon: Flame, fg: "#E65100", bg: "#FFE9D6" },
  { match: /paint/i, icon: Paintbrush, fg: "#1976D2", bg: "#E3F2FD" },
  { match: /driver|loader|transport/i, icon: Truck, fg: "#1565C0", bg: "#EAF3FF" },
];

export function tradeFor(typeName: string | null | undefined) {
  const t = TRADES.find((x) => typeName && x.match.test(typeName));
  return t ?? { icon: HardHat, fg: "#F57C00", bg: "#FFF4E0" };
}

export default function TradeIcon({ typeName, size = 44 }: { typeName: string | null | undefined; size?: number }) {
  const t = tradeFor(typeName);
  const Icon = t.icon;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}>
      <Icon size={size * 0.5} color={t.fg} />
    </View>
  );
}
