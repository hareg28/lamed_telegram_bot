/**
 * fix-supplier-sheet.ts
 *
 * One-time fix: completely clears the "Supplier Information" sheet in Google
 * Sheets (header + all data rows) and rewrites it using the current schema
 * from the database. Run when header columns change and existing data is
 * misaligned in the sheet.
 *
 * Usage:
 *   npx tsx scripts/fix-supplier-sheet.ts
 */

import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const prisma = new PrismaClient();

const SUPPLIER_SHEET = 'Supplier Information';
const SUPPLIER_HEADERS = [
  'Supplier Name',
  'Company Name',
  'Phone',
  'VAT Registered',
  'Bank Name',
  'Bank Account',
  'Registration Date',
  'Status',
];

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

async function getSheetsClient() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath || !fs.existsSync(credPath)) {
    throw new Error(`GOOGLE_APPLICATION_CREDENTIALS not found or file missing: ${credPath}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: credPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SHEET_ID not set in .env');

  console.log('🔧 Fixing Supplier Information sheet...\n');

  const sheets = await getSheetsClient();

  // ── Step 1: Clear the entire sheet (all columns, all rows) ─────────────────
  console.log('🗑️  Clearing all data from sheet...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${SUPPLIER_SHEET}!A:ZZ`,
  });
  console.log('  ✅ Sheet cleared');

  // ── Step 2: Write new headers in row 1 ────────────────────────────────────
  console.log('📝 Writing new headers...');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SUPPLIER_SHEET}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [SUPPLIER_HEADERS] },
  });
  console.log(`  ✅ Headers written: ${SUPPLIER_HEADERS.join(' | ')}`);

  // ── Step 3: Load all suppliers from DB and write rows ─────────────────────
  console.log('\n📦 Loading suppliers from database...');
  const suppliers = await prisma.supplier.findMany({ orderBy: { createdAt: 'asc' } });
  console.log(`  Found ${suppliers.length} supplier(s)`);

  if (suppliers.length > 0) {
    const rows = suppliers.map((s: any) => [
      s.name ?? '',
      s.companyName ?? '',
      s.phone ?? '',
      s.vatRegistered ? 'Yes' : 'No',
      s.bankName ?? '',
      s.accountNumber ?? '',
      formatDate(s.createdAt),
      s.isActive ? 'Active' : 'Inactive',
    ]);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SUPPLIER_SHEET}!A2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
    console.log(`  ✅ Wrote ${rows.length} supplier row(s)`);
  }

  console.log('\n✅ Supplier sheet fixed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
