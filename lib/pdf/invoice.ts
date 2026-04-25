// PDFKit-based invoice rendering. Same letterhead as payment requests
// (drawLetterhead) followed by Bill-To, line-item table, totals, and
// optional bank details + signature.

import {
  C,
  PAGE_MARGIN_X,
  createDoc,
  docToBuffer,
  drawFooter,
  drawLetterhead,
  fetchLogoBytes,
  fmtDate,
  inr,
  sectionLabel,
  type DocMeta,
  type LetterheadOrg,
} from "./letterhead";
import type {
  Client,
  Invoice,
  InvoiceLineItem,
  OrganizationBankAccount,
} from "@/lib/types/database";

export interface InvoicePdfInput {
  invoice: Invoice;
  lineItems: InvoiceLineItem[];
  client: Pick<
    Client,
    | "company_name"
    | "brand_name"
    | "billing_address"
    | "billing_city"
    | "billing_state"
    | "billing_pin_code"
    | "gstin"
    | "pan"
  >;
  org: LetterheadOrg;
  orgLogoSignedUrl?: string | null;
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
  termsText?: string | null;
}

const STATUS_PILL: Record<
  string,
  { color: string; bg: string; border: string; label: string }
> = {
  draft:           { color: "#475569", bg: "#F1F5F9", border: "#E2E8F0", label: "DRAFT" },
  sent:            { color: "#1E40AF", bg: "#DBEAFE", border: "#BFDBFE", label: "SENT" },
  partially_paid:  { color: "#92400E", bg: "#FEF3C7", border: "#FDE68A", label: "PARTIAL" },
  paid:            { color: "#065F46", bg: "#D1FAE5", border: "#A7F3D0", label: "PAID" },
  overdue:         { color: "#991B1B", bg: "#FEE2E2", border: "#FECACA", label: "OVERDUE" },
  cancelled:       { color: "#475569", bg: "#F1F5F9", border: "#E2E8F0", label: "CANCELLED" },
};

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const { invoice, lineItems, client, org, bankAccount, termsText } = input;
  const doc = createDoc();
  const logoBytes = await fetchLogoBytes(input.orgLogoSignedUrl);

  // ── Letterhead ───────────────────────────────────────────────────────
  const status = STATUS_PILL[invoice.status] ?? STATUS_PILL.draft;
  const meta: DocMeta = {
    label: "TAX INVOICE",
    number: `#${invoice.invoice_number}`,
    dateLines: [
      ["Date", fmtDate(invoice.invoice_date)],
      ["Due", fmtDate(invoice.due_date)],
    ],
    status,
  };
  drawLetterhead(doc, org, meta, logoBytes);

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - PAGE_MARGIN_X * 2;

  // ── Bill To ──────────────────────────────────────────────────────────
  sectionLabel(doc, "Bill to");
  doc.moveDown(0.25);
  doc
    .font("Helvetica-Bold")
    .fillColor(C.ink)
    .fontSize(11)
    .text(client.company_name + (client.brand_name ? `  •  ${client.brand_name}` : ""), {
      width: contentWidth,
    });
  doc.moveDown(0.1);
  doc.font("Helvetica").fillColor(C.muted).fontSize(9);
  if (client.billing_address) doc.text(client.billing_address, { width: contentWidth });
  const billCity = [client.billing_city, client.billing_state, client.billing_pin_code]
    .filter(Boolean)
    .join(", ");
  if (billCity) doc.text(billCity, { width: contentWidth });
  const taxParts: string[] = [];
  if (client.gstin) taxParts.push(`GSTIN: ${client.gstin}`);
  if (client.pan) taxParts.push(`PAN: ${client.pan}`);
  if (taxParts.length > 0) {
    doc.fillColor(C.ink).text(taxParts.join("    "), { width: contentWidth });
  }

  // ── Line items table ─────────────────────────────────────────────────
  doc.moveDown(0.8);
  drawLineItemsTable(doc, lineItems, contentWidth);

  // ── Totals ───────────────────────────────────────────────────────────
  doc.moveDown(0.6);
  drawTotalsBlock(doc, invoice, contentWidth);

  // ── Bank details (when set) ──────────────────────────────────────────
  if (bankAccount) {
    doc.moveDown(0.8);
    drawBankBlock(doc, bankAccount, contentWidth);
  }

  // ── Notes / terms ────────────────────────────────────────────────────
  const trailingTerms = (termsText ?? invoice.terms_and_conditions ?? "").trim();
  if (trailingTerms) {
    doc.moveDown(0.8);
    sectionLabel(doc, "Terms & Conditions");
    doc.moveDown(0.2);
    doc
      .font("Helvetica")
      .fillColor(C.muted)
      .fontSize(8.5)
      .text(trailingTerms, { width: contentWidth, lineGap: 2 });
  }
  if (invoice.notes && invoice.notes.trim() !== "") {
    doc.moveDown(0.5);
    sectionLabel(doc, "Notes");
    doc.moveDown(0.2);
    doc
      .font("Helvetica")
      .fillColor(C.muted)
      .fontSize(8.5)
      .text(invoice.notes.trim(), { width: contentWidth, lineGap: 2 });
  }

  // ── Signature ────────────────────────────────────────────────────────
  const sigY = doc.page.height - 60 - 56;
  const sigW = 200;
  const sigX = doc.page.width - PAGE_MARGIN_X - sigW;
  doc
    .save()
    .strokeColor(C.ink)
    .lineWidth(0.6)
    .moveTo(sigX, sigY + 28)
    .lineTo(sigX + sigW, sigY + 28)
    .stroke()
    .restore();
  doc
    .font("Helvetica-Bold")
    .fillColor(C.ink)
    .fontSize(9)
    .text("Authorised Signatory", sigX, sigY + 32, { width: sigW, align: "center" });
  doc
    .font("Helvetica")
    .fillColor(C.muted)
    .fontSize(8)
    .text(`for ${org.name}`, sigX, sigY + 44, { width: sigW, align: "center" });

  drawFooter(doc, `Invoice ${invoice.invoice_number} · ${org.name}`, 0, 1);

  return docToBuffer(doc);
}

// ─── Local helpers ────────────────────────────────────────────────────────

function drawLineItemsTable(
  doc: InstanceType<typeof import("pdfkit")>,
  lineItems: InvoiceLineItem[],
  contentWidth: number,
): void {
  const colDescW = contentWidth * 0.46;
  const colHsnW = contentWidth * 0.12;
  const colQtyW = contentWidth * 0.08;
  const colRateW = contentWidth * 0.17;
  const colAmtW = contentWidth * 0.17;

  const headerY = doc.y;
  const headerH = 22;
  doc
    .save()
    .rect(PAGE_MARGIN_X, headerY, contentWidth, headerH)
    .fill(C.bgMuted)
    .restore();
  doc
    .save()
    .strokeColor(C.border)
    .lineWidth(0.6)
    .rect(PAGE_MARGIN_X, headerY, contentWidth, headerH)
    .stroke()
    .restore();

  const headerTextY = headerY + 7;
  doc
    .font("Helvetica-Bold")
    .fillColor(C.ink)
    .fontSize(8.5);
  let cx = PAGE_MARGIN_X + 8;
  doc.text("Description", cx, headerTextY, { width: colDescW - 8 });
  cx += colDescW;
  doc.text("HSN/SAC", cx, headerTextY, { width: colHsnW });
  cx += colHsnW;
  doc.text("Qty", cx, headerTextY, { width: colQtyW, align: "right" });
  cx += colQtyW;
  doc.text("Rate", cx, headerTextY, { width: colRateW - 8, align: "right" });
  cx += colRateW;
  doc.text("Amount", cx, headerTextY, { width: colAmtW - 8, align: "right" });

  doc.y = headerY + headerH;

  doc.font("Helvetica").fillColor(C.ink).fontSize(9);
  for (const item of lineItems) {
    const rowY = doc.y;
    const rowH = 22;

    let cx2 = PAGE_MARGIN_X + 8;
    doc.text(item.description, cx2, rowY + 7, { width: colDescW - 16, ellipsis: true });
    cx2 = PAGE_MARGIN_X + colDescW;
    doc.text(item.hsn_sac_code || "—", cx2, rowY + 7, { width: colHsnW });
    cx2 += colHsnW;
    doc.text(String(item.quantity ?? 1), cx2, rowY + 7, { width: colQtyW, align: "right" });
    cx2 += colQtyW;
    doc.text(inr(item.rate_paise), cx2, rowY + 7, { width: colRateW - 8, align: "right" });
    cx2 += colRateW;
    doc.text(inr(item.amount_paise), cx2, rowY + 7, { width: colAmtW - 8, align: "right" });

    doc
      .save()
      .strokeColor(C.borderSoft)
      .lineWidth(0.6)
      .moveTo(PAGE_MARGIN_X, rowY + rowH)
      .lineTo(PAGE_MARGIN_X + contentWidth, rowY + rowH)
      .stroke()
      .restore();
    doc.y = rowY + rowH;
    doc.x = PAGE_MARGIN_X;
  }
}

function drawTotalsBlock(
  doc: InstanceType<typeof import("pdfkit")>,
  invoice: Invoice,
  contentWidth: number,
): void {
  const blockW = 240;
  const blockX = PAGE_MARGIN_X + contentWidth - blockW;
  const totalRows: Array<[string, string, boolean?]> = [
    ["Subtotal", inr(invoice.subtotal_paise)],
  ];
  if (invoice.cgst_paise > 0) totalRows.push(["CGST", inr(invoice.cgst_paise)]);
  if (invoice.sgst_paise > 0) totalRows.push(["SGST", inr(invoice.sgst_paise)]);
  if (invoice.igst_paise > 0) totalRows.push(["IGST", inr(invoice.igst_paise)]);
  totalRows.push(["Total", inr(invoice.total_paise), true]);
  if (invoice.amount_paid_paise > 0) {
    totalRows.push(["Paid", inr(invoice.amount_paid_paise)]);
    totalRows.push(["Balance Due", inr(invoice.balance_due_paise), true]);
  }

  let y = doc.y;
  for (const [label, value, emphasise] of totalRows) {
    const rowH = emphasise ? 22 : 18;
    if (emphasise) {
      doc
        .save()
        .rect(blockX, y, blockW, rowH)
        .fill(C.accentSoft)
        .restore();
    }
    doc
      .font(emphasise ? "Helvetica-Bold" : "Helvetica")
      .fillColor(emphasise ? C.accent : C.muted)
      .fontSize(emphasise ? 11 : 9.5);
    doc.text(label, blockX + 12, y + (rowH - (emphasise ? 11 : 9.5)) / 2, {
      width: blockW / 2,
    });
    doc
      .font(emphasise ? "Helvetica-Bold" : "Helvetica-Bold")
      .fillColor(emphasise ? C.accent : C.ink)
      .text(value, blockX + blockW / 2 - 12, y + (rowH - (emphasise ? 11 : 9.5)) / 2, {
        width: blockW / 2,
        align: "right",
      });
    y += rowH;
  }
  doc.y = y + 4;
  doc.x = PAGE_MARGIN_X;
}

function drawBankBlock(
  doc: InstanceType<typeof import("pdfkit")>,
  bank: Pick<
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
  >,
  contentWidth: number,
): void {
  sectionLabel(doc, "Bank details (for payment)");
  doc.moveDown(0.25);
  const startY = doc.y;
  doc
    .save()
    .roundedRect(PAGE_MARGIN_X, startY, contentWidth, 76, 4)
    .lineWidth(0.6)
    .strokeColor(C.border)
    .stroke()
    .restore();

  const padX = 14;
  const colW = (contentWidth - padX * 3) / 2;
  const colLeftX = PAGE_MARGIN_X + padX;
  const colRightX = colLeftX + colW + padX;
  let leftY = startY + 12;
  let rightY = startY + 12;

  const writeKv = (
    label: string,
    value: string | null | undefined,
    col: "left" | "right",
  ): void => {
    if (value == null || value === "") return;
    const x = col === "left" ? colLeftX : colRightX;
    const w = colW;
    const y = col === "left" ? leftY : rightY;
    doc
      .font("Helvetica")
      .fillColor(C.muted)
      .fontSize(8)
      .text(label.toUpperCase(), x, y, { width: w, characterSpacing: 0.6 });
    doc
      .font("Helvetica-Bold")
      .fillColor(C.ink)
      .fontSize(9.5)
      .text(value, x, doc.y, { width: w });
    if (col === "left") leftY = doc.y + 6;
    else rightY = doc.y + 6;
  };

  writeKv("Bank", bank.bank_name, "left");
  writeKv("Account holder", bank.account_holder_name, "right");
  writeKv("Account number", bank.account_number, "left");
  writeKv("IFSC", bank.ifsc_code, "right");
  if (bank.branch_name) writeKv("Branch", bank.branch_name, "left");
  if (bank.upi_id) writeKv("UPI", bank.upi_id, "right");
  if (bank.account_type) writeKv("Type", bank.account_type, "left");
  if (bank.swift_code) writeKv("SWIFT", bank.swift_code, "right");

  doc.y = startY + 84;
  doc.x = PAGE_MARGIN_X;
}
