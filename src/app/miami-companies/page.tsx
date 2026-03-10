import MiamiCompanies from "@/components/MiamiCompanies";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GovPilot — Miami Companies",
  description: "Miami construction companies sourced from Google Places",
};

export default function MiamiCompaniesPage() {
  return <MiamiCompanies />;
}
