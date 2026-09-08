import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

async function testAuth() {
  console.log('🔍 Testing Google Sheets Authentication...');
  console.log('📁 Credentials path:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
  console.log('📊 Sheet ID:', process.env.GOOGLE_SHEET_ID);

  // Check if file exists
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    console.error('❌ GOOGLE_APPLICATION_CREDENTIALS not set in .env');
    return;
  }

  try {
    const stats = fs.statSync(credPath);
    console.log('✅ Credentials file found:', stats.size, 'bytes');
  } catch (error) {
    console.error('❌ Credentials file NOT found at:', credPath);
    console.log('💡 Make sure the file exists in your project root');
    return;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: credPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Try to get the sheet
    const response = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
    });
    
    console.log('✅ Authentication successful!');
    console.log('📊 Sheet title:', response.data.properties?.title);
    console.log('📊 Sheet URL:', `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`);
    
    // List all sheets
    const sheetsList = response.data.sheets?.map(s => s.properties?.title).filter(Boolean);
    console.log('📋 Existing sheets:', sheetsList);

  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    if (error.message.includes('not found')) {
      console.log('💡 The sheet ID might be wrong or the service account doesn\'t have access');
    }
    if (error.message.includes('invalid_grant')) {
      console.log('💡 The credentials file is invalid. Regenerate the key in Google Cloud Console.');
    }
  }
}

testAuth();