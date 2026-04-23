// @react-pdf/renderer document — renders as PDF, must be imported dynamically (no SSR)
import {
  Document, Image, Page, Text, View, StyleSheet,
} from "@react-pdf/renderer";
import { inr, fmt } from "@/lib/utils";
import type { Invoice, InvoiceLineItem, Client, Organization, OrganizationBankAccount } from "@/lib/types/database";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvoiceDocumentProps {
  invoice: Invoice;
  lineItems: InvoiceLineItem[];
  client: Pick<Client, "company_name" | "brand_name" | "billing_address" | "billing_city" | "billing_state" | "billing_pin_code" | "gstin" | "pan">;
  org: Pick<Organization, "name" | "address" | "city" | "state" | "pin_code" | "gstin" | "pan" | "phone" | "email">;
  // Proper bank account object chosen per-invoice. When null, the bank
  // details block is hidden on the PDF.
  bankAccount?: Pick<
    OrganizationBankAccount,
    | "label"
    | "bank_name"
    | "account_holder_name"
    | "account_number"
    | "ifsc_code"
    | "branch_name"
    | "account_type"
    | "upi_id"
    | "swift_code"
  > | null;
  // Signed URL for the org logo OR a data-URI. Rendered top-left on page
  // 1; hidden when unset.
  orgLogoUrl?: string | null;
}

// ─── Design tokens ────────────────────────────────────────────────────────────
// Brand-neutral palette derived from the app's design system (hex equivalents
// of the oklch tokens — react-pdf only understands hex/rgb).
const C = {
  ink:        "#0F172A", // primary text
  muted:      "#64748B", // secondary text
  border:     "#E2E8F0", // dividers / borders
  borderSoft: "#F1F5F9", // table row separator
  bgMuted:    "#F8FAFC", // table header & totals background
  accent:     "#1E3A8A", // navy brand accent (matches PPTX)
  accentSoft: "#EEF2FF", // accent-tinted backgrounds
  danger:     "#DC2626", // overdue
  success:    "#059669", // paid
};

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  row: { flexDirection: "row" },
  col: { flex: 1 },

  // ── Brand band (accent stripe at the very top of the page) ──
  brandBand: {
    height: 6,
    backgroundColor: C.accent,
    marginBottom: 18,
  },

  // ── Header ──
  headerWrap: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerLeft: { flex: 1, paddingRight: 16, flexDirection: "row", alignItems: "flex-start", gap: 12 },
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
  brandName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 3 },
  brandLine: { fontSize: 8, color: C.muted, lineHeight: 1.5 },

  invoiceMeta: { alignItems: "flex-end", maxWidth: 220 },
  invoiceLabel: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: C.accent,
    letterSpacing: 1.5,
  },
  invoiceNumber: {
    fontSize: 10,
    color: C.ink,
    fontFamily: "Helvetica-Bold",
    marginTop: 3,
  },
  invoiceDateLine: { fontSize: 8, color: C.muted, marginTop: 4 },
  dueLine: {
    fontSize: 9,
    color: C.ink,
    fontFamily: "Helvetica-Bold",
    marginTop: 3,
  },

  // Status pill (top-right corner watermark)
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

  // ── Dividers ──
  rule: { borderBottomWidth: 1, borderBottomColor: C.border, marginVertical: 12 },
  ruleThin: { borderBottomWidth: 0.5, borderBottomColor: C.border, marginVertical: 8 },

  // ── Section headers ──
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },

  // ── Bill-to / meta blocks ──
  blocksRow: { flexDirection: "row", gap: 14 },
  block: { flex: 1 },
  blockTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 2 },
  blockLine: { fontSize: 9, color: C.ink, lineHeight: 1.5 },
  blockMuted: { fontSize: 8, color: C.muted, lineHeight: 1.5 },

  metaCard: {
    backgroundColor: C.bgMuted,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 4,
    padding: 8,
    marginBottom: 6,
  },
  metaLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  metaValue: { fontSize: 9, color: C.ink, fontFamily: "Helvetica-Bold" },

  // ── Table ──
  tableHeader: {
    flexDirection: "row",
    backgroundColor: C.accent,
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  tableHeaderText: {
    color: "#fff",
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: C.borderSoft,
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  tableRowAlt: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: C.borderSoft,
    paddingVertical: 7,
    paddingHorizontal: 6,
    backgroundColor: "#FCFDFE",
  },
  cellMuted: { color: C.muted, fontSize: 8 },
  cellNum: { textAlign: "right", fontSize: 9, color: C.ink },
  cellAmount: { textAlign: "right", fontSize: 9, fontFamily: "Helvetica-Bold", color: C.ink },

  // ── Totals ──
  totalsWrap: { marginTop: 12, alignItems: "flex-end" },
  totalsBox: { width: 260 },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalsLabel: { color: C.muted, fontSize: 9 },
  totalsValue: { color: C.ink, fontSize: 9 },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: C.accentSoft,
    borderRadius: 4,
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  grandTotalLabel: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.accent },
  grandTotalValue: { fontSize: 14, fontFamily: "Helvetica-Bold", color: C.accent },

  // ── Amount in words ──
  amountWords: {
    backgroundColor: C.bgMuted,
    borderLeftWidth: 2,
    borderLeftColor: C.accent,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginTop: 14,
  },
  amountWordsLabel: {
    fontSize: 7,
    color: C.muted,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  amountWordsText: { fontSize: 9, color: C.ink, fontFamily: "Helvetica-Bold" },

  // ── Bank / notes / terms ──
  bankBox: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 4,
    padding: 10,
    backgroundColor: "#fff",
  },
  bankHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  bankBadge: {
    width: 4,
    height: 14,
    backgroundColor: C.accent,
    borderRadius: 2,
    marginRight: 8,
  },
  bankTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  bankGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  bankItem: { minWidth: 130, marginBottom: 4 },
  bankLabel: {
    fontSize: 7,
    color: C.muted,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  bankValue: { fontSize: 10, color: C.ink, marginTop: 2, fontFamily: "Helvetica-Bold" },
  bankValueMono: { fontSize: 10, color: C.ink, marginTop: 2, fontFamily: "Courier-Bold" },

  notesBlock: { marginTop: 12 },
  notesText: { fontSize: 8, color: C.muted, lineHeight: 1.5 },

  // ── Signature ──
  signatureWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 30 },
  signatureBox: { alignItems: "center", width: 180 },
  signatureRule: { borderTopWidth: 1, borderTopColor: C.border, width: "100%", marginBottom: 4 },
  signatureLabel: { fontSize: 7, color: C.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  signatureName: { fontSize: 9, fontFamily: "Helvetica-Bold", color: C.ink, marginTop: 1 },

  // ── Footer ──
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
  footerThanks: { fontSize: 7, color: C.muted, textAlign: "center", marginTop: 3, fontStyle: "italic" },
});

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function numToWords(n: number): string {
  if (n === 0) return "Zero";
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + numToWords(n % 100) : "");
  if (n < 100000) return numToWords(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + numToWords(n % 1000) : "");
  if (n < 10000000) return numToWords(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + numToWords(n % 100000) : "");
  return numToWords(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 ? " " + numToWords(n % 10000000) : "");
}

function amountInWords(totalPaise: number): string {
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  let result = "Rupees " + numToWords(rupees);
  if (paise > 0) result += " and " + numToWords(paise) + " Paise";
  return result + " Only";
}

const SERVICE_LABELS: Record<string, string> = {
  display_rental: "Display Rental",
  flex_printing: "Flex Printing",
  mounting: "Mounting",
  design: "Design",
  transport: "Transport",
  other: "Other",
};

// Map invoice status → pill colors. Uses any to be tolerant of unknown statuses.
function statusStyle(status?: string | null): { bg: string; border: string; color: string; label: string } | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "paid") return { bg: "#ECFDF5", border: C.success, color: C.success, label: "PAID" };
  if (s === "overdue") return { bg: "#FEF2F2", border: C.danger, color: C.danger, label: "OVERDUE" };
  if (s === "draft") return { bg: C.bgMuted, border: C.border, color: C.muted, label: "DRAFT" };
  if (s === "cancelled") return { bg: C.bgMuted, border: C.border, color: C.muted, label: "CANCELLED" };
  if (s === "partially_paid") return { bg: "#FFFBEB", border: "#D97706", color: "#D97706", label: "PARTIAL" };
  if (s === "sent") return { bg: C.accentSoft, border: C.accent, color: C.accent, label: "SENT" };
  return null;
}

// ─── Document component ───────────────────────────────────────────────────────

export function InvoiceDocument({ invoice, lineItems, client, org, bankAccount, orgLogoUrl }: InvoiceDocumentProps) {
  // Status pill is shown only if invoice has a status field react-pdf can render.
  const pill = statusStyle((invoice as { status?: string }).status);

  return (
    <Document>
      <Page size="A4" style={S.page}>
        {/* ── Accent brand band ── */}
        <View style={S.brandBand} fixed />

        <View style={S.body}>
          {/* ── Header ── */}
          <View style={S.headerWrap}>
            <View style={S.headerLeft}>
              {orgLogoUrl && (
                <View style={S.logoBox}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image doesn't accept alt */}
                  <Image src={orgLogoUrl} style={S.logoImg} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={S.brandName}>{org.name}</Text>
                {org.address && <Text style={S.brandLine}>{org.address}</Text>}
                {(org.city || org.state) && (
                  <Text style={S.brandLine}>
                    {[org.city, org.state, org.pin_code].filter(Boolean).join(", ")}
                  </Text>
                )}
                {org.gstin && <Text style={S.brandLine}>GSTIN: {org.gstin}{org.pan ? `  ·  PAN: ${org.pan}` : ""}</Text>}
                {(org.phone || org.email) && (
                  <Text style={S.brandLine}>
                    {org.phone}{org.phone && org.email ? "  ·  " : ""}{org.email}
                  </Text>
                )}
              </View>
            </View>

            <View style={S.invoiceMeta}>
              <Text style={S.invoiceLabel}>TAX INVOICE</Text>
              <Text style={S.invoiceNumber}>{invoice.invoice_number}</Text>
              <Text style={S.invoiceDateLine}>Issued: {fmt(invoice.invoice_date)}</Text>
              <Text style={S.dueLine}>Due: {fmt(invoice.due_date)}</Text>
              {pill && (
                <Text
                  style={[
                    S.statusPill,
                    { backgroundColor: pill.bg, borderColor: pill.border, color: pill.color },
                  ]}
                >
                  {pill.label}
                </Text>
              )}
            </View>
          </View>

          <View style={S.rule} />

          {/* ── Bill To / GST Details ── */}
          <View style={S.blocksRow}>
            <View style={S.block}>
              <Text style={S.sectionLabel}>Bill To</Text>
              <Text style={S.blockTitle}>{client.company_name}</Text>
              {client.brand_name && <Text style={S.blockMuted}>{client.brand_name}</Text>}
              {client.billing_address && <Text style={S.blockMuted}>{client.billing_address}</Text>}
              {(client.billing_city || client.billing_state) && (
                <Text style={S.blockMuted}>
                  {[client.billing_city, client.billing_state, client.billing_pin_code].filter(Boolean).join(", ")}
                </Text>
              )}
              {client.gstin && (
                <Text style={[S.blockMuted, { marginTop: 4 }]}>GSTIN: {client.gstin}</Text>
              )}
              {client.pan && (
                <Text style={S.blockMuted}>PAN: {client.pan}</Text>
              )}
            </View>

            <View style={{ width: 210 }}>
              <View style={S.metaCard}>
                <Text style={S.metaLabel}>Place of Supply</Text>
                <Text style={S.metaValue}>{invoice.place_of_supply_state ?? org.state ?? "—"}</Text>
              </View>
              <View style={S.metaCard}>
                <Text style={S.metaLabel}>Tax Treatment</Text>
                <Text style={S.metaValue}>
                  {invoice.is_inter_state ? "IGST (Inter-State)" : "CGST + SGST (Intra-State)"}
                </Text>
              </View>
            </View>
          </View>

          {/* ── Line Items ── */}
          <View style={{ marginTop: 14 }}>
            <View style={S.tableHeader}>
              <Text style={[S.tableHeaderText, { width: 18 }]}>#</Text>
              <Text style={[S.tableHeaderText, { flex: 3 }]}>Description</Text>
              <Text style={[S.tableHeaderText, { flex: 1 }]}>HSN/SAC</Text>
              <Text style={[S.tableHeaderText, { width: 70 }]}>Period</Text>
              <Text style={[S.tableHeaderText, { width: 30, textAlign: "right" }]}>Qty</Text>
              <Text style={[S.tableHeaderText, { width: 70, textAlign: "right" }]}>Rate</Text>
              <Text style={[S.tableHeaderText, { width: 82, textAlign: "right" }]}>Amount</Text>
            </View>
            {lineItems.map((item, i) => (
              <View key={item.id} style={i % 2 === 0 ? S.tableRow : S.tableRowAlt}>
                <Text style={[S.cellMuted, { width: 18 }]}>{i + 1}</Text>
                <View style={{ flex: 3, paddingRight: 6 }}>
                  <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 9, color: C.ink }}>
                    {item.description}
                  </Text>
                  <Text style={[S.cellMuted, { marginTop: 1 }]}>{SERVICE_LABELS[item.service_type]}</Text>
                </View>
                <Text style={[S.cellMuted, { flex: 1 }]}>{item.hsn_sac_code}</Text>
                <Text style={[S.cellMuted, { width: 70, fontSize: 7 }]}>
                  {item.period_from
                    ? `${fmt(item.period_from)}${item.period_to ? "\nto " + fmt(item.period_to) : ""}`
                    : "—"}
                </Text>
                <Text style={[S.cellNum, { width: 30 }]}>{Number(item.quantity)}</Text>
                <Text style={[S.cellNum, { width: 70 }]}>{inr(item.rate_paise)}</Text>
                <Text style={[S.cellAmount, { width: 82 }]}>{inr(item.amount_paise)}</Text>
              </View>
            ))}
          </View>

          {/* ── Totals ── */}
          <View style={S.totalsWrap}>
            <View style={S.totalsBox}>
              <View style={S.totalsRow}>
                <Text style={S.totalsLabel}>Subtotal</Text>
                <Text style={S.totalsValue}>{inr(invoice.subtotal_paise)}</Text>
              </View>
              {invoice.is_inter_state ? (
                <View style={S.totalsRow}>
                  <Text style={S.totalsLabel}>IGST (18%)</Text>
                  <Text style={S.totalsValue}>{inr(invoice.igst_paise)}</Text>
                </View>
              ) : (
                <>
                  <View style={S.totalsRow}>
                    <Text style={S.totalsLabel}>CGST (9%)</Text>
                    <Text style={S.totalsValue}>{inr(invoice.cgst_paise)}</Text>
                  </View>
                  <View style={S.totalsRow}>
                    <Text style={S.totalsLabel}>SGST (9%)</Text>
                    <Text style={S.totalsValue}>{inr(invoice.sgst_paise)}</Text>
                  </View>
                </>
              )}
              <View style={S.grandTotalRow}>
                <Text style={S.grandTotalLabel}>GRAND TOTAL</Text>
                <Text style={S.grandTotalValue}>{inr(invoice.total_paise)}</Text>
              </View>
              {(invoice.amount_paid_paise ?? 0) > 0 && (
                <>
                  <View style={S.totalsRow}>
                    <Text style={S.totalsLabel}>Amount Paid</Text>
                    <Text style={[S.totalsValue, { color: C.success }]}>
                      ({inr(invoice.amount_paid_paise)})
                    </Text>
                  </View>
                  <View style={[S.totalsRow, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 4 }]}>
                    <Text style={[S.totalsLabel, { fontFamily: "Helvetica-Bold", color: C.ink }]}>Balance Due</Text>
                    <Text style={[S.totalsValue, { fontFamily: "Helvetica-Bold", color: C.danger }]}>
                      {inr(invoice.balance_due_paise)}
                    </Text>
                  </View>
                </>
              )}
            </View>
          </View>

          {/* ── Amount in words ── */}
          <View style={S.amountWords}>
            <Text style={S.amountWordsLabel}>Amount in Words</Text>
            <Text style={S.amountWordsText}>{amountInWords(invoice.total_paise)}</Text>
          </View>

          {/* ── Bank Details ── */}
          {bankAccount && (
            <View style={S.bankBox}>
              <View style={S.bankHeader}>
                <View style={S.bankBadge} />
                <Text style={S.bankTitle}>Bank Details for Payment</Text>
              </View>
              <View style={S.bankGrid}>
                <View style={S.bankItem}>
                  <Text style={S.bankLabel}>Bank</Text>
                  <Text style={S.bankValue}>
                    {bankAccount.bank_name}
                    {bankAccount.branch_name ? `, ${bankAccount.branch_name}` : ""}
                  </Text>
                </View>
                {bankAccount.account_holder_name && (
                  <View style={S.bankItem}>
                    <Text style={S.bankLabel}>Account Holder</Text>
                    <Text style={S.bankValue}>{bankAccount.account_holder_name}</Text>
                  </View>
                )}
                <View style={S.bankItem}>
                  <Text style={S.bankLabel}>Account Number</Text>
                  <Text style={S.bankValueMono}>{bankAccount.account_number}</Text>
                </View>
                <View style={S.bankItem}>
                  <Text style={S.bankLabel}>IFSC</Text>
                  <Text style={S.bankValueMono}>{bankAccount.ifsc_code}</Text>
                </View>
                {bankAccount.account_type && (
                  <View style={S.bankItem}>
                    <Text style={S.bankLabel}>A/C Type</Text>
                    <Text style={S.bankValue}>
                      {bankAccount.account_type.charAt(0).toUpperCase() + bankAccount.account_type.slice(1)}
                    </Text>
                  </View>
                )}
                {bankAccount.upi_id && (
                  <View style={S.bankItem}>
                    <Text style={S.bankLabel}>UPI</Text>
                    <Text style={S.bankValueMono}>{bankAccount.upi_id}</Text>
                  </View>
                )}
                {bankAccount.swift_code && (
                  <View style={S.bankItem}>
                    <Text style={S.bankLabel}>SWIFT</Text>
                    <Text style={S.bankValueMono}>{bankAccount.swift_code}</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* ── Notes ── */}
          {invoice.notes && (
            <View style={S.notesBlock}>
              <Text style={S.sectionLabel}>Notes</Text>
              <Text style={S.notesText}>{invoice.notes}</Text>
            </View>
          )}

          {/* ── Terms ── */}
          {invoice.terms_and_conditions && (
            <View style={S.notesBlock}>
              <Text style={S.sectionLabel}>Terms &amp; Conditions</Text>
              <Text style={S.notesText}>{invoice.terms_and_conditions}</Text>
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
              {invoice.invoice_number}  ·  SAC {invoice.sac_code}
            </Text>
            <Text
              style={S.footerText}
              render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
            />
          </View>
          <Text style={S.footerThanks}>Thank you for your business.</Text>
        </View>
      </Page>
    </Document>
  );
}
