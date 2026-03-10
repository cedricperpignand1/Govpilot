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
  score: number;
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
  state: string;
  naics: string;      // comma-separated NAICS codes
  ptype: string;      // comma-separated ptype codes
  includeKeywords: string;
  excludeKeywords: string;
  sortBy: "score" | "deadline" | "posted";
  limit: number;
  offset: number;
}
