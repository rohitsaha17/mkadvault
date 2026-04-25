// PDFKit-based receipt voucher. Issued to a client when we receive a
// payment against an invoice. Distinct format from invoice / payment
// request — the document acknowledges the receipt, names the payer,
// the source invoice, the amount and method.

import {
  C,
  FONT_BODY,
  FONT_BOLD,
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
import { paymentModeLabel } from "@/lib/constants/expenses";
import type {
  Client,
  Invoice,
  PaymentReceived,
} from "@/lib/types/database";

export interface ReceiptVoucherPdfInput {
  payment: PaymentReceived;
  invoice: Pick<Invoice, "invoice_number" | "invoice_date" | "total_paise">;
  client: Pick<
    Client,
    | "company_name"
    | "brand_name"
    | "billing_address"
    | "billing_city"
    | "billing_state"
    | "billing_pin_code"
    | "gstin"
  >;
  org: LetterheadOrg;
  orgLogoSignedUrl?: string | null;
  receivedByName?: string | null;
  termsText?: string | null;
}

const PAID_PILL = {
  color: "#065F46",
  bg: "#D1FAE5",
  border: "#A7F3D0",
  label: "RECEIVED",
};

export async function renderReceiptVoucherPdf(
  input: ReceiptVoucherPdfInput,
): Promise<Buffer> {
  const { payment, invoice, client, org, receivedByName, termsText } = input;
  const doc = createDoc();
  const logoBytes = await fetchLogoBytes(input.orgLogoSignedUrl);

  // ── Letterhead ───────────────────────────────────────────────────────
  const meta: DocMeta = {
    label: "RECEIPT VOUCHER",
    number: payment.receipt_number ? `#${payment.receipt_number}` : `#${payment.id.slice(0, 8).toUpperCase()}`,
    dateLines: [["Received", fmtDate(payment.payment_date)]],
    status: PAID_PILL,
  };
  drawLetterhead(doc, org, meta, logoBytes);

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - PAGE_MARGIN_X * 2;

  // ── Acknowledgement line ─────────────────────────────────────────────
  // Paragraph that reads like a real receipt: "We acknowledge receipt of
  // X from Y on Z towards Invoice N." Compact, scannable.
  doc.moveDown(0.3);
  doc
    .font(FONT_BODY)
    .fillColor(C.ink)
    .fontSize(11)
    .text(
      `We hereby acknowledge receipt of ${inr(payment.amount_paise)} from ${client.company_name}` +
        (client.brand_name ? ` (${client.brand_name})` : "") +
        ` on ${fmtDate(payment.payment_date)} towards Invoice ${invoice.invoice_number} dated ${fmtDate(invoice.invoice_date)}.`,
      { width: contentWidth, lineGap: 3 },
    );

  // ── Payer (Bill From their side / Bill To from ours) ─────────────────
  doc.moveDown(0.6);
  sectionLabel(doc, "Received from");
  doc.moveDown(0.2);
  doc
    .font(FONT_BOLD)
    .fillColor(C.ink)
    .fontSize(11)
    .text(client.company_name + (client.brand_name ? `  •  ${client.brand_name}` : ""), {
      width: contentWidth,
    });
  doc.moveDown(0.1);
  doc.font(FONT_BODY).fillColor(C.muted).fontSize(9);
  if (client.billing_address) doc.text(client.billing_address, { width: contentWidth });
  const billCity = [client.billing_city, client.billing_state, client.billing_pin_code]
    .filter(Boolean)
    .join(", ");
  if (billCity) doc.text(billCity, { width: contentWidth });
  if (client.gstin) doc.fillColor(C.ink).text(`GSTIN: ${client.gstin}`, { width: contentWidth });

  // ── Payment details (mode / reference / etc.) ────────────────────────
  doc.moveDown(0.6);
  sectionLabel(doc, "Payment details");
  doc.moveDown(0.2);
  drawTwoColRow(doc, "Mode", paymentModeLabel(payment.payment_mode) ?? "—");
  if (payment.reference_number) {
    drawTwoColRow(doc, "Reference", payment.reference_number);
  }
  if (payment.bank_name) drawTwoColRow(doc, "Bank", payment.bank_name);
  if (payment.notes) {
    doc.moveDown(0.2);
    sectionLabel(doc, "Notes");
    doc.moveDown(0.2);
    doc.font(FONT_BODY).fillColor(C.muted).fontSize(9.5).text(payment.notes, { width: contentWidth });
  }

  // ── Amount callout ───────────────────────────────────────────────────
  doc.moveDown(0.8);
  const cardY = doc.y;
  const cardH = 56;
  doc
    .save()
    .roundedRect(PAGE_MARGIN_X, cardY, contentWidth, cardH, 4)
    .fill(C.accentSoft)
    .restore();
  doc
    .font(FONT_BOLD)
    .fillColor(C.accent)
    .fontSize(9)
    .text("AMOUNT RECEIVED", PAGE_MARGIN_X + 16, cardY + 14, {
      width: contentWidth - 32,
      characterSpacing: 0.6,
    });
  doc
    .font(FONT_BOLD)
    .fillColor(C.accent)
    .fontSize(22)
    .text(inr(payment.amount_paise), PAGE_MARGIN_X + 16, cardY + 26, {
      width: contentWidth - 32,
    });
  doc.y = cardY + cardH + 14;
  doc.x = PAGE_MARGIN_X;

  // ── Audit ────────────────────────────────────────────────────────────
  doc.moveDown(0.4);
  sectionLabel(doc, "Audit");
  doc.moveDown(0.2);
  doc
    .font(FONT_BODY)
    .fillColor(C.muted)
    .fontSize(9)
    .text(
      `Recorded on ${fmtDate(payment.created_at)}` +
        (receivedByName ? ` by ${receivedByName}` : "") +
        ".",
      { width: contentWidth },
    );

  // ── Terms ────────────────────────────────────────────────────────────
  if (termsText && termsText.trim() !== "") {
    doc.moveDown(0.6);
    sectionLabel(doc, "Terms & Conditions");
    doc.moveDown(0.2);
    doc
      .font(FONT_BODY)
      .fillColor(C.muted)
      .fontSize(8.5)
      .text(termsText.trim(), { width: contentWidth, lineGap: 2 });
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
    .font(FONT_BOLD)
    .fillColor(C.ink)
    .fontSize(9)
    .text("Authorised Signatory", sigX, sigY + 32, { width: sigW, align: "center" });
  doc
    .font(FONT_BODY)
    .fillColor(C.muted)
    .fontSize(8)
    .text(`for ${org.name}`, sigX, sigY + 44, { width: sigW, align: "center" });

  drawFooter(
    doc,
    `Receipt ${payment.receipt_number ?? payment.id.slice(0, 8).toUpperCase()} · ${org.name}`,
    0,
    1,
  );

  return docToBuffer(doc);
}

function drawTwoColRow(
  doc: InstanceType<typeof import("pdfkit")>,
  label: string,
  value: string | null | undefined,
): void {
  if (value === null || value === undefined || value === "") return;
  const labelW = 120;
  const startX = doc.x;
  const startY = doc.y;
  doc
    .font(FONT_BOLD)
    .fillColor(C.muted)
    .fontSize(8.5)
    .text(label.toUpperCase(), startX, startY, { width: labelW, characterSpacing: 0.5 });
  doc
    .font(FONT_BOLD)
    .fillColor(C.ink)
    .fontSize(10)
    .text(value, startX + labelW + 4, startY, {
      width: doc.page.width - PAGE_MARGIN_X * 2 - labelW - 4,
    });
  doc.x = startX;
  doc.moveDown(0.15);
}
