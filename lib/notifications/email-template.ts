// Branded email HTML wrapper. Header carries the org logo + name
// (when set in settings), the footer carries GSTIN / PAN / phone /
// email so the recipient knows which entity the mail is from.
//
// The dispatcher fetches the org row + a signed logo URL once per
// batch and reuses it across every email so we don't hammer storage
// for each recipient.

import type { Severity } from "./types";

export interface BrandInfo {
  name: string;
  logoUrl: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pin_code: string | null;
  gstin: string | null;
  pan: string | null;
  phone: string | null;
  email: string | null;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const SEVERITY_COLOR: Record<Severity, string> = {
  info: "#1E3A8A",
  warning: "#D97706",
  critical: "#DC2626",
};

// HTML-escape user-controlled text. Cheap and exhaustive enough for
// email contexts — we never inject script or attributes from input.
function esc(s: string | number | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderEmailInput {
  brand: BrandInfo;
  severity: Severity;
  preheader: string; // shown next to the subject in some inbox previews
  title: string;
  // Pre-rendered HTML for the body block. Callers build their own
  // event-specific block (key-value table, paragraph, etc.) and pass
  // it in.
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
}

/**
 * Render the canonical branded email shell:
 *
 *   [colored brand bar — severity tint]
 *   [logo + org name]
 *   [title]
 *   [body block — caller-provided HTML]
 *   [CTA button — optional]
 *   [footer — GSTIN, PAN, phone, email, address]
 *
 * Returns plain HTML ready to hand to Resend.
 */
export function renderBrandedEmail(input: RenderEmailInput): string {
  const { brand, severity, preheader, title, bodyHtml, ctaText, ctaUrl } = input;
  const accent = SEVERITY_COLOR[severity];

  const logoBlock = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" width="44" height="44"
            style="display:block;border:0;border-radius:6px;object-fit:contain;background:#fff;" />`
    : "";

  const footerLine1 = [
    brand.address,
    [brand.city, brand.state, brand.pin_code].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
  const footerLine2 = [
    brand.gstin ? `GSTIN: ${brand.gstin}` : null,
    brand.pan ? `PAN: ${brand.pan}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const footerLine3 = [brand.phone, brand.email].filter(Boolean).join(" · ");

  const ctaBlock = ctaText && ctaUrl
    ? `
      <tr>
        <td style="padding:8px 32px 24px 32px;">
          <a href="${esc(ctaUrl)}" target="_blank"
             style="display:inline-block;padding:10px 18px;background:${accent};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">
            ${esc(ctaText)}
          </a>
        </td>
      </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Helvetica,Arial,sans-serif;color:#1e293b;">
  <!-- Hidden preheader text. Mailbox preview pulls this in. -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${esc(preheader)}
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;max-width:600px;">
        <tr><td style="background:${accent};padding:4px 0;"></td></tr>

        <tr>
          <td style="padding:24px 32px 0 32px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                ${logoBlock ? `<td valign="middle" style="padding-right:12px;">${logoBlock}</td>` : ""}
                <td valign="middle">
                  <p style="margin:0;font-size:14px;font-weight:700;color:#0F172A;">${esc(brand.name)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:18px 32px 8px 32px;">
            <h1 style="margin:0;font-size:20px;font-weight:700;color:#0F172A;line-height:1.3;">${esc(title)}</h1>
          </td>
        </tr>

        <tr>
          <td style="padding:0 32px 16px 32px;font-size:14px;color:#334155;line-height:1.55;">
            ${bodyHtml}
          </td>
        </tr>

        ${ctaBlock}

        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px 22px 32px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;line-height:1.55;">
            <p style="margin:0;font-weight:600;color:#334155;">${esc(brand.name)}</p>
            ${footerLine1 ? `<p style="margin:2px 0 0 0;">${esc(footerLine1)}</p>` : ""}
            ${footerLine2 ? `<p style="margin:2px 0 0 0;">${esc(footerLine2)}</p>` : ""}
            ${footerLine3 ? `<p style="margin:2px 0 0 0;">${esc(footerLine3)}</p>` : ""}
            <p style="margin:8px 0 0 0;color:#94a3b8;">
              You're receiving this because you have a notification preference enabled.
              Manage preferences in <a href="${esc(APP_URL)}/settings" style="color:#1E3A8A;text-decoration:none;">Settings</a>.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Convenience helper for the body block — render a small key/value
 * "details" card the same way every event template does. Most
 * notifications boil down to "headline + 2-4 facts + a link", and
 * keeping the markup centralised means the look stays consistent.
 */
export function renderDetailsList(
  rows: Array<{ label: string; value: string | number | null | undefined }>,
): string {
  const items = rows
    .filter((r) => r.value != null && r.value !== "")
    .map(
      (r) => `
        <tr>
          <td style="padding:6px 12px 6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;vertical-align:top;white-space:nowrap;">${esc(r.label)}</td>
          <td style="padding:6px 0;font-size:14px;color:#0F172A;font-weight:600;">${esc(r.value)}</td>
        </tr>`,
    )
    .join("");
  if (!items) return "";
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">
      ${items}
    </table>`;
}

export { esc as escapeHtml };
