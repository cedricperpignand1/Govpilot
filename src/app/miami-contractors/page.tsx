import MiamiContractors from "@/components/MiamiContractors";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GovPilot — Miami Contractors",
  description: "Miami-based construction companies registered in SAM.gov",
};

export default function MiamiContractorsPage() {
  return <MiamiContractors />;
}
