import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { cache } from "@/lib/cache";
import { Opportunity, SamApiResponse } from "@/lib/types";

const SAM_BASE = process.env.SAM_BASE_URL ?? "https://api.sam.gov";
const SAM_KEY = process.env.SAM_API_KEY ?? "";

const COMPANY = {
  name: "Perpignad Florida Services LLC",
  contact: "Cedric Perpignand",
  phone: "3052002591",
  email: "cedricperpignand@gmail.com",
  uei: "[PLACEHOLDER - TBD]",
  cage: "[PLACEHOLDER - TBD]",
};

// ─── Colors ────────────────────────────────────────────────────────────────
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

// ─── SAM fetch (uses server cache first) ───────────────────────────────────
async function getOpportunity(noticeId: string): Promise<Opportunity | null> {
  const cached = cache.get<SamApiResponse>(`detail:${noticeId}`);
  if (cached?.opportunitiesData?.[0]) return cached.opportunitiesData[0];

  const fmt = (d: Date) => {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${mm}/${dd}/${d.getFullYear()}`;
  };
  const today = fmt(new Date());
  const yearAgo = fmt(new Date(Date.now() - 364 * 86_400_000));

  try {
    const url = [
      `${SAM_BASE}/opportunities/v2/search`,
      `?api_key=${encodeURIComponent(SAM_KEY)}`,
      `&noticeid=${encodeURIComponent(noticeId)}`,
      `&postedFrom=${yearAgo}`,
      `&postedTo=${today}`,
      `&limit=10&offset=0`,
    ].join("");
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as SamApiResponse;
    return data.opportunitiesData?.[0] ?? null;
  } catch { return null; }
}

// ─── Excel generation ──────────────────────────────────────────────────────
async function buildInvoice(opp: Opportunity): Promise<Buffer> {
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

  let r = 1; // row pointer — tracks current row throughout

  // ── TITLE ───────────────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:I${r}`);
  const titleCell = ws.getCell(`A${r}`);
  titleCell.value = "QUOTE / INVOICE (For RFQ Response)";
  titleCell.font = whiteFont(18);
  titleCell.fill = solidFill(NAVY);
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(r).height = 38;
  r++;

  ws.getRow(r).height = 5; r++; // spacer

  // ── INVOICE META ────────────────────────────────────────────────────────
  // Invoice Number / Invoice Date
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

  // Due Date / Response Deadline
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

  ws.getRow(r).height = 8; r++; // spacer

  // ── VENDOR / CUSTOMER HEADERS ────────────────────────────────────────────
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

  // Vendor / Buyer data rows
  const poc = opp.pointOfContact?.[0];
  const pop = opp.placeOfPerformance;
  const popStr = [pop?.city?.name, pop?.state?.name ?? pop?.state?.code, pop?.zip]
    .filter(Boolean).join(", ");
  const agency = opp.fullParentPathName ?? opp.organizationName ?? "";

  const vendorRows: [string, string][] = [
    ["Company Name:", COMPANY.name],
    ["Contact:",      COMPANY.contact],
    ["Phone:",        COMPANY.phone],
    ["Email:",        COMPANY.email],
    ["UEI:",          COMPANY.uei],
    ["CAGE:",         COMPANY.cage],
  ];
  const buyerRows: [string, string][] = [
    ["Agency:",     agency],
    ["POC Name:",   poc?.fullName ?? ""],
    ["POC Email:",  poc?.email    ?? ""],
    ["POC Phone:",  poc?.phone    ?? ""],
    ["Ship To:",    popStr],
    ["",            ""],
  ];

  for (let i = 0; i < vendorRows.length; i++) {
    const [vl, vv] = vendorRows[i];
    const [bl, bv] = buyerRows[i];

    ws.getCell(`A${r}`).value = vl;
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`A${r}`).fill = solidFill(LIGHT_BLUE);
    ws.getCell(`A${r}`).border = thinBorder();
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value = vv;
    ws.getCell(`B${r}`).border = thinBorder();

    ws.getCell(`F${r}`).value = bl;
    ws.getCell(`F${r}`).font = { bold: true };
    ws.getCell(`F${r}`).fill = solidFill(LIGHT_BLUE);
    ws.getCell(`F${r}`).border = thinBorder();
    ws.mergeCells(`G${r}:I${r}`);
    ws.getCell(`G${r}`).value = bv;
    ws.getCell(`G${r}`).border = thinBorder();
    r++;
  }

  ws.getRow(r).height = 8; r++; // spacer

  // ── OPPORTUNITY REFERENCE ────────────────────────────────────────────────
  ws.mergeCells(`A${r}:I${r}`);
  ws.getCell(`A${r}`).value = "OPPORTUNITY REFERENCE";
  ws.getCell(`A${r}`).font = whiteFont();
  ws.getCell(`A${r}`).fill = solidFill(NAVY);
  ws.getCell(`A${r}`).alignment = { horizontal: "center" };
  r++;

  // Title (full width)
  ws.getCell(`A${r}`).value = "Title:";
  ws.getCell(`A${r}`).font = { bold: true };
  ws.getCell(`A${r}`).fill = solidFill(LIGHT_BLUE);
  ws.getCell(`A${r}`).border = thinBorder();
  ws.mergeCells(`B${r}:I${r}`);
  ws.getCell(`B${r}`).value = opp.title;
  ws.getCell(`B${r}`).font = { bold: true };
  ws.getCell(`B${r}`).border = thinBorder();
  ws.getCell(`B${r}`).alignment = { wrapText: true };
  ws.getRow(r).height = 30;
  r++;

  // Two-column reference rows
  const displayDate = (raw?: string) => {
    if (!raw) return "";
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  };

  const refRows: [string, string, string, string][] = [
    ["Solicitation #:", opp.solicitationNumber ?? "", "Notice ID:", opp.noticeId],
    ["Posted Date:",    displayDate(opp.postedDate),  "Response Deadline:", displayDate(deadline)],
    ["NAICS Code:",     opp.naicsCode ?? "",           "Classification:",    opp.classificationCode ?? ""],
  ];

  for (const [l1, v1, l2, v2] of refRows) {
    ws.getCell(`A${r}`).value = l1;
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`A${r}`).fill = solidFill(LIGHT_BLUE);
    ws.getCell(`A${r}`).border = thinBorder();
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value = v1;
    ws.getCell(`B${r}`).border = thinBorder();

    ws.getCell(`F${r}`).value = l2;
    ws.getCell(`F${r}`).font = { bold: true };
    ws.getCell(`F${r}`).fill = solidFill(LIGHT_BLUE);
    ws.getCell(`F${r}`).border = thinBorder();
    ws.mergeCells(`G${r}:I${r}`);
    ws.getCell(`G${r}`).value = v2;
    ws.getCell(`G${r}`).border = thinBorder();
    r++;
  }

  ws.getRow(r).height = 8; r++; // spacer

  // ── LINE ITEMS TABLE ─────────────────────────────────────────────────────
  const colHeaders = [
    "Line #", "Item / Part Number", "Description",
    "Qty", "Unit", "Unit Price", "Shipping", "Tax", "Line Total",
  ];
  colHeaders.forEach((h, i) => {
    const cell = ws.getRow(r).getCell(i + 1);
    cell.value = h;
    cell.font = whiteFont();
    cell.fill = solidFill(BLUE_HDR);
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = thinBorder();
  });
  ws.getRow(r).height = 22;
  r++;

  const firstDataRow = r;
  const NUM_LINES = 10;

  for (let i = 1; i <= NUM_LINES; i++) {
    const rowFill = i % 2 === 0 ? LIGHT_GRAY : WHITE;
    ws.getRow(r).getCell(1).value = i;
    ws.getRow(r).getCell(1).alignment = { horizontal: "center" };
    // Line Total = Qty × Unit Price + Shipping + Tax
    ws.getRow(r).getCell(9).value = {
      formula: `=IF(D${r}="","",D${r}*F${r}+G${r}+H${r})`,
    };
    ws.getRow(r).getCell(9).numFmt = '"$"#,##0.00';
    for (let c = 1; c <= 9; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.fill = solidFill(rowFill);
      cell.border = thinBorder();
      if (c === 6 || c === 7 || c === 8) cell.numFmt = '"$"#,##0.00';
    }
    ws.getRow(r).height = 18;
    r++;
  }
  const lastDataRow = r - 1;

  ws.getRow(r).height = 6; r++; // spacer

  // ── TOTALS ───────────────────────────────────────────────────────────────
  const subtotalRowNum = r;

  const totals: [string, string][] = [
    ["Subtotal",       `=SUM(I${firstDataRow}:I${lastDataRow})`],
    ["Shipping Total", `=SUM(G${firstDataRow}:G${lastDataRow})`],
    ["Tax Total",      `=SUM(H${firstDataRow}:H${lastDataRow})`],
  ];

  for (const [label, formula] of totals) {
    ws.mergeCells(`A${r}:H${r}`);
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`A${r}`).alignment = { horizontal: "right" };
    ws.getCell(`A${r}`).fill = solidFill(LIGHT_GRAY);
    ws.getCell(`A${r}`).border = thinBorder();
    ws.getCell(`I${r}`).value = { formula };
    ws.getCell(`I${r}`).numFmt = '"$"#,##0.00';
    ws.getCell(`I${r}`).font = { bold: true };
    ws.getCell(`I${r}`).fill = solidFill(LIGHT_GRAY);
    ws.getCell(`I${r}`).border = thinBorder();
    r++;
  }

  // Grand Total
  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = "GRAND TOTAL";
  ws.getCell(`A${r}`).font = whiteFont(13);
  ws.getCell(`A${r}`).fill = solidFill(NAVY);
  ws.getCell(`A${r}`).alignment = { horizontal: "right" };
  ws.getCell(`A${r}`).border = thinBorder();
  ws.getCell(`I${r}`).value = {
    formula: `=I${subtotalRowNum}+I${subtotalRowNum + 1}+I${subtotalRowNum + 2}`,
  };
  ws.getCell(`I${r}`).numFmt = '"$"#,##0.00';
  ws.getCell(`I${r}`).font = whiteFont(13);
  ws.getCell(`I${r}`).fill = solidFill(NAVY);
  ws.getCell(`I${r}`).border = thinBorder();
  ws.getRow(r).height = 24;
  r++;

  ws.getRow(r).height = 10; r++; // spacer

  // ── TERMS & CONDITIONS ───────────────────────────────────────────────────
  ws.mergeCells(`A${r}:I${r}`);
  ws.getCell(`A${r}`).value = "TERMS & CONDITIONS";
  ws.getCell(`A${r}`).font = whiteFont();
  ws.getCell(`A${r}`).fill = solidFill(NAVY);
  ws.getCell(`A${r}`).alignment = { horizontal: "center" };
  r++;

  const terms: [string, string, number][] = [
    ["Delivery Lead Time:", "",       18],
    ["Payment Terms:",      "Net 30", 18],
    ["Country of Origin:",  "",       18],
    ["Notes:",              "",       48],
  ];

  for (const [label, val, height] of terms) {
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`A${r}`).fill = solidFill(LIGHT_BLUE);
    ws.getCell(`A${r}`).border = thinBorder();
    ws.mergeCells(`B${r}:I${r}`);
    ws.getCell(`B${r}`).value = val;
    ws.getCell(`B${r}`).border = thinBorder();
    if (height > 18) ws.getCell(`B${r}`).alignment = { wrapText: true, vertical: "top" };
    ws.getRow(r).height = height;
    r++;
  }

  // Freeze the top 4 rows (title + invoice meta)
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 4, topLeftCell: "A5" }];

  return (await wb.xlsx.writeBuffer()) as Buffer;
}

// ─── Route handler ─────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: { noticeId: string } }
) {
  if (!SAM_KEY || SAM_KEY === "PASTE_YOUR_SAM_GOV_API_KEY_HERE") {
    return NextResponse.json({ error: "SAM_API_KEY not configured." }, { status: 500 });
  }

  const { noticeId } = params;
  if (!noticeId) {
    return NextResponse.json({ error: "noticeId required" }, { status: 400 });
  }

  const opp = await getOpportunity(noticeId);
  if (!opp) {
    return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
  }

  try {
    const buffer = await buildInvoice(opp);
    const safeName = `Invoice_${(opp.solicitationNumber ?? noticeId).replace(/[^a-zA-Z0-9_-]/g, "_")}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeName}"`,
      },
    });
  } catch (err) {
    console.error("[Invoice error]", err);
    return NextResponse.json(
      { error: "Failed to generate Excel file", detail: String(err) },
      { status: 500 }
    );
  }
}
