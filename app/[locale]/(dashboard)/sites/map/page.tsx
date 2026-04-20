// Sites Map page — full-screen Google Maps with coloured markers per status.
// If NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set, shows a setup prompt.
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { LayoutList, Calendar, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { SiteMap } from "@/components/sites/SiteMap";

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function SiteMapPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

  const supabase = await createClient();
  const { data: sites } = await supabase
    .from("sites")
    .select("id, site_code, name, media_type, status, city, latitude, longitude, base_rate_paise")
    .is("deleted_at", null)
    .order("city")
    .limit(500);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background shrink-0">
        <div>
          <h1 className="font-bold text-foreground">Sites Map</h1>
          <p className="text-xs text-muted-foreground">{sites?.length ?? 0} total sites</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sites">
            <Button variant="outline" size="sm" className="gap-1.5">
              <LayoutList className="h-4 w-4" />
              <span className="hidden sm:inline">List</span>
            </Button>
          </Link>
          <Link href="/sites/calendar">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Calendar className="h-4 w-4" />
              <span className="hidden sm:inline">Calendar</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* No API key */}
      {!apiKey ? (
        <div className="flex-1 flex items-center justify-center bg-muted">
          <div className="text-center px-8 max-w-md">
            <MapPin className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-foreground">
              Google Maps not configured
            </h2>
            <p className="text-sm text-muted-foreground mt-2 mb-4">
              Add{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
              </code>{" "}
              to your <code className="font-mono text-xs">.env.local</code> file to enable
              the map view.
            </p>
            <p className="text-xs text-muted-foreground">
              You can still manage sites from the{" "}
              <Link href="/sites" className="text-blue-500 hover:underline">
                list view
              </Link>
              .
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <SiteMap sites={sites ?? []} apiKey={apiKey} />
        </div>
      )}
    </div>
  );
}
