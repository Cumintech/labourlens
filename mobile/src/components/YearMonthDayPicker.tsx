import React, { useState } from "react";
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../theme";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

// Replaces relying on the native calendar/spinner picker for year
// selection -- confirmed still broken in practice (real-device
// feedback: tapping the calendar icon still can't reach an old DOB like
// 1990 without paging one year at a time, even with "calendar"/"inline"
// display modes requested), because that behavior is ultimately up to
// the OS/OEM's own picker implementation, not something a JS library
// can fully guarantee across every Android skin. This is a fully
// custom, in-app year -> month -> day flow instead, so it behaves
// identically everywhere: tap the year field, get a scrollable grid of
// years (newest first) and pick one directly -- exactly 1 tap to reach
// any year, then 2 more for month and day.
export default function YearMonthDayPicker({
  visible,
  initialDate,
  minYear = 1930,
  onSelect,
  onClose,
}: {
  visible: boolean;
  initialDate: Date;
  minYear?: number;
  onSelect: (date: Date) => void;
  onClose: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const [step, setStep] = useState<"year" | "month" | "day">("year");
  const [year, setYear] = useState(initialDate.getFullYear());
  const [month, setMonth] = useState(initialDate.getMonth());

  // Reset to the year step fresh every time the picker opens, rather
  // than resuming wherever it was left mid-flow last time.
  React.useEffect(() => {
    if (visible) {
      setStep("year");
      setYear(initialDate.getFullYear());
      setMonth(initialDate.getMonth());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const years = Array.from({ length: currentYear - minYear + 1 }, (_, i) => currentYear - i);
  const days = Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1);

  function handlePickYear(y: number) {
    setYear(y);
    setStep("month");
  }

  function handlePickMonth(m: number) {
    setMonth(m);
    setStep("day");
  }

  function handlePickDay(d: number) {
    onSelect(new Date(year, month, d));
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.headerRow}>
            {step !== "year" && (
              <TouchableOpacity onPress={() => setStep(step === "day" ? "month" : "year")}>
                <Text style={styles.backText}>‹ Back</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.title}>
              {step === "year" ? "Select year" : step === "month" ? `${year} — select month` : `${MONTH_NAMES[month]} ${year} — select day`}
            </Text>
          </View>

          {step === "year" && (
            <FlatList
              data={years}
              keyExtractor={(y) => String(y)}
              numColumns={4}
              style={styles.list}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.gridCell, item === year && styles.gridCellSelected]} onPress={() => handlePickYear(item)}>
                  <Text style={[styles.gridCellText, item === year && styles.gridCellTextSelected]}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          )}

          {step === "month" && (
            <FlatList
              data={MONTH_NAMES}
              keyExtractor={(m) => m}
              numColumns={3}
              style={styles.list}
              renderItem={({ item, index }) => (
                <TouchableOpacity style={[styles.gridCellWide, index === month && styles.gridCellSelected]} onPress={() => handlePickMonth(index)}>
                  <Text style={[styles.gridCellText, index === month && styles.gridCellTextSelected]}>{item.slice(0, 3)}</Text>
                </TouchableOpacity>
              )}
            />
          )}

          {step === "day" && (
            <FlatList
              data={days}
              keyExtractor={(d) => String(d)}
              numColumns={7}
              style={styles.list}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.gridCellSmall} onPress={() => handlePickDay(item)}>
                  <Text style={styles.gridCellText}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, maxHeight: "70%" },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm, gap: spacing.sm },
  backText: { color: colors.teal, fontWeight: "700", fontSize: 14 },
  title: { fontSize: 14, fontWeight: "700", color: colors.navy, flex: 1 },
  list: { flexGrow: 0 },
  gridCell: { flex: 1, margin: 4, paddingVertical: 14, borderRadius: radius.sm, backgroundColor: colors.fieldBg, alignItems: "center" },
  gridCellWide: { flex: 1, margin: 4, paddingVertical: 18, borderRadius: radius.sm, backgroundColor: colors.fieldBg, alignItems: "center" },
  gridCellSmall: { flex: 1, margin: 3, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.fieldBg, alignItems: "center" },
  gridCellSelected: { backgroundColor: colors.teal },
  gridCellText: { fontSize: 14, fontWeight: "600", color: colors.navy },
  gridCellTextSelected: { color: colors.white },
  cancelButton: { paddingVertical: 14, alignItems: "center", marginTop: spacing.xs },
  cancelText: { color: colors.muted, fontWeight: "700" },
});
