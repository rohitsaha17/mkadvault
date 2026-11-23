// Dynamically rendered app icon — Next serves PNG bytes at /icon by
// running ImageResponse on this file. Keeps the mark in sync with
// <BrandMark> (the on-screen version): same gradient, same "MK"
// letterform, same amber LED-dot row at the bottom.

import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const contentType = "image/png";
// 512 is big enough that Android's launcher won't have to upscale on
// any device while still being cheap to render. The browser will
// downscale for the 192 size declared in the manifest.
export const size = { width: 512, height: 512 };

export default function Icon() {
  const dot = 32;
  const gap = 20;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Matches the on-screen BrandMark gradient so the PWA icon
          // and the sidebar logo are visually identical.
          background:
            "linear-gradient(135deg,#312E81 0%,#4F46E5 45%,#1E293B 100%)",
          borderRadius: 116,
          color: "#FFFFFF",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        {/* Soft highlight */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 116,
            background:
              "radial-gradient(120% 60% at 20% 0%, rgba(255,255,255,0.22), transparent 60%)",
          }}
        />
        {/* MK letterform */}
        <div
          style={{
            display: "flex",
            fontSize: 224,
            fontWeight: 800,
            letterSpacing: -10,
            transform: "translateY(-28px)",
          }}
        >
          MK
        </div>
        {/* LED-dot row */}
        <div
          style={{
            position: "absolute",
            bottom: 72,
            left: 0,
            right: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap,
          }}
        >
          <div style={{ width: dot, height: dot, borderRadius: dot, background: "#FCD34D" }} />
          <div style={{ width: dot, height: dot, borderRadius: dot, background: "rgba(255,255,255,0.85)" }} />
          <div style={{ width: dot, height: dot, borderRadius: dot, background: "#FCD34D" }} />
        </div>
      </div>
    ),
    { ...size },
  );
}
