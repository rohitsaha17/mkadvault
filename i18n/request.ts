// next-intl request configuration — loads messages for the current locale
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  // Get the locale from the request, fall back to default
  let locale = await requestLocale;

  // Ensure locale is valid, fall back to default if not
  if (!locale || !routing.locales.includes(locale as "en" | "hi")) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
