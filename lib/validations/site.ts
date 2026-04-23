// Zod validation schema for the site add/edit form.
// Used on both client (react-hook-form resolver) and server (server actions).
//
// IMPORTANT: Keep types simple (no z.transform) so react-hook-form's zodResolver
// doesn't have input/output type mismatches. Coercion happens in server actions.
import { z } from "zod";

// Helper: an optional number input where an empty HTML number field
// (which react-hook-form's valueAsNumber parses as NaN) is treated as
// "not provided" rather than a validation error. Without this, zod v4
// rejects NaN as "not a finite number" and the form silently blocks
// the user from advancing — even though the DB column is nullable.
const optionalNumber = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v === "number" && Number.isNaN(v)) return undefined;
    return v;
  },
  z.number().optional(),
);

const optionalPositiveNumber = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v === "number" && Number.isNaN(v)) return undefined;
    return v;
  },
  z.number().positive("Must be positive").optional(),
);

export const siteSchema = z.object({
  // ── Step 1: Basic Info ─────────────────────────────────────────────────
  name: z.string().min(1, "Site name is required"),
  // Site code is optional — if blank the server action auto-generates one
  // from the city prefix + short random suffix (e.g. "MUM-4F2A").
  site_code: z.string().max(50).optional(),
  media_type: z.enum([
    "billboard", "hoarding", "dooh", "kiosk",
    "wall_wrap", "unipole", "bus_shelter", "custom",
  ]),
  structure_type: z.enum(["permanent", "temporary", "digital"]),
  status: z.enum(["available", "booked", "maintenance", "blocked", "expired"]),

  // ── Step 2: Location ───────────────────────────────────────────────────
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  // Optional string fields — empty string is treated as null in the server action
  pincode: z.string().optional(),
  landmark: z.string().optional(),
  // Lat/lng: fully optional. Empty inputs (which valueAsNumber turns
  // into NaN) are coerced to undefined via the optionalNumber helper so
  // the user can save a site without touching the map / coordinates.
  latitude: optionalNumber,
  longitude: optionalNumber,

  // ── Step 3: Specifications ─────────────────────────────────────────────
  // Width, height, illumination, traffic_side are mandatory per spec — every
  // physical site must declare these. Facing + visibility distance remain
  // optional because older stock sometimes lacks this data.
  width_ft: z.number({ message: "Width is required" }).positive("Must be positive"),
  height_ft: z.number({ message: "Height is required" }).positive("Must be positive"),
  illumination: z.enum(["frontlit", "backlit", "digital", "nonlit"], {
    message: "Select an illumination type",
  }),
  facing: z.enum(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]).optional(),
  traffic_side: z.enum(["lhs", "rhs", "both"], {
    message: "Select a traffic side",
  }),
  visibility_distance_m: optionalPositiveNumber,
  // Extra dimensions the user adds — e.g. {label:"Depth", value:"3 ft"}.
  // Stored as JSONB on the sites table. Each entry must have a non-empty
  // label and value (we drop empty rows on submit rather than erroring).
  custom_dimensions: z
    .array(
      z.object({
        label: z.string().min(1, "Dimension name is required"),
        value: z.string().min(1, "Dimension value is required"),
      })
    )
    .optional(),

  // ── Step 4: Commercial ─────────────────────────────────────────────────
  ownership_model: z.enum(["owned", "rented"]),
  // Direct landowner link — only meaningful when ownership_model = "owned".
  // Empty string from the select is coerced to undefined by the form.
  landowner_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || undefined),
  // Form collects rate in INR; server action converts to paise (× 100).
  base_rate_inr: optionalPositiveNumber,
  municipal_permission_number: z.string().optional(),
  municipal_permission_expiry: z.string().optional(), // ISO date "YYYY-MM-DD"

  // ── Step 6: Notes ──────────────────────────────────────────────────────
  notes: z.string().optional(),
});

export type SiteFormValues = z.infer<typeof siteSchema>;

// Default values for a blank new-site form.
// Width/height/illumination/traffic_side are declared required in the schema
// but intentionally left undefined here so the user is forced to pick — zod
// surfaces the validation error on submit if they skip them.
export const siteFormDefaults: Partial<SiteFormValues> = {
  name: "",
  site_code: "",
  media_type: "billboard",
  structure_type: "permanent",
  status: "available",
  address: "",
  city: "",
  state: "",
  ownership_model: "owned",
  landowner_id: undefined,
  custom_dimensions: [],
};
