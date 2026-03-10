import { Opportunity, ScoredOpportunity } from "./types";
import { PREFERRED_NAICS } from "./defaults";

interface ScoringOptions {
  includeKeywords: string[];
  excludeKeywords: string[];
  preferredNaics?: string[];
}

function getDeadline(opp: Opportunity): Date | null {
  // The API has a typo — handle both spellings
  const raw = opp.responseDeadLine ?? opp.reponseDeadLine;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export function scoreOpportunity(
  opp: Opportunity,
  opts: ScoringOptions
): number {
  let score = 0;
  const title = (opp.title ?? "").toLowerCase();
  // SAM returns ptype as a short code in `type` field
  const ptype = (opp.type ?? opp.baseType ?? "").toLowerCase().trim();

  // --- Procurement type ---
  if (ptype === "o" || ptype === "solicitation") score += 10;
  if (ptype === "k" || ptype.includes("combined")) score += 10;
  // Sources Sought is useful research but not a direct bid (+2)
  if (ptype === "r") score += 2;

  // --- NAICS match ---
  const naicsSet = new Set(opts.preferredNaics ?? PREFERRED_NAICS);
  if (opp.naicsCode && naicsSet.has(opp.naicsCode)) score += 8;

  // --- Include keywords (title) — award up to +5 per hit, max +15 ---
  let includeHits = 0;
  for (const kw of opts.includeKeywords) {
    const kwLower = kw.toLowerCase().trim();
    if (kwLower && title.includes(kwLower)) {
      score += 5;
      includeHits++;
      if (includeHits >= 3) break;
    }
  }

  // --- Exclude keywords (title) — -8 per hit ---
  for (const kw of opts.excludeKeywords) {
    const kwLower = kw.toLowerCase().trim();
    if (kwLower && title.includes(kwLower)) {
      score -= 8;
    }
  }

  // --- Deadline sweet spot ---
  const deadline = getDeadline(opp);
  if (deadline) {
    const now = new Date();
    const hoursUntil = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursUntil < 0) {
      score -= 20; // already expired
    } else if (hoursUntil < 48) {
      score -= 5; // too close — short fuse
    } else if (hoursUntil >= 72 && hoursUntil <= 21 * 24) {
      score += 5; // sweet spot: 3–21 days
    }
  }

  // --- Hard penalty keywords ---
  if (/\bidiq\b/.test(title)) score -= 10;
  if (/\bmatoc\b/.test(title)) score -= 10;
  if (/\bmacc\b/.test(title)) score -= 10;

  // Construction/services (I sell supplies, not construction services)
  if (/\bconstruction\b/.test(title) || /design.build/.test(title)) score -= 10;

  if (title.includes("security clearance")) score -= 8;
  if (title.includes("past performance")) score -= 8;
  if (title.includes("bonding") || title.includes("performance bond"))
    score -= 8;

  // RFP = more complex; RFQ = simpler
  if (title.includes("rfp")) score -= 6;
  if (title.includes("rfq")) score += 6;

  return score;
}

export function scoreAll(
  opps: Opportunity[],
  opts: ScoringOptions
): ScoredOpportunity[] {
  return opps.map((o) => ({ ...o, score: scoreOpportunity(o, opts) }));
}
