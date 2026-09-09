import DateTimePicker, { DateTimePickerChangeEvent } from "@react-native-community/datetimepicker";
import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { colors, radius, spacing } from "../theme";

export function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseIso(value: string): { day: string; month: string; year: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { day: "", month: "", year: "" };
  return { year: match[1], month: match[2], day: match[3] };
}

// A real calendar date, not just "3 numbers in range" -- e.g. rejects
// 31/02/2000. new Date() silently rolls invalid day/month combinations
// forward (31 Feb becomes 2/3 Mar), so round-tripping the parts back
// out and comparing is what actually catches that.
function toValidIso(day: string, month: string, year: string): string | null {
  if (day.length === 0 || month.length === 0 || year.length !== 4) return null;
  const d = parseInt(day, 10);
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (!d || !m || !y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return isoDate(date);
}

// Replaces a free-typed "YYYY-MM-DD" text field -- a typo'd or
// ambiguous hand-typed date was real feedback from the first
// real-device pass. Direct Day/Month/Year entry (real feedback: the
// native picker's own year scroller makes reaching an old DOB like
// 1984 painfully slow, one increment at a time) is now the primary way
// to set a date; the calendar button next to it still opens the native
// picker for whenever browsing a nearby date is more convenient than
// typing it.
export default function DateField({
  label,
  value,
  onChange,
  placeholder = "Select date",
  disabled = false,
}: {
  label: string;
  value: string; // "" | "YYYY-MM-DD"
  onChange: (isoValue: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [parts, setParts] = useState(() => parseIso(value));
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);

  // Re-sync from the parent whenever it changes the value out from
  // under us (OCR filling the field in, a reset, a different worker
  // loaded) -- but not on every keystroke, since during typing the
  // parent's value only updates once the date becomes fully valid,
  // and re-syncing then would fight whichever field the user is still
  // mid-edit on.
  useEffect(() => {
    setParts(parseIso(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function updatePart(next: Partial<typeof parts>) {
    const merged = { ...parts, ...next };
    setParts(merged);
    const iso = toValidIso(merged.day, merged.month, merged.year);
    if (iso) onChange(iso);
  }

  function handleDayChange(text: string) {
    const digits = text.replace(/[^0-9]/g, "").slice(0, 2);
    updatePart({ day: digits });
    if (digits.length === 2) monthRef.current?.focus();
  }

  function handleMonthChange(text: string) {
    const digits = text.replace(/[^0-9]/g, "").slice(0, 2);
    updatePart({ month: digits });
    if (digits.length === 2) yearRef.current?.focus();
  }

  function handleYearChange(text: string) {
    const digits = text.replace(/[^0-9]/g, "").slice(0, 4);
    updatePart({ year: digits });
  }

  // `onChange` is deprecated in the installed library version in favor
  // of `onValueChange`/`onDismiss`/`onNeutralButtonPress` -- confirmed
  // against the installed package's own type definitions, not assumed.
  function handlePickerChange(_event: DateTimePickerChangeEvent, selected: Date) {
    // Android's picker is a modal dialog that closes itself; iOS's is an
    // inline spinner that stays open until the field is tapped again --
    // hiding unconditionally after any change only closes it where that
    // dismissal is expected.
    if (Platform.OS === "android") setShowPicker(false);
    const iso = isoDate(selected);
    setParts(parseIso(iso));
    onChange(iso);
  }

  function handleDismiss() {
    if (Platform.OS === "android") setShowPicker(false);
  }

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.row, disabled && styles.inputDisabled]}>
        <TextInput
          style={styles.partInputDay}
          value={parts.day}
          onChangeText={handleDayChange}
          placeholder="DD"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
          maxLength={2}
          editable={!disabled}
        />
        <Text style={styles.separator}>/</Text>
        <TextInput
          ref={monthRef}
          style={styles.partInputDay}
          value={parts.month}
          onChangeText={handleMonthChange}
          placeholder="MM"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
          maxLength={2}
          editable={!disabled}
        />
        <Text style={styles.separator}>/</Text>
        <TextInput
          ref={yearRef}
          style={styles.partInputYear}
          value={parts.year}
          onChangeText={handleYearChange}
          placeholder="YYYY"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
          maxLength={4}
          editable={!disabled}
        />
        <TouchableOpacity
          style={styles.calendarButton}
          onPress={() => !disabled && setShowPicker(true)}
          disabled={disabled}
        >
          <Text style={styles.calendarButtonText}>📅</Text>
        </TouchableOpacity>
      </View>
      {!value && !parts.day && !parts.month && !parts.year && (
        <Text style={styles.placeholderHint}>{placeholder}</Text>
      )}
      {showPicker && !disabled && (
        <DateTimePicker
          value={value ? new Date(value) : new Date()}
          mode="date"
          // "default" on Android can fall back to the one-unit-at-a-time
          // spinner style on some OEM skins (Samsung's stock theme, real
          // feedback) instead of the classic calendar view, which is the
          // one that has a tappable month/year header opening a
          // scrollable year list -- "calendar" forces that mode
          // explicitly rather than leaving it to the device's theme.
          display={Platform.OS === "ios" ? "spinner" : "calendar"}
          onValueChange={handlePickerChange}
          onDismiss={handleDismiss}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldWrap: { marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.fieldBg,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
  },
  inputDisabled: { opacity: 0.6 },
  partInputDay: {
    width: 32,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.navy,
    textAlign: "center",
  },
  partInputYear: {
    width: 52,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.navy,
    textAlign: "center",
  },
  separator: { color: colors.muted, fontSize: 16 },
  calendarButton: { marginLeft: "auto", padding: 8 },
  calendarButtonText: { fontSize: 18 },
  placeholderHint: { fontSize: 11, color: colors.muted, marginTop: 4 },
});
