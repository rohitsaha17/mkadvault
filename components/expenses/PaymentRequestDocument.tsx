// @react-pdf/renderer document for a single payment request.
//
// Renders on the organization's letterhead — logo + name + address +
// GSTIN/PAN + contact row, same visual language as the invoice PDF so
// finance docs feel consistent. Content below the header is a vertical
// detail sheet (no table) since a payment request is one expense, not
// a list of items.
//
// Must be imported dynamically (no SSR) — see PaymentRequestPDFButton.
import {
  Document,
  Image,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { inr, fmt } from "@/lib/utils";
import {
  expenseCategoryLabel,
  paymentModeLabel,
} from "@/lib/constants/expenses";
import type {
  SiteExpense,
  Organization,
  Site,
  Campaign,
} from "@/lib/types/database";

export interface PaymentRequestDocumentProps {
  expense: SiteExpense;
  org: Pick<
    Organization,
    | "name"
    | "address"
    | "city"
    | "state"
    | "pin_code"
    | "gstin"
    | "pan"
    | "phone"
    | "email"
  >;
  orgLogoUrl?: string | null;
  site: Pick<Site, "id" | "name" | "site_code" | "city" | "state"> | null;
  campaign: Pick<Campaign, "id" | "campaign_name" | "campaign_code"> | null;
  createdByName?: string | null;
  paidByName?: string | null;
  // Org-wide payment-voucher T&C (migration 040). When non-empty, a
  // "Terms & Conditions" block renders just above the signature so the
  // printed PDF carries the org's standard payment language.
  termsText?: string | null;
}

// ─── Design tokens (match the invoice PDF) ────────────────────────────────────
const C = {
  ink: "#0F172A",
  muted: "#64748B",
  border: "#E2E8F0",
  borderSoft: "#F1F5F9",
  bgMuted: "#F8FAFC",
  accent: "#1E3A8A",
  accentSoft: "#EEF2FF",
  danger: "#DC2626",
  success: "#059669",
};

const S = StyleSheet.create({
  page: {
    paddingTop: 0,
    paddingBottom: 64,
    paddingHorizontal: 0,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: C.ink,
    lineHeight: 1.4,
  },
  body: { paddingHorizontal: 36, paddingTop: 18 },
  brandBand: { height: 6, backgroundColor: C.accent, marginBottom: 18 },

  // ── Letterhead ─────────────────────────────────────────────────────────
  headerWrap: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerLeft: {
    flex: 1,
    paddingRight: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: C.border,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImg: { width: 52, height: 52, objectFit: "contain" },
  brandName: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    marginBottom: 3,
  },
  brandLine: { fontSize: 8, color: C.muted, lineHeight: 1.5 },

  docMeta: { alignItems: "flex-end", maxWidth: 220 },
  docLabel: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: C.accent,
    letterSpacing: 1.2,
  },
  docNumber: {
    fontSize: 10,
    color: C.ink,
    fontFamily: "Helvetica-Bold",
    marginTop: 3,
  },
  docDateLine: { fontSize: 8, color: C.muted, marginTop: 4 },

  statusPill: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
  },

  rule: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    marginVertical: 12,
  },

  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },

  // ── Two-column grid for the detail rows ───────────────────────────────
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 2 },
  cell: {
    width: "50%",
    paddingRight: 12,
    marginBottom: 10,
  },
  cellFull: {
    width: "100%",
    marginBottom: 10,
  },
  cellLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  cellValue: {
    fontSize: 10,
    color: C.ink,
    fontFamily: "Helvetica-Bold",
  },
  cellSub: { fontSize: 8, color: C.muted, marginTop: 1 },
  cellMono: { fontSize: 10, color: C.ink, fontFamily: "Courier-Bold" },

  // ── Amount callout ─────────────────────────────────────────────────────
  amountCard: {
    marginTop: 14,
    backgroundColor: C.accentSoft,
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  amountLabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: C.accent,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  amountValue: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: C.accent,
  },

  // ── Payee card ─────────────────────────────────────────────────────────
  payeeBox: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 4,
    padding: 10,
    backgroundColor: "#fff",
  },
  payeeHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  payeeBadge: {
    width: 4,
    height: 14,
    backgroundColor: C.accent,
    borderRadius: 2,
    marginRight: 8,
  },
  payeeTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  // ── Notes / signature / footer ────────────────────────────────────────
  notesBlock: { marginTop: 12 },
  notesText: { fontSize: 8, color: C.muted, lineHeight: 1.5 },

  signatureWrap: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 30,
  },
  signatureBox: { alignItems: "center", width: 180 },
  signatureRule: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    width: "100%",
    marginBottom: 4,
  },
  signatureLabel: {
    fontSize: 7,
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  signatureName: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    marginTop: 1,
  },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    paddingTop: 6,
  },
  footerRow: { flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 7, color: C.muted },
});

// Map status → visual pill
function statusStyle(status: string): {
  bg: string;
  border: string;
  color: string;
  label: string;
} {
  if (status === "paid")
    return { bg: "#ECFDF5", border: C.success, color: C.success, label: "PAID" };
  if (status === "approved")
    return { bg: C.accentSoft, border: C.accent, color: C.accent, label: "APPROVED" };
  if (status === "rejected")
    return { bg: "#FEF2F2", border: C.danger, color: C.danger, label: "REJECTED" };
  return { bg: "#FFFBEB", border: "#D97706", color: "#D97706", label: "PENDING" };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PaymentRequestDocument({
  expense,
  org,
  orgLogoUrl,
  site,
  campaign,
  createdByName,
  paidByName,
  termsText,
}: PaymentRequestDocumentProps) {
  const pill = statusStyle(expense.status);
  const shortId = expense.id.slice(0, 8);
  const tds = expense.tds_paise ?? 0;
  const net = expense.amount_paise - tds;
  const hasTds = tds > 0;

  return (
    <Document>
      <Page size="A4" style={S.page}>
        {/* ── Accent brand band ── */}
        <View style={S.brandBand} fixed />

        <View style={S.body}>
          {/* ── Letterhead ── */}
          <View style={S.headerWrap}>
            <View style={S.headerLeft}>
              {orgLogoUrl && (
                <View style={S.logoBox}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <Image src={orgLogoUrl} style={S.logoImg} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={S.brandName}>{org.name}</Text>
                {org.address && (
                  <Text style={S.brandLine}>{org.address}</Text>
                )}
                {(org.city || org.state) && (
                  <Text style={S.brandLine}>
                    {[org.city, org.state, org.pin_code].filter(Boolean).join(", ")}
                  </Text>
                )}
                {(org.gstin || org.pan) && (
                  <Text style={S.brandLine}>
                    {org.gstin ? `GSTIN: ${org.gstin}` : ""}
                    {org.gstin && org.pan ? "  ·  " : ""}
                    {org.pan ? `PAN: ${org.pan}` : ""}
                  </Text>
                )}
                {(org.phone || org.email) && (
                  <Text style={S.brandLine}>
                    {org.phone}
                    {org.phone && org.email ? "  ·  " : ""}
                    {org.email}
                  </Text>
                )}
              </View>
            </View>

            <View style={S.docMeta}>
              <Text style={S.docLabel}>PAYMENT REQUEST</Text>
              <Text style={S.docNumber}>#{shortId}</Text>
              <Text style={S.docDateLine}>
                Raised: {fmt(expense.created_at)}
              </Text>
              {expense.needed_by && (
                <Text style={S.docDateLine}>
                  Needed by: {fmt(expense.needed_by)}
                </Text>
              )}
              <Text
                style={[
                  S.statusPill,
                  {
                    backgroundColor: pill.bg,
                    borderColor: pill.border,
                    color: pill.color,
                  },
                ]}
              >
                {pill.label}
              </Text>
            </View>
          </View>

          <View style={S.rule} />

          {/* ── Request details ── */}
          <Text style={S.sectionLabel}>Request details</Text>
          <View style={S.grid}>
            <View style={S.cell}>
              <Text style={S.cellLabel}>Category</Text>
              <Text style={S.cellValue}>
                {expenseCategoryLabel(expense.category)}
              </Text>
            </View>
            <View style={S.cell}>
              <Text style={S.cellLabel}>Status</Text>
              <Text style={[S.cellValue, { color: pill.color }]}>
                {pill.label}
              </Text>
            </View>
            <View style={S.cellFull}>
              <Text style={S.cellLabel}>Description</Text>
              <Text style={[S.cellValue, { fontFamily: "Helvetica" }]}>
                {expense.description}
              </Text>
            </View>
            {expense.notes && (
              <View style={S.cellFull}>
                <Text style={S.cellLabel}>Internal notes</Text>
                <Text style={[S.cellValue, { fontFamily: "Helvetica" }]}>
                  {expense.notes}
                </Text>
              </View>
            )}
          </View>

          {/* ── Linked records ── */}
          {(site || campaign) && (
            <>
              <Text style={[S.sectionLabel, { marginTop: 6 }]}>
                Linked records
              </Text>
              <View style={S.grid}>
                {site && (
                  <View style={S.cell}>
                    <Text style={S.cellLabel}>Site</Text>
                    <Text style={S.cellValue}>{site.name}</Text>
                    {(site.site_code || site.city) && (
                      <Text style={S.cellSub}>
                        {[site.site_code, site.city, site.state]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    )}
                  </View>
                )}
                {campaign && (
                  <View style={S.cell}>
                    <Text style={S.cellLabel}>Campaign</Text>
                    <Text style={S.cellValue}>{campaign.campaign_name}</Text>
                    {campaign.campaign_code && (
                      <Text style={S.cellSub}>{campaign.campaign_code}</Text>
                    )}
                  </View>
                )}
              </View>
            </>
          )}

          {/* ── Amount callout ── */}
          <View style={S.amountCard}>
            <View>
              <Text style={S.amountLabel}>Amount requested</Text>
              {hasTds && (
                <Text style={[S.cellSub, { marginTop: 3, color: C.accent }]}>
                  Net payable (after TDS ₹
                  {(tds / 100).toLocaleString("en-IN")}): ₹
                  {(net / 100).toLocaleString("en-IN")}
                </Text>
              )}
            </View>
            <Text style={S.amountValue}>{inr(expense.amount_paise)}</Text>
          </View>

          {/* ── Payee ── */}
          <View style={S.payeeBox}>
            <View style={S.payeeHeader}>
              <View style={S.payeeBadge} />
              <Text style={S.payeeTitle}>Pay to</Text>
            </View>
            <View style={S.grid}>
              <View style={S.cell}>
                <Text style={S.cellLabel}>Name</Text>
                <Text style={S.cellValue}>{expense.payee_name}</Text>
              </View>
              <View style={S.cell}>
                <Text style={S.cellLabel}>Type</Text>
                <Text style={[S.cellValue, { textTransform: "capitalize" }]}>
                  {expense.payee_type}
                </Text>
              </View>
              {expense.payee_contact && (
                <View style={S.cell}>
                  <Text style={S.cellLabel}>Contact</Text>
                  <Text style={S.cellValue}>{expense.payee_contact}</Text>
                </View>
              )}
              {expense.payee_bank_details &&
                Object.entries(expense.payee_bank_details).map(([k, v]) => (
                  <View key={k} style={S.cell}>
                    <Text style={S.cellLabel}>{k.replace(/_/g, " ")}</Text>
                    <Text style={S.cellMono}>{String(v)}</Text>
                  </View>
                ))}
            </View>
          </View>

          {/* ── Settlement (only for paid) ── */}
          {expense.status === "paid" && (
            <>
              <Text style={[S.sectionLabel, { marginTop: 14 }]}>
                Settlement
              </Text>
              <View style={S.grid}>
                <View style={S.cell}>
                  <Text style={S.cellLabel}>Paid on</Text>
                  <Text style={S.cellValue}>
                    {expense.paid_at ? fmt(expense.paid_at) : "—"}
                  </Text>
                </View>
                <View style={S.cell}>
                  <Text style={S.cellLabel}>Payment mode</Text>
                  <Text style={S.cellValue}>
                    {paymentModeLabel(expense.payment_mode)}
                  </Text>
                </View>
                {expense.payment_reference && (
                  <View style={S.cell}>
                    <Text style={S.cellLabel}>Reference</Text>
                    <Text style={S.cellMono}>
                      {expense.payment_reference}
                    </Text>
                  </View>
                )}
                {paidByName && (
                  <View style={S.cell}>
                    <Text style={S.cellLabel}>Paid by</Text>
                    <Text style={S.cellValue}>{paidByName}</Text>
                  </View>
                )}
              </View>
            </>
          )}

          {/* ── Audit ── */}
          <View style={S.notesBlock}>
            <Text style={S.sectionLabel}>Audit</Text>
            <Text style={S.notesText}>
              Raised on {fmt(expense.created_at)}
              {createdByName ? ` by ${createdByName}` : ""}. Last updated{" "}
              {fmt(expense.updated_at)}.
            </Text>
          </View>

          {/* ── Terms & Conditions (from organization settings) ── */}
          {termsText && termsText.trim() !== "" && (
            <View style={S.notesBlock}>
              <Text style={S.sectionLabel}>Terms &amp; Conditions</Text>
              <Text style={S.notesText}>{termsText.trim()}</Text>
            </View>
          )}

          {/* ── Signature ── */}
          <View style={S.signatureWrap}>
            <View style={S.signatureBox}>
              <View style={S.signatureRule} />
              <Text style={S.signatureLabel}>Authorised Signatory</Text>
              <Text style={S.signatureName}>for {org.name}</Text>
            </View>
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={S.footer} fixed>
          <View style={S.footerRow}>
            <Text style={S.footerText}>
              Payment Request #{shortId} · {org.name}
            </Text>
            <Text
              style={S.footerText}
              render={({ pageNumber, totalPages }) =>
                `Page ${pageNumber} of ${totalPages}`
              }
            />
          </View>
        </View>
      </Page>
    </Document>
  );
}
