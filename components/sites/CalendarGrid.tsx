// CalendarGrid — renders a Gantt-style availability grid.
// Rows = sites, Columns = days of the selected month.
// Status colour fills each day cell. Bookings (from campaigns) will overlay
// coloured bars in Sprint 4 once campaign_sites data is available.

interface Booking {
  siteId: string;
  startDate: string; // ISO "YYYY-MM-DD"
  endDate: string;   // ISO "YYYY-MM-DD"
  label?: string;
}

interface SiteRow {
  id: string;
  site_code: string;
  name: string;
  status: string;
  city?: string | null;
}

interface Props {
  sites: SiteRow[];
  year: number;
  month: number; // 1-based
  bookings: Booking[];
}

// Colour for each status (Tailwind bg classes)
const STATUS_BG: Record<string, string> = {
  available: "bg-emerald-100",
  booked: "bg-blue-100",
  maintenance: "bg-amber-100",
  blocked: "bg-muted",
  expired: "bg-red-100",
};

const STATUS_BOOKING_BAR: Record<string, string> = {
  booked: "bg-blue-400",
  maintenance: "bg-amber-400",
  blocked: "bg-muted-foreground",
};

export function CalendarGrid({ sites, year, month, bookings }: Props) {
  // Build array of day numbers for the month
  const daysInMonth = new Date(year, month, 0).getDate(); // last day = days count
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const today = new Date();
  const todayDay =
    today.getFullYear() === year && today.getMonth() + 1 === month
      ? today.getDate()
      : null;

  // Day-of-week header labels (1 = Mon, 7 = Sun)
  const dayLabels = days.map((d) => {
    const date = new Date(year, month - 1, d);
    return date.toLocaleString("en-IN", { weekday: "narrow" });
  });

  // Check if a specific site/day falls within a booking
  function getBookingForDay(siteId: string, day: number): Booking | undefined {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return bookings.find(
      (b) => b.siteId === siteId && b.startDate <= date && b.endDate >= date
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr className="bg-muted">
            {/* Site name column */}
            <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-r border-border min-w-[180px]">
              Site
            </th>
            {/* Day columns */}
            {days.map((d, i) => (
              <th
                key={d}
                className={`px-0 py-1.5 text-center font-medium border-b border-border w-8 ${
                  todayDay === d
                    ? "text-blue-600"
                    : "text-muted-foreground"
                }`}
              >
                <div>{d}</div>
                <div className="text-muted-foreground font-normal">{dayLabels[i]}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sites.map((site) => (
            <tr key={site.id} className="hover:bg-muted/50">
              {/* Site name */}
              <td className="sticky left-0 z-10 bg-white hover:bg-muted/50 px-3 py-2 border-r border-border whitespace-nowrap">
                <div className="font-medium text-foreground">{site.name}</div>
                <div className="text-muted-foreground font-mono">{site.site_code}</div>
              </td>

              {/* Day cells */}
              {days.map((d) => {
                const booking = getBookingForDay(site.id, d);
                const isToday = todayDay === d;
                const bgClass = booking
                  ? (STATUS_BOOKING_BAR[booking.label ?? "booked"] ?? "bg-blue-400")
                  : (STATUS_BG[site.status] ?? "bg-muted");

                return (
                  <td
                    key={d}
                    title={booking?.label ?? site.status}
                    className={`px-0 py-0 h-9 border-r border-border ${bgClass} ${
                      isToday ? "ring-1 ring-inset ring-blue-400" : ""
                    }`}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
