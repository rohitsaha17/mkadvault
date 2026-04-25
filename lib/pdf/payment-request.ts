// Render a payment-request PDF with PDFKit. See ./letterhead.ts for
// the rationale on not using @react-pdf/renderer.

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
import { expenseCategoryLabel, paymentModeLabel } from "@/lib/constants/expenses";
import type {
  Campaign,
  Site,
  SiteExpense,
} from "@/lib/types/database";

export interface PaymentRequestPdfInput {
  expense: SiteExpense;
  org: LetterheadOrg;
  orgLogoSignedUrl?: string | null;
  site?: Pick<Site, "id" | "name" | "site_code" | "city" | "state"> | null;
  campaign?: Pick<Campaign, "id" | "campaign_name" | "campaign_code"> | null;
  createdByName?: string | null;
  paidByName?: string | null;
  termsText?: string | null;
}

// Status pill colour map — mirrors the badge colours in the web UI so
// the PDF and on-screen views feel like the same document.
const STATUS_PILL: Record<
  string,
  { color: string; bg: string; border: string; label: string }
> = {
  pending:  { color: "#92400E", bg: "#FEF3C7", border: "#FDE68A", label: "PENDING" },
  approved: { color: "#1E40AF", bg: "#DBEAFE", border: "#BFDBFE", label: "APPROVED" },
  paid:     { color: "#065F46", bg: "#D1FAE5", border: "#A7F3D0", label: "PAID" },
  rejected: { color: "#991B1B", bg: "#FEE2E2", border: "#FECACA", label: "REJECTED" },
};

export async function renderPaymentRequestPdf(
  input: PaymentRequestPdfInput,
): Promise<Buffer> {
  const { expense, org, site, campaign, createdByName, paidByName, termsText } = input;
  const doc = createDoc();
  const logoBytes = await fetchLogoBytes(input.orgLogoSignedUrl);

  // ── Letterhead ───────────────────────────────────────────────────────
  const status = STATUS_PILL[expense.status] ?? STATUS_PILL.pending;
  const meta: DocMeta = {
    label: "PAYMENT REQUEST",
    number: `#${expense.id.slice(0, 8).toUpperCase()}`,
    dateLines: [
      ["Raised", fmtDate(expense.created_at)],
      ...(expense.needed_by ? [["Needed by", fmtDate(expense.needed_by)] as [string, string]] : []),
      ...(expense.paid_at ? [["Paid on", fmtDate(expense.paid_at)] as [string, string]] : []),
    ],
    status,
  };
  drawLetterhead(doc, org, meta, logoBytes);

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - PAGE_MARGIN_X * 2;

  // ── Description / category ───────────────────────────────────────────
  sectionLabel(doc, "Request");
  doc.moveDown(0.2);
  drawTwoColRow(doc, "Category", expenseCategoryLabel(expense.category));
  drawTwoColRow(doc, "Status", status.label, status.color);
  drawFullRow(doc, "Description", expense.description);
  if (expense.notes) drawFullRow(doc, "Internal notes", expense.notes);

  // ── Linked records ───────────────────────────────────────────────────
  if (site || campaign) {
    doc.moveDown(0.5);
    sectionLabel(doc, "Linked records");
    doc.moveDown(0.2);
    if (site) {
      const code = [site.site_code, site.city, site.state].filter(Boolean).join(" · ");
      drawFullRow(doc, "Site", `${site.name}${code ? ` (${code})` : ""}`);
    }
    if (campaign) {
      drawFullRow(
        doc,
        "Campaign",
        `${campaign.campaign_name}${campaign.campaign_code ? ` (${campaign.campaign_code})` : ""}`,
      );
    }
  }

  // ── Amount callout ───────────────────────────────────────────────────
  doc.moveDown(0.6);
  const tds = expense.tds_paise ?? 0;
  const net = expense.amount_paise - tds;
  const cardY = doc.y;
  const cardH = tds > 0 ? 56 : 44;
  doc
    .save()
    .roundedRect(PAGE_MARGIN_X, cardY, contentWidth, cardH, 4)
    .fill(C.accentSoft)
    .restore();
  doc
    .font("Helvetica-Bold")
    .fillColor(C.accent)
    .fontSize(9)
    .text("AMOUNT REQUESTED", PAGE_MARGIN_X + 16, cardY + 12, {
      width: contentWidth - 32,
      characterSpacing: 0.6,
    });
  doc
    .font("Helvetica-Bold")
    .fillColor(C.accent)
    .fontSize(20)
    .text(inr(expense.amount_paise), PAGE_MARGIN_X + 16, cardY + 24, {
      width: contentWidth - 32,
      align: "left",
    });
  if (tds > 0) {
    doc
      .font("Helvetica")
      .fillColor(C.muted)
      .fontSize(8.5)
      .text(
        `Net payable after TDS (${inr(tds)}): ${inr(net)}`,
        PAGE_MARGIN_X + 16,
        cardY + cardH - 14,
        { width: contentWidth - 32 },
      );
  }
  doc.y = cardY + cardH + 14;
  doc.x = PAGE_MARGIN_X;

  // ── Payee ────────────────────────────────────────────────────────────
  sectionLabel(doc, "Pay to");
  doc.moveDown(0.2);
  drawTwoColRow(doc, "Name", expense.payee_name);
  drawTwoColRow(doc, "Type", capitalize(expense.payee_type));
  if (expense.payee_contact) drawTwoColRow(doc, "Contact", expense.payee_contact);
  if (expense.payee_bank_details) {
    for (const [k, v] of Object.entries(expense.payee_bank_details)) {
      if (v == null || v === "") continue;
      drawTwoColRow(doc, k.replace(/_/g, " "), String(v), C.ink, "Courier-Bold");
    }
  }

  // ── Settlement (only when paid) ──────────────────────────────────────
  if (expense.status === "paid") {
    doc.moveDown(0.6);
    sectionLabel(doc, "Settlement");
    doc.moveDown(0.2);
    drawTwoColRow(doc, "Paid on", fmtDate(expense.paid_at));
    drawTwoColRow(doc, "Mode", paymentModeLabel(expense.payment_mode) ?? "—");
    if (expense.payment_reference) {
      drawTwoColRow(doc, "Reference", expense.payment_reference, C.ink, "Courier-Bold");
    }
    if (paidByName) drawTwoColRow(doc, "Paid by", paidByName);
  }

  // ── Audit ────────────────────────────────────────────────────────────
  doc.moveDown(0.6);
  sectionLabel(doc, "Audit");
  doc.moveDown(0.2);
  doc
    .font("Helvetica")
    .fillColor(C.muted)
    .fontSize(9)
    .text(
      `Raised on ${fmtDate(expense.created_at)}${createdByName ? ` by ${createdByName}` : ""}. ` +
        `Last updated ${fmtDate(expense.updated_at)}.`,
      { width: contentWidth },
    );

  // ── Terms & Conditions ───────────────────────────────────────────────
  if (termsText && termsText.trim() !== "") {
    doc.moveDown(0.8);
    sectionLabel(doc, "Terms & Conditions");
    doc.moveDown(0.2);
    doc
      .font("Helvetica")
      .fillColor(C.muted)
      .fontSize(8.5)
      .text(termsText.trim(), { width: contentWidth, lineGap: 2 });
  }

  // ── Signature block ──────────────────────────────────────────────────
  // Pinned to the bottom of the page rather than flowing inline, so the
  // signature line always sits in the same place visually.
  const sigY = doc.page.height - 60 - 56;
  const sigW = 180;
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
    .text("Authorised Signatory", sigX, sigY + 32, {
      width: sigW,
      align: "center",
    });
  doc
    .font("Helvetica")
    .fillColor(C.muted)
    .fontSize(8)
    .text(`for ${org.name}`, sigX, sigY + 44, { width: sigW, align: "center" });

  // ── Footer ───────────────────────────────────────────────────────────
  drawFooter(
    doc,
    `Payment Request #${expense.id.slice(0, 8).toUpperCase()} · ${org.name}`,
    0,
    1,
  );

  return docToBuffer(doc);
}

// ─── Tiny layout helpers (kept local — not generic enough for letterhead.ts)

function drawTwoColRow(
  doc: InstanceType<typeof import("pdfkit")>,
  label: string,
  value: string | null | undefined,
  valueColor: string = C.ink,
  valueFont: string = "Helvetica-Bold",
): void {
  if (value === null || value === undefined || value === "") return;
  const labelW = 120;
  const startX = doc.x;
  const startY = doc.y;
  doc
    .font("Helvetica-Bold")
    .fillColor(C.muted)
    .fontSize(8.5)
    .text(label.toUpperCase(), startX, startY, {
      width: labelW,
      characterSpacing: 0.5,
    });
  // Reset y for the value column.
  doc
    .font(valueFont)
    .fillColor(valueColor)
    .fontSize(10)
    .text(value, startX + labelW + 4, startY, {
      width: doc.page.width - PAGE_MARGIN_X * 2 - labelW - 4,
    });
  // Take whichever cursor advanced further.
  doc.x = startX;
  doc.moveDown(0.15);
}

function drawFullRow(
  doc: InstanceType<typeof import("pdfkit")>,
  label: string,
  value: string,
): void {
  if (!value) return;
  const startX = doc.x;
  const w = doc.page.width - PAGE_MARGIN_X * 2;
  doc
    .font("Helvetica-Bold")
    .fillColor(C.muted)
    .fontSize(8.5)
    .text(label.toUpperCase(), startX, doc.y, {
      width: w,
      characterSpacing: 0.5,
    });
  doc.fontSize(10).fillColor(C.ink).font("Helvetica").text(value, startX, doc.y, {
    width: w,
    lineGap: 1,
  });
  doc.moveDown(0.25);
}

function capitalize(v: string): string {
  if (!v) return v;
  return v.charAt(0).toUpperCase() + v.slice(1);
}
