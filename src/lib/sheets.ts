// lib/sheets.ts
// Utility functions for Google Sheets tracking updates

import { google } from 'googleapis';
import fs from 'node:fs';
export type SheetRecipient = Record<string, string>;

// Column mapping (zero-indexed for batchUpdate ranges)
export const SHEET_COLUMNS = {
  email: 'A',
  firstName: 'B',
  productName: 'C',
  discountCode: 'D',
  emailId: 'E',
  delivered: 'F',
  deliveredAt: 'G',
  seen: 'H',
  seenAt: 'I',
  replied: 'J',
  repliedAt: 'K',
  replyContent: 'S', // New column for storing reply content
  replyMessageId: 'T', // New column for storing reply's Message-ID (for threading)
  bounced: 'L',
  bounceReason: 'M',
  complaint: 'N',
  suppressed: 'O',
  followUpCount: 'P',
  lastFollowUpAt: 'Q',
  status: 'R'
} as const;

// Initialize Google Sheets API client
export function getSheetsClient() {
  const fromFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  const fromB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  const fromInline = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  let raw: string | undefined;
  
  // Try file system first (only works in local/dev, not on Vercel)
  if (fromFile) {
    try {
      // On Vercel, file system access is limited, so this will gracefully fail
      if (fs.existsSync(fromFile)) {
        raw = fs.readFileSync(fromFile, 'utf8');
      }
    } catch (error) {
      // File system not available (e.g., on Vercel), continue to other methods
      console.warn('[Sheets] File system access not available, trying other credential methods');
    }
  }
  
  // Prefer base64 or inline JSON (works on Vercel)
  if (!raw && fromB64) {
    raw = Buffer.from(fromB64, 'base64').toString('utf8');
  } else if (!raw && fromInline) {
    raw = fromInline;
  }

  if (!raw) {
    throw new Error('Google credentials not set. Provide GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 or GOOGLE_SERVICE_ACCOUNT_KEY (recommended for Vercel). GOOGLE_SERVICE_ACCOUNT_KEY_FILE only works in local development.');
  }
  
  const credentials = JSON.parse(raw);
  if (credentials.private_key && typeof credentials.private_key === 'string') {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  
  // Store service account email for error messages
  const serviceAccountEmail = credentials.client_email;
  if (serviceAccountEmail) {
    (auth as any).serviceAccountEmail = serviceAccountEmail;
  }
  
  return google.sheets({ version: 'v4', auth });
}

/**
 * Get spreadsheet sheet/tab titles
 */
export async function getSpreadsheetTitles(spreadsheetId: string): Promise<string[]> {
  const sheets = getSheetsClient();
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const titles = (meta.data.sheets || [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => !!t);
    return titles;
  } catch (error: any) {
    if (error?.code === 403 || error?.status === 403) {
      // Try to get service account email for helpful error message
      let serviceAccountEmail = 'your-service-account@project.iam.gserviceaccount.com';
      try {
        const fromFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
        const fromB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
        const fromInline = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
        
        let raw: string | undefined;
        if (fromFile && fs.existsSync(fromFile)) {
          raw = fs.readFileSync(fromFile, 'utf8');
        } else if (fromB64) {
          raw = Buffer.from(fromB64, 'base64').toString('utf8');
        } else if (fromInline) {
          raw = fromInline;
        }
        
        if (raw) {
          const credentials = JSON.parse(raw);
          serviceAccountEmail = credentials.client_email || serviceAccountEmail;
        }
      } catch {
        // Ignore if we can't get the email
      }
      
      throw new Error(
        `Permission denied. Share the spreadsheet with: ${serviceAccountEmail}\n` +
        `Steps: Open spreadsheet → Click "Share" → Add ${serviceAccountEmail} → Give "Viewer" or "Editor" permission`
      );
    }
    throw error;
  }
}

function toA1AllCols(title: string) {
  const escaped = title.includes("'") ? title.replace(/'/g, "''") : title;
  return `'${escaped}'!A:Z`;
}

/**
 * Read recipients from a Google Sheet.
 * Uses header row to build recipient objects.
 */
export async function getRecipientsFromSheet(
  spreadsheetId: string,
  preferredSheetName?: string
): Promise<{ recipients: SheetRecipient[]; headers: string[]; sheetNameUsed: string }> {
  const sheets = getSheetsClient();
  const titles = await getSpreadsheetTitles(spreadsheetId);
  if (!titles.length) throw new Error('Spreadsheet has no sheets/tabs');
  const sheetNameUsed = preferredSheetName && titles.includes(preferredSheetName)
    ? preferredSheetName
    : titles[0];
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: toA1AllCols(sheetNameUsed),
  });
  const rows = resp.data.values || [];
  if (!rows.length) throw new Error('Sheet is empty');
  const headers = rows[0] as string[];
  
  // Find email column index (case-insensitive)
  const emailColumnKeys = ['email', 'e-mail', 'email address', 'emailaddress', 'mail'];
  let emailColumnIndex = -1;
  for (const key of emailColumnKeys) {
    const found = headers.findIndex(h => h.toLowerCase().trim() === key);
    if (found >= 0) {
      emailColumnIndex = found;
      break;
    }
  }
  // Fallback to first column if no email column found
  if (emailColumnIndex < 0) {
    emailColumnIndex = 0;
  }
  
  // Map rows to recipients, filtering out empty rows
  const recipients: SheetRecipient[] = rows.slice(1)
    .map((row: any[]) => {
      const obj: SheetRecipient = {};
      headers.forEach((h, i) => { 
        // Normalize values - convert to string and trim whitespace
        const value = row[i];
        obj[h] = value != null ? String(value).trim() : '';
      });
      return obj;
    })
    .filter((recipient: SheetRecipient) => {
      // Filter out rows that don't have an email address
      const emailValue = recipient[headers[emailColumnIndex]] || recipient.email || recipient.Email || recipient.EMAIL;
      return emailValue && emailValue.trim().length > 0;
    });
  
  return { recipients, headers, sheetNameUsed };
}

/**
 * Convert column index (0-based) to Google Sheets column letter (A, B, ..., Z, AA, AB, ...)
 */
function columnIndexToLetter(index: number): string {
  let result = '';
  index++; // Convert to 1-based
  while (index > 0) {
    index--;
    result = String.fromCharCode(65 + (index % 26)) + result;
    index = Math.floor(index / 26);
  }
  return result;
}

/**
 * Update master spreadsheet status columns (Last Processed, Error)
 */
export async function updateMasterSpreadsheetStatus(
  masterSpreadsheetId: string,
  masterSheetName: string,
  rowIndex: number,
  updates: { lastProcessed?: string; error?: string }
): Promise<boolean> {
  try {
    const sheets = getSheetsClient();
    
    // Get available sheet titles and use the correct one (same logic as getActiveCampaigns)
    const titles = await getSpreadsheetTitles(masterSpreadsheetId);
    if (!titles.length) {
      throw new Error('Master spreadsheet has no sheets/tabs');
    }
    
    // Use the provided sheet name if it exists, otherwise use the first available sheet
    const sheetNameUsed = titles.includes(masterSheetName) ? masterSheetName : titles[0];
    const escapedSheetName = escapeSheetName(sheetNameUsed);
    
    console.log(`[Master Spreadsheet] Updating status on sheet: "${sheetNameUsed}" (requested: "${masterSheetName}")`);
    
    // Read headers to find column indices
    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId: masterSpreadsheetId,
      range: `${escapedSheetName}!1:1`,
    });
    const headers = headerResp.data.values?.[0] || [];
    
    const findColumnIndex = (name: string): number => {
      const lowerName = name.toLowerCase();
      return headers.findIndex(h => h.toLowerCase().trim() === lowerName);
    };
    
    const lastProcessedCol = findColumnIndex('lastprocessed') !== -1
      ? findColumnIndex('lastprocessed')
      : findColumnIndex('last processed');
    const errorCol = findColumnIndex('error');
    
    const data: any[] = [];
    
    if (updates.lastProcessed !== undefined && lastProcessedCol >= 0) {
      // Convert column index to letter (A=0, B=1, AA=26, etc.)
      const colLetter = columnIndexToLetter(lastProcessedCol);
      data.push({
        range: `${escapedSheetName}!${colLetter}${rowIndex}`,
        values: [[updates.lastProcessed]]
      });
    }
    
    if (updates.error !== undefined && errorCol >= 0) {
      const colLetter = columnIndexToLetter(errorCol);
      data.push({
        range: `${escapedSheetName}!${colLetter}${rowIndex}`,
        values: [[updates.error]]
      });
    }
    
    if (data.length === 0) return true;
    
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: masterSpreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data
      }
    });
    
    console.log(`[Master Spreadsheet] Updated status for row ${rowIndex}`);
    return true;
  } catch (error) {
    console.error('[Master Spreadsheet] Error updating status:', error);
    return false;
  }
}

/**
 * Read active campaigns from master spreadsheet.
 * Master spreadsheet should have columns: 
 * - Campaign Name (optional)
 * - Spreadsheet ID (required) or spreadsheetId
 * - Active (optional, defaults to TRUE)
 * - Type (optional: REPLIES, FOLLOWUP, BOTH)
 * - Last Processed (optional)
 * - Error (optional)
 * 
 * @param masterSpreadsheetId - ID of the master spreadsheet
 * @param masterSheetName - Sheet name in master spreadsheet (default: 'Sheet1')
 * @param filterType - Filter by type: 'REPLIES', 'FOLLOWUP', or undefined for all
 * @returns Array of active campaign configs
 */
export interface CampaignConfig {
  spreadsheetId: string;
  sheetName?: string;
  active?: boolean;
  campaignName?: string;
  type?: 'REPLIES' | 'FOLLOWUP' | 'BOTH';
  lastProcessed?: string;
  error?: string;
  rowIndex?: number; // Store row index for updating status
  [key: string]: any; // Allow additional fields
}

export async function getActiveCampaigns(
  masterSpreadsheetId: string,
  masterSheetName: string = 'Sheet1',
  filterType?: 'REPLIES' | 'FOLLOWUP'
): Promise<CampaignConfig[]> {
  const sheets = getSheetsClient();
  const titles = await getSpreadsheetTitles(masterSpreadsheetId);
  if (!titles.length) throw new Error('Master spreadsheet has no sheets/tabs');
  
  const sheetNameUsed = titles.includes(masterSheetName) ? masterSheetName : titles[0];
  
  // Read all rows - use a larger range to ensure we get all data
  // Google Sheets API may truncate rows if they're sparse, so read more columns
  const escapedSheetName = sheetNameUsed.includes("'") ? sheetNameUsed.replace(/'/g, "''") : sheetNameUsed;
  const range = `'${escapedSheetName}'!A:ZZ`; // Read up to column ZZ to ensure we get all rows
  
  console.log(`[Master Spreadsheet] Reading from range: ${range}`);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: masterSpreadsheetId,
    range: range,
    majorDimension: 'ROWS', // Explicitly request rows
  });
  
  const rows = resp.data.values || [];
  console.log(`[Master Spreadsheet] Found ${rows.length} total rows (including header)`);
  
  // Log first few rows for debugging
  if (rows.length > 0) {
    console.log(`[Master Spreadsheet] Header row: ${JSON.stringify(rows[0])}`);
    for (let i = 1; i < Math.min(rows.length, 6); i++) {
      console.log(`[Master Spreadsheet] Row ${i + 1}: ${JSON.stringify(rows[i])}`);
    }
  }
  
  if (!rows.length) throw new Error('Master sheet is empty');
  
  const headers = rows[0] as string[];
  console.log(`[Master Spreadsheet] Headers: ${headers.join(', ')}`);
  
  const campaigns: CampaignConfig[] = [];
  
  // Find column indices (case-insensitive)
  const findColumnIndex = (name: string): number => {
    const lowerName = name.toLowerCase();
    return headers.findIndex(h => h.toLowerCase().trim() === lowerName);
  };
  
  // Support both old format (spreadsheetId) and new format (Spreadsheet ID)
  const spreadsheetIdCol = findColumnIndex('spreadsheetid') !== -1 
    ? findColumnIndex('spreadsheetid')
    : findColumnIndex('spreadsheet id');
  const sheetNameCol = findColumnIndex('sheetname') !== -1
    ? findColumnIndex('sheetname')
    : findColumnIndex('sheet name');
  const activeCol = findColumnIndex('active');
  const typeCol = findColumnIndex('type');
  const campaignNameCol = findColumnIndex('campaignname') !== -1
    ? findColumnIndex('campaignname')
    : findColumnIndex('campaign name');
  const lastProcessedCol = findColumnIndex('lastprocessed') !== -1
    ? findColumnIndex('lastprocessed')
    : findColumnIndex('last processed');
  const errorCol = findColumnIndex('error');
  
  console.log(`[Master Spreadsheet] Column indices - spreadsheetId: ${spreadsheetIdCol}, sheetName: ${sheetNameCol}, active: ${activeCol}, type: ${typeCol}, campaignName: ${campaignNameCol}`);
  
  if (spreadsheetIdCol === -1) {
    throw new Error('Master sheet must have a "spreadsheetId" or "Spreadsheet ID" column');
  }
  
  // Process each row (skip header)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    // Ensure row has enough elements (pad with empty strings if needed)
    while (row.length < headers.length) {
      row.push('');
    }
    
    const spreadsheetId = row[spreadsheetIdCol]?.toString().trim();
    
    console.log(`[Master Spreadsheet] Row ${i + 1}: spreadsheetId="${spreadsheetId}"`);
    
    if (!spreadsheetId) {
      console.log(`[Master Spreadsheet] Row ${i + 1}: Skipping - no spreadsheetId`);
      continue; // Skip rows without spreadsheetId
    }
    
    // Check if campaign is active (default to true if column doesn't exist or is empty)
    const activeValue = activeCol >= 0 && row[activeCol] ? row[activeCol].toString().trim().toUpperCase() : '';
    const isActive = activeValue === 'TRUE' || activeValue === 'YES' || activeValue === '1' || activeValue === '';
    
    console.log(`[Master Spreadsheet] Row ${i + 1}: active value="${activeValue}", isActive=${isActive}`);
    
    if (!isActive) {
      console.log(`[Master Spreadsheet] Row ${i + 1}: Skipping - inactive`);
      continue; // Skip inactive campaigns
    }
    
    // Get type value
    const typeValue = typeCol >= 0 && row[typeCol] ? row[typeCol].toString().trim().toUpperCase() : undefined;
    const campaignType = typeValue as 'REPLIES' | 'FOLLOWUP' | 'BOTH' | undefined;
    
    // Filter by type if specified
    if (filterType) {
      if (campaignType && campaignType !== 'BOTH' && campaignType !== filterType) {
        console.log(`[Master Spreadsheet] Row ${i + 1}: Skipping - type "${campaignType}" doesn't match filter "${filterType}"`);
        continue;
      }
      // If type is BOTH or undefined, include it for any filterType
    }
    
    const campaign: CampaignConfig = {
      spreadsheetId,
      sheetName: sheetNameCol >= 0 && row[sheetNameCol] ? row[sheetNameCol].toString().trim() : undefined,
      active: true,
      campaignName: campaignNameCol >= 0 && row[campaignNameCol] ? row[campaignNameCol].toString().trim() : undefined,
      type: campaignType,
      lastProcessed: lastProcessedCol >= 0 && row[lastProcessedCol] ? row[lastProcessedCol].toString().trim() : undefined,
      error: errorCol >= 0 && row[errorCol] ? row[errorCol].toString().trim() : undefined,
      rowIndex: i + 1, // Store 1-based row index for updating
    };
    
    // Include any additional columns
    headers.forEach((header, colIndex) => {
      if (colIndex !== spreadsheetIdCol && colIndex !== sheetNameCol && colIndex !== activeCol && 
          colIndex !== typeCol && colIndex !== campaignNameCol && colIndex !== lastProcessedCol && colIndex !== errorCol) {
        campaign[header] = row[colIndex]?.toString().trim() || '';
      }
    });
    
    console.log(`[Master Spreadsheet] Row ${i + 1}: Added campaign - name="${campaign.campaignName || 'N/A'}", spreadsheetId="${campaign.spreadsheetId}", type="${campaign.type || 'N/A'}", sheetName="${campaign.sheetName || 'undefined'}"`);
    campaigns.push(campaign);
  }
  
  console.log(`[Master Spreadsheet] Total active campaigns found: ${campaigns.length}`);
  return campaigns;
}

/**
 * Find row index by emailId in the sheet
 * Returns row number (1-indexed) or null if not found
 */
export function escapeSheetName(sheetName: string): string {
  // If sheet name contains special characters or spaces, wrap in single quotes
  if (sheetName.includes(' ') || sheetName.includes("'") || sheetName.includes('!')) {
    // Escape single quotes by doubling them
    const escaped = sheetName.replace(/'/g, "''");
    return `'${escaped}'`;
  }
  return sheetName;
}

export async function findRowByEmailId(
  spreadsheetId: string,
  emailId: string,
  sheetName: string = 'Sheet1'
): Promise<number | null> {
  try {
    const sheets = getSheetsClient();
    const escapedSheetName = escapeSheetName(sheetName);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${escapedSheetName}!E:E`, // emailId column
    });
    
    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === emailId);
    
    return rowIndex >= 0 ? rowIndex + 1 : null; // Convert to 1-indexed
  } catch (error: any) {
    console.error(`[Sheets] Error finding row by emailId=${emailId} in sheet=${sheetName}:`, error?.message || error);
    // Check if it's a 404 error (sheet not found)
    if (error?.code === 404 || error?.response?.status === 404) {
      console.error(`[Sheets] Sheet "${sheetName}" not found in spreadsheet ${spreadsheetId}. Check if the sheet name is correct.`);
    }
    return null;
  }
}

/**
 * Find row index by email address in column A
 * Returns row number (1-indexed) or null if not found
 */
export async function findRowByEmail(
  spreadsheetId: string,
  email: string,
  sheetName: string = 'Sheet1'
): Promise<number | null> {
  try {
    const sheets = getSheetsClient();
    const escapedSheetName = escapeSheetName(sheetName);
    const normalizedSearchEmail = email.trim().toLowerCase();
    
    console.log(`[Sheets] Searching for email="${normalizedSearchEmail}" in sheet="${sheetName}" (escaped: "${escapedSheetName}")`);
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${escapedSheetName}!A:A`, // email column
    });
    const rows = response.data.values || [];
    
    console.log(`[Sheets] Found ${rows.length} rows in email column. Checking for match...`);
    
    // Log first few emails for debugging
    if (rows.length > 0) {
      const sampleEmails = rows.slice(0, 5).map((row, i) => {
        const rowEmail = (row[0] || '').toString().trim().toLowerCase();
        const match = rowEmail === normalizedSearchEmail ? ' ✅ MATCH' : '';
        return `Row ${i + 1}: "${rowEmail}"${match}`;
      });
      console.log(`[Sheets] Sample emails in sheet: ${sampleEmails.join(', ')}`);
    }
    
    const rowIndex = rows.findIndex((row) => {
      const rowEmail = (row[0] || '').toString().trim().toLowerCase();
      const matches = rowEmail === normalizedSearchEmail;
      if (matches) {
        console.log(`[Sheets] ✅ Found match at row ${rows.indexOf(row) + 1}: "${rowEmail}" === "${normalizedSearchEmail}"`);
      }
      return matches;
    });
    
    const result = rowIndex >= 0 ? rowIndex + 1 : null;
    if (!result) {
      console.log(`[Sheets] ❌ No match found for email="${normalizedSearchEmail}"`);
      // Show all emails for debugging
      const allEmails = rows.map((row, i) => `Row ${i + 1}: "${(row[0] || '').toString().trim().toLowerCase()}"`).slice(0, 10);
      console.log(`[Sheets] All emails in sheet (first 10): ${allEmails.join(', ')}`);
    }
    
    return result;
  } catch (error: any) {
    console.error(`[Sheets] Error finding row by email=${email} in sheet=${sheetName}:`, error?.message || error);
    if (error?.code === 404 || error?.response?.status === 404) {
      console.error(`[Sheets] Sheet "${sheetName}" not found in spreadsheet ${spreadsheetId}. Check if the sheet name is correct.`);
      // Try to list available sheets
      try {
        const availableSheets = await getSpreadsheetTitles(spreadsheetId);
        console.error(`[Sheets] Available sheets: ${availableSheets.join(', ')}`);
      } catch (e) {
        console.error(`[Sheets] Could not list available sheets:`, e);
      }
    }
    return null;
  }
}

/**
 * Update a specific cell in the sheet by emailId
 */
export async function updateCellByEmailId(
  spreadsheetId: string,
  emailId: string,
  column: keyof typeof SHEET_COLUMNS,
  value: string | boolean | number,
  sheetName: string = 'Sheet1'
): Promise<boolean> {
  try {
    const rowNum = await findRowByEmailId(spreadsheetId, emailId, sheetName);
    if (!rowNum) {
      console.warn(`[Sheets] No row found for emailId=${emailId}`);
      return false;
    }
    
    const sheets = getSheetsClient();
    const columnLetter = SHEET_COLUMNS[column];
    const escapedSheetName = escapeSheetName(sheetName);
    const range = `${escapedSheetName}!${columnLetter}${rowNum}`;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[value]]
      }
    });
    
    console.log(`[Sheets] Updated ${column}=${value} for emailId=${emailId} at row ${rowNum}`);
    return true;
  } catch (error) {
    console.error('[Sheets] Error updating cell:', error);
    return false;
  }
}

/**
 * Batch update multiple columns for a given emailId
 */
export async function batchUpdateByEmailId(
  spreadsheetId: string,
  emailId: string,
  updates: Partial<Record<keyof typeof SHEET_COLUMNS, string | boolean | number>>,
  sheetName: string = 'Sheet1'
): Promise<boolean> {
  try {
    const rowNum = await findRowByEmailId(spreadsheetId, emailId, sheetName);
    if (!rowNum) {
      console.warn(`[Sheets] No row found for emailId=${emailId} in sheet=${sheetName}`);
      return false;
    }
    
    const sheets = getSheetsClient();
    const escapedSheetName = escapeSheetName(sheetName);
    const data = Object.entries(updates).map(([col, value]) => {
      // Convert boolean to uppercase string for Google Sheets
      let sheetValue: string | boolean | number = value;
      if (typeof value === 'boolean') {
        sheetValue = value ? 'TRUE' : 'FALSE';
      }
      return {
        range: `${escapedSheetName}!${SHEET_COLUMNS[col as keyof typeof SHEET_COLUMNS]}${rowNum}`,
        values: [[sheetValue]]
      };
    });
    
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data
      }
    });
    
    console.log(`[Sheets] Batch updated ${Object.keys(updates).join(', ')} for emailId=${emailId}`);
    return true;
  } catch (error) {
    console.error('[Sheets] Error in batch update:', error);
    return false;
  }
}

/**
 * Ensure the emailId is set for a row identified by email address
 */
export async function setEmailIdByEmail(
  spreadsheetId: string,
  email: string,
  emailId: string,
  sheetName: string = 'Sheet1'
): Promise<boolean> {
  try {
    const rowNum = await findRowByEmail(spreadsheetId, email, sheetName);
    if (!rowNum) {
      console.warn(`[Sheets] No row found for email=${email}`);
      return false;
    }

    const sheets = getSheetsClient();
    const escapedSheetName = escapeSheetName(sheetName);
    const range = `${escapedSheetName}!${SHEET_COLUMNS.emailId}${rowNum}`; // Column E
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [[emailId]] },
    });
    console.log(`[Sheets] Set emailId for ${email} at row ${rowNum}`);
    return true;
  } catch (error) {
    console.error('[Sheets] Error setting emailId by email:', error);
    return false;
  }
}

/**
 * Mark email as seen/opened
 */
export async function markSeen(spreadsheetId: string, emailId: string, sheetName: string = 'Sheet1'): Promise<boolean> {
  return batchUpdateByEmailId(spreadsheetId, emailId, {
    seen: true,
    seenAt: new Date().toISOString()
  }, sheetName);
}

/**
 * Mark email as delivered
 */
export async function markDelivered(spreadsheetId: string, emailId: string, sheetName: string = 'Sheet1'): Promise<boolean> {
  return batchUpdateByEmailId(spreadsheetId, emailId, {
    delivered: true,
    deliveredAt: new Date().toISOString()
  }, sheetName);
}

/**
 * Mark email as bounced
 */
export async function markBounced(
  spreadsheetId: string,
  emailId: string,
  reason: string,
  sheetName: string = 'Sheet1'
): Promise<boolean> {
  return batchUpdateByEmailId(spreadsheetId, emailId, {
    bounced: true,
    bounceReason: reason,
    suppressed: true
  }, sheetName);
}

/**
 * Mark email as complaint
 */
export async function markComplaint(spreadsheetId: string, emailId: string, sheetName: string = 'Sheet1'): Promise<boolean> {
  return batchUpdateByEmailId(spreadsheetId, emailId, {
    complaint: true,
    suppressed: true
  }, sheetName);
}

/**
 * Mark email as replied
 * Only updates repliedAt if this is the first reply (replied was not already TRUE)
 * @param replyContent - Optional reply email content to store (truncated to 5000 chars)
 * @param replyMessageId - Optional reply's Message-ID header (for threading follow-ups)
 */
export async function markReplied(
  spreadsheetId: string, 
  emailId: string, 
  sheetName: string = 'Sheet1',
  replyContent?: string,
  replyMessageId?: string
): Promise<boolean> {
  try {
    // First, check if they already replied
    const rowNum = await findRowByEmailId(spreadsheetId, emailId, sheetName);
    if (!rowNum) {
      console.warn(`[Sheets] No row found for emailId=${emailId}`);
      return false;
    }
    
    const sheets = getSheetsClient();
    const escapedSheetName = escapeSheetName(sheetName);
    
    // Read current replied and repliedAt values
    const repliedRange = `${escapedSheetName}!${SHEET_COLUMNS.replied}${rowNum}`;
    const repliedAtRange = `${escapedSheetName}!${SHEET_COLUMNS.repliedAt}${rowNum}`;
    
    const [repliedResp, repliedAtResp] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: repliedRange }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: repliedAtRange })
    ]);
    
    const currentReplied = (repliedResp.data.values?.[0]?.[0] || '').toString().trim().toUpperCase();
    const currentRepliedAt = (repliedAtResp.data.values?.[0]?.[0] || '').toString().trim();
    const alreadyReplied = currentReplied === 'TRUE';
    
    // Prepare updates
    const updates: Partial<Record<keyof typeof SHEET_COLUMNS, string | boolean | number>> = {
      replied: true,
      status: 'Replied'
    };
    
    // Only update repliedAt if this is the first reply (preserve original timestamp for follow-up timer)
    if (!alreadyReplied || !currentRepliedAt) {
      updates.repliedAt = new Date().toISOString();
      console.log(`[Sheets] Setting repliedAt for first reply: emailId=${emailId}`);
    } else {
      console.log(`[Sheets] Preserving existing repliedAt=${currentRepliedAt} for emailId=${emailId} (already replied)`);
    }
    
    // Store reply content (truncate to 5000 chars to avoid cell size limits)
    if (replyContent) {
      const truncatedContent = replyContent.length > 5000 
        ? replyContent.substring(0, 5000) + '... [truncated]'
        : replyContent;
      updates.replyContent = truncatedContent;
      console.log(`[Sheets] Storing reply content (${truncatedContent.length} chars) for emailId=${emailId}`);
    }
    
    // Store reply Message-ID (for threading follow-ups)
    if (replyMessageId) {
      updates.replyMessageId = replyMessageId;
      console.log(`[Sheets] Storing reply Message-ID: ${replyMessageId} for emailId=${emailId}`);
    }
    
    return batchUpdateByEmailId(spreadsheetId, emailId, updates, sheetName);
  } catch (error) {
    console.error('[Sheets] Error in markReplied:', error);
    // Fallback to simple update if check fails
    return batchUpdateByEmailId(spreadsheetId, emailId, {
      replied: true,
      repliedAt: new Date().toISOString(),
      status: 'Replied'
    }, sheetName);
  }
}

// ============= CAMPAIGN STATUS TRACKING =============

/**
 * Campaign status tracking structure in Google Sheets
 * Create a new sheet tab called "CampaignJobs" with headers:
 * campaignId | subject | recipientCount | sentCount | failedCount | status | startedAt | completedAt | error
 */

export interface CampaignStatus {
  campaignId: string;
  subject: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  error?: string;
}

/**
 * Create or get campaign job sheet tab
 */
async function ensureCampaignJobsSheet(spreadsheetId: string): Promise<void> {
  const sheets = getSheetsClient();
  const titles = await getSpreadsheetTitles(spreadsheetId);
  
  if (!titles.includes('CampaignJobs')) {
    // Create the sheet
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: 'CampaignJobs'
            }
          }
        }]
      }
    });
    
    // Add headers
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'CampaignJobs!A1:I1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [['campaignId', 'subject', 'recipientCount', 'sentCount', 'failedCount', 'status', 'startedAt', 'completedAt', 'error']]
      }
    });
  }
}

/**
 * Create a new campaign job entry in the tracking sheet
 */
export async function createCampaignJob(
  spreadsheetId: string,
  campaignId: string,
  subject: string,
  recipientCount: number
): Promise<boolean> {
  try {
    await ensureCampaignJobsSheet(spreadsheetId);
    
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'CampaignJobs!A:I',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          campaignId,
          subject,
          recipientCount,
          0, // sentCount
          0, // failedCount
          'pending',
          new Date().toISOString(),
          '', // completedAt
          '' // error
        ]]
      }
    });
    
    console.log(`[Sheets] Created campaign job: ${campaignId}`);
    return true;
  } catch (error) {
    console.error('[Sheets] Error creating campaign job:', error);
    return false;
  }
}

/**
 * Find campaign job row by campaignId
 */
async function findCampaignJobRow(spreadsheetId: string, campaignId: string): Promise<number | null> {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'CampaignJobs!A:A',
    });
    
    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === campaignId);
    
    return rowIndex >= 0 ? rowIndex + 1 : null;
  } catch (error) {
    console.error('[Sheets] Error finding campaign job:', error);
    return null;
  }
}

/**
 * Update campaign job status
 */
export async function updateCampaignJobStatus(
  spreadsheetId: string,
  campaignId: string,
  updates: Partial<Omit<CampaignStatus, 'campaignId'>>
): Promise<boolean> {
  try {
    await ensureCampaignJobsSheet(spreadsheetId);
    const rowNum = await findCampaignJobRow(spreadsheetId, campaignId);
    
    if (!rowNum) {
      console.warn(`[Sheets] Campaign job not found: ${campaignId}`);
      return false;
    }
    
    const sheets = getSheetsClient();
    const data: any[] = [];
    
    // Map updates to columns
    if (updates.subject !== undefined) data.push({ range: `CampaignJobs!B${rowNum}`, values: [[updates.subject]] });
    if (updates.recipientCount !== undefined) data.push({ range: `CampaignJobs!C${rowNum}`, values: [[updates.recipientCount]] });
    if (updates.sentCount !== undefined) data.push({ range: `CampaignJobs!D${rowNum}`, values: [[updates.sentCount]] });
    if (updates.failedCount !== undefined) data.push({ range: `CampaignJobs!E${rowNum}`, values: [[updates.failedCount]] });
    if (updates.status !== undefined) data.push({ range: `CampaignJobs!F${rowNum}`, values: [[updates.status]] });
    if (updates.startedAt !== undefined) data.push({ range: `CampaignJobs!G${rowNum}`, values: [[updates.startedAt]] });
    if (updates.completedAt !== undefined) data.push({ range: `CampaignJobs!H${rowNum}`, values: [[updates.completedAt]] });
    if (updates.error !== undefined) data.push({ range: `CampaignJobs!I${rowNum}`, values: [[updates.error]] });
    
    if (data.length === 0) return true;
    
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data
      }
    });
    
    console.log(`[Sheets] Updated campaign job: ${campaignId}`);
    return true;
  } catch (error) {
    console.error('[Sheets] Error updating campaign job:', error);
    return false;
  }
}

/**
 * Get campaign job status
 */
export async function getCampaignJobStatus(
  spreadsheetId: string,
  campaignId: string
): Promise<CampaignStatus | null> {
  try {
    const rowNum = await findCampaignJobRow(spreadsheetId, campaignId);
    
    if (!rowNum) {
      return null;
    }
    
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `CampaignJobs!A${rowNum}:I${rowNum}`,
    });
    
    const row = response.data.values?.[0];
    if (!row) return null;
    
    return {
      campaignId: row[0] || '',
      subject: row[1] || '',
      recipientCount: parseInt(row[2] || '0'),
      sentCount: parseInt(row[3] || '0'),
      failedCount: parseInt(row[4] || '0'),
      status: (row[5] || 'pending') as CampaignStatus['status'],
      startedAt: row[6] || '',
      completedAt: row[7] || undefined,
      error: row[8] || undefined,
    };
  } catch (error) {
    console.error('[Sheets] Error getting campaign job status:', error);
    return null;
  }
}
