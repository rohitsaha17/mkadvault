// HeroBanner — the top of the dashboard: a street at night with one lit
// hoarding. Dark in both themes, so the `dark` class scopes the dark tokens
// to everything inside it.
//
// The frame, artwork and heading paint immediately. `board` and `stats` are
// slots so the page can stream them in behind their own Suspense boundaries.
import Image from "next/image";
import trails from "@/assets/dashboard/light-trails.webp";
import { HoardingBoard } from "./HoardingBoard";

export function HeroBanner({
  eyebrow,
  title,
  description,
  filters,
  board,
  stats,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  filters?: React.ReactNode;
  board?: React.ReactNode;
  stats?: React.ReactNode;
}) {
  return (
    <section className="dark hero-surface relative isolate overflow-hidden rounded-[28px] text-foreground">
      <Image
        src={trails}
        alt=""
        fill
        loading="eager"
        sizes="(min-width: 64rem) 1100px, 100vw"
        className="-z-10 object-cover object-left-bottom opacity-45 mix-blend-screen [mask-image:linear-gradient(to_top,black_10%,transparent_72%)]"
      />
      <HoardingBoard>{board}</HoardingBoard>

      {/* Below lg the hoarding stands above the text, so leave room for it. */}
      <div className="relative flex flex-col gap-6 p-5 pt-[212px] sm:p-7 sm:pt-[236px] lg:min-h-[530px] lg:justify-between lg:p-8 xl:min-h-[440px]">
        <div className="max-w-[26rem] space-y-3 lg:max-w-[22rem] xl:max-w-[34rem]">
          <p className="text-[13px] font-medium text-volt">{eyebrow}</p>
          <h2 className="text-balance text-[40px] font-semibold leading-[0.98] sm:text-5xl xl:text-[60px]">
            {title}
          </h2>
          {description && (
            <p className="max-w-md text-sm leading-relaxed text-white/65">
              {description}
            </p>
          )}
          {filters && <div className="pt-2">{filters}</div>}
        </div>
        {stats}
      </div>
    </section>
  );
}
