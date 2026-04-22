// Canonical list of Indian states + Union Territories.
// Used by every form that collects a state name so we don't end up with
// "MH", "Maharashtra", "maharashtra", "Mah" all in the database.
//
// Source: Ministry of Home Affairs — 28 states + 8 UTs (as of 2020 reorg).
// Order: states first (alphabetical), then UTs (alphabetical), then "Other"
// as an escape hatch for edge cases / foreign addresses.

export const INDIAN_STATES = [
  // States (28)
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export const INDIAN_UNION_TERRITORIES = [
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

// Combined list used by dropdowns. "Other" at the end lets users pick
// something outside this list if needed (e.g. an address abroad).
export const INDIAN_STATES_AND_UTS: readonly string[] = [
  ...INDIAN_STATES,
  ...INDIAN_UNION_TERRITORIES,
  "Other",
];
