import OpportunityDetail from "@/components/OpportunityDetail";

interface Props {
  params: { noticeId: string };
}

export default function OpportunityPage({ params }: Props) {
  return <OpportunityDetail noticeId={params.noticeId} />;
}
