import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import fs from "fs";
import path from "path";
// Force Node.js runtime so pdf-parse is never bundled by webpack
export const runtime = "nodejs";
import { Opportunity } from "@/lib/types";

const SAM_KEY = process.env.SAM_API_KEY ?? "";
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";

// ─── Server-side in-memory caches ───────────────────────────────────────────
// Survives across requests within the same Next.js server process.
// TTL: 4 hours — long enough to avoid redundant SAM fetches in a work session.
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

interface CacheEntry<T> { value: T; expiresAt: number; }

const pdfTextCache = new Map<string, CacheEntry<string>>();   // url → extracted text
const aiResultCache = new Map<string, CacheEntry<AiResult>>(); // noticeId → AI extraction

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { map.delete(key); return null; }
  return entry.value;
}
function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

const COMPANY = {
  name: "Perpignad Florida Services LLC",
  contact: "Cedric Perpignand",
  phone: "3052002591",
  email: "cedricperpignand@gmail.com",
  uei: "PFH8KBJQU8M5",
  cage: "1A3C4",
};

interface LineItem {
  partNumber: string;
  description: string;
  quantity: number | string;
  unit: string;
}

interface AiResult {
  items: LineItem[];
  deliveryTerms: string;
  paymentTerms: string;
  notes: string;
}

interface Supplier {
  name: string;
  phone: string;
  website: string;
  matchedItems: string; // which CLINs/items they supply
}

interface SupplierResult {
  suppliers: Supplier[];
}

// ─── Colors (same as invoice route) ────────────────────────────────────────
const NAVY       = { argb: "FF1F3864" };
const BLUE_HDR   = { argb: "FF344D6E" };
const LIGHT_BLUE = { argb: "FFBDD7EE" };
const LIGHT_GRAY = { argb: "FFF2F2F2" };
const WHITE      = { argb: "FFFFFFFF" };

function solidFill(color: { argb: string }): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: color };
}
function thinBorder(): Partial<ExcelJS.Borders> {
  const s = { style: "thin" as const, color: { argb: "FF1F3864" } };
  return { top: s, left: s, bottom: s, right: s };
}
function whiteFont(size = 11): Partial<ExcelJS.Font> {
  return { bold: true, color: { argb: "FFFFFFFF" }, size };
}

/** Fetch a SAM URL (adds api_key), return text or extracted PDF text */
async function fetchSamContent(url: string): Promise<{ text: string; error?: string }> {
  try {
    const target = new URL(url);
    target.searchParams.set("api_key", SAM_KEY);
    const res = await fetch(target.toString(), {
      headers: { Accept: "*/*" },
      redirect: "follow",
      cache: "no-store",
    });
    if (!res.ok) return { text: "", error: `HTTP ${res.status} for ${url}` };

    const contentType = res.headers.get("content-type") ?? "";
    const buf = await res.arrayBuffer();
    const bytes = Buffer.from(buf);

    // Detect PDF by magic bytes (%PDF) OR content-type — SAM.gov often
    // serves PDFs as application/octet-stream, so content-type alone is unreliable.
    const isPdf = contentType.includes("pdf") ||
      (bytes.length > 4 && bytes.slice(0, 4).toString("ascii") === "%PDF");

    if (isPdf) {
      // Check cache before parsing — avoids re-fetching the same PDF
      const cached = cacheGet(pdfTextCache, url);
      if (cached) return { text: cached };
      try {
        const result = await pdfParse(bytes);
        if (!result.text?.trim()) {
          return { text: "", error: `pdf-parse returned empty text for ${url} (possibly image-based PDF)` };
        }
        cacheSet(pdfTextCache, url, result.text);
        return { text: result.text };
      } catch (pdfErr) {
        return { text: "", error: `pdf-parse threw: ${String(pdfErr).slice(0, 300)} for ${url}` };
      }
    }

    // JSON description envelope — extract just the text value
    if (contentType.includes("json")) {
      try {
        const json = JSON.parse(bytes.toString("utf-8"));
        const raw: string = json.description ?? JSON.stringify(json);
        const cleaned = raw
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&ndash;/g, "-")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/\s{2,}/g, " ")
          .trim();
        return { text: cleaned };
      } catch { return { text: "" }; }
    }

    return { text: bytes.toString("utf-8") };
  } catch (err) {
    return { text: "", error: `fetch failed: ${String(err).slice(0, 200)}` };
  }
}

// ─── Find the most CLIN-rich section of the text ────────────────────────────
function extractRelevantSection(text: string, maxChars = 120000): string {
  // Keywords that mark the start of a CLIN / line-item schedule
  const clinPatterns = [
    /CLIN\s*\d{4}/i,
    /CONTRACT LINE ITEM/i,
    /SCHEDULE OF SUPPLIES/i,
    /SCHEDULE OF SERVICES/i,
    /SECTION\s+B\b/i,
    /SUPPLIES OR SERVICES AND PRICES/i,
    /LINE ITEM\s+NO/i,
    /ITEM\s+NO\.?\s+SUPPLIES/i,
    /ITEM\s+NO\.?\s+DESCRIPTION/i,
  ];

  let bestStart = 0;
  for (const pat of clinPatterns) {
    const idx = text.search(pat);
    if (idx !== -1 && (bestStart === 0 || idx < bestStart)) {
      bestStart = idx;
    }
  }

  // Take up to maxChars starting from the best found section; if the section
  // is small, append more text from before it for context.
  if (bestStart > 0 && text.length - bestStart >= maxChars * 0.5) {
    // Start a bit before the keyword to include any preceding headers
    const start = Math.max(0, bestStart - 500);
    return text.slice(start, start + maxChars);
  }

  // Fallback: just use the first maxChars
  return text.slice(0, maxChars);
}

// ─── OpenAI extraction ──────────────────────────────────────────────────────
async function extractWithAI(text: string, title: string): Promise<AiResult> {
  const client = new OpenAI({ apiKey: OPENAI_KEY });

  const excerpt = extractRelevantSection(text, 120000);

  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are a government contracting data extraction engine. Your ONLY job is to find every CLIN (Contract Line Item Number) or bid line item in the solicitation text and return them verbatim as JSON.

CRITICAL RULES — follow exactly:
1. Find ALL CLINs. They look like: CLIN 0001, 0001, ITEM 0001, Line Item 1, etc.
2. For "partNumber": use the CLIN number exactly as written (e.g. "0001", "CLIN 0001"). If a separate manufacturer part number or NSN also appears for that line, append it like "0001 / CORNING P/N: 7525876".
3. For "description": copy the FULL description text from the document verbatim. Do NOT summarize, shorten, or paraphrase. Include the product name, specifications, and any manufacturer info exactly as written.
4. For "quantity": use the exact number from the document. If the field says "1 EA" the quantity is 1. If it says "300 Each" the quantity is 300.
5. For "unit": copy the unit exactly (EA, Each, LT, BX, FT, Spool, etc.).
6. Do NOT merge multiple CLINs into one. Each CLIN is a separate item in the array.
7. If you see zero CLINs, look for any table of supplies/services with quantities and extract those rows.

Return ONLY valid JSON:
{
  "items": [
    {
      "partNumber": "CLIN number and/or part number exactly as written",
      "description": "FULL verbatim description from document",
      "quantity": <exact number from document>,
      "unit": "unit exactly as written, or EA"
    }
  ],
  "deliveryTerms": "delivery timeframe e.g. '30 days ARO', or empty string",
  "paymentTerms": "e.g. Net 30, or empty string",
  "notes": "any special requirements, FOB point, inspection/acceptance terms, or other bid conditions"
}`,
      },
      {
        role: "user",
        content: `Solicitation title: ${title}\n\nDocument text:\n${excerpt}`,
      },
    ],
  });

  try {
    const raw = completion.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      deliveryTerms: parsed.deliveryTerms ?? "",
      paymentTerms: parsed.paymentTerms ?? "Net 30",
      notes: parsed.notes ?? "",
    };
  } catch {
    return { items: [], deliveryTerms: "", paymentTerms: "Net 30", notes: "" };
  }
}

// ─── Supplier suggestions ────────────────────────────────────────────────────
async function suggestSuppliers(items: LineItem[], naicsCode?: string): Promise<SupplierResult> {
  const client = new OpenAI({ apiKey: OPENAI_KEY });

  const itemList = items
    .map((it, i) => `${i + 1}. ${it.partNumber ? `[${it.partNumber}] ` : ""}${it.description} — Qty ${it.quantity} ${it.unit}`)
    .join("\n");

  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are a government procurement specialist. Given a list of items to be sourced, identify 4–6 real US distributors or manufacturers that are most likely to carry ALL or MOST of these items.

Return ONLY valid JSON:
{
  "suppliers": [
    {
      "name": "Company full legal name",
      "phone": "Main US phone number in (XXX) XXX-XXXX format — use the national sales or customer service line",
      "website": "www.example.com (no https://)",
      "matchedItems": "Comma-separated list of CLIN numbers or brief item names this supplier covers"
    }
  ]
}

Rules:
- Only include REAL, well-established companies you are confident exist.
- Prefer authorized distributors and government-contract-friendly suppliers (e.g., GSA contract holders).
- Phone numbers must be the company's actual national customer service or sales line.
- If the NAICS code is provided, use it to narrow the supplier category.
- Do NOT invent companies. If unsure about a phone number, use the main corporate number.`,
      },
      {
        role: "user",
        content: `NAICS Code: ${naicsCode ?? "unknown"}\n\nItems to source:\n${itemList}`,
      },
    ],
  });

  try {
    const raw = completion.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(raw);
    return { suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [] };
  } catch {
    return { suppliers: [] };
  }
}

// ─── Suppliers sheet builder ─────────────────────────────────────────────────
function addSuppliersSheet(wb: ExcelJS.Workbook, suppliers: Supplier[], items: LineItem[]): void {
  const ws = wb.addWorksheet("Suggested Suppliers");

  ws.columns = [
    { width: 30 },  // A  Company Name
    { width: 20 },  // B  Phone
    { width: 28 },  // C  Website
    { width: 50 },  // D  Items They Cover
  ];

  let r = 1;

  // Title
  ws.mergeCells(`A${r}:D${r}`);
  const title = ws.getCell(`A${r}`);
  title.value = "SUGGESTED SUPPLIERS — AI Matched";
  title.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
  title.fill = solidFill(NAVY);
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(r).height = 32;
  r++;

  // Disclaimer
  ws.mergeCells(`A${r}:D${r}`);
  const disc = ws.getCell(`A${r}`);
  disc.value = "⚠  Verify contact info before calling — phone numbers may have changed since AI training data.";
  disc.font = { italic: true, color: { argb: "FF7F0000" }, size: 9 };
  disc.fill = solidFill({ argb: "FFFFF2CC" });
  disc.alignment = { horizontal: "center" };
  ws.getRow(r).height = 18;
  r++;

  ws.getRow(r).height = 6; r++;

  // Items being sourced header
  ws.mergeCells(`A${r}:D${r}`);
  ws.getCell(`A${r}`).value = "ITEMS BEING SOURCED";
  ws.getCell(`A${r}`).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getCell(`A${r}`).fill = solidFill(BLUE_HDR);
  ws.getCell(`A${r}`).alignment = { horizontal: "center" };
  r++;

  items.forEach((item, i) => {
    const rowFill = i % 2 === 0 ? WHITE : LIGHT_GRAY;
    ws.getCell(`A${r}`).value = item.partNumber || `Item ${i + 1}`;
    ws.getCell(`A${r}`).font = { bold: true };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value = `${item.description}  ·  Qty: ${item.quantity} ${item.unit}`;
    ws.getCell(`B${r}`).alignment = { wrapText: true };
    for (let c = 1; c <= 4; c++) {
      ws.getRow(r).getCell(c).fill = solidFill(rowFill);
      ws.getRow(r).getCell(c).border = thinBorder();
    }
    ws.getRow(r).height = 18;
    r++;
  });

  ws.getRow(r).height = 10; r++;

  // Suppliers table header
  const hdrs = ["Company Name", "Phone", "Website", "Items They Supply"];
  hdrs.forEach((h, i) => {
    const cell = ws.getRow(r).getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = solidFill(BLUE_HDR);
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = thinBorder();
  });
  ws.getRow(r).height = 22;
  r++;

  if (suppliers.length === 0) {
    ws.mergeCells(`A${r}:D${r}`);
    ws.getCell(`A${r}`).value = "No suppliers found — try searching ThomasNet.com or Grainger.com manually.";
    ws.getCell(`A${r}`).font = { italic: true };
    r++;
  }

  suppliers.forEach((sup, i) => {
    const rowFill = i % 2 === 0 ? WHITE : LIGHT_GRAY;

    ws.getCell(`A${r}`).value = sup.name;
    ws.getCell(`A${r}`).font = { bold: true };

    ws.getCell(`B${r}`).value = sup.phone;

    ws.getCell(`C${r}`).value = { text: sup.website, hyperlink: `https://${sup.website}` };
    ws.getCell(`C${r}`).font = { color: { argb: "FF0563C1" }, underline: true };

    ws.getCell(`D${r}`).value = sup.matchedItems;
    ws.getCell(`D${r}`).alignment = { wrapText: true };

    for (let c = 1; c <= 4; c++) {
      ws.getRow(r).getCell(c).fill = solidFill(rowFill);
      ws.getRow(r).getCell(c).border = thinBorder();
    }
    ws.getRow(r).height = 20;
    r++;
  });

  ws.getRow(r).height = 10; r++;

  // Footer note
  ws.mergeCells(`A${r}:D${r}`);
  ws.getCell(`A${r}`).value = "Tip: Search GSA Advantage (gsaadvantage.gov) and SAM.gov for additional contract-ready vendors.";
  ws.getCell(`A${r}`).font = { italic: true, size: 9, color: { argb: "FF555555" } };
  ws.getCell(`A${r}`).alignment = { horizontal: "center" };
}

// ─── Excel builder ──────────────────────────────────────────────────────────
async function buildAiInvoice(opp: Opportunity, ai: AiResult): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GovPilot";
  wb.created = new Date();

  const ws = wb.addWorksheet("Invoice", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 },
  });

  ws.columns = [
    { width: 8 },   // A  Line #
    { width: 17 },  // B  Item / Part #
    { width: 34 },  // C  Description
    { width: 7 },   // D  Qty
    { width: 9 },   // E  Unit
    { width: 13 },  // F  Unit Price
    { width: 12 },  // G  Shipping
    { width: 10 },  // H  Tax
    { width: 13 },  // I  Line Total
  ];

  let r = 1;

  // Title row with optional logo in top-left corner
  ws.mergeCells(`A${r}:I${r}`);
  const titleCell = ws.getCell(`A${r}`);
  titleCell.value = "QUOTE / INVOICE (For RFQ Response)";
  titleCell.font = { bold: true, size: 18, color: { argb: "FF1F3864" } };
  titleCell.fill = solidFill({ argb: "FFFFFFFF" });
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(r).height = 60;

  // Embed logo if present at public/logo.png
  const logoPath = path.join(process.cwd(), "public", "logo.png");
  if (fs.existsSync(logoPath)) {
    const logoId = wb.addImage({ filename: logoPath, extension: "png" });
    // Place logo overlaid on the left portion of the title row, sized to fill the row height
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws.addImage(logoId, {
      tl: { col: 0.1, row: 0.05 } as any,
      br: { col: 1.8, row: 0.95 } as any,
      editAs: "oneCell",
    });
  }
  r++;

  ws.getRow(r).height = 5; r++;

  // Invoice meta
  ws.getCell(`A${r}`).value = "Invoice Number:";
  ws.getCell(`A${r}`).font = { bold: true };
  ws.mergeCells(`B${r}:D${r}`);
  ws.getCell(`B${r}`).value = "INV-0001";
  ws.getCell(`F${r}`).value = "Invoice Date:";
  ws.getCell(`F${r}`).font = { bold: true };
  ws.mergeCells(`G${r}:I${r}`);
  ws.getCell(`G${r}`).value = new Date();
  ws.getCell(`G${r}`).numFmt = "mmmm d, yyyy";
  r++;

  const deadline = opp.responseDeadLine ?? opp.reponseDeadLine;
  ws.getCell(`A${r}`).value = "Due Date:";
  ws.getCell(`A${r}`).font = { bold: true };
  ws.mergeCells(`B${r}:D${r}`);
  ws.getCell(`F${r}`).value = "Response Deadline:";
  ws.getCell(`F${r}`).font = { bold: true };
  ws.mergeCells(`G${r}:I${r}`);
  if (deadline) {
    const dl = new Date(deadline);
    ws.getCell(`G${r}`).value = isNaN(dl.getTime()) ? deadline : dl;
    if (!isNaN(dl.getTime())) ws.getCell(`G${r}`).numFmt = "mmmm d, yyyy";
  }
  r++;

  ws.getRow(r).height = 8; r++;

  // Vendor / Buyer headers
  ws.mergeCells(`A${r}:D${r}`);
  ws.getCell(`A${r}`).value = "VENDOR (SELLER)";
  ws.getCell(`A${r}`).font = whiteFont();
  ws.getCell(`A${r}`).fill = solidFill(NAVY);
  ws.getCell(`A${r}`).alignment = { horizontal: "center" };
  ws.mergeCells(`F${r}:I${r}`);
  ws.getCell(`F${r}`).value = "CUSTOMER (BUYER)";
  ws.getCell(`F${r}`).font = whiteFont();
  ws.getCell(`F${r}`).fill = solidFill(NAVY);
  ws.getCell(`F${r}`).alignment = { horizontal: "center" };
  r++;

  const poc = opp.pointOfContact?.[0];
  const pop = opp.placeOfPerformance;
  const popStr = [pop?.city?.name, pop?.state?.name ?? pop?.state?.code, pop?.zip]
    .filter(Boolean).join(", ");
  const agency = opp.fullParentPathName ?? opp.organizationName ?? "";

  const vendorRows: [string, string][] = [
    ["Company Name:", COMPANY.name],
    ["Contact:", COMPANY.contact],
    ["Phone:", COMPANY.phone],
    ["Email:", COMPANY.email],
    ["UEI:", COMPANY.uei],
    ["CAGE:", COMPANY.cage],
  ];
  const buyerRows: [string, string][] = [
    ["Agency:", agency],
    ["POC Name:", poc?.fullName ?? ""],
    ["POC Email:", poc?.email ?? ""],
    ["POC Phone:", poc?.phone ?? ""],
    ["Ship To:", popStr],
    ["", ""],
  ];

  for (let i = 0; i < vendorRows.length; i++) {
    const [vl, vv] = vendorRows[i];
    const [bl, bv] = buyerRows[i];
    ws.getCell(`A${r}`).value = vl; ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`A${r}`).fill = solidFill(LIGHT_BLUE); ws.getCell(`A${r}`).border = thinBorder();
    ws.mergeCells(`B${r}:D${r}`); ws.getCell(`B${r}`).value = vv; ws.getCell(`B${r}`).border = thinBorder();
    ws.getCell(`F${r}`).value = bl; ws.getCell(`F${r}`).font = { bold: true };
    ws.getCell(`F${r}`).fill = solidFill(LIGHT_BLUE); ws.getCell(`F${r}`).border = thinBorder();
    ws.mergeCells(`G${r}:I${r}`); ws.getCell(`G${r}`).value = bv; ws.getCell(`G${r}`).border = thinBorder();
    r++;
  }

  ws.getRow(r).height = 8; r++;

  // Opportunity reference
  ws.mergeCells(`A${r}:I${r}`);
  ws.getCell(`A${r}`).value = "OPPORTUNITY REFERENCE";
  ws.getCell(`A${r}`).font = whiteFont(); ws.getCell(`A${r}`).fill = solidFill(NAVY);
  ws.getCell(`A${r}`).alignment = { horizontal: "center" };
  r++;

  ws.getCell(`A${r}`).value = "Title:"; ws.getCell(`A${r}`).font = { bold: true };
  ws.getCell(`A${r}`).fill = solidFill(LIGHT_BLUE); ws.getCell(`A${r}`).border = thinBorder();
  ws.mergeCells(`B${r}:I${r}`); ws.getCell(`B${r}`).value = opp.title;
  ws.getCell(`B${r}`).font = { bold: true }; ws.getCell(`B${r}`).border = thinBorder();
  ws.getCell(`B${r}`).alignment = { wrapText: true }; ws.getRow(r).height = 30;
  r++;

  const displayDate = (raw?: string) => {
    if (!raw) return "";
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  };

  const refRows: [string, string, string, string][] = [
    ["Solicitation #:", opp.solicitationNumber ?? "", "Notice ID:", opp.noticeId],
    ["Posted Date:", displayDate(opp.postedDate), "Response Deadline:", displayDate(deadline)],
    ["NAICS Code:", opp.naicsCode ?? "", "Classification:", opp.classificationCode ?? ""],
  ];

  for (const [l1, v1, l2, v2] of refRows) {
    ws.getCell(`A${r}`).value = l1; ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`A${r}`).fill = solidFill(LIGHT_BLUE); ws.getCell(`A${r}`).border = thinBorder();
    ws.mergeCells(`B${r}:D${r}`); ws.getCell(`B${r}`).value = v1; ws.getCell(`B${r}`).border = thinBorder();
    ws.getCell(`F${r}`).value = l2; ws.getCell(`F${r}`).font = { bold: true };
    ws.getCell(`F${r}`).fill = solidFill(LIGHT_BLUE); ws.getCell(`F${r}`).border = thinBorder();
    ws.mergeCells(`G${r}:I${r}`); ws.getCell(`G${r}`).value = v2; ws.getCell(`G${r}`).border = thinBorder();
    r++;
  }

  ws.getRow(r).height = 8; r++;

  // Line items table header
  const colHeaders = ["Line #", "Item / Part Number", "Description", "Qty", "Unit", "Unit Price", "Shipping", "Tax", "Line Total"];
  colHeaders.forEach((h, i) => {
    const cell = ws.getRow(r).getCell(i + 1);
    cell.value = h; cell.font = whiteFont(); cell.fill = solidFill(BLUE_HDR);
    cell.alignment = { horizontal: "center", vertical: "middle" }; cell.border = thinBorder();
  });
  ws.getRow(r).height = 22;
  r++;

  const firstDataRow = r;
  const NUM_LINES = Math.max(10, ai.items.length);

  for (let i = 0; i < NUM_LINES; i++) {
    const item = ai.items[i];
    const rowFill = i % 2 === 0 ? WHITE : LIGHT_GRAY;

    ws.getRow(r).getCell(1).value = i + 1;
    ws.getRow(r).getCell(1).alignment = { horizontal: "center" };

    if (item) {
      ws.getRow(r).getCell(2).value = item.partNumber || "";
      ws.getRow(r).getCell(3).value = item.description || "";
      ws.getRow(r).getCell(3).alignment = { wrapText: true };
      const qty = typeof item.quantity === "number" ? item.quantity : Number(item.quantity) || undefined;
      if (qty !== undefined) ws.getRow(r).getCell(4).value = qty;
      ws.getRow(r).getCell(5).value = item.unit || "EA";
    }

    ws.getRow(r).getCell(9).value = { formula: `=IF(D${r}="","",D${r}*F${r}+G${r}+H${r})` };
    ws.getRow(r).getCell(9).numFmt = '"$"#,##0.00';

    for (let c = 1; c <= 9; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.fill = solidFill(rowFill);
      cell.border = thinBorder();
      if (c === 6 || c === 7 || c === 8) cell.numFmt = '"$"#,##0.00';
    }
    ws.getRow(r).height = item?.description && item.description.length > 60 ? 30 : 18;
    r++;
  }
  const lastDataRow = r - 1;

  ws.getRow(r).height = 6; r++;

  // Totals
  const subtotalRowNum = r;
  const totals: [string, string][] = [
    ["Subtotal", `=SUM(I${firstDataRow}:I${lastDataRow})`],
    ["Shipping Total", `=SUM(G${firstDataRow}:G${lastDataRow})`],
    ["Tax Total", `=SUM(H${firstDataRow}:H${lastDataRow})`],
  ];
  for (const [label, formula] of totals) {
    ws.mergeCells(`A${r}:H${r}`);
    ws.getCell(`A${r}`).value = label; ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`A${r}`).alignment = { horizontal: "right" };
    ws.getCell(`A${r}`).fill = solidFill(LIGHT_GRAY); ws.getCell(`A${r}`).border = thinBorder();
    ws.getCell(`I${r}`).value = { formula }; ws.getCell(`I${r}`).numFmt = '"$"#,##0.00';
    ws.getCell(`I${r}`).font = { bold: true }; ws.getCell(`I${r}`).fill = solidFill(LIGHT_GRAY);
    ws.getCell(`I${r}`).border = thinBorder();
    r++;
  }

  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = "GRAND TOTAL"; ws.getCell(`A${r}`).font = whiteFont(13);
  ws.getCell(`A${r}`).fill = solidFill(NAVY); ws.getCell(`A${r}`).alignment = { horizontal: "right" };
  ws.getCell(`A${r}`).border = thinBorder();
  ws.getCell(`I${r}`).value = { formula: `=I${subtotalRowNum}+I${subtotalRowNum + 1}+I${subtotalRowNum + 2}` };
  ws.getCell(`I${r}`).numFmt = '"$"#,##0.00'; ws.getCell(`I${r}`).font = whiteFont(13);
  ws.getCell(`I${r}`).fill = solidFill(NAVY); ws.getCell(`I${r}`).border = thinBorder();
  ws.getRow(r).height = 24;
  r++;

  ws.getRow(r).height = 10; r++;

  // Terms & Conditions — pre-filled from AI
  ws.mergeCells(`A${r}:I${r}`);
  ws.getCell(`A${r}`).value = "TERMS & CONDITIONS";
  ws.getCell(`A${r}`).font = whiteFont(); ws.getCell(`A${r}`).fill = solidFill(NAVY);
  ws.getCell(`A${r}`).alignment = { horizontal: "center" };
  r++;

  const terms: [string, string, number][] = [
    ["Delivery Lead Time:", ai.deliveryTerms, 18],
    ["Payment Terms:", ai.paymentTerms || "Net 30", 18],
    ["Country of Origin:", "", 18],
    ["Notes:", ai.notes, ai.notes.length > 80 ? 60 : 30],
  ];
  for (const [label, val, height] of terms) {
    ws.getCell(`A${r}`).value = label; ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`A${r}`).fill = solidFill(LIGHT_BLUE); ws.getCell(`A${r}`).border = thinBorder();
    ws.mergeCells(`B${r}:I${r}`); ws.getCell(`B${r}`).value = val;
    ws.getCell(`B${r}`).border = thinBorder();
    ws.getCell(`B${r}`).alignment = { wrapText: true, vertical: "top" };
    ws.getRow(r).height = height;
    r++;
  }

  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 4, topLeftCell: "A5" }];
  return wb;
}


// ─── Route handler ──────────────────────────────────────────────────────────
// Accepts the opportunity object from the client (already in component state)
// so we never need an extra SAM API call.
export async function POST(
  req: NextRequest,
  { params: _ }: { params: { noticeId: string } }
) {
  if (!OPENAI_KEY || OPENAI_KEY === "your_openai_api_key_here") {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured in .env.local." }, { status: 500 });
  }

  let opp: Opportunity;
  try {
    opp = (await req.json()) as Opportunity;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!opp?.noticeId) {
    return NextResponse.json({ error: "Opportunity data missing" }, { status: 400 });
  }

  console.log("[invoice-ai] resourceLinks:", opp.resourceLinks ?? []);
  console.log("[invoice-ai] description url:", opp.description ?? "(none)");

  // Gather text sources. Skip the description URL when PDFs are available —
  // the PDFs contain the full solicitation and description calls often 429.
  const textParts: string[] = [];
  const fetchErrors: string[] = [];
  const hasPdfs = (opp.resourceLinks?.length ?? 0) > 0;

  if (opp.description && !hasPdfs) {
    const { text: descText, error } = await fetchSamContent(opp.description);
    if (error) fetchErrors.push(error);
    if (descText) textParts.push(`--- DESCRIPTION ---\n${descText}`);
  }

  if (opp.resourceLinks?.length) {
    for (const url of opp.resourceLinks) {
      const { text: pdfText, error } = await fetchSamContent(url);
      if (error) fetchErrors.push(error);
      if (pdfText) textParts.push(`--- ATTACHMENT ---\n${pdfText}`);
    }
  }

  const combinedText = textParts.join("\n\n");
  console.log("[invoice-ai] combined text length:", combinedText.length);

  if (!combinedText.trim()) {
    return NextResponse.json(
      {
        error: "No readable content found in the solicitation documents.",
        fetchErrors,
        resourceLinks: opp.resourceLinks ?? [],
        hasDescription: !!opp.description,
      },
      { status: 422 }
    );
  }

  const debugInfo = {
    resourceLinksCount: opp.resourceLinks?.length ?? 0,
    hasDescription: !!opp.description,
    combinedTextLength: combinedText.length,
    textPartsCount: textParts.length,
  };

  let ai: AiResult;
  const cachedAi = cacheGet(aiResultCache, opp.noticeId);
  if (cachedAi) {
    ai = cachedAi;
  } else {
    try {
      ai = await extractWithAI(combinedText, opp.title);
      cacheSet(aiResultCache, opp.noticeId, ai);
    } catch (err) {
      console.error("[invoice-ai] OpenAI error:", err);
      return NextResponse.json({ error: "OpenAI extraction failed", detail: String(err), debug: debugInfo }, { status: 500 });
    }
  }

  // Run supplier lookup in parallel with Excel build for speed
  const [wb, supplierResult] = await Promise.all([
    buildAiInvoice(opp, ai),
    suggestSuppliers(ai.items, opp.naicsCode ?? undefined).catch(() => ({ suppliers: [] })),
  ]);

  addSuppliersSheet(wb, supplierResult.suppliers, ai.items);

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await wb.xlsx.writeBuffer());
  } catch (err) {
    console.error("[invoice-ai] Excel build error:", err);
    return NextResponse.json({ error: "Excel generation failed", detail: String(err) }, { status: 500 });
  }

  const titlePart = (opp.title ?? "Invoice").slice(0, 60).replace(/[^a-zA-Z0-9 _-]/g, "").trim();
  const solPart = (opp.solicitationNumber ?? opp.noticeId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeName = `${titlePart} - ${solPart}.xlsx`;

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "X-Debug-ResourceLinks": String(debugInfo.resourceLinksCount),
      "X-Debug-TextLength": String(debugInfo.combinedTextLength),
      "X-Debug-TextParts": String(debugInfo.textPartsCount),
      "X-Debug-Items": String(ai.items.length),
    },
  });
}
