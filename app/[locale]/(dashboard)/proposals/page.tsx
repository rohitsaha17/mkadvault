// Proposals list — themed to match the app-wide UI overhaul.
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Plus, FileText } from "lucide-react";
import { ProposalActions } from "@/components/proposals/ProposalActions";
import type { Proposal } from "@/lib/types/database";

export const metadata = { title: "Proposals" };

interface ProposalRow extends Proposal {
  client?: { company_name: string } | null;
  agency?: { agency_name: string } | null;
}

export default async function ProposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("proposals");
  const { page } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10));
  const PAGE_SIZE = 25;
  const offset = (currentPage - 1) * PAGE_SIZE;

  const supabase = await createClient();

  const { data, count } = await supabase
    .from("proposals")
    .select(
      "id, proposal_name, status, template_type, created_at, updated_at, client_id, agency_id, recipient_type, client:clients(company_name), agency:partner_agencies(agency_name)",
      { count: "exact" }
    )
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const proposals = (data ?? []) as unknown as ProposalRow[];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Fetch site counts per proposal
  const proposalIds = proposals.map((p) => p.id);
  let siteCountMap: Record<string, number> = {};
  if (proposalIds.length > 0) {
    const { data: siteCounts } = await supabase
      .from("proposal_sites")
      .select("proposal_id")
      .in("proposal_id", proposalIds);
    siteCountMap = (siteCounts ?? []).reduce<Record<string, number>>((acc, row) => {
      acc[row.proposal_id] = (acc[row.proposal_id] ?? 0) + 1;
      return acc;
    }, {});
  }

  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/proposals/new">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              Create Proposal
            </Button>
          </Link>
        }
      />

      {proposals.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<FileText className="h-7 w-7" />}
          title={t("noProposals")}
          description={t("noProposalsDesc")}
          action={
            <Link href="/proposals/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Create Proposal
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Proposal Name</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead className="text-right">Sites</TableHead>
                  <TableHead>Layout</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        href={`/proposals/${p.id}`}
                        className="font-medium text-foreground hover:text-primary transition-colors"
                      >
                        {p.proposal_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {/* Recipient can be a partner agency OR a client;
                          show whichever is populated (migration 039). */}
                      {p.agency?.agency_name ? (
                        <span>
                          {p.agency.agency_name}
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">· Agency</span>
                        </span>
                      ) : p.client?.company_name ? (
                        <span>
                          {p.client.company_name}
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">· Client</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/60">No recipient</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {siteCountMap[p.id] ?? 0}
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {p.template_type?.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {format(new Date(p.updated_at), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end">
                        <ProposalActions proposalId={p.id} proposalName={p.proposal_name} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="mt-5 flex items-center justify-center gap-3">
              {currentPage > 1 && (
                <Link href={`/proposals?page=${currentPage - 1}`}>
                  <Button variant="outline" size="sm">← Previous</Button>
                </Link>
              )}
              <span className="text-sm text-muted-foreground tabular-nums">
                Page {currentPage} of {totalPages}
              </span>
              {currentPage < totalPages && (
                <Link href={`/proposals?page=${currentPage + 1}`}>
                  <Button variant="outline" size="sm">Next →</Button>
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
