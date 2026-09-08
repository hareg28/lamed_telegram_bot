import { google } from "googleapis";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

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

async function getSheetsClient() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsPath) {
    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      return google.sheets({ version: "v4", auth });
    } catch (err) {
      console.error("Failed to initialize Google Sheets client via GOOGLE_APPLICATION_CREDENTIALS", err);
    }
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }
  if (!email || !privateKey) {
    console.warn("Google Sheets credentials are not configured in .env");
    return null;
  }
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function main() {
  console.log("🧹 Wiping PostgreSQL Database...");
  
  // Wipe child tables first to avoid foreign key errors
  await prisma.approvalHistory.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.formDraft.deleteMany({});
  await prisma.activityLog.deleteMany({});
  await prisma.purchaseRequestItem.deleteMany({});
  await prisma.purchaseRequest.deleteMany({});
  await prisma.materialRequestItem.deleteMany({});
  await prisma.materialRequest.deleteMany({});
  await prisma.supplier.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.user.deleteMany({});

  console.log("✅ PostgreSQL Database cleared completely (including users, projects, suppliers, requests).");

  if (SHEET_ID) {
    console.log("📊 Wiping Google Sheets & resetting headers...");
    const sheets = await getSheetsClient();
    if (sheets) {
      const targets = [
        { sheet: MR_SHEET, headers: MR_HEADERS },
        { sheet: PR_SHEET, headers: PR_HEADERS },
        { sheet: SUPPLIER_SHEET, headers: SUPPLIER_HEADERS },
        { sheet: PRICE_HISTORY_SHEET, headers: PRICE_HISTORY_HEADERS },
      ];

      for (const target of targets) {
        try {
          // Clear current content
          await sheets.spreadsheets.values.clear({
            spreadsheetId: SHEET_ID,
            range: `${target.sheet}!A1:Z10000`,
          });
          // Write headers
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `${target.sheet}!A1`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [target.headers] },
          });
          console.log(`✅ Cleared and reset sheet tab: "${target.sheet}"`);
        } catch (err) {
          console.error(`❌ Failed to clear sheet tab "${target.sheet}":`, err);
        }
      }
    }
  } else {
    console.log("⚠️ GOOGLE_SHEET_ID not set, skipping Google Sheets reset.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
