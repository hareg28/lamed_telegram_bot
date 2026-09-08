import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

async function testWrite() {
  console.log('📝 Testing write to Google Sheets...');

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Try to write a test row to the Material Requests sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Material Requests!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['TEST-001', new Date().toISOString(), 'Test Project', 'Test Material', '1', 'Unit', 'Test']],
      },
    });
    
    console.log('✅ Write successful!');
    console.log('📊 Updated range:', response.data.updates?.updatedRange);
    console.log('📊 Updated rows:', response.data.updates?.updatedRows);
    
  } catch (error) {
    console.error('❌ Write failed:', error.message);
    if (error.message.includes('not found')) {
      console.log('💡 The sheet "Material Requests" might not exist yet');
      console.log('💡 Try writing to "Sheet1" instead');
    }
  }
}

testWrite();