import { NextRequest, NextResponse } from 'next/server';
import { getSpreadsheetTitles } from '@/lib/sheets';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sheetId = searchParams.get('sheetId');
  
  if (!sheetId) {
    return NextResponse.json({ error: 'Missing sheetId parameter' }, { status: 400 });
  }
  
  try {
    const titles = await getSpreadsheetTitles(sheetId);
    return NextResponse.json({ 
      spreadsheetId: sheetId,
      availableSheets: titles 
    });
  } catch (error: any) {
    return NextResponse.json({ 
      error: error?.message || 'Failed to get sheets',
      details: error?.toString()
    }, { status: 500 });
  }
}

