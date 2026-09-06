import React, { useEffect, useState } from "react";
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../theme";

type Props = {
  visible: boolean;
  initialHours: number;
  onConfirm: (hours: number) => void;
  onCancel: () => void;
};

// 0-8 hours in 0.5-hour steps -- a bounded, realistic range for a single
// day's overtime on top of a factory shift (an assumption, since none
// was specified; documented in the summary).
const OT_OPTIONS: number[] = [];
for (let h = 0; h <= 8; h += 0.5) OT_OPTIONS.push(h);

// Tapping the OT control opens this instead of editing inline -- a
// dropdown-style list of hour presets plus explicit Confirm/Cancel, so
// dismissing without confirming never changes the stored value.
export default function OtHoursModal({ visible, initialHours, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState(initialHours);

  useEffect(() => {
    if (visible) setSelected(initialHours);
  }, [visible, initialHours]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Overtime Hours</Text>
          <FlatList
            data={OT_OPTIONS}
            keyExtractor={(h) => String(h)}
            style={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity style={[styles.option, item === selected && styles.optionSelected]} onPress={() => setSelected(item)}>
                <Text style={[styles.optionText, item === selected && styles.optionTextSelected]}>
                  {item === 0 ? "No overtime" : `${item} hour${item === 1 ? "" : "s"}`}
                </Text>
              </TouchableOpacity>
            )}
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmButton} onPress={() => onConfirm(selected)}>
              <Text style={styles.confirmText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.lg, width: "80%", maxHeight: "70%" },
  title: { fontSize: 16, fontWeight: "700", color: colors.navy, marginBottom: spacing.sm },
  list: { flexGrow: 0, marginBottom: spacing.sm },
  option: { paddingVertical: 12, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  optionSelected: { backgroundColor: colors.violetLight },
  optionText: { fontSize: 15, color: colors.navy },
  optionTextSelected: { color: colors.violet, fontWeight: "700" },
  buttonRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  cancelButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.fieldBg },
  cancelText: { color: colors.muted, fontWeight: "700" },
  confirmButton: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.teal },
  confirmText: { color: colors.white, fontWeight: "700" },
});
