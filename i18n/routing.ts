// next-intl routing configuration
// Defines supported locales and default locale
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // Supported locales
  locales: ["en", "hi"],
  // Default locale — English
  defaultLocale: "en",
  // Use "as-needed" so English URLs don't have /en/ prefix
  // e.g., "/" for English, "/hi" for Hindi
  localePrefix: "as-needed",
});
