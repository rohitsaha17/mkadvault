"use client";
// PPTX export using pptxgenjs — browser-side only, no SSR needed
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
  } | null;
  filename: string;
}

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

export function ProposalPptxButton({ proposal, sites, org, filename }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      // Dynamic import so pptxgenjs is never bundled server-side
      const pptxgenjs = (await import("pptxgenjs")).default;
      const prs = new pptxgenjs();

      prs.layout = "LAYOUT_WIDE";
      prs.title = proposal.proposal_name;
      prs.author = org?.name ?? "";

      // ── Slide 1: Cover ────────────────────────────────────────────────────
      const cover = prs.addSlide();
      cover.background = { color: "1e3a5f" };

      if (proposal.include_company_branding && org?.name) {
        cover.addText(org.name, {
          x: 1, y: 1, w: 11, h: 0.5,
          fontSize: 14, color: "94a3b8", align: "center", fontFace: "Calibri",
        });
      }

      cover.addText(proposal.proposal_name, {
        x: 1, y: 2, w: 11, h: 1,
        fontSize: 32, bold: true, color: "ffffff", align: "center", fontFace: "Calibri",
      });

      if (proposal.custom_header_text) {
        cover.addText(proposal.custom_header_text, {
          x: 1, y: 3.2, w: 11, h: 0.5,
          fontSize: 12, color: "cbd5e1", align: "center", fontFace: "Calibri",
        });
      }

      cover.addText(`${sites.length} Site${sites.length !== 1 ? "s" : ""} • ${new Date().toLocaleDateString("en-IN")}`, {
        x: 1, y: 4.2, w: 11, h: 0.4,
        fontSize: 11, color: "64748b", align: "center", fontFace: "Calibri",
      });

      // ── Slides: Sites ──────────────────────────────────────────────────────
      for (const site of sites) {
        const slide = prs.addSlide();
        slide.background = { color: "ffffff" };

        // Accent bar at top
        slide.addShape(prs.ShapeType.rect, {
          x: 0, y: 0, w: "100%", h: 0.12, fill: { color: "1d4ed8" },
        });

        // Site name
        slide.addText(site.name, {
          x: 0.4, y: 0.3, w: 8, h: 0.6,
          fontSize: 22, bold: true, color: "1e293b", fontFace: "Calibri",
        });

        // Rate badge
        const rateText = displayRate(site.base_rate_paise, proposal.show_rates);
        if (proposal.show_rates !== "hidden") {
          slide.addText(rateText + (proposal.show_rates === "request_quote" ? "" : "/mo"), {
            x: 9, y: 0.35, w: 3.2, h: 0.5,
            fontSize: 14, bold: true, color: "1d4ed8", align: "right", fontFace: "Calibri",
          });
        }

        // City & address
        slide.addText(`${site.city}, ${site.state}${site.address ? " • " + site.address : ""}`, {
          x: 0.4, y: 0.9, w: 12, h: 0.35,
          fontSize: 10, color: "64748b", fontFace: "Calibri",
        });

        // Photo (if available)
        if (proposal.show_photos && site.primary_photo_url) {
          try {
            slide.addImage({
              path: site.primary_photo_url,
              x: 0.4, y: 1.35, w: 5.5, h: 3.5,
              sizing: { type: "contain", w: 5.5, h: 3.5 },
            });
          } catch {
            // Photo load failed — skip silently
          }
        }

        // Details box (right side)
        const detailX = proposal.show_photos && site.primary_photo_url ? 6.2 : 0.4;
        const detailW = proposal.show_photos && site.primary_photo_url ? 6 : 12;

        const details: { label: string; value: string }[] = [
          { label: "Media Type", value: site.media_type?.replace(/_/g, " ") ?? "—" },
        ];
        if (proposal.show_dimensions) {
          details.push({ label: "Dimensions", value: site.width_ft && site.height_ft ? `${site.width_ft} × ${site.height_ft} ft` : "—" });
        }
        if (proposal.show_illumination) {
          details.push({ label: "Illumination", value: site.illumination ?? "—" });
        }
        if (proposal.show_traffic_info) {
          details.push({ label: "Facing", value: site.facing ?? "—" });
          if (site.visibility_distance_m) {
            details.push({ label: "Visibility", value: `${site.visibility_distance_m}m` });
          }
        }
        if (proposal.show_availability) {
          details.push({ label: "Status", value: site.status });
        }

        details.forEach((d, i) => {
          const yPos = 1.5 + i * 0.55;
          slide.addText(d.label.toUpperCase(), {
            x: detailX, y: yPos, w: detailW, h: 0.22,
            fontSize: 7, color: "94a3b8", fontFace: "Calibri",
          });
          slide.addText(d.value, {
            x: detailX, y: yPos + 0.22, w: detailW, h: 0.28,
            fontSize: 11, bold: true, color: "1e293b", fontFace: "Calibri",
          });
        });

        // Footer
        if (proposal.custom_footer_text) {
          slide.addText(proposal.custom_footer_text, {
            x: 0, y: 6.9, w: "100%", h: 0.3,
            fontSize: 7, color: "94a3b8", align: "center", fontFace: "Calibri",
          });
        }
      }

      // ── Slide: Terms ───────────────────────────────────────────────────────
      if (proposal.include_terms && proposal.terms_text) {
        const termsSlide = prs.addSlide();
        termsSlide.background = { color: "f8fafc" };

        termsSlide.addText("Terms & Conditions", {
          x: 0.5, y: 0.3, w: 12, h: 0.6,
          fontSize: 22, bold: true, color: "1e3a5f", fontFace: "Calibri",
        });

        termsSlide.addShape(prs.ShapeType.line, {
          x: 0.5, y: 1, w: 12, h: 0, line: { color: "e2e8f0", width: 1 },
        });

        termsSlide.addText(proposal.terms_text, {
          x: 0.5, y: 1.2, w: 12, h: 5,
          fontSize: 9, color: "475569", fontFace: "Calibri",
          valign: "top", wrap: true,
        });
      }

      // ── Slide: Contact ─────────────────────────────────────────────────────
      if (proposal.include_contact_details && org) {
        const contactSlide = prs.addSlide();
        contactSlide.background = { color: "1e3a5f" };

        contactSlide.addText("Get in Touch", {
          x: 1, y: 1, w: 11, h: 0.7,
          fontSize: 28, bold: true, color: "ffffff", align: "center", fontFace: "Calibri",
        });

        contactSlide.addText(org.name, {
          x: 1, y: 2, w: 11, h: 0.5,
          fontSize: 16, color: "94a3b8", align: "center", fontFace: "Calibri",
        });

        const contactDetails = [
          org.phone && `Phone: ${org.phone}`,
          org.email && `Email: ${org.email}`,
          org.city && `${org.city}, ${org.state}`,
        ].filter(Boolean).join("   •   ");

        if (contactDetails) {
          contactSlide.addText(contactDetails, {
            x: 1, y: 2.7, w: 11, h: 0.4,
            fontSize: 11, color: "cbd5e1", align: "center", fontFace: "Calibri",
          });
        }
      }

      // ── Download ───────────────────────────────────────────────────────────
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
