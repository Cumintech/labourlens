// Matches what form_templates actually has rows for on the backend --
// shared by ShiftSettingsScreen (factory profile) and
// StatutoryFormsScreen (the Forms & Reports state selector) so they can
// never drift out of sync. Adding a new state later is a backend data
// change plus one more entry here, not a UI redesign.
export const INDIAN_STATE_OPTIONS = [
  { label: "Tamil Nadu", value: "Tamil Nadu" },
  { label: "Karnataka", value: "Karnataka" },
];

// Every state/UT, for "home state" pickers (worker employment
// classification) where a migrant worker's origin can be anywhere in
// India -- unlike INDIAN_STATE_OPTIONS above, which is deliberately
// limited to states form_templates has statutory forms for.
export const ALL_INDIAN_STATE_OPTIONS = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
  "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
].map((name) => ({ label: name, value: name }));
