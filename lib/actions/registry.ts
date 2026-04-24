// Registry of server actions reachable via the stable /api/action
// dispatcher. Keeping this on the server side means the list of
// callable actions can't be enumerated or spoofed from the client —
// only names present here are invokable. Each value is the actual
// async function the dispatcher will call.
//
// When you add a new client-facing mutation:
//   1) Implement it as a Server Action as usual.
//   2) Add an entry below.
//   3) From the client, call it with
//        import { callAction } from "@/lib/utils/call-action";
//        const result = await callAction("myAction", arg1, arg2);
//
// DO NOT route server-only actions (cron jobs, internal helpers)
// through here. Only user-triggered mutations.

import * as agencies from "@/app/[locale]/(dashboard)/agencies/actions";
import * as billing from "@/app/[locale]/(dashboard)/billing/actions";
import * as campaigns from "@/app/[locale]/(dashboard)/campaigns/actions";
import * as clients from "@/app/[locale]/(dashboard)/clients/actions";
import * as contracts from "@/app/[locale]/(dashboard)/contracts/actions";
import * as expenses from "@/app/[locale]/(dashboard)/expenses/actions";
import * as landowners from "@/app/[locale]/(dashboard)/landowners/actions";
import * as proposals from "@/app/[locale]/(dashboard)/proposals/actions";
import * as sites from "@/app/[locale]/(dashboard)/sites/actions";
import * as settings from "@/app/[locale]/(dashboard)/settings/actions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dispatcher is intentionally polymorphic
type AnyAction = (...args: any[]) => Promise<unknown>;

// The whitelist. Alphabetised by namespace for grep-ability.
export const ACTION_REGISTRY: Record<string, AnyAction> = {
  // Agencies
  createAgency: agencies.createAgency,
  updateAgency: agencies.updateAgency,
  deleteAgency: agencies.deleteAgency,

  // Billing / invoices
  createInvoice: billing.createInvoice,
  updateInvoiceStatus: billing.updateInvoiceStatus,
  deleteInvoice: billing.deleteInvoice,
  recordInvoicePayment: billing.recordPayment,

  // Campaigns — the three hot paths (create / cancel / delete) already
  // have dedicated Route Handlers, but the less-common mutations still
  // go through the dispatcher.
  updateCampaign: campaigns.updateCampaign,
  updateCampaignStatus: campaigns.updateCampaignStatus,
  addCampaignSite: campaigns.addCampaignSite,
  removeCampaignSite: campaigns.removeCampaignSite,
  extendCampaign: campaigns.extendCampaign,
  createCampaignChangeRequest: campaigns.createChangeRequest,
  reviewCampaignChangeRequest: campaigns.reviewChangeRequest,

  // Clients
  createClient: clients.createClientRecord,
  updateClient: clients.updateClientRecord,
  deleteClient: clients.deleteClientRecord,

  // Contracts — NOTE: createSignedAgreement, uploadContractDocument,
  // uploadSignedContract take a FormData and can't go through the
  // JSON dispatcher. They keep their direct Server Action import
  // until we add a dedicated multipart Route Handler for them.
  createContract: contracts.createContract,
  updateContract: contracts.updateContract,
  deleteContract: contracts.deleteContract,
  recordContractPayment: contracts.recordPayment,
  deleteSignedAgreement: contracts.deleteSignedAgreement,

  // Expenses / payment requests
  createExpense: expenses.createExpense,
  setExpenseStatus: expenses.setExpenseStatus,
  markExpensePaid: expenses.markExpensePaid,
  deleteExpense: expenses.deleteExpense,
  uploadExpenseDoc: expenses.uploadExpenseDoc,

  // Landowners
  createLandowner: landowners.createLandowner,
  updateLandowner: landowners.updateLandowner,
  deleteLandowner: landowners.deleteLandowner,

  // Proposals
  createProposal: proposals.createProposal,
  updateProposal: proposals.updateProposal,
  deleteProposal: proposals.deleteProposal,
  duplicateProposal: proposals.duplicateProposal,
  updateProposalStatus: proposals.updateProposalStatus,
  saveOrgProposalTermsTemplate: proposals.saveOrgProposalTermsTemplate,

  // Sites
  createSite: sites.createSite,
  updateSite: sites.updateSite,
  deleteSite: sites.deleteSite,
  createSitesFromImport: sites.createSitesFromImport,

  // Settings
  updateOrganization: settings.updateOrganization,
  upsertAlertPreference: settings.upsertAlertPreference,
  updateProfile: settings.updateProfile,
};

export type ActionName = keyof typeof ACTION_REGISTRY;
