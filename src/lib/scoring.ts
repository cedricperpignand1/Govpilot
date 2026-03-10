import { Opportunity, ScoredOpportunity } from "./types";
import { PREFERRED_NAICS } from "./defaults";

export interface ScoringOptions {
  includeKeywords: string[];
  excludeKeywords: string[];
  preferredNaics?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTitle(opp: Opportunity): string {
  return (opp.title ?? "").toLowerCase();
}

function getSolicitationType(opp: Opportunity): string {
  return (opp.type ?? opp.baseType ?? "").toLowerCase().trim();
}

function getDeadline(opp: Opportunity): Date | null {
  const raw = opp.responseDeadLine ?? opp.reponseDeadLine;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function getResponseDays(opp: Opportunity): number {
  const deadline = getDeadline(opp);
  if (!deadline) return 14;
  const posted = opp.postedDate ? new Date(opp.postedDate) : new Date();
  return Math.max(0, (deadline.getTime() - posted.getTime()) / 86_400_000);
}

function getAttachmentCount(opp: Opportunity): number {
  return opp.resourceLinks?.length ?? 0;
}

function parseAwardAmount(opp: Opportunity): number | null {
  const raw = opp.award?.amount;
  if (!raw) return null;
  const n = parseFloat(String(raw).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
}

// ─── Step 1: Opportunity Attractiveness Score (0–100) ────────────────────────

function calcOpportunityScore(
  opp: Opportunity,
  opts: ScoringOptions
): { score: number; signals: string[] } {
  let score = 0;
  const signals: string[] = [];
  const title = getTitle(opp);
  const ptype = getSolicitationType(opp);

  // — Solicitation Type —
  if (title.includes("rfq") || ptype === "o" || ptype.includes("quote")) {
    score += 20;
    signals.push("RFQ");
  } else if (ptype === "k" || ptype.includes("combined") || ptype.includes("synopsis")) {
    score += 15;
    signals.push("Combined Synopsis");
  } else if (title.includes("rfp") || ptype.includes("proposal")) {
    score -= 10;
    signals.push("RFP");
  } else if (ptype === "r" || ptype.includes("sources sought") || ptype.includes("rfi")) {
    score -= 25;
    signals.push("Sources Sought");
  }

  // — Set Aside —
  const setAside = (opp.setAside ?? opp.setAsideCode ?? "").toLowerCase();
  if (
    setAside.includes("total small") ||
    setAside === "sba" ||
    setAside.includes("total_small")
  ) {
    score += 10;
    signals.push("Total SB Set-Aside");
  } else if (
    !setAside ||
    setAside === "none" ||
    setAside.includes("full and open") ||
    setAside.includes("unrestricted")
  ) {
    score += 5;
  } else if (
    setAside.includes("8(a)") ||
    setAside.includes("8a") ||
    setAside.includes("hubzone") ||
    setAside.includes("sdvosb") ||
    setAside.includes("wosb")
  ) {
    score -= 20;
    signals.push("Special Cert Required");
  }

  // — Product vs Service —
  const serviceWords = [
    "service", "maintenance", "repair", "installation", "cleaning",
    "inspection", "support", "consulting", "training", "management",
    "operation", "staffing",
  ];
  const productWords = [
    "supply", "supplies", "equipment", "parts", "hardware", "materials",
    "items", "purchase", "procurement", "delivery", "unit", "each",
  ];
  const svcHits = serviceWords.filter((w) => title.includes(w)).length;
  const prdHits = productWords.filter((w) => title.includes(w)).length;

  if (prdHits > 0 && svcHits === 0) {
    score += 20;
    signals.push("Physical Products");
  } else if (prdHits > 0 && svcHits > 0) {
    score += 5;
    signals.push("Mixed Supply+Service");
  } else if (svcHits > 0 && prdHits === 0) {
    score -= 15;
    signals.push("Service Heavy");
  }

  // — Brand Language —
  if (title.includes("brand name or equal") || title.includes("or equal")) {
    score += 15;
    signals.push("Brand or Equal");
  } else if (
    title.includes("brand name only") ||
    title.includes("sole source") ||
    title.includes("sole-source")
  ) {
    score -= 10;
    signals.push("Sole Source");
  } else {
    score += 5;
  }

  // — Attachments —
  const attachments = getAttachmentCount(opp);
  if (attachments >= 1 && attachments <= 3) {
    score += 10;
  } else if (attachments >= 4 && attachments <= 7) {
    score += 3;
  } else if (attachments > 7) {
    score -= 10;
    signals.push(`${attachments} Attachments`);
  }

  // — Delivery Timeline (response window) —
  const responseDays = getResponseDays(opp);
  if (responseDays >= 15 && responseDays <= 60) {
    score += 10;
  } else if (responseDays >= 7 && responseDays < 15) {
    score += 5;
    signals.push(`${Math.round(responseDays)}d Window`);
  } else if (responseDays < 7) {
    score -= 10;
    signals.push("Short Fuse");
  }

  // — NAICS Match —
  const naicsSet = new Set(opts.preferredNaics ?? PREFERRED_NAICS);
  if (opp.naicsCode && naicsSet.has(opp.naicsCode)) {
    score += 8;
    signals.push("NAICS Match");
  }

  // — Contract Value —
  const amount = parseAwardAmount(opp);
  if (amount !== null) {
    if (amount >= 5_000 && amount <= 75_000) {
      score += 20;
      signals.push(`$${(amount / 1000).toFixed(0)}k`);
    } else if (amount > 75_000 && amount <= 150_000) {
      score += 10;
      signals.push(`$${(amount / 1000).toFixed(0)}k`);
    } else if (amount < 5_000) {
      score -= 10;
      signals.push("<$5k");
    } else {
      score -= 15;
      signals.push(">$150k");
    }
  }

  // — Include Keywords (max 3 hits, +5 each) —
  let kwHits = 0;
  for (const kw of opts.includeKeywords) {
    const k = kw.toLowerCase().trim();
    if (k && title.includes(k)) {
      score += 5;
      kwHits++;
      if (kwHits >= 3) break;
    }
  }

  // — Exclude Keywords (−8 each) —
  for (const kw of opts.excludeKeywords) {
    const k = kw.toLowerCase().trim();
    if (k && title.includes(k)) score -= 8;
  }

  return { score: Math.max(0, Math.min(100, score)), signals };
}

// ─── Steps 2–5: Competition Estimation ───────────────────────────────────────

function calcCompetition(opp: Opportunity): {
  competitionScore: number;
  estimatedBidders: string;
  competitionTier: ScoredOpportunity["competitionTier"];
} {
  const title = getTitle(opp);
  const attachments = getAttachmentCount(opp);
  const responseDays = getResponseDays(opp);

  // Base formula using signals available in SAM search results
  let cs = attachments * 1.5 + responseDays * 0.5;

  // Step 4 — Category adjustments
  const industrial = ["generator", "compressor", "pump", "motor", "valve", "hose", "hydraulic", "pneumatic"];
  const mechanical = ["bearing", "gear", "shaft", "gasket", "seal", "coupling", "belt"];
  const tools      = ["tool", "drill", "saw", "wrench", "socket", "cutter"];
  const itHardware = ["computer", "laptop", "server", "network", "router", "switch", "monitor"];
  const officeSup  = ["office supplies", "paper", "toner", "furniture", "chair", "desk"];

  if (industrial.some((w) => title.includes(w))) cs -= 5;
  if (mechanical.some((w) => title.includes(w))) cs -= 4;
  if (tools.some((w) => title.includes(w))) cs -= 2;
  if (itHardware.some((w) => title.includes(w))) cs += 8;
  if (officeSup.some((w) => title.includes(w))) cs += 10;

  // Step 5 — Contract value adjustment
  const amount = parseAwardAmount(opp);
  if (amount !== null) {
    if (amount >= 10_000 && amount <= 60_000) cs -= 3;
    else if (amount > 60_000 && amount <= 150_000) cs += 2;
    else if (amount > 150_000) cs += 8;
  }

  // Small business set-aside narrows the eligible bidder pool
  const setAside = (opp.setAside ?? opp.setAsideCode ?? "").toLowerCase();
  if (setAside.includes("total small") || setAside === "sba") cs -= 3;

  cs = Math.max(0, cs);

  // Step 3 — Map score to bidder range and tier
  let estimatedBidders: string;
  let competitionTier: ScoredOpportunity["competitionTier"];

  if (cs <= 10) {
    estimatedBidders = "1–3 bidders";
    competitionTier = "Excellent";
  } else if (cs <= 20) {
    estimatedBidders = "4–7 bidders";
    competitionTier = "Good";
  } else if (cs <= 35) {
    estimatedBidders = "8–15 bidders";
    competitionTier = "Moderate";
  } else if (cs <= 50) {
    estimatedBidders = "16–30 bidders";
    competitionTier = "High";
  } else {
    estimatedBidders = "30+ bidders";
    competitionTier = "Very High";
  }

  return { competitionScore: cs, estimatedBidders, competitionTier };
}

// ─── Step 6: Final Score ──────────────────────────────────────────────────────

export function scoreOpportunity(
  opp: Opportunity,
  opts: ScoringOptions
): Omit<ScoredOpportunity, keyof Opportunity> {
  const { score: opportunityScore, signals } = calcOpportunityScore(opp, opts);
  const { competitionScore, estimatedBidders, competitionTier } = calcCompetition(opp);

  // FinalScore = OpportunityScore − CompetitionScore, clamped 0–100
  const finalScore = Math.max(0, Math.min(100, opportunityScore - competitionScore));

  return {
    score: finalScore,
    opportunityScore,
    competitionScore: Math.round(competitionScore),
    estimatedBidders,
    competitionTier,
    signals,
  };
}

export function scoreAll(
  opps: Opportunity[],
  opts: ScoringOptions
): ScoredOpportunity[] {
  return opps.map((o) => ({ ...o, ...scoreOpportunity(o, opts) }));
}
