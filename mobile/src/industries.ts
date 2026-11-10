// Drives HomeScreen's background pattern (item 19) -- each value here
// must have a matching pattern in homeBackground.tsx's INDUSTRY_PATTERNS
// map, which falls back to a generic pattern for anything else
// (including a factory that hasn't set one yet).
// "rice_mill" and "brick_tiles" also set the factory's scheduled minimum-wage employment (and create its worker types).
export const INDUSTRY_OPTIONS = [
  { label: "Rice, Flour & Dhall Mills", value: "rice_mill" },
  { label: "Brick & Tile Manufacturing", value: "brick_tiles" },
  { label: "Textiles & Garments", value: "textiles" },
  { label: "Steel & Metal Fabrication", value: "metal" },
  { label: "Food Processing", value: "food" },
  { label: "Chemicals & Pharmaceuticals", value: "chemicals" },
  { label: "Automotive & Auto Components", value: "automotive" },
  { label: "Electronics & Electricals", value: "electronics" },
  { label: "Plastics & Rubber", value: "plastics" },
  { label: "Other / General Manufacturing", value: "general" },
];
