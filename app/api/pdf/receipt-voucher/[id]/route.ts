// GET /api/pdf/receipt-voucher/[id]
// ─────────────────────────────────
// Generates a receipt voucher PDF for a single payments_received row.
// Gated to finance / accounts / admin / super_admin — anyone else just
// gets a 403 instead of the PDF (the row may be readable to them via
// RLS but issuing the printable acknowledgement is an admin task).

import { NextResponse } from "next/server";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { renderReceiptVoucherPdf } from "@/lib/pdf/receipt-voucher";
import type {
  Client,
  Invoice,
  Organization,
  PaymentReceived,
} from "@/lib/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["super_admin", "admin", "accounts", "finance"]);

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
      .select("org_id, role, roles, full_name")
      .eq("id", user.id)
      .single();
    if (!profile?.org_id) {
      return NextResponse.json({ error: "No organisation found" }, { status: 400 });
    }

    // Multi-role aware check (migration 020 introduced roles[]).
    const rolesArr: string[] =
      Array.isArray((profile as { roles?: string[] }).roles) &&
      ((profile as { roles?: string[] }).roles?.length ?? 0) > 0
        ? ((profile as { roles?: string[] }).roles as string[])
        : profile.role
          ? [profile.role as string]
          : [];
    const allowed = rolesArr.some((r) => ALLOWED_ROLES.has(r));
    if (!allowed) {
      return NextResponse.json(
        { error: "Only finance / accounts / admin can issue receipt vouchers." },
        { status: 403 },
      );
    }

    const [
      { data: paymentData },
      { data: orgData },
    ] = await Promise.all([
      supabase
        .from("payments_received")
        .select(
          `*,
           invoice:invoices(invoice_number, invoice_date, total_paise),
           client:clients(company_name, brand_name, billing_address, billing_city, billing_state, billing_pin_code, gstin)`,
        )
        .eq("id", id)
        .single(),
      supabase
        .from("organizations")
        .select("name, address, city, state, pin_code, gstin, pan, phone, email, logo_url")
        .eq("id", profile.org_id)
        .single(),
    ]);

    if (!paymentData) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    if (!orgData) {
      return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
    }

    // Per-doc T&C — see the other PDF routes for the rationale on the
    // separate query.
    let receiptTerms: string | null = null;
    {
      const { data, error } = await supabase
        .from("organizations")
        .select("receipt_voucher_terms_template")
        .eq("id", profile.org_id)
        .maybeSingle();
      if (!error && data) {
        receiptTerms = (data as { receipt_voucher_terms_template?: string | null })
          .receipt_voucher_terms_template ?? null;
      }
    }

    const payment = paymentData as unknown as PaymentReceived & {
      invoice: Pick<Invoice, "invoice_number" | "invoice_date" | "total_paise"> | null;
      client: Pick<
        Client,
        | "company_name"
        | "brand_name"
        | "billing_address"
        | "billing_city"
        | "billing_state"
        | "billing_pin_code"
        | "gstin"
      > | null;
    };

    if (!payment.invoice || !payment.client) {
      return NextResponse.json(
        { error: "Payment is missing its invoice or client link." },
        { status: 400 },
      );
    }

    const org = orgData as Pick<
      Organization,
      "name" | "address" | "city" | "state" | "pin_code" | "gstin" | "pan" | "phone" | "email"
    > & { logo_url?: string | null };

    let orgLogoSignedUrl: string | null = null;
    if (org.logo_url) {
      const { data: signed } = await supabase.storage
        .from("org-logos")
        .createSignedUrl(org.logo_url, 60 * 60);
      orgLogoSignedUrl = signed?.signedUrl ?? null;
    }

    const buffer = await renderReceiptVoucherPdf({
      payment,
      invoice: payment.invoice,
      client: payment.client,
      org,
      orgLogoSignedUrl,
      receivedByName: (profile as { full_name?: string | null }).full_name ?? null,
      termsText: receiptTerms,
    });

    const tag = payment.receipt_number ?? id.slice(0, 8).toUpperCase();
    const filename = `Receipt-${tag}-${format(new Date(), "yyyyMMdd")}.pdf`;
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[pdf/receipt-voucher] error:", err);
    const msg = err instanceof Error ? err.message : "PDF generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
