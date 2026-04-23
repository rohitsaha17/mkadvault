"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Search, ChevronUp, ChevronDown, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn, inr } from "@/lib/utils";
import { createProposal, updateProposal, saveOrgProposalTermsTemplate } from "@/app/[locale]/(dashboard)/proposals/actions";
import { sanitizeForTransport } from "@/lib/utils/sanitize";
import { ProposalExportButtons } from "./ProposalExportButtons";
import { ImportFromFileDialog } from "./ImportFromFileDialog";
import type { Proposal, ProposalSite, Client, Organization } from "@/lib/types/database";
import type { SiteForProposal } from "@/app/[locale]/(dashboard)/proposals/new/page";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SelectedSiteRow {
  site_id: string;
  custom_rate_paise: number | null;
  custom_notes: string;
  display_order: number;
}

interface ProposalConfig {
  proposal_name: string;
  client_id: string;
  template_type: "grid" | "list" | "one_per_page" | "compact";
  show_rates: "exact" | "range" | "request_quote" | "hidden";
  show_photos: boolean;
  show_map: boolean;
  show_dimensions: boolean;
  show_illumination: boolean;
  show_traffic_info: boolean;
  show_availability: boolean;
  include_company_branding: boolean;
  include_terms: boolean;
  terms_text: string;
  include_contact_details: boolean;
  custom_header_text: string;
  custom_footer_text: string;
  notes: string;
}

interface Props {
  sites: SiteForProposal[];
  clients: Pick<Client, "id" | "company_name">[];
  org: (Pick<Organization, "name" | "address" | "city" | "state" | "pin_code" | "gstin" | "phone" | "email"> & { logo_url?: string | null }) | null;
  // Signed URL (1-hour TTL) for the org logo, if one's uploaded. The
  // wizard passes this to the PPTX export button which embeds the
  // bytes into the generated deck. Null if no logo yet.
  orgLogoUrl?: string | null;
  // Org-wide T&C template (from organizations.proposal_terms_template).
  // When a fresh proposal is opened with no existing terms, we pre-fill
  // from this. Null/empty means the org hasn't set a default yet.
  orgTermsTemplate?: string | null;
  preselectedSiteIds?: string[];
  isRateCard?: boolean;
  existingProposal?: Proposal;
  existingSites?: ProposalSite[];
  editProposalId?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STEP_LABELS = ["Select Sites", "Configure Display", "Preview & Export"];

// ─── Toggle Switch ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer py-2">
      <span className="text-sm">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground/30"
        )}
      >
        <span className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5",
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        )} />
      </button>
    </label>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ProposalWizard({
  sites,
  clients,
  org,
  orgLogoUrl = null,
  orgTermsTemplate = null,
  preselectedSiteIds = [],
  isRateCard = false,
  existingProposal,
  existingSites = [],
  editProposalId,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSavingTemplate, startSaveTemplate] = useTransition();
  const [step, setStep] = useState(1);

  // ── Config state ────────────────────────────────────────────────────────────
  // Defaults for T&C:
  //   • editing an existing proposal → use its saved terms_text / include_terms
  //   • brand-new proposal + org has a template → pre-fill from template and
  //     turn the toggle on, so users don't have to re-enable + re-type
  //   • brand-new proposal + no template → empty, toggle off
  const orgTemplateText = (orgTermsTemplate ?? "").trim();
  const hasOrgTemplate = orgTemplateText.length > 0;
  const defaultTermsText = existingProposal
    ? (existingProposal.terms_text ?? "")
    : orgTemplateText;
  const defaultIncludeTerms = existingProposal
    ? (existingProposal.include_terms ?? false)
    : hasOrgTemplate;

  const [config, setConfig] = useState<ProposalConfig>({
    proposal_name: existingProposal?.proposal_name ?? (isRateCard ? "Rate Card" : ""),
    client_id: existingProposal?.client_id ?? "",
    template_type: existingProposal?.template_type ?? "grid",
    show_rates: existingProposal?.show_rates ?? (isRateCard ? "exact" : "exact"),
    show_photos: existingProposal?.show_photos ?? true,
    show_map: existingProposal?.show_map ?? true,
    show_dimensions: existingProposal?.show_dimensions ?? true,
    show_illumination: existingProposal?.show_illumination ?? true,
    show_traffic_info: existingProposal?.show_traffic_info ?? true,
    show_availability: existingProposal?.show_availability ?? true,
    include_company_branding: existingProposal?.include_company_branding ?? true,
    include_terms: defaultIncludeTerms,
    terms_text: defaultTermsText,
    include_contact_details: existingProposal?.include_contact_details ?? true,
    custom_header_text: existingProposal?.custom_header_text ?? "",
    custom_footer_text: existingProposal?.custom_footer_text ?? "",
    notes: existingProposal?.notes ?? "",
  });

  // ── Save current terms as the organization default ──────────────────────────
  function handleSaveTermsAsDefault() {
    const text = config.terms_text.trim();
    if (!text) {
      toast.error("Enter some terms text first");
      return;
    }
    startSaveTemplate(async () => {
      const result = await saveOrgProposalTermsTemplate(text);
      if (result.error) toast.error(result.error);
      else toast.success("Saved as organization default");
    });
  }

  function handleResetTermsToOrgDefault() {
    setConfig((c) => ({ ...c, terms_text: orgTemplateText }));
  }

  // ── Selected sites state ─────────────────────────────────────────────────────
  const [selectedSites, setSelectedSites] = useState<SelectedSiteRow[]>(() => {
    if (existingSites.length > 0) {
      return existingSites.map((ps) => ({
        site_id: ps.site_id,
        custom_rate_paise: ps.custom_rate_paise,
        custom_notes: ps.custom_notes ?? "",
        display_order: ps.display_order,
      }));
    }
    if (preselectedSiteIds.length > 0) {
      return preselectedSiteIds.map((id, i) => ({
        site_id: id,
        custom_rate_paise: null,
        custom_notes: "",
        display_order: i,
      }));
    }
    return [];
  });

  // ── Site search/filter ───────────────────────────────────────────────────────
  const [siteSearch, setSiteSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCity, setFilterCity] = useState("");

  const selectedIds = new Set(selectedSites.map((s) => s.site_id));

  const filteredSites = sites.filter((s) => {
    if (filterStatus && s.status !== filterStatus) return false;
    if (filterCity && s.city !== filterCity) return false;
    if (siteSearch) {
      const q = siteSearch.toLowerCase();
      if (!s.name.toLowerCase().includes(q) && !s.site_code.toLowerCase().includes(q) && !s.city.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const cities = [...new Set(sites.map((s) => s.city))].sort();

  function toggleSite(siteId: string) {
    setSelectedSites((prev) => {
      if (prev.some((s) => s.site_id === siteId)) {
        return prev.filter((s) => s.site_id !== siteId).map((s, i) => ({ ...s, display_order: i }));
      }
      return [...prev, { site_id: siteId, custom_rate_paise: null, custom_notes: "", display_order: prev.length }];
    });
  }

  function updateSiteRate(siteId: string, rateInr: string) {
    const paise = rateInr ? Math.round(parseFloat(rateInr) * 100) : null;
    setSelectedSites((prev) => prev.map((s) => s.site_id === siteId ? { ...s, custom_rate_paise: paise } : s));
  }

  function updateSiteNotes(siteId: string, notes: string) {
    setSelectedSites((prev) => prev.map((s) => s.site_id === siteId ? { ...s, custom_notes: notes } : s));
  }

  function moveSite(index: number, direction: "up" | "down") {
    setSelectedSites((prev) => {
      const arr = [...prev];
      const swapIdx = direction === "up" ? index - 1 : index + 1;
      if (swapIdx < 0 || swapIdx >= arr.length) return prev;
      [arr[index], arr[swapIdx]] = [arr[swapIdx], arr[index]];
      return arr.map((s, i) => ({ ...s, display_order: i }));
    });
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  function handleSave(_status: "draft" | "sent" = "draft") {
    if (!config.proposal_name.trim()) { toast.error("Enter a proposal name"); return; }
    if (selectedSites.length === 0) { toast.error("Select at least one site"); return; }

    const values = {
      ...config,
      client_id: config.client_id || undefined,
      sites: selectedSites,
    };

    const clean = sanitizeForTransport(values);
    startTransition(async () => {
      try {
        const result = editProposalId
          ? await updateProposal(editProposalId, clean)
          : await createProposal(clean);

        if ("error" in result && result.error) { toast.error(result.error); return; }

        const newId = "id" in result ? result.id : editProposalId!;
        toast.success(editProposalId ? "Proposal updated" : "Proposal created");
        router.push(`/proposals/${newId}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  // Get site data for selected sites (for preview and export)
  const selectedSiteData = selectedSites
    .map((sel) => {
      const site = sites.find((s) => s.id === sel.site_id);
      if (!site) return null;
      return { ...site, base_rate_paise: sel.custom_rate_paise ?? site.base_rate_paise };
    })
    .filter((s): s is SiteForProposal => s !== null);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => i + 1 < step && setStep(i + 1)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                step === i + 1 ? "bg-primary text-primary-foreground" :
                i + 1 < step ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20" :
                "bg-muted text-muted-foreground"
              )}
            >
              {i + 1 < step ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}
              {label}
            </button>
            {i < STEP_LABELS.length - 1 && <div className="h-px w-8 bg-border" />}
          </div>
        ))}
      </div>

      {/* ── Step 1: Site Selection ─────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3">
            <div>
              <Label>Proposal Name *</Label>
              <Input
                value={config.proposal_name}
                onChange={(e) => setConfig((c) => ({ ...c, proposal_name: e.target.value }))}
                placeholder="e.g. Diwali Campaign 2026 — Client Name"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Client (optional)</Label>
              <select
                value={config.client_id}
                onChange={(e) => setConfig((c) => ({ ...c, client_id: e.target.value }))}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">No specific client</option>
                {clients.map((cl) => (
                  <option key={cl.id} value={cl.id}>{cl.company_name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Import-from-file row — lets a user upload another agency's
              deck, have the AI extract sites, review, and create them
              in-place. Newly-created site IDs are added to the selection;
              router.refresh hydrates the sites list on the server. */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border/80 bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">
              Have a PDF / PPTX rate card from another agency? Pull its sites in automatically.
            </div>
            <ImportFromFileDialog
              onDone={(newIds) => {
                if (newIds.length === 0) return;
                // Queue the new site IDs for the proposal — they'll show
                // in the reorder list after router.refresh lands the
                // freshly-created `sites` rows in the page's server data.
                setSelectedSites((prev) => {
                  const known = new Set(prev.map((s) => s.site_id));
                  const additions = newIds
                    .filter((id) => !known.has(id))
                    .map((id, i) => ({
                      site_id: id,
                      custom_rate_paise: null,
                      custom_notes: "",
                      display_order: prev.length + i,
                    }));
                  return [...prev, ...additions];
                });
                router.refresh();
              }}
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={siteSearch}
                onChange={(e) => setSiteSearch(e.target.value)}
                placeholder="Search sites…"
                className="pl-9"
              />
            </div>
            <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">All Cities</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">All Statuses</option>
              <option value="available">Available</option>
              <option value="booked">Booked</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>

          <p className="text-sm text-muted-foreground">
            {selectedIds.size} site{selectedIds.size !== 1 ? "s" : ""} selected · {filteredSites.length} shown
          </p>

          {/* Site grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto">
            {filteredSites.map((site) => {
              const isSelected = selectedIds.has(site.id);
              return (
                <div
                  key={site.id}
                  onClick={() => toggleSite(site.id)}
                  className={cn(
                    "border rounded-lg p-3 cursor-pointer transition-all",
                    isSelected ? "border-primary bg-primary/10" : "hover:border-primary/50 hover:bg-muted/30"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{site.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{site.site_code}</p>
                      <p className="text-xs text-muted-foreground">{site.city}, {site.state}</p>
                      <p className="text-xs text-muted-foreground capitalize">{site.media_type?.replace(/_/g, " ")}</p>
                      {site.base_rate_paise && (
                        <p className="text-xs font-medium mt-1">{inr(site.base_rate_paise)}/mo</p>
                      )}
                    </div>
                    <div className={cn(
                      "h-5 w-5 rounded border flex-shrink-0 flex items-center justify-center",
                      isSelected ? "bg-primary border-primary text-primary-foreground" : "border-input"
                    )}>
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selected sites reordering */}
          {selectedSites.length > 0 && (
            <div className="border rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b bg-muted/30 text-sm font-semibold">
                Selected Sites — Drag to Reorder
              </div>
              <div className="divide-y">
                {selectedSites.map((sel, i) => {
                  const site = sites.find((s) => s.id === sel.site_id);
                  if (!site) return null;
                  return (
                    <div key={sel.site_id} className="flex items-center gap-3 px-4 py-2">
                      <div className="flex flex-col gap-0.5">
                        <button type="button" onClick={() => moveSite(i, "up")} disabled={i === 0}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => moveSite(i, "down")} disabled={i === selectedSites.length - 1}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span className="text-xs text-muted-foreground w-5 text-center">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{site.name}</p>
                        <p className="text-xs text-muted-foreground">{site.city}</p>
                      </div>
                      <Input
                        type="number"
                        placeholder={site.base_rate_paise ? String(site.base_rate_paise / 100) : "Rate"}
                        value={sel.custom_rate_paise ? String(sel.custom_rate_paise / 100) : ""}
                        onChange={(e) => updateSiteRate(sel.site_id, e.target.value)}
                        className="w-28 text-xs h-8"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Input
                        placeholder="Notes"
                        value={sel.custom_notes}
                        onChange={(e) => updateSiteNotes(sel.site_id, e.target.value)}
                        className="w-40 text-xs h-8"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button type="button" onClick={() => toggleSite(sel.site_id)}
                        className="text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => {
                if (!config.proposal_name.trim()) { toast.error("Enter a proposal name first"); return; }
                if (selectedSites.length === 0) { toast.error("Select at least one site"); return; }
                setStep(2);
              }}
            >
              Next: Configure Display →
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Display Configuration ──────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Layout */}
            <div className="border rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-sm">Layout</h3>
              {(["grid", "list", "one_per_page", "compact"] as const).map((t) => (
                <label key={t} className="flex items-center gap-3 cursor-pointer">
                  <input type="radio" name="template" value={t}
                    checked={config.template_type === t}
                    onChange={() => setConfig((c) => ({ ...c, template_type: t }))}
                    className="accent-primary"
                  />
                  <div>
                    <span className="text-sm font-medium capitalize">{t.replace(/_/g, " ")}</span>
                    <p className="text-xs text-muted-foreground">
                      {t === "grid" ? "2 sites per row — balanced view" :
                       t === "list" ? "1 per row — detailed with all info" :
                       t === "one_per_page" ? "Full page per site — premium feel" :
                       "4 per row — compact overview"}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            {/* Rate Display */}
            <div className="border rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-sm">Rate Display</h3>
              {(["exact", "range", "request_quote", "hidden"] as const).map((r) => (
                <label key={r} className="flex items-center gap-3 cursor-pointer">
                  <input type="radio" name="rates" value={r}
                    checked={config.show_rates === r}
                    onChange={() => setConfig((c) => ({ ...c, show_rates: r }))}
                    className="accent-primary"
                  />
                  <div>
                    <span className="text-sm font-medium capitalize">{r.replace(/_/g, " ")}</span>
                    <p className="text-xs text-muted-foreground">
                      {r === "exact" ? "Show actual rate" :
                       r === "range" ? "Show ±20% range" :
                       r === "request_quote" ? "Show 'Request Quote' text" :
                       "Hide rates entirely"}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Content toggles */}
          <div className="border rounded-xl p-4">
            <h3 className="font-semibold text-sm mb-2">Content to Include</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 divide-y md:divide-y-0">
              <div className="divide-y">
                <Toggle checked={config.show_photos} onChange={(v) => setConfig((c) => ({ ...c, show_photos: v }))} label="Photos" />
                <Toggle checked={config.show_dimensions} onChange={(v) => setConfig((c) => ({ ...c, show_dimensions: v }))} label="Dimensions (W × H ft)" />
                <Toggle checked={config.show_illumination} onChange={(v) => setConfig((c) => ({ ...c, show_illumination: v }))} label="Illumination Type" />
                <Toggle checked={config.show_traffic_info} onChange={(v) => setConfig((c) => ({ ...c, show_traffic_info: v }))} label="Traffic Info (Facing, Visibility)" />
              </div>
              <div className="divide-y">
                <Toggle checked={config.show_availability} onChange={(v) => setConfig((c) => ({ ...c, show_availability: v }))} label="Availability Status" />
                <Toggle checked={config.include_company_branding} onChange={(v) => setConfig((c) => ({ ...c, include_company_branding: v }))} label="Company Branding" />
                <Toggle checked={config.include_contact_details} onChange={(v) => setConfig((c) => ({ ...c, include_contact_details: v }))} label="Contact Details" />
                <Toggle checked={config.include_terms} onChange={(v) => setConfig((c) => ({ ...c, include_terms: v }))} label="Terms & Conditions" />
              </div>
            </div>
          </div>

          {/* Custom text */}
          <div className="border rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-sm">Custom Text</h3>
            <div className="space-y-1">
              <Label className="text-xs">Header Text</Label>
              <Input value={config.custom_header_text} onChange={(e) => setConfig((c) => ({ ...c, custom_header_text: e.target.value }))} placeholder="e.g. Confidential — Prepared for Acme Corp" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Footer Text</Label>
              <Input value={config.custom_footer_text} onChange={(e) => setConfig((c) => ({ ...c, custom_footer_text: e.target.value }))} placeholder="e.g. Rates valid for 30 days from proposal date" />
            </div>
            {config.include_terms && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-xs">Terms & Conditions</Label>
                  <div className="flex items-center gap-2 text-xs">
                    {hasOrgTemplate && config.terms_text !== orgTemplateText && (
                      <button
                        type="button"
                        onClick={handleResetTermsToOrgDefault}
                        className="text-muted-foreground hover:text-foreground underline"
                      >
                        Reset to org default
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleSaveTermsAsDefault}
                      disabled={isSavingTemplate}
                      className="text-primary hover:underline disabled:opacity-60"
                    >
                      {isSavingTemplate ? "Saving…" : "Save as organization default"}
                    </button>
                  </div>
                </div>
                <textarea
                  value={config.terms_text}
                  onChange={(e) => setConfig((c) => ({ ...c, terms_text: e.target.value }))}
                  rows={6}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder={
                    hasOrgTemplate
                      ? "Edit the organization's default terms, or enter proposal-specific T&C…"
                      : "Enter terms and conditions text. Click ‘Save as organization default’ to reuse this on future proposals."
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  {hasOrgTemplate
                    ? "Pre-filled from your organization template. Edits here apply to this proposal only unless you save as the default."
                    : "No organization template yet. Save this text as the default and it will pre-fill future proposals and rate cards."}
                </p>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Internal Notes</Label>
              <Input value={config.notes} onChange={(e) => setConfig((c) => ({ ...c, notes: e.target.value }))} placeholder="For your reference only — not shown in proposal" />
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
            <Button onClick={() => setStep(3)}>Next: Preview & Export →</Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Preview & Export ───────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-6">
          {/* Preview */}
          <div className="border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
              <h2 className="font-semibold">Preview — {config.template_type.replace(/_/g, " ")} layout</h2>
              <Badge variant="outline" className="text-xs">{selectedSiteData.length} sites</Badge>
            </div>
            <div className={cn(
              "p-4 gap-3 overflow-auto max-h-[50vh]",
              config.template_type === "grid" ? "grid grid-cols-2" :
              config.template_type === "compact" ? "grid grid-cols-4" :
              "flex flex-col"
            )}>
              {selectedSiteData.map((site) => (
                <div key={site.id} className={cn(
                  "border rounded-lg overflow-hidden",
                  config.template_type === "list" ? "flex gap-3 p-3" :
                  config.template_type === "one_per_page" ? "p-4" : "p-2"
                )}>
                  {config.show_photos && site.primary_photo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={site.primary_photo_url}
                      alt={site.name}
                      className={cn(
                        "object-cover bg-muted",
                        config.template_type === "list" ? "w-24 h-20 rounded flex-shrink-0" :
                        config.template_type === "one_per_page" ? "w-full h-40 rounded mb-2" :
                        "w-full h-20 rounded mb-1"
                      )}
                    />
                  )}
                  {(!config.show_photos || !site.primary_photo_url) && config.template_type !== "compact" && (
                    <div className={cn(
                      "bg-muted rounded flex items-center justify-center text-xs text-muted-foreground",
                      config.template_type === "list" ? "w-24 h-20 flex-shrink-0" :
                      config.template_type === "one_per_page" ? "w-full h-40 mb-2" :
                      "w-full h-20 mb-1"
                    )}>
                      No photo
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={cn("font-semibold truncate", config.template_type === "compact" ? "text-xs" : "text-sm")}>
                      {site.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{site.city}</p>
                    {config.show_dimensions && site.width_ft && site.height_ft && config.template_type !== "compact" && (
                      <p className="text-xs text-muted-foreground">{site.width_ft}×{site.height_ft} ft</p>
                    )}
                    {config.show_rates !== "hidden" && (
                      <p className="text-xs font-medium mt-0.5">
                        {config.show_rates === "request_quote" ? "Request Quote" :
                         config.show_rates === "range" && site.base_rate_paise ?
                           `${inr(Math.round(site.base_rate_paise * 0.8))}–${inr(Math.round(site.base_rate_paise * 1.2))}` :
                           inr(site.base_rate_paise)}
                        {config.show_rates !== "request_quote" && site.base_rate_paise ? "/mo" : ""}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Export & Save */}
          <div className="border rounded-xl p-4 space-y-4">
            <h2 className="font-semibold">Export & Save</h2>
            <div className="flex flex-wrap gap-3">
              <ProposalExportButtons
                proposal={{
                  ...config,
                  id: editProposalId ?? "preview",
                  organization_id: "",
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  created_by: null,
                  updated_by: null,
                  deleted_at: null,
                  status: "draft",
                  sent_to_email: null,
                  sent_at: null,
                  viewed_at: null,
                  pdf_url: null,
                  pptx_url: null,
                  client_id: config.client_id || null,
                  terms_text: config.terms_text || null,
                  custom_header_text: config.custom_header_text || null,
                  custom_footer_text: config.custom_footer_text || null,
                  notes: config.notes || null,
                }}
                sites={selectedSiteData}
                org={org}
                orgLogoUrl={orgLogoUrl}
              />
              <Button onClick={() => handleSave("draft")} disabled={isPending} variant="outline">
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save as Draft
              </Button>
              <Button onClick={() => handleSave("sent")} disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save & Mark Sent
              </Button>
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
          </div>
        </div>
      )}
    </div>
  );
}
