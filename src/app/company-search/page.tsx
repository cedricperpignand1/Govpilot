import type { Metadata } from "next";
import CompanySearch from "@/components/CompanySearch";

export const metadata: Metadata = {
  title: "GovPilot — Company Search",
};

export default function CompanySearchPage() {
  return <CompanySearch />;
}
