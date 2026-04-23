"use client";
// PPTX export using pptxgenjs — browser-side only, no SSR needed.
//
// This is the sole export format for proposals / rate cards (PDF was
// removed). Design principles applied in this rewrite:
//   • Typography bumped substantially — cover title 56pt, site headers
//     36pt, detail labels 14pt / values 22pt, so the deck reads cleanly
//     on a meeting-room projector.
//   • Organisation branding applied everywhere — logo on the cover,
//     every site slide, the contact slide; org name + city/state in the
//     cover and footer.
//   • Image handling unchanged — we pre-fetch every photo AND the
//     org logo into base64 data URIs so the slides embed the bytes,
//     not signed URL references that might 404 later.

import { useState } from "react";
import { Loader2, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inr } from "@/lib/utils";
import type { Proposal } from "@/lib/types/database";
import type { SiteForProposal } from "@/app/[locale]/(dashboard)/proposals/new/page";

interface Props {
  proposal: Proposal;
  sites: SiteForProposal[];
  org: {
    name: string;
    city?: string | null;
    state?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    gstin?: string | null;
  } | null;
  // 1-hour signed URL for the org logo. Fetched + embedded once on the
  // cover and every site slide so the resulting deck is self-contained.
  orgLogoUrl: string | null;
  filename: string;
}

// Brand colours — kept here rather than loose literals so tweaks are
// one-stop.
const BRAND_PRIMARY = "1e3a5f"; // deep navy, used for cover + contact slide bg
const BRAND_ACCENT = "2563eb"; // saturated blue, used for rate + accent bars
const BRAND_INK = "0f172a"; // body copy on light slides
const BRAND_MUTED = "64748b"; // labels, secondary text
const BRAND_LIGHT = "f1f5f9"; // soft background for terms slide
const BRAND_HAIRLINE = "cbd5e1"; // divider lines

function displayRate(paise: number | null, showRates: string): string {
  if (!paise || showRates === "hidden") return "—";
  if (showRates === "request_quote") return "Request Quote";
  if (showRates === "range") {
    const low = Math.round(paise * 0.8);
    const high = Math.round(paise * 1.2);
    return `${inr(low)} – ${inr(high)}`;
  }
  return inr(paise);
}

// Fetch a remote image and return it as a base64 data URI so pptxgenjs
// can embed the bytes directly. Returns null on failure so slides
// fall back gracefully instead of crashing the export.
async function urlToDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function ProposalPptxButton({
  proposal,
  sites,
  org,
  orgLogoUrl,
  filename,
}: Props) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const pptxgenjs = (await import("pptxgenjs")).default;
      const prs = new pptxgenjs();

      // Pre-fetch site photos + org logo in parallel so every slide
      // builds without a further network call.
      const photoUrls = sites
        .map((s) => s.primary_photo_url)
        .filter((u): u is string => !!u);
      const [photoData, logoData] = await Promise.all([
        Promise.all(photoUrls.map(urlToDataUri)),
        orgLogoUrl ? urlToDataUri(orgLogoUrl) : Promise.resolve(null),
      ]);
      const photoDataByUrl = new Map<string, string>();
      photoUrls.forEach((url, i) => {
        const data = photoData[i];
        if (data) photoDataByUrl.set(url, data);
      });

      prs.layout = "LAYOUT_WIDE"; // 13.333" × 7.5"
      prs.title = proposal.proposal_name;
      prs.author = org?.name ?? "";

      // ─── Slide 1 — Cover ─────────────────────────────────────────────
      const cover = prs.addSlide();
      cover.background = { color: BRAND_PRIMARY };

      // Subtle right-edge accent bar for brand personality.
      cover.addShape(prs.ShapeType.rect, {
        x: 12.75, y: 0, w: 0.58, h: 7.5, fill: { color: BRAND_ACCENT },
      });

      // Logo — top-left, generously sized (up to 1.8" square). Only
      // rendered when the org has actually uploaded one.
      if (logoData) {
        cover.addImage({
          data: logoData, x: 0.75, y: 0.75, w: 1.8, h: 1.8,
          sizing: { type: "contain", w: 1.8, h: 1.8 },
        });
      }

      if (proposal.include_company_branding && org?.name) {
        cover.addText(org.name.toUpperCase(), {
          x: 0.75, y: 2.8, w: 11.5, h: 0.5,
          fontSize: 20, color: BRAND_HAIRLINE, fontFace: "Calibri",
          bold: true, charSpacing: 4,
        });
      }

      cover.addText(proposal.proposal_name, {
        x: 0.75, y: 3.35, w: 11.5, h: 1.6,
        fontSize: 56, bold: true, color: "ffffff", fontFace: "Calibri",
        valign: "top",
      });

      if (proposal.custom_header_text) {
        cover.addText(proposal.custom_header_text, {
          x: 0.75, y: 5.1, w: 11.5, h: 0.7,
          fontSize: 22, color: BRAND_HAIRLINE, fontFace: "Calibri",
        });
      }

      // Footer-ish line at the bottom of the cover: site count + date +
      // (optional) city/state
      const coverMeta = [
        `${sites.length} Site${sites.length !== 1 ? "s" : ""}`,
        new Date().toLocaleDateString("en-IN", {
          day: "numeric", month: "long", year: "numeric",
        }),
        org?.city && org?.state ? `${org.city}, ${org.state}` : null,
      ]
        .filter(Boolean)
        .join("   •   ");

      cover.addText(coverMeta, {
        x: 0.75, y: 6.6, w: 11.5, h: 0.5,
        fontSize: 16, color: "94a3b8", fontFace: "Calibri",
      });

      // ─── Site slides ─────────────────────────────────────────────────
      for (const site of sites) {
        const slide = prs.addSlide();
        slide.background = { color: "ffffff" };

        // Thick accent bar at top
        slide.addShape(prs.ShapeType.rect, {
          x: 0, y: 0, w: "100%", h: 0.18, fill: { color: BRAND_ACCENT },
        });

        // Corner logo — small, top-right. Keeps every slide branded.
        if (logoData) {
          slide.addImage({
            data: logoData, x: 11.95, y: 0.35, w: 1, h: 1,
            sizing: { type: "contain", w: 1, h: 1 },
          });
        }

        // Site name (big)
        slide.addText(site.name, {
          x: 0.5, y: 0.4, w: 11.3, h: 0.95,
          fontSize: 36, bold: true, color: BRAND_INK, fontFace: "Calibri",
          valign: "top",
        });

        // City / state / address on one subtitle line
        const locationLine = [
          site.city,
          site.state,
          site.address,
        ]
          .filter(Boolean)
          .join("  •  ");
        if (locationLine) {
          slide.addText(locationLine, {
            x: 0.5, y: 1.32, w: 11.3, h: 0.5,
            fontSize: 18, color: BRAND_MUTED, fontFace: "Calibri",
          });
        }

        // Rate ribbon (bottom-right of image or free-standing)
        const rateText = displayRate(site.base_rate_paise, proposal.show_rates);
        const hasRateBadge = proposal.show_rates !== "hidden";

        // Photo area — 8.4" × 5" wide panel on the left.
        const photoData = site.primary_photo_url
          ? photoDataByUrl.get(site.primary_photo_url)
          : null;
        const hasPhoto = proposal.show_photos && !!photoData;

        if (hasPhoto && photoData) {
          slide.addImage({
            data: photoData,
            x: 0.5, y: 1.95, w: 8.4, h: 5,
            sizing: { type: "contain", w: 8.4, h: 5 },
          });
        } else {
          // Empty-photo placeholder so the slide still looks intentional.
          slide.addShape(prs.ShapeType.rect, {
            x: 0.5, y: 1.95, w: 8.4, h: 5,
            fill: { color: BRAND_LIGHT },
            line: { color: BRAND_HAIRLINE, width: 1 },
          });
          slide.addText("Photo pending", {
            x: 0.5, y: 4.25, w: 8.4, h: 0.5,
            fontSize: 16, color: BRAND_MUTED, align: "center",
            fontFace: "Calibri",
          });
        }

        // Rate chip — placed at the top of the details column
        const detailX = hasPhoto ? 9.1 : 0.5;
        const detailW = hasPhoto ? 3.85 : 12.3;

        if (hasRateBadge) {
          slide.addShape(prs.ShapeType.roundRect, {
            x: detailX, y: 1.95, w: detailW, h: 1.1,
            fill: { color: BRAND_PRIMARY },
            line: { color: BRAND_PRIMARY, width: 0 },
            rectRadius: 0.08,
          });
          slide.addText("MONTHLY RATE", {
            x: detailX + 0.15, y: 2.05, w: detailW - 0.3, h: 0.3,
            fontSize: 11, color: "a5b4fc", fontFace: "Calibri",
            bold: true, charSpacing: 3,
          });
          slide.addText(
            rateText + (proposal.show_rates === "request_quote" ? "" : " / mo"),
            {
              x: detailX + 0.15, y: 2.35, w: detailW - 0.3, h: 0.6,
              fontSize: 22, bold: true, color: "ffffff",
              fontFace: "Calibri", valign: "top",
            },
          );
        }

        // Details list — starts under the rate chip (or at top if no rate)
        const detailsStartY = hasRateBadge ? 3.2 : 1.95;
        const details: { label: string; value: string }[] = [
          { label: "Media Type", value: site.media_type?.replace(/_/g, " ") ?? "—" },
        ];
        if (proposal.show_dimensions) {
          details.push({
            label: "Dimensions",
            value:
              site.width_ft && site.height_ft
                ? `${site.width_ft} × ${site.height_ft} ft`
                : "—",
          });
        }
        if (proposal.show_illumination) {
          details.push({ label: "Illumination", value: site.illumination ?? "—" });
        }
        if (proposal.show_traffic_info) {
          details.push({ label: "Facing", value: site.facing ?? "—" });
          if (site.visibility_distance_m) {
            details.push({
              label: "Visibility",
              value: `${site.visibility_distance_m}m`,
            });
          }
        }
        if (proposal.show_availability) {
          details.push({ label: "Status", value: site.status });
        }

        details.forEach((d, i) => {
          const yPos = detailsStartY + i * 0.75;
          slide.addText(d.label.toUpperCase(), {
            x: detailX, y: yPos, w: detailW, h: 0.25,
            fontSize: 11, color: BRAND_MUTED, fontFace: "Calibri",
            bold: true, charSpacing: 2,
          });
          slide.addText(d.value, {
            x: detailX, y: yPos + 0.25, w: detailW, h: 0.45,
            fontSize: 18, bold: true, color: BRAND_INK, fontFace: "Calibri",
            valign: "top",
          });
        });

        // Footer — org name + optional custom footer text
        const footerParts: string[] = [];
        if (org?.name) footerParts.push(org.name);
        if (proposal.custom_footer_text) footerParts.push(proposal.custom_footer_text);
        if (footerParts.length > 0) {
          slide.addText(footerParts.join("   •   "), {
            x: 0, y: 7.15, w: "100%", h: 0.3,
            fontSize: 10, color: BRAND_MUTED, align: "center",
            fontFace: "Calibri",
          });
        }
      }

      // ─── Terms slide ─────────────────────────────────────────────────
      if (proposal.include_terms && proposal.terms_text) {
        const termsSlide = prs.addSlide();
        termsSlide.background = { color: BRAND_LIGHT };

        termsSlide.addShape(prs.ShapeType.rect, {
          x: 0, y: 0, w: "100%", h: 0.18, fill: { color: BRAND_ACCENT },
        });

        if (logoData) {
          termsSlide.addImage({
            data: logoData, x: 11.95, y: 0.35, w: 1, h: 1,
            sizing: { type: "contain", w: 1, h: 1 },
          });
        }

        termsSlide.addText("Terms & Conditions", {
          x: 0.5, y: 0.5, w: 11, h: 0.85,
          fontSize: 36, bold: true, color: BRAND_PRIMARY, fontFace: "Calibri",
        });

        termsSlide.addShape(prs.ShapeType.line, {
          x: 0.5, y: 1.5, w: 12.3, h: 0,
          line: { color: BRAND_HAIRLINE, width: 1 },
        });

        termsSlide.addText(proposal.terms_text, {
          x: 0.5, y: 1.8, w: 12.3, h: 5.2,
          fontSize: 14, color: "334155", fontFace: "Calibri",
          valign: "top", wrap: true,
        });
      }

      // ─── Contact slide ───────────────────────────────────────────────
      if (proposal.include_contact_details && org) {
        const contactSlide = prs.addSlide();
        contactSlide.background = { color: BRAND_PRIMARY };

        // Large centered logo when present
        if (logoData) {
          contactSlide.addImage({
            data: logoData, x: 5.67, y: 0.6, w: 2, h: 2,
            sizing: { type: "contain", w: 2, h: 2 },
          });
        }

        contactSlide.addText("Get in Touch", {
          x: 1, y: 2.8, w: 11.3, h: 0.9,
          fontSize: 44, bold: true, color: "ffffff",
          align: "center", fontFace: "Calibri",
        });

        contactSlide.addText(org.name, {
          x: 1, y: 3.85, w: 11.3, h: 0.6,
          fontSize: 24, color: BRAND_HAIRLINE,
          align: "center", fontFace: "Calibri",
        });

        // Stack contact details on separate rows for readability rather
        // than cramming on one line (the previous version did).
        const rows: string[] = [];
        if (org.phone) rows.push(`Phone   ${org.phone}`);
        if (org.email) rows.push(`Email   ${org.email}`);
        if (org.address) rows.push(`Address   ${org.address}`);
        if (org.city && org.state && !org.address) {
          rows.push(`Location   ${org.city}, ${org.state}`);
        }
        if (org.gstin) rows.push(`GSTIN   ${org.gstin}`);

        rows.forEach((row, i) => {
          contactSlide.addText(row, {
            x: 1, y: 4.8 + i * 0.5, w: 11.3, h: 0.45,
            fontSize: 18, color: "e2e8f0",
            align: "center", fontFace: "Calibri",
          });
        });
      }

      await prs.writeFile({ fileName: filename });
    } catch (err) {
      console.error("PPTX generation failed:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleDownload} disabled={loading}>
      {loading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Presentation className="h-4 w-4 mr-2" />
      )}
      {loading ? "Generating PPTX…" : "Download PPTX"}
    </Button>
  );
}
