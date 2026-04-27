// GET /api/pdf/invoice/[id]
// ─────────────────────────
// PDFKit-based invoice PDF. Same approach as /api/pdf/payment-request:
// @react-pdf/renderer is broken under React 19, so we render directly
// with PDFKit on the server.

import { NextResponse } from "next/server";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import type {
  Invoice,
  InvoiceLineItem,
  Client,
  Organization,
  OrganizationBankAccount,
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
      { data: invoiceData },
      { data: lineItemsData },
      { data: orgData },
    ] = await Promise.all([
      // Defense in depth: scope to caller's org explicitly. See the
      // payment-request PDF route for the rationale.
      supabase
        .from("invoices")
        .select(
          `*,
           client:clients(company_name, brand_name, billing_address, billing_city, billing_state, billing_pin_code, gstin, pan)`,
        )
        .eq("id", id)
        .eq("organization_id", profile.org_id)
        .is("deleted_at", null)
        .single(),
      supabase
        .from("invoice_line_items")
        .select("*")
        .eq("invoice_id", id)
        .eq("organization_id", profile.org_id)
        .order("created_at", { ascending: true }),
      supabase
        .from("organizations")
        .select("name, address, city, state, pin_code, gstin, pan, phone, email, logo_url")
        .eq("id", profile.org_id)
        .single(),
    ]);

    if (!invoiceData) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (!orgData) {
      return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
    }

    // Per-doc T&C — see payment-request route for the rationale.
    let invoiceTerms: string | null = null;
    {
      const { data, error } = await supabase
        .from("organizations")
        .select("invoice_terms_template")
        .eq("id", profile.org_id)
        .maybeSingle();
      if (!error && data) {
        invoiceTerms = (data as { invoice_terms_template?: string | null })
          .invoice_terms_template ?? null;
      }
    }

    const invoice = invoiceData as unknown as Invoice & {
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
      > | null;
    };
    if (!invoice.client) {
      return NextResponse.json({ error: "Invoice client missing" }, { status: 400 });
    }
    const lineItems = (lineItemsData ?? []) as unknown as InvoiceLineItem[];
    const org = orgData as Pick<
      Organization,
      "name" | "address" | "city" | "state" | "pin_code" | "gstin" | "pan" | "phone" | "email"
    > & { logo_url?: string | null };

    let bankAccount:
      | Pick<
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
        >
      | null = null;
    if (invoice.bank_account_id) {
      const { data } = await supabase
        .from("organization_bank_accounts")
        .select(
          "label, bank_name, account_holder_name, account_number, ifsc_code, branch_name, account_type, upi_id, swift_code",
        )
        .eq("id", invoice.bank_account_id)
        .maybeSingle();
      bankAccount = (data ?? null) as typeof bankAccount;
    }

    let orgLogoSignedUrl: string | null = null;
    if (org.logo_url) {
      const { data: signed } = await supabase.storage
        .from("org-logos")
        .createSignedUrl(org.logo_url, 60 * 60);
      orgLogoSignedUrl = signed?.signedUrl ?? null;
    }

    const buffer = await renderInvoicePdf({
      invoice,
      lineItems,
      client: invoice.client,
      org,
      orgLogoSignedUrl,
      bankAccount,
      termsText: invoiceTerms,
    });

    const filename = `Invoice-${invoice.invoice_number || id.slice(0, 8)}-${format(new Date(), "yyyyMMdd")}.pdf`;
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[pdf/invoice] error:", err);
    const msg = err instanceof Error ? err.message : "PDF generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
