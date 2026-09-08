import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

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
  console.log("🧹 Clearing PostgreSQL Request & History tables...");

  // Delete child records first to satisfy foreign key constraints
  const deletedApprovalHistory = await prisma.approvalHistory.deleteMany({});
  console.log(`  ✅ ApprovalHistory deleted (${deletedApprovalHistory.count} records)`);

  const deletedNotification = await prisma.notification.deleteMany({});
  console.log(`  ✅ Notification deleted (${deletedNotification.count} records)`);

  const deletedFormDraft = await prisma.formDraft.deleteMany({});
  console.log(`  ✅ FormDraft deleted (${deletedFormDraft.count} records)`);

  const deletedActivityLog = await prisma.activityLog.deleteMany({});
  console.log(`  ✅ ActivityLog deleted (${deletedActivityLog.count} records)`);

  const deletedPurchaseItems = await prisma.purchaseRequestItem.deleteMany({});
  console.log(`  ✅ PurchaseRequestItem deleted (${deletedPurchaseItems.count} records)`);

  const deletedPurchaseRequests = await prisma.purchaseRequest.deleteMany({});
  console.log(`  ✅ PurchaseRequest deleted (${deletedPurchaseRequests.count} records)`);

  const deletedMrItems = await prisma.materialRequestItem.deleteMany({});
  console.log(`  ✅ MaterialRequestItem deleted (${deletedMrItems.count} records)`);

  const deletedMaterialRequests = await prisma.materialRequest.deleteMany({});
  console.log(`  ✅ MaterialRequest deleted (${deletedMaterialRequests.count} records)`);

  console.log("\n✅ Database request tables cleared successfully!");
  console.log("ℹ️  User accounts, roles, projects, and suppliers are preserved.");

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (sheetId) {
    console.log("\n📊 Clearing Google Sheets request data (preserving headers)...");
    try {
      const sheets = await getSheetsClient();
      if (sheets) {
        const sheetsToClear = [
          "Material Requests",
          "Purchase Requests",
          "Price History",
        ];

        for (const sheetName of sheetsToClear) {
          try {
            await sheets.spreadsheets.values.clear({
              spreadsheetId: sheetId,
              range: `${sheetName}!A2:Z10000`,
            });
            console.log(`  ✅ Cleared data rows from tab: "${sheetName}"`);
          } catch (sheetErr: any) {
            console.warn(`  ⚠️ Could not clear tab "${sheetName}": ${sheetErr.message || sheetErr}`);
          }
        }
      }
    } catch (err) {
      console.error("❌ Failed to clear Google Sheets:", err);
    }
  } else {
    console.log("\n⚠️ GOOGLE_SHEET_ID not configured in .env, skipping Google Sheets cleanup.");
  }

  // Count remaining MRs
  const remainingMrCount = await prisma.materialRequest.count();
  console.log(`\n🎉 Reset complete! Current MR count in database: ${remainingMrCount}`);
  console.log("➡️  Next generated MR number will be: MR-000001");
  console.log("➡️  Next generated PR number will be: PR-000001");
}

main()
  .catch((e) => {
    console.error("❌ Error during reset script execution:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
