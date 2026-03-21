export interface POC {
  type?: string;
  title?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  fax?: string;
}

export interface PlaceOfPerformance {
  state?: { code?: string; name?: string };
  zip?: string;
  city?: { code?: string; name?: string };
  country?: { code?: string; name?: string };
}

export interface Opportunity {
  noticeId: string;
  title: string;
  solicitationNumber?: string;
  postedDate?: string;
  // SAM docs have a typo — handle both spellings
  responseDeadLine?: string;
  reponseDeadLine?: string;
  type?: string;
  baseType?: string;
  organizationName?: string;
  fullParentPathName?: string;
  naicsCode?: string;
  classificationCode?: string;
  setAside?: string;
  setAsideCode?: string;
  // description is a URL link to the full notice description package
  description?: string;
  // uiLink is the direct SAM.gov notice URL
  uiLink?: string;
  pointOfContact?: POC[];
  placeOfPerformance?: PlaceOfPerformance;
  active?: string;
  award?: {
    date?: string;
    number?: string;
    amount?: string;
    awardee?: { name?: string; location?: Record<string, unknown> };
  };
  additionalInfoLink?: string;
  links?: Array<{ rel?: string; href?: string }>;
  resourceLinks?: string[];
}

export interface ScoredOpportunity extends Opportunity {
  /** Final score 0–100 (OpportunityScore − CompetitionScore) */
  score: number;
  /** Raw opportunity attractiveness 0–100 before competition adjustment */
  opportunityScore: number;
  /** Raw competition pressure score (higher = more competition) */
  competitionScore: number;
  /** Estimated number of bidders as a range string e.g. "4–7" */
  estimatedBidders: string;
  /** Human-readable competition tier */
  competitionTier: "Excellent" | "Good" | "Moderate" | "High" | "Very High";
  /** Key signals that drove the score */
  signals: string[];
}

export interface SamApiResponse {
  totalRecords: number;
  opportunitiesData: Opportunity[];
  limit: number;
  offset: number;
}

export interface FilterState {
  postedFrom: string; // MM/dd/yyyy
  postedTo: string;   // MM/dd/yyyy
  keyword: string;    // sent as 'title' to SAM — server-side keyword filter
  solnum: string;     // solicitation number lookup
  agency: string;     // sent as 'organizationName' to SAM
  state: string;
  naics: string;      // comma-separated NAICS codes
  ptype: string;      // comma-separated ptype codes
  includeKeywords: string;
  excludeKeywords: string;
  sortBy: "score" | "deadline" | "posted";
  minScore: number;
  hideVeryHighCompetition: boolean;
  limit: number;
  offset: number;
}
