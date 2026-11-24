// IconTile — one of the 3D icons on a small dark tile.
//
// The artwork is drawn on black, so the tile stays dark in both themes and
// `mix-blend-screen` drops the black away. `isolate` keeps that blend inside
// the tile so it can't react with whatever card it sits on.
import Image, { type StaticImageData } from "next/image";
import bell from "@/assets/dashboard/icon-bell.webp";
import calendar from "@/assets/dashboard/icon-calendar.webp";
import coins from "@/assets/dashboard/icon-coins.webp";
import growth from "@/assets/dashboard/icon-growth.webp";
import hoarding from "@/assets/dashboard/icon-hoarding.webp";
import megaphone from "@/assets/dashboard/icon-megaphone.webp";
import pin from "@/assets/dashboard/icon-pin.webp";
import receipt from "@/assets/dashboard/icon-receipt.webp";
import { cn } from "@/lib/utils";

const ICONS = {
  bell,
  calendar,
  coins,
  growth,
  hoarding,
  megaphone,
  pin,
  receipt,
} satisfies Record<string, StaticImageData>;

export type IconName = keyof typeof ICONS;

export function IconTile({
  name,
  size = 52,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const art = Math.round(size * 0.8);
  return (
    <span
      aria-hidden
      className={cn(
        "relative isolate inline-flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#0b0f0a] ring-1 ring-inset ring-white/10",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_115%,rgb(181_247_69/0.34),transparent_62%)]" />
      <Image
        src={ICONS[name]}
        alt=""
        width={art}
        height={art}
        className="relative mix-blend-screen"
      />
    </span>
  );
}
