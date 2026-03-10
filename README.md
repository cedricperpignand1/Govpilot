# GovPilot — SAM.gov Bid Feed

A local-only Next.js app that fetches, scores, and filters SAM.gov contract opportunities for resellers and suppliers.

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Get the right SAM.gov API key (System Account required)

The v2 search endpoint requires a **System Account API key** — a personal profile key returns 404.

**How to get a System Account key (free, ~5 min):**

1. Sign in at sam.gov
2. Go to **Help → Get Started → System Accounts** or navigate to:
   `https://sam.gov/system-accounts`
3. Create a new System Account (name it anything, e.g. "GovPilot Local")
4. Under **Domains**, select **Contract Opportunities**
5. Under **Roles**, check **Read** (Contract Opportunities Reader)
6. Submit — approval is usually instant for read-only access
7. Once approved, go to the System Account and copy the **API Key**

Edit `.env.local`:
```
SAM_API_KEY=YOUR_SYSTEM_ACCOUNT_KEY_HERE
SAM_BASE_URL=https://api.sam.gov
```

**After editing `.env.local` you must restart the dev server** (Ctrl+C then `npm run dev`) — Next.js does not hot-reload env files.

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Project Structure

```
govpilot/
├── .env.local                          ← Your SAM API key (never commit)
├── package.json
├── tsconfig.json
├── next.config.js
├── README.md
└── src/
    ├── app/
    │   ├── layout.tsx                  ← App shell / header
    │   ├── page.tsx                    ← Home page (Bid Feed)
    │   ├── globals.css                 ← All styles
    │   ├── api/
    │   │   └── opportunities/
    │   │       ├── route.ts            ← GET /api/opportunities (list)
    │   │       └── [noticeId]/
    │   │           └── route.ts        ← GET /api/opportunities/:id (detail)
    │   └── opportunities/
    │       └── [noticeId]/
    │           └── page.tsx            ← Detail page
    ├── components/
    │   ├── BidFeed.tsx                 ← Home page client component
    │   ├── FilterPanel.tsx             ← Sidebar filters
    │   ├── OpportunityRow.tsx          ← Single row in results list
    │   ├── OpportunityDetail.tsx       ← Full detail view
    │   └── CopyButton.tsx              ← "Copy for OpenAI" clipboard button
    └── lib/
        ├── types.ts                    ← Shared TypeScript interfaces
        ├── scoring.ts                  ← Deterministic match scoring
        ├── cache.ts                    ← In-memory API response cache (90s TTL)
        └── defaults.ts                 ← Default NAICS, keywords, date helpers
```

---

## Features

### Bid Feed (Home Page)
- **Filters**: date range, state, NAICS codes, procurement types, include/exclude keywords, sort order
- **Scoring**: deterministic match score based on NAICS, keywords, deadline timing, and penalty patterns
- **Per-result**: score, title, type badge, NAICS, set-aside, agency, posted date, deadline, "Open on SAM.gov" link

### Detail Page
- All notice metadata (title, solicitation #, notice ID, agency, dates, set-aside, NAICS, place of performance)
- Points of contact with email/phone links
- Links to description package and SAM.gov notice page
- "How to Submit" section with a step-by-step checklist
- **"Copy for OpenAI"** button — copies a structured text block ready to paste into ChatGPT or Claude

### API Routes (server-side proxy)
- `GET /api/opportunities` — proxies SAM.gov search with your filters; your API key is never exposed to the browser
- `GET /api/opportunities/[noticeId]` — fetches a single notice by ID
- 90-second in-memory cache to avoid rate limits

---

## Scoring Logic

| Condition | Points |
|---|---|
| ptype = Solicitation (`o`) or Combined Syn/Sol (`k`) | +10 |
| NAICS matches preferred list | +8 |
| Title contains an include keyword (up to 3 hits) | +5 each |
| Title contains an exclude keyword | -8 each |
| Deadline 3–21 days from now (sweet spot) | +5 |
| Deadline < 48 hours (short fuse) | -5 |
| Deadline already expired | -20 |
| Title contains IDIQ / MATOC / MACC | -10 |
| Title contains "construction" or "design-build" | -10 |
| Title contains "security clearance" | -8 |
| Title contains "past performance" | -8 |
| Title contains "bonding" / "performance bond" | -8 |
| Title contains RFP | -6 |
| Title contains RFQ | +6 |

---

## Default Profile

**Preferred NAICS** (pre-loaded, editable in the filter panel):
- 423990, 423710, 423840, 423690, 423610, 423330, 423320, 423390

**Include keywords**: safety gloves, PPE, fasteners, drill bits, batteries, janitorial, electrical supplies, plumbing, lighting, abrasives, caulk, paint supplies, and more.

**Exclude keywords**: IDIQ, MATOC, design-build, cybersecurity, clearance, weapons, staffing, bonding, and more.

---

## Notes
- No database, no auth, no deployment — runs entirely on localhost
- `.env.local` is gitignored — your API key stays local
- API responses are cached in memory for 90 seconds per unique query
- The SAM.gov API requires `postedFrom` and `postedTo` (max 1-year range) on every request
