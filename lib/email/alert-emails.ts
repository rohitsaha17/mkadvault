// Alert email templates — sent via Resend when an alert has email: true preference.
// Called from the cron job after alerts are inserted.
//
// Each function returns the Resend-compatible { subject, html } for one alert type.

import type { Alert } from "@/lib/types/database";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "OOH Platform";

// ─── Base HTML wrapper ────────────────────────────────────────────────────────

function emailBase({
  title,
  body,
  ctaText,
  ctaUrl,
  severityColor,
}: {
  title: string;
  body: string;
  ctaText?: string;
  ctaUrl?: string;
  severityColor: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Helvetica,Arial,sans-serif;color:#1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;max-width:600px;">
        <!-- Header bar -->
        <tr>
          <td style="background:${severityColor};padding:4px 0;"></td>
        </tr>
        <!-- Logo + app name -->
        <tr>
          <td style="padding:24px 32px 0 32px;">
            <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">${APP_NAME}</p>
          </td>
        </tr>
        <!-- Title -->
        <tr>
          <td style="padding:12px 32px 8px 32px;">
            <h1 style="margin:0;font-size:20px;font-weight:700;color:#1e293b;">${title}</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:8px 32px 24px 32px;">
            <p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">${body}</p>
          </td>
        </tr>
        ${ctaText && ctaUrl ? `
        <!-- CTA -->
        <tr>
          <td style="padding:0 32px 32px 32px;">
            <a href="${ctaUrl}" style="display:inline-block;background:#1d4ed8;color:#ffffff;font-size:14px;font-weight:600;padding:10px 20px;border-radius:6px;text-decoration:none;">${ctaText}</a>
          </td>
        </tr>` : ""}
        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #f1f5f9;">
            <p style="margin:0;font-size:11px;color:#94a3b8;">You received this because you have email alerts enabled. Manage preferences in ${APP_NAME} Settings.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function severityColor(severity: string): string {
  if (severity === "critical") return "#ef4444";
  if (severity === "warning") return "#f59e0b";
  return "#3b82f6";
}

// ─── Entity page URLs ─────────────────────────────────────────────────────────

function entityUrl(alert: Alert): string {
  const locale = "en";
  const base = `${APP_URL}/${locale}`;
  switch (alert.related_entity_type) {
    case "contract":
    case "contract_payment":
      return alert.related_entity_id ? `${base}/contracts/${alert.related_entity_id}` : `${base}/contracts`;
    case "campaign":
      return alert.related_entity_id ? `${base}/campaigns/${alert.related_entity_id}` : `${base}/campaigns`;
    case "invoice":
      return alert.related_entity_id ? `${base}/billing/invoices/${alert.related_entity_id}` : `${base}/billing/invoices`;
    case "site":
      return alert.related_entity_id ? `${base}/sites/${alert.related_entity_id}` : `${base}/sites`;
    default:
      return `${base}/notifications`;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface AlertEmailPayload {
  subject: string;
  html: string;
  ctaUrl: string;
}

export function buildAlertEmail(alert: Alert): AlertEmailPayload {
  const url = entityUrl(alert);
  const color = severityColor(alert.severity);

  // CTA label varies by entity type
  const ctaLabels: Record<string, string> = {
    contract: "View Contract",
    contract_payment: "View Payment",
    campaign: "View Campaign",
    invoice: "View Invoice",
    site: "View Site",
  };
  const ctaText = alert.related_entity_type ? (ctaLabels[alert.related_entity_type] ?? "View Details") : "View Details";

  const html = emailBase({
    title: alert.title,
    body: alert.message,
    ctaText,
    ctaUrl: url,
    severityColor: color,
  });

  return {
    subject: `[${APP_NAME}] ${alert.title}`,
    html,
    ctaUrl: url,
  };
}

// ─── Send a single alert email ────────────────────────────────────────────────
// Returns true if sent successfully.

export async function sendAlertEmail(
  alert: Alert,
  toEmail: string
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping email for alert", alert.id);
    return false;
  }

  const { subject, html } = buildAlertEmail(alert);
  const fromEmail = process.env.EMAIL_FROM ?? `alerts@${new URL(APP_URL).hostname}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${APP_NAME} <${fromEmail}>`,
        to: [toEmail],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[email] Resend error:", body);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[email] fetch error:", err);
    return false;
  }
}
