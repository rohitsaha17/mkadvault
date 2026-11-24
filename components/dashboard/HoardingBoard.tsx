// HoardingBoard — the lit hoarding in the hero, with real text on its panel.
// See .hoarding-stage / .hoarding-panel in globals.css for how the text is
// locked to the panel in perspective.
import Image from "next/image";
import hoarding from "@/assets/dashboard/hero-hoarding.webp";

export function HoardingBoard({ children }: { children?: React.ReactNode }) {
  return (
    <div className="hoarding-stage">
      <Image
        src={hoarding}
        alt=""
        preload
        // Shown at 360–660px wide; the stage is laid out at 1536 and scaled.
        sizes="(min-width: 80rem) 660px, (min-width: 64rem) 490px, 420px"
        className="size-full"
      />
      <div className="hoarding-panel">{children}</div>
    </div>
  );
}
