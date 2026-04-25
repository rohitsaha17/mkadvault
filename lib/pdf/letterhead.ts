// Shared PDFKit helpers for company letterhead + currency formatting.
// Used by every PDF route under /api/pdf/* — keeps the visual language
// consistent across invoices, payment requests, and future docs.
//
// Why PDFKit and not @react-pdf/renderer:
//   @react-pdf 4.5.x ships @react-pdf/reconciler@2.0.0, which reaches
//   into React internals that React 19 removed. Both client- and
//   server-side rendering crash with "Cannot read properties of
//   undefined (reading 'S')" the moment we try to render any document.
//   PDFKit is the same low-level engine react-pdf wraps — going direct
//   sidesteps the whole React layer.

import PDFDocument from "pdfkit";
import path from "node:path";

// Bundled Unicode TTF fonts. PDFKit's built-in Helvetica is WinAnsi-
// encoded and silently falls back to "1" for any glyph outside that
// range — the rupee sign ₹ (U+20B9) being the most common offender.
// Noto Sans covers Indian + global glyphs with two ~620 KB files.
//
// We resolve the path against process.cwd() so the same code works in
// dev (`pnpm dev` from project root) and in the Vercel runtime where
// node modules live alongside the .next output.
const FONT_DIR = path.join(process.cwd(), "lib", "pdf", "fonts");
const FONT_REGULAR_PATH = path.join(FONT_DIR, "NotoSans-Regular.ttf");
const FONT_BOLD_PATH = path.join(FONT_DIR, "NotoSans-Bold.ttf");

// Aliases used throughout the document modules. Switching to a
// different family is then a one-line change here.
export const FONT_BODY = "Body";
export const FONT_BOLD = "Body-Bold";

// ─── Brand palette (hex — PDFKit accepts hex/RGB) ─────────────────────────
export const C = {
  ink: "#0F172A", // primary text
  muted: "#64748B", // secondary text
  border: "#E2E8F0", // hairline rules
  borderSoft: "#F1F5F9", // soft separators
  bgMuted: "#F8FAFC", // table header / totals tint
  accent: "#1E3A8A", // navy brand bar
  accentSoft: "#EEF2FF", // accent-tinted callout backgrounds
  danger: "#DC2626",
  success: "#059669",
  warning: "#D97706",
} as const;

// Most boxes use these spacings. Keeping them as named constants makes
// it easy to nudge the whole layout in one place.
export const PAGE_MARGIN_X = 36;
export const PAGE_MARGIN_TOP = 36;
export const PAGE_MARGIN_BOTTOM = 60;

export interface LetterheadOrg {
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pin_code?: string | null;
  gstin?: string | null;
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface DocMeta {
  // The big right-aligned header label, e.g. "PAYMENT REQUEST".
  label: string;
  // Document number — printed below the label in mono.
  number?: string | null;
  // Pairs of label/value lines under the number, e.g.
  // [["Date", "20 Apr 2026"], ["Due", "30 Apr 2026"]].
  dateLines?: Array<[string, string]>;
  // Optional pill text + colour shown under the dates (status badge).
  status?: { label: string; color: string; bg: string; border: string } | null;
}

/**
 * Create an A4 PDFKit document configured with our standard margins,
 * default font, and a couple of helpers that PDFKit itself doesn't
 * expose neatly (line spacing, hairline rule, two-column grid).
 */
export function createDoc(): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({
    size: "A4",
    margins: {
      top: PAGE_MARGIN_TOP,
      bottom: PAGE_MARGIN_BOTTOM,
      left: PAGE_MARGIN_X,
      right: PAGE_MARGIN_X,
    },
    info: {
      Producer: "MK Ad Communication Service",
    },
    autoFirstPage: true,
  });
  // Register the Noto Sans TTFs as named fonts and set the regular
  // weight as the document default. Subsequent font(...) calls in
  // letterhead / document modules pass FONT_BODY or FONT_BOLD.
  doc.registerFont(FONT_BODY, FONT_REGULAR_PATH);
  doc.registerFont(FONT_BOLD, FONT_BOLD_PATH);
  doc.font(FONT_BODY);
  return doc;
}

/**
 * Pipe a PDFKit document to a Buffer. PDFKit is stream-based; this
 * helper resolves once the PDF has fully serialised.
 */
export function docToBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/**
 * Fetch the org logo bytes from a signed URL so PDFKit can embed them.
 * Returns null on any failure — the letterhead falls back to text-only.
 */
export async function fetchLogoBytes(
  signedUrl: string | null | undefined,
): Promise<Buffer | null> {
  if (!signedUrl) return null;
  try {
    const res = await fetch(signedUrl);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/**
 * Render the company letterhead at the top of the current page:
 *   - 6pt navy accent bar across the top edge
 *   - Logo (left) + org name + address + GSTIN/PAN/contact lines
 *   - Right-aligned doc label + number + dates + optional status pill
 *   - Hairline rule separating the head from the body
 *
 * Leaves the cursor below the rule so callers can `doc.y` straight
 * into their content.
 */
export function drawLetterhead(
  doc: InstanceType<typeof PDFDocument>,
  org: LetterheadOrg,
  meta: DocMeta,
  logoBytes: Buffer | null,
): void {
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - PAGE_MARGIN_X * 2;

  // ── Top accent bar (full bleed) ────────────────────────────────────────
  doc
    .save()
    .rect(0, 0, pageWidth, 6)
    .fill(C.accent)
    .restore();

  // Reset cursor below the bar.
  doc.y = 18;

  // ── Two-column header: company on left, doc meta on right ──────────────
  const leftW = contentWidth * 0.62;
  const rightW = contentWidth * 0.38;
  const leftX = PAGE_MARGIN_X;
  const rightX = PAGE_MARGIN_X + leftW;
  const topY = doc.y;

  // ── LEFT: logo + name + address block ──
  let cursorX = leftX;
  if (logoBytes) {
    try {
      doc.image(logoBytes, leftX, topY, {
        fit: [56, 56],
      });
      cursorX = leftX + 64; // 56 logo + 8 gap
    } catch {
      // Bad image (corrupt / unsupported MIME) — skip silently.
    }
  }
  const textX = cursorX;
  const textW = leftW - (cursorX - leftX);
  let cursorY = topY;

  // Org name
  doc
    .font(FONT_BOLD)
    .fillColor(C.ink)
    .fontSize(13)
    .text(org.name, textX, cursorY, { width: textW, lineGap: 2 });
  cursorY = doc.y + 2;

  // Address lines
  doc.font(FONT_BODY).fillColor(C.muted).fontSize(8.5);
  if (org.address) {
    doc.text(org.address, textX, cursorY, { width: textW });
    cursorY = doc.y;
  }
  const cityLine = [org.city, org.state, org.pin_code].filter(Boolean).join(", ");
  if (cityLine) {
    doc.text(cityLine, textX, cursorY, { width: textW });
    cursorY = doc.y;
  }

  // GSTIN / PAN — labelled, on their own line so they're scannable.
  const taxParts: string[] = [];
  if (org.gstin) taxParts.push(`GSTIN: ${org.gstin}`);
  if (org.pan) taxParts.push(`PAN: ${org.pan}`);
  if (taxParts.length > 0) {
    doc
      .fillColor(C.ink)
      .fontSize(8.5)
      .text(taxParts.join("    "), textX, cursorY, { width: textW });
    cursorY = doc.y;
    doc.fillColor(C.muted);
  }

  // Phone + email
  const contactParts: string[] = [];
  if (org.phone) contactParts.push(org.phone);
  if (org.email) contactParts.push(org.email);
  if (contactParts.length > 0) {
    doc.text(contactParts.join("    ·    "), textX, cursorY, { width: textW });
    cursorY = doc.y;
  }

  const leftBottom = cursorY;

  // ── RIGHT: doc label / number / dates / status ──
  doc
    .font(FONT_BOLD)
    .fillColor(C.accent)
    .fontSize(15)
    .text(meta.label, rightX, topY, {
      width: rightW,
      align: "right",
      characterSpacing: 1.2,
    });
  let rightCursorY = doc.y + 4;

  if (meta.number) {
    doc
      .font(FONT_BOLD)
      .fillColor(C.ink)
      .fontSize(10)
      .text(meta.number, rightX, rightCursorY, { width: rightW, align: "right" });
    rightCursorY = doc.y + 4;
  }

  if (meta.dateLines && meta.dateLines.length > 0) {
    doc.font(FONT_BODY).fillColor(C.muted).fontSize(8.5);
    for (const [label, value] of meta.dateLines) {
      doc.text(`${label}: ${value}`, rightX, rightCursorY, {
        width: rightW,
        align: "right",
      });
      rightCursorY = doc.y + 1;
    }
    rightCursorY += 3;
  }

  if (meta.status) {
    const pillText = meta.status.label;
    const pillH = 16;
    const pillFontSize = 8;
    doc.font(FONT_BOLD).fontSize(pillFontSize);
    const pillW = doc.widthOfString(pillText) + 16;
    const pillX = rightX + rightW - pillW;
    const pillY = rightCursorY;
    doc
      .save()
      .roundedRect(pillX, pillY, pillW, pillH, pillH / 2)
      .lineWidth(0.6)
      .strokeColor(meta.status.border)
      .fillAndStroke(meta.status.bg, meta.status.border)
      .restore();
    doc
      .fillColor(meta.status.color)
      .fontSize(pillFontSize)
      .text(pillText, pillX, pillY + (pillH - pillFontSize) / 2 - 0.5, {
        width: pillW,
        align: "center",
        characterSpacing: 1,
      });
    rightCursorY = pillY + pillH + 4;
  }

  const rightBottom = rightCursorY;

  // ── Hairline rule beneath the deeper of the two columns ────────────────
  const ruleY = Math.max(leftBottom, rightBottom) + 10;
  doc
    .save()
    .strokeColor(C.border)
    .lineWidth(0.6)
    .moveTo(PAGE_MARGIN_X, ruleY)
    .lineTo(pageWidth - PAGE_MARGIN_X, ruleY)
    .stroke()
    .restore();

  doc.y = ruleY + 14;
  doc.x = PAGE_MARGIN_X;
}

/**
 * Tiny uppercase section label with letter-spacing, used above each
 * content block. Caller is responsible for spacing above/below.
 */
export function sectionLabel(
  doc: InstanceType<typeof PDFDocument>,
  text: string,
): void {
  doc
    .font(FONT_BOLD)
    .fillColor(C.muted)
    .fontSize(8)
    .text(text.toUpperCase(), { characterSpacing: 0.8, lineGap: 2 });
  doc.fillColor(C.ink).font(FONT_BODY);
}

/**
 * Standard page footer — printed once per page in the bottom margin.
 * Pass the doc + a centre line of text. Page numbers are appended on
 * the right automatically.
 */
export function drawFooter(
  doc: InstanceType<typeof PDFDocument>,
  centerText: string,
  pageIndex: number,
  pageCount: number,
): void {
  const y = doc.page.height - PAGE_MARGIN_BOTTOM + 24;
  const w = doc.page.width - PAGE_MARGIN_X * 2;
  doc
    .save()
    .strokeColor(C.borderSoft)
    .lineWidth(0.6)
    .moveTo(PAGE_MARGIN_X, y - 6)
    .lineTo(PAGE_MARGIN_X + w, y - 6)
    .stroke()
    .restore();
  doc.font(FONT_BODY).fillColor(C.muted).fontSize(8);
  doc.text(centerText, PAGE_MARGIN_X, y, { width: w, align: "left" });
  doc.text(
    `Page ${pageIndex + 1} of ${pageCount}`,
    PAGE_MARGIN_X,
    y,
    { width: w, align: "right" },
  );
}

// ─── Currency / date helpers ──────────────────────────────────────────────

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export function inr(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  return inrFormatter.format(paise / 100);
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
