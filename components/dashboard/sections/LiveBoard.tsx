// LiveBoard — what's printed on the hero hoarding: how many campaigns are up
// right now. Always "today", whatever date range the dashboard is showing.
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";

export async function LiveBoard({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const t = await getTranslations("dashboard");

  const { count } = await supabase
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", "live")
    .is("deleted_at", null);

  // If the count couldn't be read, leave the panel blank rather than
  // announcing zero.
  if (count === null) return null;

  return (
    <div className="board-on flex h-full flex-col justify-center pl-14 text-ink">
      {count === 0 ? (
        <p className="font-heading text-[104px] font-bold leading-[0.95] tracking-[-0.03em]">
          {t("board_empty")}
        </p>
      ) : (
        <>
          <p className="font-heading text-[236px] font-bold leading-[0.76] tracking-[-0.05em]">
            {count}
          </p>
          <p className="mt-10 font-heading text-[68px] font-semibold leading-none tracking-[-0.02em]">
            {t("board_live", { count })}
          </p>
        </>
      )}
    </div>
  );
}
