import { NextRequest, NextResponse } from 'next/server';
import { markReplied } from '@/lib/sheets';

/**
 * Mark email as replied
 * Can be called directly or via webhook/IMAP checker
 * 
 * Usage:
 * GET /api/trk/reply?emailId=...&sheetId=...&sheetName=...
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const emailId = searchParams.get('emailId');
  const sheetId = searchParams.get('sheetId');
  const sheetName = searchParams.get('sheetName') || 'Sheet1';

  if (!emailId || !sheetId) {
    return NextResponse.json(
      { error: 'Missing emailId or sheetId' },
      { status: 400 }
    );
  }

  try {
    console.log(`[REPLY] Marking replied for emailId=${emailId}, sheetId=${sheetId}`);
    const success = await markReplied(sheetId, emailId, sheetName);
    
    if (success) {
      console.log(`[REPLY] Successfully marked replied for emailId=${emailId}`);
      return NextResponse.json({
        success: true,
        message: 'Email marked as replied',
        emailId,
      });
    } else {
      console.error(`[REPLY] Failed to mark replied for emailId=${emailId}`);
      return NextResponse.json(
        { error: 'Failed to mark as replied. Check if emailId exists in sheet.' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error(`[REPLY] Error marking replied:`, error?.message || error);
    return NextResponse.json(
      { error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Mark email as replied (POST method)
 * Useful for webhooks or IMAP checkers
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { emailId, sheetId, sheetName } = body;

    if (!emailId || !sheetId) {
      return NextResponse.json(
        { error: 'Missing emailId or sheetId' },
        { status: 400 }
      );
    }

    const finalSheetName = sheetName || 'Sheet1';
    console.log(`[REPLY] Marking replied for emailId=${emailId}, sheetId=${sheetId}`);
    const success = await markReplied(sheetId, emailId, finalSheetName);
    
    if (success) {
      console.log(`[REPLY] Successfully marked replied for emailId=${emailId}`);
      return NextResponse.json({
        success: true,
        message: 'Email marked as replied',
        emailId,
      });
    } else {
      return NextResponse.json(
        { error: 'Failed to mark as replied' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error(`[REPLY] Error:`, error?.message || error);
    return NextResponse.json(
      { error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

