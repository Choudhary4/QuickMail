// Quick script to check available sheets in your Google Sheet
const { google } = require('googleapis');
const path = require('path');

async function checkSheets() {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(__dirname, 'google-credentials.json'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = '1bR2uTULxz2qUHUbYx0GkJNgqSP98L4VFqoxeWvitgYk';

    const response = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    console.log('Available sheets:');
    response.data.sheets.forEach((sheet, index) => {
      console.log(`  ${index + 1}. "${sheet.properties.title}" (ID: ${sheet.properties.sheetId})`);
    });
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkSheets();

