// Dynamically rendered app icon — Next serves PNG bytes at /icon by
// running ImageResponse on this file. Avoids having to ship binary
// PNG assets in the repo. Manifest declares 192×192 + 512×512; the OS
// scales whichever it needs.
//
// Design: rounded navy square + bold white "MK" centred. Matches the
// brand colour used elsewhere (PDF letterhead bar, status pills).

import { ImageResponse } from "next/og";

// Tells Next to bake this at build time rather than per-request.
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
          background: "#1E3A8A",
          color: "#FFFFFF",
          // 22% radius matches Android's "squircle" mask closely so
          // the icon looks tidy whether the launcher applies a mask
          // or shows the raw asset.
          borderRadius: 116,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 224,
          fontWeight: 800,
          letterSpacing: -8,
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        MK
      </div>
    ),
    { ...size },
  );
}
