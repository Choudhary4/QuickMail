import { NextRequest, NextResponse } from 'next/server';
import { markSeen } from '@/lib/sheets';

/**
 * Track link clicks and mark email as seen
 * This works even when Gmail blocks pixel tracking
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const emailId = searchParams.get('emailId');
  const sheetId = searchParams.get('sheetId');
  const sheetName = searchParams.get('sheetName') || undefined;
  const redirectUrl = searchParams.get('url'); // Original URL to redirect to

  if (!emailId) {
    return NextResponse.json({ error: 'Missing emailId' }, { status: 400 });
  }

  // Mark email as seen when link is clicked
  // This is more reliable than pixel tracking in Gmail
  if (sheetId) {
    try {
      console.log(`[CLICK] Link clicked for emailId=${emailId}, marking as seen`);
      await markSeen(sheetId, emailId, sheetName || 'Sheet1');
      console.log(`[CLICK] Successfully marked seen for emailId=${emailId}`);
    } catch (error: any) {
      console.error(`[CLICK] Error marking seen:`, error?.message || error);
      // Don't fail the redirect if tracking fails
    }
  }

  // Redirect to original URL
  if (redirectUrl) {
    // Decode the URL if it's encoded
    const decodedUrl = decodeURIComponent(redirectUrl);
    return NextResponse.redirect(decodedUrl, { status: 302 });
  }

  // If no redirect URL, return success
  return NextResponse.json({ 
    success: true, 
    message: 'Click tracked and email marked as seen' 
  });
}

