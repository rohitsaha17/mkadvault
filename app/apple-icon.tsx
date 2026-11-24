// Apple touch icon — iOS Safari uses this when the user picks
// Share → "Add to Home Screen". 180×180 canonical size. iOS applies its own
// rounded corners, so the lime fills the whole square.

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
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#B5F745",
          color: "#0E1407",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: 82,
          fontWeight: 800,
          letterSpacing: -4,
        }}
      >
        MK
      </div>
    ),
    { ...size },
  );
}
