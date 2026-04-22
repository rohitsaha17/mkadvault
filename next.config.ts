import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl plugin — connects the i18n/request.ts config to Next.js
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Trim large client bundles by tree-shaking icon / util barrel imports.
  // Without this, a single `lucide-react` import pulls in ~1k icon modules.
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      "recharts",
      "@react-pdf/renderer",
    ],
  },

  // Image optimisation — allow Supabase Storage buckets through the
  // Next.js image optimiser (smaller payloads, automatic webp/avif).
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ckyzwkwuasawizrffqvc.supabase.co",
        // Covers both public object URLs and signed URLs (/object/sign/...)
        // since our buckets are private and we use createSignedUrls().
        pathname: "/storage/v1/object/**",
      },
    ],
    formats: ["image/avif", "image/webp"],
  },

  // Gzip in production
  compress: true,

  // Drop the "Powered by Next.js" header (tiny perf + security)
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
