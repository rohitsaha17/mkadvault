// Apple touch icon — iOS Safari uses this when the user picks
// Share → "Add to Home Screen". 180×180 is the canonical size iOS
// looks for. No transparency / rounding — iOS applies its own rounded
// corners on top, so a solid square with safe-area margins works best.

import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const contentType = "image/png";
export const size = { width: 180, height: 180 };

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#1E3A8A",
          color: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 80,
          fontWeight: 800,
          letterSpacing: -3,
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
