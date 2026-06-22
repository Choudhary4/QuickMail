import { NextRequest, NextResponse } from 'next/server';
import { getCampaignJobStatus, getActiveCampaigns } from '@/lib/sheets';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const campaignId = id;
    
    // Get spreadsheetId from query parameter, or try to find it
    const { searchParams } = new URL(request.url);
    let spreadsheetId = searchParams.get('spreadsheetId');
    
    // If not provided, try to find it by searching master spreadsheet or using default
    if (!spreadsheetId) {
      const masterSpreadsheetId = process.env.MASTER_SPREADSHEET_ID;
      
      if (masterSpreadsheetId) {
        // Try to find the campaign in master spreadsheet's campaigns
        try {
          const campaigns = await getActiveCampaigns(
            masterSpreadsheetId,
            process.env.MASTER_SHEET_NAME || 'Sheet1'
          );
          
          // Search for campaign in each spreadsheet
          for (const campaign of campaigns) {
            const status = await getCampaignJobStatus(campaign.spreadsheetId, campaignId);
            if (status) {
              return NextResponse.json(status);
            }
          }
        } catch (error) {
          console.warn('[Campaign Status] Failed to search master spreadsheet:', error);
        }
      }
      
      // Fallback to DEFAULT_TRACKING_SHEET_ID
      spreadsheetId = process.env.DEFAULT_TRACKING_SHEET_ID || null;
      
      if (!spreadsheetId) {
        return NextResponse.json(
          { 
            message: 'Spreadsheet ID not provided. Add ?spreadsheetId=YOUR_SHEET_ID to the URL, or set DEFAULT_TRACKING_SHEET_ID or MASTER_SPREADSHEET_ID in environment variables.',
            hint: 'The spreadsheetId should be the tracking spreadsheet where the campaign was created'
          },
          { status: 400 }
        );
      }
    }

    const status = await getCampaignJobStatus(spreadsheetId, campaignId);

    if (!status) {
      return NextResponse.json(
        { 
          message: 'Campaign not found',
          hint: `Campaign ${campaignId} not found in spreadsheet ${spreadsheetId}. Make sure the campaign was created in this spreadsheet.`
        },
        { status: 404 }
      );
    }

    return NextResponse.json(status);
  } catch (error: any) {
    console.error('Campaign Status API Error:', error);
    return NextResponse.json(
      { message: 'Failed to fetch campaign status', error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
