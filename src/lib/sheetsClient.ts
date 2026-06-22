// Google Sheets API client utility for tracking email events
// Requires googleapis package and service account JSON

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// Service account credentials (loaded from env or file)
const SERVICE_ACCOUNT_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const SERVICE_ACCOUNT_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n') || '';

let sheetsClient: any = null;

/**
 * Initialize Google Sheets API client with service account auth
 */
function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const auth = new JWT({
    email: SERVICE_ACCOUNT_EMAIL,
    key: SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/**
 * Find row index by emailId in a Google Sheet
 * @param spreadsheetId - The Google Sheet ID
 * @param sheetName - Sheet tab name (default: 'Sheet1')
 * @param emailId - Unique email identifier
 * @returns Row index (1-based) or null if not found
 */
export async function findRowByEmailId(
  spreadsheetId: string,
  sheetName: string = 'Sheet1',
  emailId: string
): Promise<number | null> {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Z`, // Read all columns
    });

    const rows = response.data.values || [];
    
    // Find emailId column index (assuming header in row 1)
    const headers = rows[0] || [];
    const emailIdColIndex = headers.findIndex((h: string) => h.toLowerCase() === 'emailid');
    
    if (emailIdColIndex === -1) {
      console.warn('[Sheets] emailId column not found in headers');
      return null;
    }

    // Search for matching emailId (start from row 2, since row 1 is header)
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][emailIdColIndex] === emailId) {
        return i + 1; // Return 1-based row index
      }
    }

    return null;
  } catch (error) {
    console.error('[Sheets] Error finding row:', error);
    return null;
  }
}

/**
 * Update specific columns in a row by emailId
 * @param spreadsheetId - The Google Sheet ID
 * @param sheetName - Sheet tab name
 * @param emailId - Unique email identifier
 * @param updates - Object with column names and values to update
 */
export async function updateRowByEmailId(
  spreadsheetId: string,
  sheetName: string = 'Sheet1',
  emailId: string,
  updates: Record<string, string | boolean | number>
): Promise<boolean> {
  try {
    const sheets = getSheetsClient();
    
    // Get headers to map column names to indices
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!1:1`,
    });
    const headers = headerResponse.data.values?.[0] || [];
    
    // Find the row
    const rowIndex = await findRowByEmailId(spreadsheetId, sheetName, emailId);
    if (!rowIndex) {
      console.warn('[Sheets] Row not found for emailId:', emailId);
      return false;
    }

    // Build batch update requests
    const batchData: any[] = [];
    
    for (const [columnName, value] of Object.entries(updates)) {
      const colIndex = headers.findIndex((h: string) => h.toLowerCase() === columnName.toLowerCase());
      if (colIndex === -1) {
        console.warn(`[Sheets] Column "${columnName}" not found`);
        continue;
      }
      
      const colLetter = String.fromCharCode(65 + colIndex); // A, B, C...
      batchData.push({
        range: `${sheetName}!${colLetter}${rowIndex}`,
        values: [[value]],
      });
    }

    if (batchData.length === 0) {
      console.warn('[Sheets] No valid columns to update');
      return false;
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: batchData,
      },
    });

    console.log(`[Sheets] Updated row ${rowIndex} for emailId ${emailId}`);
    return true;
  } catch (error) {
    console.error('[Sheets] Error updating row:', error);
    return false;
  }
}

/**
 * Append a new row to the sheet
 * @param spreadsheetId - The Google Sheet ID
 * @param sheetName - Sheet tab name
 * @param rowData - Array of values matching column order
 */
export async function appendRow(
  spreadsheetId: string,
  sheetName: string = 'Sheet1',
  rowData: (string | number | boolean)[]
): Promise<boolean> {
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [rowData],
      },
    });
    console.log('[Sheets] Appended new row');
    return true;
  } catch (error) {
    console.error('[Sheets] Error appending row:', error);
    return false;
  }
}

/**
 * Mark email as seen/opened
 */
export async function markSeen(spreadsheetId: string, emailId: string, sheetName: string = 'Sheet1') {
  return updateRowByEmailId(spreadsheetId, sheetName, emailId, {
    seen: true,
    seenAt: new Date().toISOString(),
  });
}

/**
 * Mark email as delivered
 */
export async function markDelivered(spreadsheetId: string, emailId: string, sheetName: string = 'Sheet1') {
  return updateRowByEmailId(spreadsheetId, sheetName, emailId, {
    delivered: true,
    deliveredAt: new Date().toISOString(),
  });
}

/**
 * Mark email as bounced
 */
export async function markBounced(
  spreadsheetId: string,
  emailId: string,
  reason: string,
  sheetName: string = 'Sheet1'
) {
  return updateRowByEmailId(spreadsheetId, sheetName, emailId, {
    bounced: true,
    bounceReason: reason,
    suppressed: true,
  });
}

/**
 * Mark email as complaint (spam report)
 */
export async function markComplaint(spreadsheetId: string, emailId: string, sheetName: string = 'Sheet1') {
  return updateRowByEmailId(spreadsheetId, sheetName, emailId, {
    complaint: true,
    suppressed: true,
  });
}

/**
 * Mark email as replied
 */
export async function markReplied(spreadsheetId: string, emailId: string, sheetName: string = 'Sheet1') {
  return updateRowByEmailId(spreadsheetId, sheetName, emailId, {
    replied: true,
    repliedAt: new Date().toISOString(),
  });
}
