import { NextRequest, NextResponse } from 'next/server';
import { getActiveCampaigns, getRecipientsFromSheet } from '@/lib/sheets';

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json().catch(() => ({}));
    const onlyNonReplied = body.onlyNonReplied || false;
    
    // Get master spreadsheet ID from environment variable (required)
    const masterSpreadsheetId = process.env.MASTER_SPREADSHEET_ID;
    const masterSheetName = process.env.MASTER_SHEET_NAME || process.env.MASTER_SPREADSHEET_NAME || 'Sheet1';

    if (!masterSpreadsheetId) {
      return NextResponse.json(
        { 
          error: 'MASTER_SPREADSHEET_ID environment variable is not set.',
          hint: 'Please set MASTER_SPREADSHEET_ID in your Vercel environment variables. Go to Settings → Environment Variables → Add MASTER_SPREADSHEET_ID with your master spreadsheet ID, then redeploy.',
          instructions: [
            '1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables',
            '2. Click "Add New"',
            '3. Name: MASTER_SPREADSHEET_ID',
            '4. Value: Your master spreadsheet ID (from Google Sheets URL)',
            '5. Select environments: Production, Preview, Development',
            '6. Click "Save"',
            '7. Redeploy your application',
            '8. See ENV_SETUP.md for detailed instructions'
          ]
        },
        { status: 400 }
      );
    }

    // Get all active campaigns from master spreadsheet
    console.log(`[Fetch Master Campaigns] Reading master spreadsheet from env: ${masterSpreadsheetId}, sheet: ${masterSheetName}`);
    console.log(`[Fetch Master Campaigns] Filter: ${onlyNonReplied ? 'Non-replied only' : 'All recipients'}`);
    const campaigns = await getActiveCampaigns(
      masterSpreadsheetId,
      masterSheetName
    );

    console.log(`[Fetch Master Campaigns] Found ${campaigns.length} active campaigns`);
    
    if (campaigns.length === 0) {
      return NextResponse.json({
        success: true,
        campaigns: [],
        totalRecipients: 0,
        csvData: '',
        message: 'No active campaigns found in master spreadsheet'
      });
    }
    
    console.log(`[Fetch Master Campaigns] Campaign IDs: ${campaigns.map(c => c.spreadsheetId).join(', ')}`);

    // Fetch recipients from each campaign spreadsheet
    const allRecipients: any[] = [];
    const allHeaders = new Set<string>();
    const campaignResults: Array<{
      spreadsheetId: string;
      sheetName?: string;
      recipientCount: number;
      success: boolean;
      error?: string;
    }> = [];

    for (const campaign of campaigns) {
      try {
        console.log(`[Fetch Master Campaigns] Processing campaign: ${campaign.spreadsheetId}, sheet: ${campaign.sheetName || 'Sheet1'}`);
        
        // Fetch recipients directly from the campaign's spreadsheet
        const { recipients, headers } = await getRecipientsFromSheet(
          campaign.spreadsheetId,
          campaign.sheetName
        );

        console.log(`[Fetch Master Campaigns] Campaign ${campaign.spreadsheetId}: Found ${recipients?.length || 0} recipients`);

        if (recipients && recipients.length > 0) {
          // Filter non-replied recipients if requested
          let filteredRecipients = recipients;
          if (onlyNonReplied) {
            filteredRecipients = recipients.filter((recipient: any) => {
              const replied = recipient.replied === 'TRUE' || recipient.replied === true;
              return !replied;
            });
            console.log(`[Fetch Master Campaigns] Campaign ${campaign.spreadsheetId}: Filtered to ${filteredRecipients.length} non-replied recipients (from ${recipients.length} total)`);
          }
          
          // Add campaign info to each recipient
          const recipientsWithCampaign = filteredRecipients.map((recipient: any) => ({
            ...recipient,
            _campaignSpreadsheetId: campaign.spreadsheetId,
            _campaignSheetName: campaign.sheetName || 'Sheet1',
          }));

          allRecipients.push(...recipientsWithCampaign);
          headers?.forEach((h: string) => allHeaders.add(h));
          
          campaignResults.push({
            spreadsheetId: campaign.spreadsheetId,
            sheetName: campaign.sheetName,
            recipientCount: filteredRecipients.length,
            success: true,
          });
          
          console.log(`[Fetch Master Campaigns] Campaign ${campaign.spreadsheetId}: Successfully added ${filteredRecipients.length} recipients`);
        } else {
          console.log(`[Fetch Master Campaigns] Campaign ${campaign.spreadsheetId}: No recipients found`);
          campaignResults.push({
            spreadsheetId: campaign.spreadsheetId,
            sheetName: campaign.sheetName,
            recipientCount: 0,
            success: false,
            error: 'No recipients found in spreadsheet',
          });
        }
      } catch (error: any) {
        console.error(`[Fetch Master Campaigns] Campaign ${campaign.spreadsheetId}: Error - ${error?.message || error}`);
        campaignResults.push({
          spreadsheetId: campaign.spreadsheetId,
          sheetName: campaign.sheetName,
          recipientCount: 0,
          success: false,
          error: error?.message || 'Unknown error',
        });
      }
    }
    
    console.log(`[Fetch Master Campaigns] Total recipients aggregated: ${allRecipients.length}`);

    // Convert to CSV format
    // IMPORTANT: Add _campaignSpreadsheetId and _campaignSheetName to headers
    // These are required for the Lambda to know which spreadsheet to update for each recipient
    const headers = Array.from(allHeaders);
    
    // Ensure campaign tracking fields are in headers (add if not present)
    if (!headers.includes('_campaignSpreadsheetId')) {
      headers.push('_campaignSpreadsheetId');
    }
    if (!headers.includes('_campaignSheetName')) {
      headers.push('_campaignSheetName');
    }
    
    const csvHeaders = headers.join(',');
    const csvRows = allRecipients.map(recipient =>
      headers.map(header => {
        const value = recipient[header] || '';
        // Escape commas and quotes
        return value.includes(',') || value.includes('"')
          ? `"${value.replace(/"/g, '""')}"`
          : value;
      }).join(',')
    );
    const csvData = [csvHeaders, ...csvRows].join('\n');
    
    // Log sample recipient to verify campaign IDs are attached
    if (allRecipients.length > 0) {
      const sampleRecipient = allRecipients[0];
      console.log(`[Fetch Master Campaigns] Sample recipient has _campaignSpreadsheetId: ${sampleRecipient._campaignSpreadsheetId}`);
      console.log(`[Fetch Master Campaigns] Sample recipient has _campaignSheetName: ${sampleRecipient._campaignSheetName}`);
    }

    const successfulCampaigns = campaignResults.filter(c => c.success).length;
    const message = onlyNonReplied
      ? `Fetched ${allRecipients.length} non-replied recipients from ${successfulCampaigns} active campaigns`
      : `Fetched ${allRecipients.length} recipients from ${successfulCampaigns} active campaigns`;
    
    return NextResponse.json({
      success: true,
      campaigns: campaignResults,
      recipients: allRecipients,
      headers,
      csvData,
      totalRecipients: allRecipients.length,
      message,
      onlyNonReplied
    });

  } catch (error: any) {
    console.error('[FETCH MASTER CAMPAIGNS ERROR]:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch campaigns from master spreadsheet' },
      { status: 500 }
    );
  }
}

