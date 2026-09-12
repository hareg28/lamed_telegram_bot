import fs from "fs";
import path from "path";
import { google } from "googleapis";
import type {
  MaterialRequest,
  MaterialRequestItem,
  Project,
  PurchaseRequest,
  PurchaseRequestItem,
  Supplier,
  User,
} from "@prisma/client";
import { decimalToNumber, formatDate, getRequesterDisplayName } from "./calculations";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

let SHEET_ID = process.env.GOOGLE_SHEET_ID?.trim();

// ✅ Uses GOOGLE_SERVICE_ACCOUNT_EMAIL & GOOGLE_PRIVATE_KEY, or resolves key file
async function getSheetsClient() {
  SHEET_ID = process.env.GOOGLE_SHEET_ID?.trim();

  if (!SHEET_ID || SHEET_ID.startsWith("#")) {
    console.warn("GOOGLE_SHEET_ID is not configured or invalid in environment variables.");
    return null;
  }

  // 1. Service account email + private key (preferred on Vercel/serverless)
  let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim().replace(/^["']|["']$/g, "");
  let privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim().replace(/^["']|["']$/g, "");

  // 2. Fallback: Read from local google-sheets-key.json file if env vars are missing
  if (!email || !privateKey) {
    const candidatePaths = [
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
      path.join(process.cwd(), "google-sheets-key.json"),
      path.join(process.cwd(), "tele_bot", "google-sheets-key.json"),
    ].filter(Boolean) as string[];

    for (const keyPath of candidatePaths) {
      try {
        if (fs.existsSync(keyPath)) {
          const content = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
          if (content.client_email && content.private_key) {
            email = content.client_email;
            privateKey = content.private_key;
            break;
          }
        }
      } catch (e) {
        // ignore parse error and keep trying
      }
    }
  }

  if (email && privateKey) {
    try {
      privateKey = privateKey.replace(/\\n/g, "\n");
      const auth = new google.auth.JWT({
        email,
        key: privateKey,
        scopes: SCOPES,
      });
      return google.sheets({ version: "v4", auth });
    } catch (err) {
      console.error("Failed to initialize Google Sheets via service account credentials", err);
    }
  }

  console.warn("Google Sheets credentials not configured. Please set GOOGLE_SERVICE_ACCOUNT_EMAIL & GOOGLE_PRIVATE_KEY in your deployment environment variables (Vercel).");
  return null;
}

// ============================================================
// Sheet column definitions
// ============================================================

const MR_SHEET = "Material Requests";
const MR_HEADERS = [
  "MR Number",
  "MR Date",
  "Project",
  "Project Type",
  "BOQ",
  "Employee",
  "Material Line ID",
  "Material",
  "Quantity",
  "Unit",
  "Status",
  "Remarks",
];

const PR_SHEET = "Purchase Requests";
const PR_HEADERS = [
  "PR Number",         // A
  "Project Type",      // B
  "Project",           // C — Project Name
  "BOQ",               // D
  "Material",          // E — Item Name
  "Quantity",          // F
  "Unit",              // G
  "Unit Price (ETB)",  // H
  "Total Price (ETB)", // I — Item amount
  "VAT Status",        // J — Price Type (Excluding/Including VAT)
  "VAT (ETB)",         // K — VAT Amount
  "Total Amount (ETB)",// L — PR Grand Total
  "MR Date",           // M — Material Request date
  "PR Date",           // N — Purchase Request creation date
  "Status",            // O
  "Supplier Name",     // P
  "Supplier Phone",    // Q
  "PR Line ID",        // R
];

const SUPPLIER_SHEET = "Supplier Information";
const SUPPLIER_HEADERS = [
  "Supplier Name",
  "Company Name",
  "Phone",
  "VAT Registered",
  "Bank Name",
  "Bank Account",
  "Registration Date",
  "Status",
];

const PRICE_HISTORY_SHEET = "Price History";
const PRICE_HISTORY_HEADERS = [
  "Material Name",
  "Supplier Name",
  "Quantity",
  "Unit",
  "Unit Price",
  "Price Type",
  "VAT %",
  "VAT Amount",
  "Final Price (Inc. VAT)",
  "Purchase Date",
  "PR Number",
  "Purchaser",
];

const PROJECT_SHEET = "Projects";
const PROJECT_HEADERS = [
  "Project Name",
  "Project Type",
  "Description",
  "BOQ List",
  "Status",
  "Registered Date",
];

// ============================================================
// Helpers
// ============================================================

function cleanMaterialName(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/^\[.*?\]\s*/, "").trim();
}

async function getSheetId(sheets: any, title: string): Promise<number | null> {
  if (!SHEET_ID) return null;
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
    });
    const sheet = spreadsheet.data.sheets?.find(
      (s: any) => s.properties?.title === title
    );
    return sheet?.properties?.sheetId ?? null;
  } catch (err) {
    console.error(`Failed to get sheet ID for ${title}:`, err);
    return null;
  }
}

async function ensureWorksheet(sheets: any, title: string, headers: string[]) {
  if (!SHEET_ID) return;
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
    });
    const sheetExists = spreadsheet.data.sheets?.some(
      (s: any) => s.properties?.title === title
    );

    if (!sheetExists) {
      // Create the sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title },
              },
            },
          ],
        },
      });

      // Write headers for new sheet
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${title}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [headers] },
      });
    } else {
      // Sheet exists — keep headers aligned with the current schema.
      const headerRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${title}!1:1`,
      });
      const existingHeaders: string[] = headerRes.data.values?.[0] ?? [];
      const headersChanged =
        existingHeaders.length !== headers.length ||
        existingHeaders.some((value, index) => value !== headers[index]);

      if (headersChanged) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${title}!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [headers] },
        });
      }

      if (existingHeaders.length > headers.length) {
        const sheetId = await getSheetId(sheets, title);
        if (sheetId !== null) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: {
              requests: [
                {
                  deleteDimension: {
                    range: {
                      sheetId,
                      dimension: "COLUMNS",
                      startIndex: headers.length,
                      endIndex: existingHeaders.length,
                    },
                  },
                },
              ],
            },
          });
        }
      }
    }
  } catch (err) {
    console.error(`Failed to ensure worksheet ${title}:`, err);
  }
}

/**
 * Find the row index (1-based) of an existing record by its unique number
 * in column A. Returns null if not found.
 */
async function findRowByKey(
  sheets: any,
  sheetTitle: string,
  key: string,
  searchColumn: string = "A"
): Promise<number | null> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${sheetTitle}!${searchColumn}:${searchColumn}`,
    });
    const rows: string[][] = res.data.values ?? [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]?.[0] === key) return i + 1; // 1-based sheet row
    }
  } catch {
    // sheet may not exist yet
  }
  return null;
}

async function getNextEmptyRow(sheets: any, sheetTitle: string): Promise<number> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${sheetTitle}!A:A`,
    });
    const rows = res.data.values ?? [];
    return rows.length + 1; // 1-based next row index
  } catch {
    return 2; // default to row 2
  }
}

/**
 * Upsert a single row identified by a key in searchColumn.
 * If the key exists, update that row in place.
 * If not found, write to the next empty row.
 */
async function upsertRow(
  sheets: any,
  sheetTitle: string,
  headers: string[],
  key: string,
  values: (string | number | boolean | null)[],
  searchColumn: string = "A"
) {
  if (!SHEET_ID) return;
  await ensureWorksheet(sheets, sheetTitle, headers);

  const existingRow = await findRowByKey(sheets, sheetTitle, key, searchColumn);
  const colCount = headers.length;
  
  const targetRow = existingRow ?? (await getNextEmptyRow(sheets, sheetTitle));
  const range = `${sheetTitle}!A${targetRow}:${colLetter(colCount)}${targetRow}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ============================================================
// Sheet 1 — Material Requests
// ============================================================

/**
 * Delete ALL rows in MR_SHEET that belong to a given MR number (matched in column A).
 * This ensures stale items are removed before rewriting.
 */
async function deleteMrRows(sheets: any, mrNumber: string): Promise<void> {
  if (!SHEET_ID) return;
  try {
    // Get spreadsheet metadata to find the sheet's grid ID
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const sheetMeta = spreadsheet.data.sheets?.find(
      (s: any) => s.properties?.title === MR_SHEET
    );
    if (!sheetMeta) return;
    const sheetId = sheetMeta.properties?.sheetId;

    // Read column A to find all row indices matching this MR number
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${MR_SHEET}!A:A`,
    });
    const rows: string[][] = res.data.values ?? [];
    // Collect 0-based row indices (skip header row 0)
    const rowsToDelete: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]?.[0] === mrNumber) rowsToDelete.push(i);
    }
    if (rowsToDelete.length === 0) return;

    // Delete in reverse order so indices don't shift
    rowsToDelete.sort((a, b) => b - a);
    const requests = rowsToDelete.map((rowIdx) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: rowIdx,
          endIndex: rowIdx + 1,
        },
      },
    }));
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests },
    });
  } catch (err) {
    console.error(`Failed to delete MR rows for ${mrNumber}:`, err);
  }
}

/**
 * Delete all rows in PR_SHEET for a given PR number (matched in column A).
 * This keeps the sheet in sync without storing extra identifier columns.
 */
async function deletePrRows(sheets: any, prNumber: string): Promise<void> {
  if (!SHEET_ID) return;
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const sheetMeta = spreadsheet.data.sheets?.find(
      (s: any) => s.properties?.title === PR_SHEET
    );
    if (!sheetMeta) return;
    const sheetId = sheetMeta.properties?.sheetId;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${PR_SHEET}!A:A`,
    });
    const rows: string[][] = res.data.values ?? [];
    const rowsToDelete: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]?.[0] === prNumber) rowsToDelete.push(i);
    }
    if (rowsToDelete.length === 0) return;

    rowsToDelete.sort((a, b) => b - a);
    const requests = rowsToDelete.map((rowIdx) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: rowIdx,
          endIndex: rowIdx + 1,
        },
      },
    }));
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests },
    });
  } catch (err) {
    console.error(`Failed to delete PR rows for ${prNumber}:`, err);
  }
}

export async function upsertMaterialRequestRows(
  mr: MaterialRequest & {
    items: MaterialRequestItem[];
    requestedBy: User;
    approvedBy?: User | null;
  },
  options?: {
    rejectionReason?: string;
    approvedByName?: string;
  }
) {
  if (!SHEET_ID) return;
  const sheets = await getSheetsClient();
  if (!sheets) return;

  await ensureWorksheet(sheets, MR_SHEET, MR_HEADERS);

  const requester = getRequesterDisplayName(mr);
  const status = formatMrStatus(mr.status);

  try {
    // First, get all existing rows to find which keys already exist
    const allRowsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${MR_SHEET}!A:${colLetter(MR_HEADERS.length)}`,
    });
    const allRows = allRowsRes.data.values ?? [];
    
    // Create a map of key to row index
    const keyToRowMap = new Map<string, number>();
    // Column G is index 6 (0-based)
    for (let i = 1; i < allRows.length; i++) { // skip header row (i=0)
      const key = allRows[i][6];
      if (key) {
        keyToRowMap.set(key, i + 1); // +1 to convert to 1-based
      }
    }

    // Get sheet ID ONCE
    const sheetId = await getSheetId(sheets, MR_SHEET);

    // Determine next available row (if needed)
    let nextRow = allRows.length + 1; // 1-based
    
    // Prepare batch update requests
    const requests: any[] = [];

    // Process each item
    for (let idx = 0; idx < mr.items.length; idx++) {
      const item = mr.items[idx];
      const rowKey = item.lineId ?? `${mr.mrNumber}/${idx + 1}`;
      
      const itemBoq = (item as any).boqSection?.trim() || mr.boq?.trim() || "";
      const values = [
        mr.mrNumber,
        formatDate(mr.requestDate),
        mr.projectName,
        mr.projectType ?? "",
        itemBoq,
        requester,
        rowKey,
        cleanMaterialName(item.itemName),
        decimalToNumber(item.quantity),
        item.unit,
        status,
        options?.rejectionReason ?? "",
      ];

      let targetRow = keyToRowMap.get(rowKey);
      if (!targetRow) {
        targetRow = nextRow;
        nextRow++;
      }

      // Add update request to batch
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: targetRow - 1,
            endRowIndex: targetRow,
            startColumnIndex: 0,
            endColumnIndex: MR_HEADERS.length,
          },
          rows: [
            {
              values: values.map(v => {
                if (v === null || v === undefined) return { userEnteredValue: { stringValue: "" } };
                if (typeof v === "number") return { userEnteredValue: { numberValue: v } };
                if (typeof v === "boolean") return { userEnteredValue: { boolValue: v } };
                return { userEnteredValue: { stringValue: String(v) } };
              }),
            },
          ],
          fields: "userEnteredValue",
        },
      });
    }

    // Execute batch update if there are requests
    if (requests.length > 0 && sheetId !== null) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { requests },
      });
    }

    console.log(`Synced ${mr.items.length} MR rows for ${mr.mrNumber} to Google Sheets`);
  } catch (err) {
    console.error("Error syncing MR to Google Sheets", err);
  }
}

/** Legacy alias kept for backward compatibility */
export async function appendMaterialRequestRows(
  mr: MaterialRequest & { items: MaterialRequestItem[]; requestedBy: User }
) {
  return upsertMaterialRequestRows(mr);
}

function formatMrStatus(status: string): string {
  switch (status) {
    case "PENDING_APPROVAL": return "Pending";
    case "APPROVED_FOR_PURCHASING": return "Approved";
    case "WAITING_FINAL_APPROVAL": return "Pending";
    case "COMPLETED": return "Completed";
    case "REJECTED": return "Rejected";
    default: return "Pending";
  }
}

/**
 * Full resync of MR sheet in ascending MR number order.
 * Call this once from an admin command to fix sheet ordering.
 */
export async function syncAllMrRowsInOrder(): Promise<void> {
  if (!SHEET_ID) return;
  const sheets = await getSheetsClient();
  if (!sheets) return;

  // Clear existing rows (A2:L) to rebuild from scratch in ascending order
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `${MR_SHEET}!A2:L`,
    });
  } catch (err) {
    console.error("Error clearing MR sheet:", err);
  }

  const { prisma } = await import("./prisma");
  const allMrs = await prisma.materialRequest.findMany({
    include: { items: true, requestedBy: true },
  });

  // Sort numerically by MR number
  allMrs.sort((a, b) => {
    const numA = parseInt(a.mrNumber.replace(/^MR-0*/i, ""), 10) || 0;
    const numB = parseInt(b.mrNumber.replace(/^MR-0*/i, ""), 10) || 0;
    return numA - numB;
  });

  for (const mr of allMrs) {
    await upsertMaterialRequestRows(mr as any);
  }
  console.log(`Full MR sheet resync complete: ${allMrs.length} MRs`);
}

// ============================================================
// Sheet 2 — Purchase Requests
// ============================================================

export async function upsertPurchaseRequestRows(
  pr: PurchaseRequest & {
    items: PurchaseRequestItem[];
    purchaser: User;
    approvedBy: User | null;
    materialRequest: MaterialRequest & { requestedBy: User };
  },
  options?: { rejectionReason?: string }
) {
  if (!SHEET_ID) return;
  const sheets = await getSheetsClient();
  if (!sheets) return;

  const status = formatPrStatus(pr.status);

  try {
    await ensureWorksheet(sheets, PR_SHEET, PR_HEADERS);
    await deletePrRows(sheets, pr.prNumber);

    const rows: (string | number)[][] = [];

    for (const item of pr.items) {
      const qty = decimalToNumber(item.quantity);
      const unitPrice = decimalToNumber(item.unitPrice);
      const vatAmount = decimalToNumber((item as any).vatAmount ?? 0);
      const itemTotal = decimalToNumber(item.amount);
      const baseAmount = Math.round((itemTotal - vatAmount) * 100) / 100;
      const priceType = (item as any).priceType ?? "Excluding VAT";
      const mr = pr.materialRequest as any;

      const itemBoq =
        (item as any).materialRequestItem?.boqSection?.trim() ||
        (item as any).boqSection?.trim() ||
        mr.boq?.trim() ||
        "";

      rows.push([
        pr.prNumber,                                  // A — PR Number
        mr.projectType ?? "",                         // B — Project Type
        mr.projectName ?? "",                         // C — Project
        itemBoq,                                      // D — BOQ
        cleanMaterialName(item.itemName),             // E — Material
        qty,                                          // F — Quantity
        item.unit,                                    // G — Unit
        unitPrice,                                    // H — Unit Price
        baseAmount,                                   // I — Total Price
        priceType,                                    // J — VAT Status
        vatAmount,                                    // K — VAT
        itemTotal,                                    // L — Total Amount
        formatDate(mr.requestDate ?? pr.createdAt),   // M — MR Date
        formatDate(pr.createdAt),                     // N — PR Date
        status,                                       // O — Status
        pr.supplierName,                              // P — Supplier Name
        pr.supplierPhone ?? "",                       // Q — Supplier Phone
        (item as any).lineId ?? "",                            // R — PR Line ID
      ]);
    }

    if (rows.length > 0) {
      const startRow = await getNextEmptyRow(sheets, PR_SHEET);
      const endRow = startRow + rows.length - 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${PR_SHEET}!A${startRow}:${colLetter(PR_HEADERS.length)}${endRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: rows },
      });
    }

    console.log(`Synced ${pr.items.length} PR rows for ${pr.prNumber} to Google Sheets`);
  } catch (err) {
    console.error("Error syncing PR to Google Sheets", err);
  }
}

/** Legacy alias for backward compatibility */
export async function appendCompletedPurchaseRows(
  pr: PurchaseRequest & {
    items: PurchaseRequestItem[];
    purchaser: User;
    approvedBy: User | null;
    materialRequest: MaterialRequest & { requestedBy: User; items: MaterialRequestItem[] };
  }
) {
  return upsertPurchaseRequestRows(pr as any);
}

function formatPrStatus(status: string): string {
  switch (status) {
    case "APPROVED": return "Approved";
    case "REJECTED": return "Rejected";
    default: return "Pending";
  }
}

// ============================================================
// Sheet 3 — Supplier Information
// ============================================================

export async function appendSupplierRow(supplier: Supplier) {
  if (!SHEET_ID) return;
  const sheets = await getSheetsClient();
  if (!sheets) return;

  await ensureWorksheet(sheets, SUPPLIER_SHEET, SUPPLIER_HEADERS);

  const row = [
    supplier.name,
    (supplier as any).companyName ?? "",
    supplier.phone ?? "",
    (supplier as any).vatRegistered ? "Yes" : "No",
    (supplier as any).bankName ?? "",
    supplier.accountNumber ?? "",
    formatDate(supplier.createdAt),
    supplier.isActive ? "Active" : "Inactive",
  ];

  try {
    // Upsert by supplier name
    await upsertRow(sheets, SUPPLIER_SHEET, SUPPLIER_HEADERS, supplier.name, row);
    console.log(`Synced supplier ${supplier.name} to Google Sheets`);
  } catch (err) {
    console.error("Error syncing supplier to Google Sheets", err);
  }
}

// ============================================================
// Sheet 4 — Price History
// ============================================================

export async function appendPriceHistoryRows(
  pr: PurchaseRequest & {
    items: PurchaseRequestItem[];
    purchaser: User;
  }
) {
  if (!SHEET_ID) return;
  const sheets = await getSheetsClient();
  if (!sheets) return;

  await ensureWorksheet(sheets, PRICE_HISTORY_SHEET, PRICE_HISTORY_HEADERS);

  const purchaseDate = pr.approvalDate ? formatDate(pr.approvalDate) : formatDate(pr.updatedAt);

  try {
    const rows = pr.items.map((item) => {
      const qty = decimalToNumber(item.quantity);
      const unitPrice = decimalToNumber(item.unitPrice);
      const vatPct = decimalToNumber((item as any).vatPct ?? 15);
      const vatAmount = decimalToNumber((item as any).vatAmount ?? 0);
      const grandTotal = decimalToNumber(item.amount);
      const priceType = (item as any).priceType ?? "Excluding VAT";

      return [
        cleanMaterialName(item.itemName),
        pr.supplierName,
        qty,
        item.unit,
        unitPrice,
        priceType,
        vatPct,
        vatAmount,
        grandTotal,
        purchaseDate,
        pr.prNumber,
        pr.purchaser.fullName,
      ];
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${PRICE_HISTORY_SHEET}!A:L`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });
    console.log(`Recorded ${rows.length} Price History rows for ${pr.prNumber}`);
  } catch (err) {
    console.error("Error appending Price History to Google Sheets", err);
  }
}

// ============================================================
// Sheet 5 — Projects
// ============================================================

export async function upsertProjectRow(project: Project) {
  if (!SHEET_ID) return;
  const sheets = await getSheetsClient();
  if (!sheets) return;

  await ensureWorksheet(sheets, PROJECT_SHEET, PROJECT_HEADERS);

  const row = [
    project.name,
    project.projectType ?? "",
    project.description ?? "",
    project.boqList.join(", "),
    project.isActive ? "Active" : "Inactive",
    formatDate(project.createdAt),
  ];

  try {
    await upsertRow(sheets, PROJECT_SHEET, PROJECT_HEADERS, project.name, row);
    console.log(`Synced project "${project.name}" to Google Sheets`);
  } catch (err) {
    console.error("Error syncing project to Google Sheets", err);
  }
}

export async function syncAllProjects(): Promise<void> {
  if (!SHEET_ID) return;
  const sheets = await getSheetsClient();
  if (!sheets) return;

  const { prisma } = await import("./prisma");
  const projects = await prisma.project.findMany({ orderBy: { createdAt: "asc" } });

  for (const project of projects) {
    await upsertProjectRow(project);
  }
  console.log(`Synced ${projects.length} projects to Google Sheets`);
}
