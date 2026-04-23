"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { updateCampaignStatus } from "@/app/[locale]/(dashboard)/campaigns/actions";
import { fmt, inr } from "@/lib/utils";
import type { Campaign, CampaignStatus } from "@/lib/types/database";

// Supabase renders to-one relations as either an object or a one-element
// array depending on inference. Accept both shapes and normalise inside
// the component. Campaigns billed to an agency populate `agency`
// instead of `client`; we display whichever is present.
type Rel<T> = T | T[] | null | undefined;

interface CampaignWithBillingParty extends Campaign {
  client?: Rel<{ id?: string; company_name: string }>;
  agency?: Rel<{ id?: string; agency_name: string }>;
}

function one<T>(rel: Rel<T>): T | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel;
}

interface Props {
  campaigns: CampaignWithBillingParty[];
}

// Only show 5 key workflow columns in Kanban (operational sub-statuses managed in detail page)
const COLUMNS: { status: CampaignStatus; label: string; color: string }[] = [
  { status: "enquiry", label: "Enquiry", color: "border-border" },
  { status: "proposal_sent", label: "Proposal Sent", color: "border-blue-300" },
  { status: "confirmed", label: "Confirmed", color: "border-indigo-300" },
  { status: "live", label: "Live", color: "border-green-300" },
  { status: "completed", label: "Completed", color: "border-teal-300" },
];

const COLUMN_BG: Record<string, string> = {
  enquiry: "bg-muted",
  proposal_sent: "bg-blue-50",
  confirmed: "bg-indigo-50",
  live: "bg-green-50",
  completed: "bg-teal-50",
};

const CARD_STATUS_BADGE: Record<string, string> = {
  enquiry: "bg-muted text-muted-foreground",
  proposal_sent: "bg-blue-100 text-blue-700",
  confirmed: "bg-indigo-100 text-indigo-700",
  creative_received: "bg-purple-100 text-purple-700",
  printing: "bg-amber-100 text-amber-700",
  mounted: "bg-orange-100 text-orange-700",
  live: "bg-green-100 text-green-700",
  completed: "bg-teal-100 text-teal-700",
  dismounted: "bg-muted text-muted-foreground",
  cancelled: "bg-rose-100 text-rose-700",
};

export function KanbanBoard({ campaigns }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<CampaignStatus | null>(null);

  // Group campaigns — cards for statuses not in columns go into their "nearest" kanban column
  // enquiry, proposal_sent, confirmed go as-is; creative_received/printing/mounted → confirmed; live; completed/dismounted → completed
  function columnFor(status: CampaignStatus): CampaignStatus {
    if (["creative_received", "printing", "mounted"].includes(status)) return "confirmed";
    if (status === "dismounted" || status === "cancelled") return "completed";
    return status;
  }

  const grouped: Record<CampaignStatus, CampaignWithBillingParty[]> = {
    enquiry: [],
    proposal_sent: [],
    confirmed: [],
    creative_received: [],
    printing: [],
    mounted: [],
    live: [],
    completed: [],
    dismounted: [],
    cancelled: [],
  };

  for (const c of campaigns) {
    const col = columnFor(c.status);
    grouped[col].push(c);
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }

  function handleDragOver(e: React.DragEvent, status: CampaignStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverColumn(status);
  }

  function handleDrop(e: React.DragEvent, newStatus: CampaignStatus) {
    e.preventDefault();
    setOverColumn(null);
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;

    const campaign = campaigns.find((c) => c.id === id);
    if (!campaign) return;

    // Don't update if dropped in same column
    if (columnFor(campaign.status) === newStatus) { setDraggingId(null); return; }

    startTransition(async () => {
      const result = await updateCampaignStatus(id, newStatus);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Moved to ${COLUMNS.find((c) => c.status === newStatus)?.label}`);
        router.refresh();
      }
      setDraggingId(null);
    });
  }

  function handleDragEnd() {
    setDraggingId(null);
    setOverColumn(null);
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-96">
      {COLUMNS.map((col) => {
        const cards = grouped[col.status];
        const isOver = overColumn === col.status;
        return (
          <div
            key={col.status}
            className={`flex-shrink-0 w-64 rounded-lg border-2 transition-colors ${col.color} ${isOver ? "bg-blue-50 border-blue-400" : COLUMN_BG[col.status] ?? "bg-muted"}`}
            onDragOver={(e) => handleDragOver(e, col.status)}
            onDrop={(e) => handleDrop(e, col.status)}
            onDragLeave={() => setOverColumn(null)}
          >
            {/* Column header */}
            <div className="p-3 border-b border-current/10">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{col.label}</h3>
                <span className="text-xs bg-white/60 text-muted-foreground rounded-full px-2 py-0.5 font-medium">
                  {cards.length}
                </span>
              </div>
            </div>

            {/* Cards */}
            <div className="p-2 space-y-2 min-h-24">
              {cards.map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, c.id)}
                  onDragEnd={handleDragEnd}
                  className={`bg-white rounded-lg border shadow-sm p-3 cursor-grab active:cursor-grabbing transition-opacity space-y-1.5 ${draggingId === c.id ? "opacity-50" : "opacity-100"}`}
                >
                  <Link href={`/campaigns/${c.id}`} className="block" onClick={(e) => e.stopPropagation()}>
                    <p className="text-sm font-medium text-foreground hover:text-blue-600 line-clamp-2">
                      {c.campaign_name}
                    </p>
                  </Link>
                  {(() => {
                    const agency = one(c.agency);
                    const client = one(c.client);
                    const preferAgency =
                      c.billing_party_type === "agency" ||
                      c.billing_party_type === "client_on_behalf_of_agency";
                    const label =
                      (preferAgency && agency?.agency_name) ||
                      client?.company_name ||
                      agency?.agency_name ||
                      null;
                    if (!label) return null;
                    return (
                      <p className="text-xs text-muted-foreground truncate">
                        {label}
                      </p>
                    );
                  })()}
                  {c.campaign_code && (
                    <p className="text-xs font-mono text-muted-foreground">{c.campaign_code}</p>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    {c.start_date ? (
                      <span className="text-xs text-muted-foreground">
                        {fmt(c.start_date)}
                        {c.end_date && ` → ${fmt(c.end_date)}`}
                      </span>
                    ) : <span />}
                    {/* Show actual status if different from column status */}
                    {columnFor(c.status) !== c.status && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${CARD_STATUS_BADGE[c.status] ?? ""}`}>
                        {c.status.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  {c.total_value_paise && (
                    <p className="text-xs font-semibold text-foreground">{inr(c.total_value_paise)}</p>
                  )}
                </div>
              ))}
              {cards.length === 0 && (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  Drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
