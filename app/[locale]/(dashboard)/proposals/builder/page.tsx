// The builder is now at /proposals/new — redirect there
import { redirect } from "next/navigation";

export default async function ProposalBuilderPage() {
  redirect("/proposals/new");
}
