// Matches what form_templates actually has rows for on the backend --
// shared by ShiftSettingsScreen (factory profile) and
// StatutoryFormsScreen (the Forms & Reports state selector) so they can
// never drift out of sync. Adding a new state later is a backend data
// change plus one more entry here, not a UI redesign.
export const INDIAN_STATE_OPTIONS = [
  { label: "Tamil Nadu", value: "Tamil Nadu" },
  { label: "Karnataka", value: "Karnataka" },
];
