import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';
import readline from 'readline';

dotenv.config();

const prisma = new PrismaClient();

async function clearDatabase() {
  console.log('🗑️ Clearing database...');
  
  try {
    // Step 1: leaf tables that reference multiple parents
    await prisma.approvalHistory.deleteMany({});
    console.log('  ✅ ApprovalHistory deleted');

    await prisma.notification.deleteMany({});
    console.log('  ✅ Notification deleted');

    await prisma.formDraft.deleteMany({});
    console.log('  ✅ FormDraft deleted');

    await prisma.activityLog.deleteMany({});
    console.log('  ✅ ActivityLog deleted');

    // Step 2: purchase items (references PurchaseRequest & MaterialRequestItem)
    await prisma.purchaseRequestItem.deleteMany({});
    console.log('  ✅ PurchaseRequestItem deleted');

    // Step 3: purchase requests (references MaterialRequest, User, Supplier)
    await prisma.purchaseRequest.deleteMany({});
    console.log('  ✅ PurchaseRequest deleted');

    // Step 4: material request items (references MaterialRequest)
    await prisma.materialRequestItem.deleteMany({});
    console.log('  ✅ MaterialRequestItem deleted');

    // Step 5: material requests (references User, Project)
    await prisma.materialRequest.deleteMany({});
    console.log('  ✅ MaterialRequest deleted');

    // Step 6: suppliers
    await prisma.supplier.deleteMany({});
    console.log('  ✅ Supplier deleted');

    // Step 7: projects & BOQs
    await prisma.project.deleteMany({});
    console.log('  ✅ Project deleted');

    await prisma.boq.deleteMany({});
    console.log('  ✅ Boq deleted');

    // Step 8: users (last — everything else references them)
    await prisma.user.deleteMany({});
    console.log('  ✅ User deleted');
    
    console.log('✅ Database cleared successfully!');
  } catch (error) {
    console.error('❌ Database clear error:', error);
    throw error;
  }
}

async function clearGoogleSheets() {
  console.log('📊 Clearing Google Sheets...');
  
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    console.log('⚠️  GOOGLE_APPLICATION_CREDENTIALS not found, skipping Google Sheets clear');
    return;
  }

  try {
    // Check if credentials file exists
    if (!fs.existsSync(credPath)) {
      console.log('⚠️  Credentials file not found at:', credPath);
      return;
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: credPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!spreadsheetId) {
      console.log('⚠️  GOOGLE_SHEET_ID not found, skipping Google Sheets clear');
      return;
    }

    // Get all sheets
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const sheetTitles = response.data.sheets
      ?.map(s => s.properties?.title)
      .filter(Boolean) as string[];

    console.log('📋 Found sheets:', sheetTitles);

    // Clear data from each sheet (keep headers)
    for (const title of sheetTitles) {
      try {
        // Get the sheet to find the header row
        const headerResponse = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${title}!A1:ZZ1`,
        });

        const headers = headerResponse.data.values?.[0] || [];
        
        if (headers.length === 0) {
          console.log(`  ⚠️  No headers found in ${title}, skipping`);
          continue;
        }

        // Get the last column letter
        const lastCol = String.fromCharCode(64 + headers.length);
        
        // Clear all data below row 1 (keep headers)
        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: `${title}!A2:${lastCol}`,
        });
        
        console.log(`  ✅ Cleared data from ${title} (kept headers)`);
      } catch (error) {
        console.log(`  ⚠️  Could not clear ${title}:`, error.message);
      }
    }

    console.log('✅ Google Sheets cleared successfully!');
  } catch (error) {
    console.error('❌ Google Sheets clear error:', error);
  }
}

async function main() {
  console.log('⚠️  WARNING: This will delete ALL data from:');
  console.log('  - Database (all tables)');
  console.log('  - Google Sheets (all data, keeping headers)');
  console.log('');
  console.log('Type "YES" or "yes" to confirm:');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Confirm: ', async (answer: string) => {
    rl.close();
    
    // Accept both "YES" and "yes"
    if (answer.toLowerCase() !== 'yes') {
      console.log('❌ Cancelled.');
      await prisma.$disconnect();
      process.exit(0);
    }

    console.log('🚀 Starting cleanup...');
    console.log('');

    try {
      await clearDatabase();
      console.log('');
      await clearGoogleSheets();
      console.log('');
      console.log('✅ Complete cleanup finished!');
      console.log('💡 Your database and Google Sheets are now empty (headers kept).');
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
    } finally {
      await prisma.$disconnect();
    }
  });
}

main();