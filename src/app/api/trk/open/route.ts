import { NextRequest } from 'next/server';
import { markSeen } from '@/lib/sheets';

// Minimal transparent 1x1 GIF
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

async function markSeenInSheet(emailId: string | null, spreadsheetId?: string | null) {
  if (!emailId) return;
  // TODO: Get spreadsheetId from campaign metadata or env
  const sheetId = spreadsheetId || process.env.DEFAULT_TRACKING_SHEET_ID || '';
  if (!sheetId) {
    console.warn('[PIXEL] No spreadsheet ID configured');
    return;
  }
  await markSeen(sheetId, emailId);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const emailId = searchParams.get('emailId');
  const sheetId = searchParams.get('sheetId'); // Optional per-campaign sheet
  const sheetName = searchParams.get('sheetName') || undefined;
  const dryRun = searchParams.get('dryRun');
  
  // Log the request for debugging
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const referer = req.headers.get('referer') || 'direct';
  console.log(`[PIXEL] Request received - emailId=${emailId}, userAgent=${userAgent.substring(0, 50)}, referer=${referer.substring(0, 50)}`);
  
  if (!(dryRun === '1' || dryRun === 'true')) {
    await markSeenInSheetWithTab(emailId, sheetId, sheetName);
  }
  
  return new Response(PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*', // Allow loading from any origin (email clients)
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function markSeenInSheetWithTab(emailId: string | null, spreadsheetId?: string | null, sheetName?: string) {
  if (!emailId) {
    console.warn('[PIXEL] No emailId provided');
    return;
  }
  const sheetId = spreadsheetId || process.env.DEFAULT_TRACKING_SHEET_ID || '';
  if (!sheetId) {
    console.warn('[PIXEL] No spreadsheet ID configured');
    return;
  }
  const finalSheetName = sheetName || 'Sheet1';
  try {
    console.log(`[PIXEL] Marking seen for emailId=${emailId}, sheetId=${sheetId}, sheetName=${finalSheetName}`);
    
    // First, verify the sheet exists by trying to get available sheets
    try {
      const { getSpreadsheetTitles } = await import('@/lib/sheets');
      const availableSheets = await getSpreadsheetTitles(sheetId);
      console.log(`[PIXEL] Available sheets in spreadsheet: ${availableSheets.join(', ')}`);
      
      if (!availableSheets.includes(finalSheetName)) {
        console.error(`[PIXEL] Sheet "${finalSheetName}" not found! Available sheets: ${availableSheets.join(', ')}`);
        console.error(`[PIXEL] Using first available sheet instead: ${availableSheets[0]}`);
        // Try with the first available sheet
        const success = await markSeen(sheetId, emailId, availableSheets[0]);
        if (success) {
          console.log(`[PIXEL] Successfully marked seen for emailId=${emailId} using sheet ${availableSheets[0]}`);
        } else {
          console.error(`[PIXEL] Failed to mark seen for emailId=${emailId}`);
        }
        return;
      }
    } catch (verifyError: any) {
      console.warn(`[PIXEL] Could not verify sheet existence: ${verifyError?.message}. Proceeding anyway...`);
    }
    
    const success = await markSeen(sheetId, emailId, finalSheetName);
    if (success) {
      console.log(`[PIXEL] Successfully marked seen for emailId=${emailId}`);
    } else {
      console.error(`[PIXEL] Failed to mark seen for emailId=${emailId}. Check if emailId exists in the sheet.`);
    }
  } catch (error: any) {
    console.error(`[PIXEL] Error marking seen:`, error?.message || error);
    if (error?.code === 404 || error?.response?.status === 404) {
      console.error(`[PIXEL] Sheet "${finalSheetName}" not found in spreadsheet ${sheetId}. Check sheet name.`);
    }
  }
}
