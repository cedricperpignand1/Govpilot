import SaasOpsFeed from "@/components/SaasOpsFeed";

export const metadata = {
  title: "GovPilot — SaaS Ops",
  description: "SAM.gov opportunities filtered for SaaS and software platform contracts",
};

export default function SaasOpsPage() {
  return <SaasOpsFeed />;
}
