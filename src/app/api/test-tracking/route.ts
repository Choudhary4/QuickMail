import { NextRequest, NextResponse } from 'next/server';
import { markSeen, markReplied, findRowByEmailId } from '@/lib/sheets';

/**
 * Test endpoint for tracking fields (seen/replied)
 * Usage:
 * POST /api/test-tracking
 * Body: { spreadsheetId, emailId, sheetName?, action: 'seen' | 'replied' }
 */
export async function POST(req: NextRequest) {
  try {
    const { spreadsheetId, emailId, sheetName, action } = await req.json();

    if (!spreadsheetId || !emailId || !action) {
      return NextResponse.json(
        { error: 'Missing required fields: spreadsheetId, emailId, action' },
        { status: 400 }
      );
    }

    if (!['seen', 'replied'].includes(action)) {
      return NextResponse.json(
        { error: 'Action must be "seen" or "replied"' },
        { status: 400 }
      );
    }

    // Verify emailId exists in sheet
    const rowNum = await findRowByEmailId(spreadsheetId, emailId, sheetName || 'Sheet1');
    if (!rowNum) {
      return NextResponse.json(
        { error: `No row found for emailId: ${emailId}` },
        { status: 404 }
      );
    }

    let success = false;
    if (action === 'seen') {
      success = await markSeen(spreadsheetId, emailId, sheetName || 'Sheet1');
    } else if (action === 'replied') {
      success = await markReplied(spreadsheetId, emailId, sheetName || 'Sheet1');
    }

    if (!success) {
      return NextResponse.json(
        { error: `Failed to mark ${action}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Successfully marked as ${action}`,
      emailId,
      rowNum,
      action,
    });
  } catch (error: any) {
    console.error('[Test Tracking] Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

