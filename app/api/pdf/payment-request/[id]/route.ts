// GET /api/pdf/payment-request/[id]
// ────────────────────────────────
// Server-side render of the payment-request PDF using PDFKit. The
// previous attempt used @react-pdf/renderer, but its v4.5.x bundle
// pulls in @react-pdf/reconciler@2.0.0, which calls a React internal
// (the renamed `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`)
// that React 19 removed. Both client- and server-side rendering
// crashed with "Cannot read properties of undefined (reading 'S')".
// PDFKit is the engine react-pdf wraps anyway — going direct keeps
// the React layer out of the path entirely.

import { NextResponse } from "next/server";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { renderPaymentRequestPdf } from "@/lib/pdf/payment-request";
import type {
  Campaign,
  Site,
  SiteExpense,
  Organization,
} from "@/lib/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();
    if (!profile?.org_id) {
      return NextResponse.json({ error: "No organisation found" }, { status: 400 });
    }

    const [
      { data: expenseData },
      { data: orgData },
    ] = await Promise.all([
      supabase
        .from("site_expenses")
        .select(
          `*,
           site:sites(id, name, site_code, city, state),
           campaign:campaigns(id, campaign_name, campaign_code)`,
        )
        .eq("id", id)
        .is("deleted_at", null)
        .single(),
      supabase
        .from("organizations")
        .select("name, address, city, state, pin_code, gstin, pan, phone, email, logo_url")
        .eq("id", profile.org_id)
        .single(),
    ]);

    if (!expenseData) {
      return NextResponse.json({ error: "Payment request not found" }, { status: 404 });
    }
    if (!orgData) {
      return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
    }

    // Migration 040 added per-document T&C columns. Tolerate envs that
    // haven't applied it yet — the missing column would otherwise null
    // out the orgData fetch above.
    let paymentVoucherTerms: string | null = null;
    {
      const { data, error } = await supabase
        .from("organizations")
        .select("payment_voucher_terms_template")
        .eq("id", profile.org_id)
        .maybeSingle();
      if (!error && data) {
        paymentVoucherTerms = (data as { payment_voucher_terms_template?: string | null })
          .payment_voucher_terms_template ?? null;
      }
    }

    const expense = expenseData as unknown as SiteExpense & {
      site: Pick<Site, "id" | "name" | "site_code" | "city" | "state"> | null;
      campaign: Pick<Campaign, "id" | "campaign_name" | "campaign_code"> | null;
    };
    const org = orgData as Pick<
      Organization,
      "name" | "address" | "city" | "state" | "pin_code" | "gstin" | "pan" | "phone" | "email"
    > & { logo_url?: string | null };

    // Resolve creator/payer names for the audit line.
    const profileIds = [expense.created_by, expense.paid_by].filter(
      (v): v is string => !!v,
    );
    const profileMap: Record<string, string> = {};
    if (profileIds.length > 0) {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", profileIds);
      for (const p of data ?? []) {
        profileMap[p.id] = p.full_name ?? "—";
      }
    }

    let orgLogoSignedUrl: string | null = null;
    if (org.logo_url) {
      const { data: signed } = await supabase.storage
        .from("org-logos")
        .createSignedUrl(org.logo_url, 60 * 60);
      orgLogoSignedUrl = signed?.signedUrl ?? null;
    }

    const buffer = await renderPaymentRequestPdf({
      expense,
      org,
      orgLogoSignedUrl,
      site: expense.site ?? null,
      campaign: expense.campaign ?? null,
      createdByName: profileMap[expense.created_by ?? ""] ?? null,
      paidByName: profileMap[expense.paid_by ?? ""] ?? null,
      termsText: paymentVoucherTerms,
    });

    const shortId = id.slice(0, 8).toUpperCase();
    const filename = `PaymentRequest-${shortId}-${format(new Date(), "yyyyMMdd")}.pdf`;
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[pdf/payment-request] error:", err);
    const msg = err instanceof Error ? err.message : "PDF generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
