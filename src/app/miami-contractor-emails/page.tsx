import MiamiContractorEmails from "@/components/MiamiContractorEmails";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GovPilot — Miami Contractor Emails",
  description: "Hunter-enriched business emails for Miami construction contractors",
};

export default function MiamiContractorEmailsPage() {
  return <MiamiContractorEmails />;
}
