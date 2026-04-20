// @react-pdf/renderer document for proposals — must be dynamically imported (no SSR)
import {
  Document, Page, Text, View, StyleSheet, Image,
} from "@react-pdf/renderer";
import { inr } from "@/lib/utils";
import type { Proposal } from "@/lib/types/database";
import type { SiteForProposal } from "@/app/[locale]/(dashboard)/proposals/new/page";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProposalDocumentProps {
  proposal: Proposal;
  sites: SiteForProposal[];
  org: {
    name: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pin_code?: string | null;
    gstin?: string | null;
    phone?: string | null;
    email?: string | null;
    logo_url?: string | null;
  } | null;
  clientName?: string | null;
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  ink:        "#0F172A",
  muted:      "#64748B",
  border:     "#E2E8F0",
  borderSoft: "#F1F5F9",
  bgMuted:    "#F8FAFC",
  accent:     "#4F46E5",
  danger:     "#DC2626",
  success:    "#059669",
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 56,
    paddingHorizontal: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: C.ink,
    backgroundColor: "#ffffff",
    lineHeight: 1.4,
  },

  // ── Cover page ──
  coverPage: {
    paddingTop: 72,
    paddingBottom: 72,
    paddingHorizontal: 56,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
  },
  coverHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  coverEyebrow: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.accent,
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  coverOrgRight: { alignItems: "flex-end" },
  coverOrgName: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.ink },
  coverOrgDetail: { fontSize: 8, color: C.muted, marginTop: 1 },

  coverRule: { borderTopWidth: 1.5, borderTopColor: C.ink, marginVertical: 24 },

  coverTitle: {
    fontSize: 32,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    marginBottom: 14,
    lineHeight: 1.15,
  },
  coverPreparedFor: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 24,
  },
  coverClient: { fontSize: 16, color: C.ink, fontFamily: "Helvetica-Bold", marginTop: 4 },
  coverHeaderText: { fontSize: 10, color: C.muted, marginTop: 14, lineHeight: 1.5 },

  coverFactsRow: {
    flexDirection: "row",
    marginTop: 48,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 16,
  },
  coverFact: { flex: 1 },
  coverFactLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  coverFactValue: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.ink },

  // ── Page header (non-cover pages) ──
  pageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
    marginBottom: 14,
  },
  pageHeaderLeft: { fontSize: 9, fontFamily: "Helvetica-Bold", color: C.ink },
  pageHeaderRight: { fontSize: 8, color: C.muted },

  // ── Section header ──
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    marginBottom: 12,
  },

  // ── Divider ──
  divider: { borderBottomWidth: 0.5, borderBottomColor: C.border, marginVertical: 8 },

  // ── Grid (2 per row) ──
  gridRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  gridCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  cardPhoto: { width: "100%", height: 110, backgroundColor: C.borderSoft },
  cardBody: { padding: 10 },
  cardName: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 2 },
  cardCity: { fontSize: 8, color: C.muted, marginBottom: 4 },
  cardMeta: { fontSize: 8, color: C.muted, marginBottom: 1 },
  cardRateRow: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardRateLabel: {
    fontSize: 7,
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
  },
  cardRate: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.accent },

  // ── List card (1 per row) ──
  listCard: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 4,
    padding: 10,
    marginBottom: 8,
    flexDirection: "row",
    gap: 12,
    backgroundColor: "#ffffff",
  },
  listPhoto: { width: 90, height: 70, backgroundColor: C.borderSoft, borderRadius: 3 },
  listBody: { flex: 1 },
  listName: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 2 },
  listCity: { fontSize: 8, color: C.muted, marginBottom: 3 },
  listMeta: { fontSize: 8, color: C.muted, marginBottom: 1 },
  listRate: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: C.accent,
    marginTop: 4,
  },

  // ── One per page ──
  fullPhoto: {
    width: "100%",
    height: 240,
    backgroundColor: C.borderSoft,
    borderRadius: 4,
    marginBottom: 16,
  },
  fullName: { fontSize: 20, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 4 },
  fullMeta: { fontSize: 9, color: C.muted, marginBottom: 2 },
  fullRateBlock: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  fullRateLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  fullRate: { fontSize: 18, fontFamily: "Helvetica-Bold", color: C.ink, marginTop: 2 },

  detailRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  detailBox: {
    flex: 1,
    backgroundColor: C.bgMuted,
    borderRadius: 3,
    padding: 8,
  },
  detailLabel: {
    fontSize: 7,
    color: C.muted,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  detailValue: { fontSize: 9, fontFamily: "Helvetica-Bold", color: C.ink },

  // ── Compact (4 per row) ──
  compactRow: { flexDirection: "row", gap: 6, marginBottom: 6 },
  compactCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 3,
    padding: 6,
  },
  compactName: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 1 },
  compactMeta: { fontSize: 7, color: C.muted },
  compactRate: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.accent, marginTop: 2 },

  // ── Terms & contact ──
  termsTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 6, color: C.ink },
  termsText: { fontSize: 9, color: C.muted, lineHeight: 1.6 },

  contactCard: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 4,
    padding: 16,
    marginTop: 8,
  },
  contactTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 8 },
  contactRow: { flexDirection: "row", gap: 24, marginTop: 8 },
  contactItem: { flex: 1 },
  contactLabel: {
    fontSize: 7,
    color: C.muted,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  contactValue: { fontSize: 9, color: C.ink, marginBottom: 6 },

  // ── Footer ──
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 7, color: C.muted },
  footerThanks: { fontSize: 7, color: C.muted, fontStyle: "italic" },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayRate(paise: number | null, showRates: string): string {
  if (!paise || showRates === "hidden") return "—";
  if (showRates === "request_quote") return "Request Quote";
  if (showRates === "range") {
    const low = Math.round(paise * 0.8);
    const high = Math.round(paise * 1.2);
    return `${inr(low)} – ${inr(high)}`;
  }
  return inr(paise);
}

function siteRate(site: SiteForProposal, showRates: string): string {
  return displayRate(site.base_rate_paise, showRates);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Site Cards per layout ────────────────────────────────────────────────────

function GridCards({ sites, proposal }: { sites: SiteForProposal[]; proposal: Proposal }) {
  const rows = chunkArray(sites, 2);
  return (
    <>
      {rows.map((row, ri) => (
        <View key={ri} style={S.gridRow}>
          {row.map((site) => (
            <View key={site.id} style={S.gridCard}>
              {proposal.show_photos && site.primary_photo_url ? (
                <Image src={site.primary_photo_url} style={S.cardPhoto} />
              ) : (
                <View style={S.cardPhoto} />
              )}
              <View style={S.cardBody}>
                <Text style={S.cardName}>{site.name}</Text>
                <Text style={S.cardCity}>{site.city}, {site.state}</Text>
                <Text style={S.cardMeta}>{site.media_type?.replace(/_/g, " ")}</Text>
                {proposal.show_dimensions && site.width_ft && site.height_ft && (
                  <Text style={S.cardMeta}>{site.width_ft} × {site.height_ft} ft</Text>
                )}
                {proposal.show_illumination && site.illumination && (
                  <Text style={S.cardMeta}>{site.illumination}</Text>
                )}
                {proposal.show_rates !== "hidden" && (
                  <View style={S.cardRateRow}>
                    <Text style={S.cardRateLabel}>Monthly</Text>
                    <Text style={S.cardRate}>{siteRate(site, proposal.show_rates)}</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
          {/* Fill last row if odd */}
          {row.length === 1 && <View style={{ flex: 1 }} />}
        </View>
      ))}
    </>
  );
}

function ListCards({ sites, proposal }: { sites: SiteForProposal[]; proposal: Proposal }) {
  return (
    <>
      {sites.map((site) => (
        <View key={site.id} style={S.listCard}>
          {proposal.show_photos && site.primary_photo_url ? (
            <Image src={site.primary_photo_url} style={S.listPhoto} />
          ) : (
            <View style={S.listPhoto} />
          )}
          <View style={S.listBody}>
            <Text style={S.listName}>{site.name}</Text>
            <Text style={S.listCity}>{site.city}, {site.state} • {site.address}</Text>
            <Text style={S.listMeta}>{site.media_type?.replace(/_/g, " ")}</Text>
            {proposal.show_dimensions && site.width_ft && site.height_ft && (
              <Text style={S.listMeta}>{site.width_ft} × {site.height_ft} ft  ({site.total_sqft} sq.ft.)</Text>
            )}
            {proposal.show_illumination && site.illumination && (
              <Text style={S.listMeta}>Illumination: {site.illumination}</Text>
            )}
            {proposal.show_traffic_info && (
              <>
                {site.facing && <Text style={S.listMeta}>Facing: {site.facing}</Text>}
                {site.visibility_distance_m && <Text style={S.listMeta}>Visibility: {site.visibility_distance_m}m</Text>}
              </>
            )}
            {proposal.show_availability && (
              <Text style={S.listMeta}>Status: {site.status}</Text>
            )}
            {proposal.show_rates !== "hidden" && (
              <Text style={S.listRate}>{siteRate(site, proposal.show_rates)} / month</Text>
            )}
          </View>
        </View>
      ))}
    </>
  );
}

function CompactCards({ sites, proposal }: { sites: SiteForProposal[]; proposal: Proposal }) {
  const rows = chunkArray(sites, 4);
  return (
    <>
      {rows.map((row, ri) => (
        <View key={ri} style={S.compactRow}>
          {row.map((site) => (
            <View key={site.id} style={S.compactCard}>
              <Text style={S.compactName}>{site.name}</Text>
              <Text style={S.compactMeta}>{site.city}</Text>
              <Text style={S.compactMeta}>{site.media_type?.replace(/_/g, " ")}</Text>
              {proposal.show_rates !== "hidden" && (
                <Text style={S.compactRate}>{siteRate(site, proposal.show_rates)}</Text>
              )}
            </View>
          ))}
          {Array.from({ length: 4 - row.length }).map((_, i) => (
            <View key={i} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </>
  );
}

// ─── Main Document ────────────────────────────────────────────────────────────

export function ProposalDocument({ proposal, sites, org, clientName }: ProposalDocumentProps) {
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const footerText = proposal.custom_footer_text ?? `${org?.name ?? ""} • Generated on ${today}`;
  const orgLine = org ? [org.city, org.state].filter(Boolean).join(", ") : "";

  return (
    <Document title={proposal.proposal_name} author={org?.name ?? ""}>
      {/* ── Cover Page ─────────────────────────────────────────────────────── */}
      <Page size="A4" style={S.coverPage}>
        <View style={S.coverHeader}>
          <Text style={S.coverEyebrow}>Proposal</Text>
          {proposal.include_company_branding && org && (
            <View style={S.coverOrgRight}>
              <Text style={S.coverOrgName}>{org.name}</Text>
              {orgLine && <Text style={S.coverOrgDetail}>{orgLine}</Text>}
              {(org.phone || org.email) && (
                <Text style={S.coverOrgDetail}>
                  {[org.phone, org.email].filter(Boolean).join("  •  ")}
                </Text>
              )}
            </View>
          )}
        </View>

        <View style={S.coverRule} />

        <Text style={S.coverTitle}>{proposal.proposal_name}</Text>

        {proposal.custom_header_text && (
          <Text style={S.coverHeaderText}>{proposal.custom_header_text}</Text>
        )}

        {clientName && (
          <>
            <Text style={S.coverPreparedFor}>Prepared For</Text>
            <Text style={S.coverClient}>{clientName}</Text>
          </>
        )}

        <View style={S.coverFactsRow}>
          <View style={S.coverFact}>
            <Text style={S.coverFactLabel}>Sites</Text>
            <Text style={S.coverFactValue}>{sites.length}</Text>
          </View>
          <View style={S.coverFact}>
            <Text style={S.coverFactLabel}>Issued</Text>
            <Text style={S.coverFactValue}>{today}</Text>
          </View>
          <View style={S.coverFact}>
            <Text style={S.coverFactLabel}>Validity</Text>
            <Text style={S.coverFactValue}>30 days</Text>
          </View>
        </View>

        <View style={S.footer} fixed>
          <Text style={S.footerText}>{footerText}</Text>
          <Text style={S.footerThanks}>Thank you for considering us.</Text>
        </View>
      </Page>

      {/* ── Sites Pages ────────────────────────────────────────────────────── */}
      {proposal.template_type === "one_per_page" ? (
        // One site per page
        sites.map((site) => (
          <Page key={site.id} size="A4" style={S.page}>
            <View style={S.pageHeader} fixed>
              <Text style={S.pageHeaderLeft}>{proposal.proposal_name}</Text>
              <Text style={S.pageHeaderRight}>{org?.name ?? ""}</Text>
            </View>

            {proposal.show_photos && site.primary_photo_url ? (
              <Image src={site.primary_photo_url} style={S.fullPhoto} />
            ) : (
              <View style={S.fullPhoto} />
            )}
            <Text style={S.fullName}>{site.name}</Text>
            <Text style={S.fullMeta}>{site.city}, {site.state}</Text>
            {site.address && <Text style={S.fullMeta}>{site.address}</Text>}

            <View style={S.detailRow}>
              <View style={S.detailBox}>
                <Text style={S.detailLabel}>Media Type</Text>
                <Text style={S.detailValue}>{site.media_type?.replace(/_/g, " ")}</Text>
              </View>
              {proposal.show_dimensions && (
                <View style={S.detailBox}>
                  <Text style={S.detailLabel}>Dimensions</Text>
                  <Text style={S.detailValue}>
                    {site.width_ft && site.height_ft ? `${site.width_ft} × ${site.height_ft} ft` : "—"}
                  </Text>
                </View>
              )}
              {proposal.show_illumination && (
                <View style={S.detailBox}>
                  <Text style={S.detailLabel}>Illumination</Text>
                  <Text style={S.detailValue}>{site.illumination ?? "—"}</Text>
                </View>
              )}
              {proposal.show_traffic_info && (
                <View style={S.detailBox}>
                  <Text style={S.detailLabel}>Facing</Text>
                  <Text style={S.detailValue}>{site.facing ?? "—"}</Text>
                </View>
              )}
            </View>

            {proposal.show_rates !== "hidden" && (
              <View style={S.fullRateBlock}>
                <Text style={S.fullRateLabel}>Monthly Rate</Text>
                <Text style={S.fullRate}>{siteRate(site, proposal.show_rates)}</Text>
              </View>
            )}

            <View style={S.footer} fixed>
              <Text style={S.footerText}>{footerText}</Text>
              <Text
                style={S.footerText}
                render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
              />
            </View>
          </Page>
        ))
      ) : (
        // Multi-site page(s)
        <Page size="A4" style={S.page}>
          <View style={S.pageHeader} fixed>
            <Text style={S.pageHeaderLeft}>{proposal.proposal_name}</Text>
            <Text style={S.pageHeaderRight}>{org?.name ?? ""}</Text>
          </View>

          <Text style={S.sectionLabel}>Inventory</Text>
          <Text style={S.sectionTitle}>
            {sites.length} location{sites.length !== 1 ? "s" : ""}
          </Text>

          {proposal.template_type === "grid" && <GridCards sites={sites} proposal={proposal} />}
          {proposal.template_type === "list" && <ListCards sites={sites} proposal={proposal} />}
          {proposal.template_type === "compact" && <CompactCards sites={sites} proposal={proposal} />}

          <View style={S.footer} fixed>
            <Text style={S.footerText}>{footerText}</Text>
            <Text
              style={S.footerText}
              render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
            />
          </View>
        </Page>
      )}

      {/* ── Terms Page ─────────────────────────────────────────────────────── */}
      {proposal.include_terms && proposal.terms_text && (
        <Page size="A4" style={S.page}>
          <View style={S.pageHeader} fixed>
            <Text style={S.pageHeaderLeft}>{proposal.proposal_name}</Text>
            <Text style={S.pageHeaderRight}>{org?.name ?? ""}</Text>
          </View>

          <Text style={S.sectionLabel}>Legal</Text>
          <Text style={S.sectionTitle}>Terms &amp; Conditions</Text>
          <Text style={S.termsText}>{proposal.terms_text}</Text>

          <View style={S.footer} fixed>
            <Text style={S.footerText}>{footerText}</Text>
            <Text
              style={S.footerText}
              render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
            />
          </View>
        </Page>
      )}

      {/* ── Contact Page ───────────────────────────────────────────────────── */}
      {proposal.include_contact_details && org && (
        <Page size="A4" style={S.page}>
          <View style={S.pageHeader} fixed>
            <Text style={S.pageHeaderLeft}>{proposal.proposal_name}</Text>
            <Text style={S.pageHeaderRight}>{org?.name ?? ""}</Text>
          </View>

          <Text style={S.sectionLabel}>Get in touch</Text>
          <Text style={S.sectionTitle}>Contact Us</Text>

          <View style={S.contactCard}>
            <Text style={S.contactTitle}>{org.name}</Text>
            <View style={S.divider} />
            <View style={S.contactRow}>
              <View style={S.contactItem}>
                <Text style={S.contactLabel}>Address</Text>
                <Text style={S.contactValue}>
                  {[org.address, org.city, org.state, org.pin_code].filter(Boolean).join(", ")}
                </Text>
              </View>
              <View style={S.contactItem}>
                <Text style={S.contactLabel}>Phone</Text>
                <Text style={S.contactValue}>{org.phone ?? "—"}</Text>
                <Text style={S.contactLabel}>Email</Text>
                <Text style={S.contactValue}>{org.email ?? "—"}</Text>
              </View>
            </View>
            {org.gstin && (
              <>
                <View style={S.divider} />
                <Text style={S.contactLabel}>GSTIN</Text>
                <Text style={S.contactValue}>{org.gstin}</Text>
              </>
            )}
          </View>

          <View style={S.footer} fixed>
            <Text style={S.footerText}>{footerText}</Text>
            <Text style={S.footerThanks}>Thank you for your business.</Text>
          </View>
        </Page>
      )}
    </Document>
  );
}
