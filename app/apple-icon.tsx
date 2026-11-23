// Apple touch icon — iOS Safari uses this when the user picks
// Share → "Add to Home Screen". 180×180 canonical size. iOS applies
// its own rounded corners on top, but we keep ours so the mark looks
// identical whether iOS clips it or not.

import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const contentType = "image/png";
export const size = { width: 180, height: 180 };

export default function AppleIcon() {
  const dot = 11;
  const gap = 7;
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
          background:
            "linear-gradient(135deg,#312E81 0%,#4F46E5 45%,#1E293B 100%)",
          color: "#FFFFFF",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(120% 60% at 20% 0%, rgba(255,255,255,0.22), transparent 60%)",
          }}
        />
        <div
          style={{
            display: "flex",
            fontSize: 82,
            fontWeight: 800,
            letterSpacing: -4,
            transform: "translateY(-10px)",
          }}
        >
          MK
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 26,
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
