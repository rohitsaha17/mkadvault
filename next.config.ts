import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

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

  // pdfkit ships .afm font metric files alongside its JS modules and
  // loads them from disk at runtime via fs.readFileSync. If webpack
  // bundles pdfkit those .afm files don't make it into the chunk and
  // PDF generation crashes with ENOENT. Marking pdfkit external means
  // the route handler `require`s it from node_modules at runtime where
  // the data files exist.
  serverExternalPackages: ["pdfkit"],

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

  // pptxgenjs imports node:fs / node:https / node:http even though it
  // never executes them in the browser path. Webpack's default resolver
  // doesn't handle the `node:` scheme on the client and throws
  // UnhandledSchemeError, breaking dev compile of every page that
  // pulls in ProposalWizard.
  //
  // resolve.fallback covers bare specifiers ("fs"); for the
  // node:-prefixed forms we register a NormalModuleReplacementPlugin
  // that rewrites them to an empty stub. Both pieces are needed —
  // some packages mix bare and node:-prefixed imports.
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        https: false,
        http: false,
        path: false,
        crypto: false,
        stream: false,
        zlib: false,
        os: false,
      };
      config.plugins = config.plugins ?? [];
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^node:(fs|https|http|path|crypto|stream|zlib|os)$/,
          path.resolve(process.cwd(), "lib/empty-module.js"),
        ),
      );
    }
    return config;
  },
};

export default withNextIntl(nextConfig);
