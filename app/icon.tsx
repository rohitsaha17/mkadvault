// Dynamically rendered app icon — Next serves PNG bytes at /icon by
// running ImageResponse on this file. Same lime tile and ink "MK" as the
// on-screen <BrandMark>, so the browser tab matches the sidebar logo.

import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const contentType = "image/png";
// 512 is big enough that Android's launcher won't have to upscale on
// any device while still being cheap to render. The browser will
// downscale for the 192 size declared in the manifest.
export const size = { width: 512, height: 512 };

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#B5F745",
          borderRadius: 116,
          color: "#0E1407",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: 228,
          fontWeight: 800,
          letterSpacing: -10,
        }}
      >
        MK
      </div>
    ),
    { ...size },
  );
}
