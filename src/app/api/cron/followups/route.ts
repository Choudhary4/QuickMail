// app/api/cron/followups/route.ts
// Scheduler endpoint for automated follow-up emails with AI-generated content

import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import fs from 'node:fs';
import { createEmailProvider } from '@/lib/email-providers';
import { randomUUID } from 'crypto';
import juice from 'juice';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSpreadsheetTitles, escapeSheetName, getActiveCampaigns, CampaignConfig, updateMasterSpreadsheetStatus } from '@/lib/sheets';

interface FollowUpRule {
  condition: 'seen_no_reply' | 'delivered_not_seen';
  delayHours: number;
  subject: string;
  htmlTemplate: string;
}

// Helper to get sheets client
function getSheetsClient() {
  const fromFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  const fromB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  const fromInline = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  let raw: string | undefined;
  
  // Try file system first (only works in local/dev, not on Vercel)
  if (fromFile) {
    try {
      if (fs.existsSync(fromFile)) {
        raw = fs.readFileSync(fromFile, 'utf8');
      }
    } catch (error) {
      // File system not available (e.g., on Vercel), continue to other methods
      console.warn('[Followups] File system access not available, trying other credential methods');
    }
  }
  
  // Prefer base64 or inline JSON (works on Vercel)
  if (!raw && fromB64) {
    raw = Buffer.from(fromB64, 'base64').toString('utf8');
  } else if (!raw && fromInline) {
    raw = fromInline;
  }

  if (!raw) {
    throw new Error('Google credentials not configured. Provide GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 or GOOGLE_SERVICE_ACCOUNT_KEY (recommended for Vercel). GOOGLE_SERVICE_ACCOUNT_KEY_FILE only works in local development.');
  }
  
  const credentials = JSON.parse(raw);
  if (credentials.private_key && typeof credentials.private_key === 'string') {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  
  return google.sheets({ version: 'v4', auth });
}

// Column indices (0-based) for spreadsheet reading
// These map to the expected column order: A=0, B=1, ..., T=19
interface ColumnIndices {
  email: number;
  firstName: number;
  productName: number;
  discountCode: number;
  emailId: number;
  delivered: number;
  deliveredAt: number;
  seen: number;
  seenAt: number;
  replied: number;
  repliedAt: number;
  bounced: number;
  bounceReason: number;
  complaint: number;
  suppressed: number;
  followUpCount: number;
  lastFollowUpAt: number;
  status: number;
  replyContent: number;
  replyMessageId: number;
}

// Read all rows from tracking sheet with dynamic header detection
async function getTrackingData(spreadsheetId: string, preferredSheetName?: string) {
  const sheets = getSheetsClient();
  
  try {
    // Get available sheet titles and use preferred or first available
    const availableTitles = await getSpreadsheetTitles(spreadsheetId);
    
    if (availableTitles.length === 0) {
      throw new Error('Spreadsheet has no sheets/tabs');
    }
    
    console.log(`[Follow-up] Available sheets: ${availableTitles.join(', ')}`);
    console.log(`[Follow-up] Preferred sheet name: ${preferredSheetName || 'not specified'}`);
    
    const sheetNameUsed = preferredSheetName && availableTitles.includes(preferredSheetName)
      ? preferredSheetName
      : availableTitles[0];
    
    console.log(`[Follow-up] Using sheet: "${sheetNameUsed}"`);
    
    // Use the exported escapeSheetName function for consistency
    const escapedSheetName = escapeSheetName(sheetNameUsed);
    
    console.log(`[Follow-up] Escaped sheet name: "${escapedSheetName}"`);
    
    // First, read the header row to find column indices dynamically
    const headerRange = `${escapedSheetName}!A1:Z1`;
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: headerRange,
    });
    const headers = (headerResponse.data.values?.[0] || []).map(h => h?.toString().toLowerCase().trim() || '');
    console.log(`[Follow-up] Headers found: ${headers.join(', ')}`);
    
    // Find column indices dynamically (case-insensitive)
    const findCol = (names: string[]): number => {
      for (const name of names) {
        const idx = headers.findIndex(h => h === name.toLowerCase());
        if (idx >= 0) return idx;
      }
      return -1;
    };
    
    // Default column indices (based on standard spreadsheet layout A-T)
    const DEFAULT_INDICES: ColumnIndices = {
      email: 0, firstName: 1, productName: 2, discountCode: 3, emailId: 4,
      delivered: 5, deliveredAt: 6, seen: 7, seenAt: 8, replied: 9, repliedAt: 10,
      bounced: 11, bounceReason: 12, complaint: 13, suppressed: 14,
      followUpCount: 15, lastFollowUpAt: 16, status: 17,
      replyContent: 18, replyMessageId: 19
    };
    
    const columnIndices: ColumnIndices = {
      email: findCol(['email', 'email address', 'emailaddress']),
      firstName: findCol(['firstname', 'first name', 'first_name', 'name']),
      productName: findCol(['productname', 'product name', 'product_name', 'product']),
      discountCode: findCol(['discountcode', 'discount code', 'discount_code', 'discount', 'code']),
      emailId: findCol(['emailid', 'email id', 'email_id', 'messageid', 'message id']),
      delivered: findCol(['delivered']),
      deliveredAt: findCol(['deliveredat', 'delivered at', 'delivered_at']),
      seen: findCol(['seen', 'opened']),
      seenAt: findCol(['seenat', 'seen at', 'seen_at', 'openedat', 'opened at']),
      replied: findCol(['replied']),
      repliedAt: findCol(['repliedat', 'replied at', 'replied_at']),
      bounced: findCol(['bounced']),
      bounceReason: findCol(['bouncereason', 'bounce reason', 'bounce_reason']),
      complaint: findCol(['complaint']),
      suppressed: findCol(['suppressed']),
      followUpCount: findCol(['followupcount', 'follow up count', 'followup_count', 'followups']),
      lastFollowUpAt: findCol(['lastfollowupat', 'last follow up at', 'lastfollowup_at']),
      status: findCol(['status']),
      replyContent: findCol(['replycontent', 'reply content', 'reply_content']),
      replyMessageId: findCol(['replymessageid', 'reply message id', 'reply_message_id', 'replymsgid']),
    };
    
    // Use fallback indices for columns that weren't found
    for (const key of Object.keys(columnIndices) as Array<keyof ColumnIndices>) {
      if (columnIndices[key] === -1) {
        console.warn(`[Follow-up] Column "${key}" not found by header, using default index: ${DEFAULT_INDICES[key]}`);
        columnIndices[key] = DEFAULT_INDICES[key];
      }
    }
    
    console.log(`[Follow-up] Column indices (after fallback):`);
    console.log(`  - email: ${columnIndices.email}, emailId: ${columnIndices.emailId}`);
    console.log(`  - replied: ${columnIndices.replied}, repliedAt: ${columnIndices.repliedAt}`);
    console.log(`  - replyContent: ${columnIndices.replyContent}, replyMessageId: ${columnIndices.replyMessageId}`);
    
    // Read all data rows
    const dataRange = `${escapedSheetName}!A2:Z`; // Read all columns
    console.log(`[Follow-up] Fetching data range: ${dataRange}`);
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: dataRange,
    });
    
    const rows = response.data.values || [];
    console.log(`[Follow-up] Loaded ${rows.length} rows from sheet "${sheetNameUsed}"`);
    
    return { rows, sheetNameUsed, columnIndices };
  } catch (error: any) {
    console.error(`[Follow-up] Error in getTrackingData:`, error);
    if (error?.message?.includes('Unable to parse range')) {
      console.error(`[Follow-up] Range parsing error - check sheet name and special characters`);
    }
    if (error?.message?.includes('getaddrinfo ENOTFOUND')) {
      console.error(`[Follow-up] DNS resolution error - check internet connection or restart server`);
      console.error(`[Follow-up] This might be a temporary DNS cache issue. Try restarting the server.`);
    }
    throw error;
  }
}

// Update follow-up counts
async function updateFollowUpSent(
  spreadsheetId: string,
  rowIndex: number,
  followUpCount: number,
  sheetName = 'Sheet1'
) {
  const sheets = getSheetsClient();
  const now = new Date().toISOString();
  
  // Escape sheet name if it contains special characters
  const escapedSheetName = sheetName.includes(' ') || sheetName.includes("'") 
    ? `'${sheetName.replace(/'/g, "''")}'` 
    : sheetName;
  
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `${escapedSheetName}!P${rowIndex}`, values: [[followUpCount]] }, // followUpCount
        { range: `${escapedSheetName}!Q${rowIndex}`, values: [[now]] }, // lastFollowUpAt
        { range: `${escapedSheetName}!R${rowIndex}`, values: [['Follow-up ' + followUpCount]] }, // status
      ]
    }
  });
}

// Personalize HTML with recipient data
function personalizeHtml(html: string, recipient: Record<string, string>): string {
  let personalized = html;
  for (const [key, value] of Object.entries(recipient)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    personalized = personalized.replace(regex, value);
  }
  return personalized;
}

/**
 * Format emailId (UUID) as a proper Message-ID header value
 * Message-IDs should be in format: <local-part@domain>
 */
function formatMessageId(emailId: string, domain?: string): string {
  // Use provided domain or extract from environment
  const emailDomain = domain || process.env.EMAIL_SENDER_ADDRESS?.split('@')[1] || 'example.com';
  return `<${emailId}@${emailDomain}>`;
}

/**
 * Ensure subject has "Re:" prefix for threading
 */
function ensureRePrefix(subject: string): string {
  const trimmed = subject.trim();
  if (trimmed.toLowerCase().startsWith('re:')) {
    return trimmed; // Already has Re:
  }
  return `Re: ${trimmed}`;
}

/**
 * Generate Thread-Index header for Outlook compatibility
 * This is a base64-encoded identifier that helps Outlook group emails
 */
function generateThreadIndex(originalMessageId: string, followUpNumber: number): string {
  // Create a simple thread index based on original message ID and follow-up number
  // Outlook uses a specific format, but a simple base64 encoding works for basic threading
  const threadData = `${originalMessageId}-${followUpNumber}`;
  return Buffer.from(threadData).toString('base64');
}

/**
 * Build threading headers for email conversation threading
 * Returns headers object with In-Reply-To, References, Thread-Index, and Thread-Topic
 * @param originalEmailId - The original email's ID (UUID)
 * @param followUpNumber - The follow-up number (1, 2, 3, etc.)
 * @param subject - The email subject
 * @param replyMessageId - Optional: The reply's Message-ID (if recipient has replied)
 */
function buildThreadingHeaders(
  originalEmailId: string,
  followUpNumber: number,
  subject: string,
  replyMessageId?: string
): Record<string, string> {
  console.log(`[Threading] Building headers:`);
  console.log(`  - originalEmailId: "${originalEmailId}"`);
  console.log(`  - followUpNumber: ${followUpNumber}`);
  console.log(`  - replyMessageId: "${replyMessageId || 'NOT PROVIDED'}"`);
  
  const originalMessageId = formatMessageId(originalEmailId);
  const threadIndex = generateThreadIndex(originalEmailId, followUpNumber);
  
  console.log(`  - Formatted originalMessageId: "${originalMessageId}"`);
  
  // Thread-Topic is the subject without "Re:" prefix (for Outlook)
  const threadTopic = subject.replace(/^re:\s*/i, '').trim();
  
  // If recipient has replied, thread to their reply, not the original
  if (replyMessageId && replyMessageId.trim()) {
    // Ensure replyMessageId has proper format
    const formattedReplyMsgId = replyMessageId.includes('<') 
      ? replyMessageId.trim()
      : `<${replyMessageId.trim()}>`;
    
    // Use reply's Message-ID as In-Reply-To
    // Build References chain: original + reply (for proper threading)
    const references = `${originalMessageId} ${formattedReplyMsgId}`;
    
    console.log(`  - Using reply Message-ID for threading`);
    console.log(`  - In-Reply-To: "${formattedReplyMsgId}"`);
    console.log(`  - References: "${references}"`);
    
    return {
      'In-Reply-To': formattedReplyMsgId,
      'References': references,
      'Thread-Index': threadIndex,
      'Thread-Topic': threadTopic,
    };
  } else {
    // No reply yet, thread to original email
    console.log(`  - No reply Message-ID, threading to original`);
    console.log(`  - In-Reply-To: "${originalMessageId}"`);
    console.log(`  - References: "${originalMessageId}"`);
    
    return {
      'In-Reply-To': originalMessageId,
      'References': originalMessageId,
      'Thread-Index': threadIndex,
      'Thread-Topic': threadTopic,
    };
  }
}

// Generate AI-powered follow-up email using Gemini
async function generateAIFollowUpEmail(
  recipientData: {
    firstName: string;
    productName: string;
    discountCode?: string;
    followUpCount: number;
    daysSinceLastContact: number;
    originalSubject?: string;
    hasReplied?: boolean; // NEW: Indicates if recipient has replied
  },
  replyContent?: string // Optional: The actual reply content from the recipient
): Promise<{ subject: string; html: string }> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  if (!geminiApiKey || geminiApiKey.trim() === '') {
    console.log('[Follow-up] Gemini API key not configured, using template fallback');
    // Use template fallback directly
    if (recipientData.hasReplied) {
      return {
        subject: `Re: ${recipientData.originalSubject || 'Following up'}`,
        html: `
          <p>Hi ${recipientData.firstName},</p>
          <p>Thank you for your reply! I wanted to follow up and continue our conversation.</p>
          <p>I'd love to hear more of your thoughts and answer any questions you might have.</p>
          <p>Looking forward to continuing our conversation.</p>
          <p>Best regards</p>
        `
      };
    } else {
      return {
        subject: `Re: ${recipientData.originalSubject || 'Following up'}`,
        html: `
          <p>Hi ${recipientData.firstName},</p>
          <p>I wanted to follow up on my previous email.</p>
          <p>I'd love to hear your thoughts and answer any questions you might have.</p>
          <p>Looking forward to hearing from you.</p>
          <p>Best regards</p>
        `
      };
    }
  }

  try {
    console.log('[Follow-up] Using Gemini model: gemini-2.5-flash');
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `
You are a professional email marketer writing a follow-up email. Generate a personalized, friendly, and engaging follow-up email.

Context:
- Recipient's name: ${recipientData.firstName}
- This is follow-up #${recipientData.followUpCount + 1}
- Days since last contact: ${recipientData.daysSinceLastContact}
${recipientData.originalSubject ? `- Original email subject: ${recipientData.originalSubject}` : ''}
${recipientData.hasReplied ? `- IMPORTANT: The recipient has already replied to your previous email. This is a follow-up to continue the conversation.` : `- The recipient has not replied yet. This is a follow-up to encourage engagement.`}
${replyContent ? `- Their reply content: "${replyContent.substring(0, 1000)}${replyContent.length > 1000 ? '...' : ''}"` : ''}

Requirements:
1. ${recipientData.hasReplied ? (replyContent ? 'Read their reply carefully and respond to their specific points, questions, or concerns. Show that you understand what they said.' : 'Acknowledge their reply and show appreciation. Continue the conversation naturally.') : 'Write a professional but friendly follow-up email to encourage a response.'}
2. Keep it concise (2-3 short paragraphs)
3. Show genuine interest, not pushy
4. ${replyContent ? 'Address their specific points from their reply. If they asked questions, answer them. If they expressed concerns, address them.' : 'Include a clear call-to-action'}
5. Make it feel personal and relevant
6. Use HTML format with inline CSS for email compatibility
7. Use proper email structure with <p> tags
${recipientData.hasReplied ? '8. Be conversational and engaging, as if continuing a dialogue' : ''}
${replyContent ? '9. Reference specific things they mentioned in their reply to show you read and understood it' : ''}

Generate ONLY the email body HTML (no subject line in the HTML). Use inline styles for formatting.
Make it mobile-friendly and compatible with email clients like Gmail and Outlook.

Example structure:
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <p>Hi ${recipientData.firstName},</p>
  <p>...</p>
</body>
</html>
`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const htmlContent = response.text();

      // Extract subject from response if it includes one, otherwise generate
      let subject = `Re: ${recipientData.originalSubject || 'Following up'}`;
      
      // Try to extract subject if AI included it
      const subjectMatch = htmlContent.match(/<subject>(.*?)<\/subject>/i);
      if (subjectMatch) {
        subject = subjectMatch[1].trim();
      } else if (recipientData.originalSubject) {
        // Use original subject with Re: prefix for threading
        subject = `Re: ${recipientData.originalSubject}`;
      } else {
        // Generate subject using AI only if no original subject
        const subjectPrompt = `Generate a short, professional email subject line (max 60 characters) for a follow-up email to ${recipientData.firstName}. This is follow-up #${recipientData.followUpCount + 1}. Return ONLY the subject line, no quotes, no explanation.`;
        const subjectResult = await model.generateContent(subjectPrompt);
        const subjectResponse = await subjectResult.response;
        const generatedSubject = subjectResponse.text().trim().replace(/^["']|["']$/g, '');
        if (generatedSubject && generatedSubject.length < 100) {
          subject = generatedSubject;
        }
      }

    // Clean up HTML - remove subject tags if present
    const cleanHtml = htmlContent
      .replace(/<subject>.*?<\/subject>/gi, '')
      .replace(/```html/gi, '')
      .replace(/```/gi, '')
      .trim();

    console.log('[Follow-up] ✅ Successfully generated AI email with model: gemini-2.5-flash');
    
    return {
      subject,
      html: cleanHtml || (recipientData.hasReplied ? `
        <p>Hi ${recipientData.firstName},</p>
        <p>Thank you for your reply! I wanted to follow up and continue our conversation about ${recipientData.productName}.</p>
        <p>I'd love to hear more of your thoughts and answer any questions you might have.</p>
        <p>Best regards</p>
      ` : `
        <p>Hi ${recipientData.firstName},</p>
        <p>I wanted to follow up on my previous email about ${recipientData.productName}.</p>
        <p>I'd love to hear your thoughts and answer any questions you might have.</p>
        <p>Best regards</p>
      `)
    };
  } catch (error) {
    console.error('[Follow-up] Gemini AI error:', error);
    // Fallback to default template
    if (recipientData.hasReplied) {
      return {
        subject: `Re: ${recipientData.originalSubject || 'Following up'}`,
        html: `
          <p>Hi ${recipientData.firstName},</p>
          <p>Thank you for your reply! I wanted to follow up and continue our conversation.</p>
          <p>I'd love to hear more of your thoughts and answer any questions you might have.</p>
          <p>Looking forward to continuing our conversation.</p>
          <p>Best regards</p>
        `
      };
    } else {
      return {
        subject: `Re: ${recipientData.originalSubject || 'Following up'}`,
        html: `
          <p>Hi ${recipientData.firstName},</p>
          <p>I wanted to follow up on my previous email.</p>
          <p>I'd love to hear your thoughts and answer any questions you might have.</p>
          <p>Looking forward to hearing from you.</p>
          <p>Best regards</p>
        `
      };
    }
  }
}

/**
 * Get campaign subject from CampaignJobs sheet
 */
async function getCampaignSubject(spreadsheetId: string): Promise<string | null> {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'CampaignJobs!A:B',  // campaignId in A, subject in B
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return null; // No data or only header
    }

    // Get the most recent campaign (last row)
    const lastRow = rows[rows.length - 1];
    const subject = lastRow[1]; // Column B (index 1)
    
    if (subject && typeof subject === 'string') {
      console.log(`[Follow-up] Found campaign subject: "${subject}"`);
      return subject;
    }
    
    return null;
  } catch (error) {
    console.error('[Follow-up] Error reading campaign subject:', error);
    return null;
  }
}

/**
 * Security: Requires CRON_SECRET_TOKEN in query param (GET) or Authorization header (POST)
 */
function verifyCronToken(req: NextRequest): boolean {
  const token = process.env.CRON_SECRET_TOKEN;
  if (!token) {
    console.warn('[Cron] CRON_SECRET_TOKEN not set - allowing request (not recommended for production)');
    return true; // Allow if no token set (for backward compatibility)
  }
  
  // Check query parameter (for GET requests from external cron services)
  const queryToken = req.nextUrl.searchParams.get('token');
  if (queryToken === token) return true;
  
  // Check Authorization header (for POST requests)
  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${token}`) return true;
  
  return false;
}

export async function GET(req: NextRequest) {
  // GET method for easy external cron service calls
  if (!verifyCronToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Use environment variables for GET requests
  return handleFollowups(req, {});
}

export async function POST(req: NextRequest) {
  // Verify token if set
  if (process.env.CRON_SECRET_TOKEN && !verifyCronToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const body = await req.json().catch(() => ({}));
  return handleFollowups(req, body);
}

async function handleFollowups(req: NextRequest, body: any) {
  try {
    const { spreadsheetId, sheetName, smtpConfig, followUpRules, useAI } = body as {
      spreadsheetId?: string;
      sheetName?: string;
      smtpConfig?: { host: string; port: number; user: string; pass: string };
      followUpRules?: FollowUpRule[];
      useAI?: boolean;
    };

    // Get SMTP config from body or use SES if available
    let finalSmtpConfig = smtpConfig;
    if (!finalSmtpConfig && process.env.AWS_SES_REGION) {
      // Will use SES provider
      finalSmtpConfig = undefined;
    }

    // Use AI by default if GEMINI_API_KEY is set, or if explicitly requested
    const shouldUseAI = useAI !== false && !!process.env.GEMINI_API_KEY;

    if (!finalSmtpConfig && !process.env.AWS_SES_REGION) {
      return NextResponse.json({ 
        error: 'Missing SMTP config. Provide smtpConfig in request body or configure AWS SES.' 
      }, { status: 400 });
    }

    // Check if using master spreadsheet or single spreadsheet
    const masterSpreadsheetId = process.env.MASTER_SPREADSHEET_ID;
    const masterSheetName = process.env.MASTER_SHEET_NAME || 'Sheet1';
    
    let campaigns: CampaignConfig[] = [];
    
    if (spreadsheetId) {
      // Single spreadsheet mode (backward compatible)
      campaigns = [{ spreadsheetId, sheetName: sheetName || process.env.DEFAULT_SHEET_NAME }];
      console.log(`[Follow-up] Single spreadsheet mode: ${spreadsheetId}`);
    } else if (masterSpreadsheetId) {
      // Master spreadsheet mode - get all active campaigns filtered by FOLLOWUP type
      console.log(`[Follow-up] Master spreadsheet mode: reading campaigns from ${masterSpreadsheetId}`);
      try {
        campaigns = await getActiveCampaigns(masterSpreadsheetId, masterSheetName, 'FOLLOWUP');
        console.log(`[Follow-up] Found ${campaigns.length} active FOLLOWUP campaigns to process`);
      } catch (error: any) {
        return NextResponse.json(
          { 
            error: `Failed to read master spreadsheet: ${error?.message || error}`,
            hint: 'Ensure MASTER_SPREADSHEET_ID is set and the master sheet has a "Spreadsheet ID" or "spreadsheetId" column'
          },
          { status: 400 }
        );
      }
    } else {
      // Fallback to DEFAULT_TRACKING_SHEET_ID (backward compatible)
      const defaultSpreadsheetId = process.env.DEFAULT_TRACKING_SHEET_ID;
      if (!defaultSpreadsheetId) {
        return NextResponse.json(
          { 
            error: 'Missing spreadsheet configuration. Provide spreadsheetId in request body, or set MASTER_SPREADSHEET_ID or DEFAULT_TRACKING_SHEET_ID in environment variables.',
            hint: 'For multiple campaigns, set MASTER_SPREADSHEET_ID to a spreadsheet that lists all campaign spreadsheet IDs'
          },
          { status: 400 }
        );
      }
      campaigns = [{ spreadsheetId: defaultSpreadsheetId, sheetName: process.env.DEFAULT_SHEET_NAME }];
      console.log(`[Follow-up] Using DEFAULT_TRACKING_SHEET_ID: ${defaultSpreadsheetId}`);
    }

    if (campaigns.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active campaigns found',
        results: { evaluated: 0, sent: 0, skipped: 0, errors: [] }
      });
    }

    // Default rules if none provided
    const rules: FollowUpRule[] = followUpRules || [
      {
        condition: 'seen_no_reply',
        delayHours: 48,
        subject: 'Re: Following up',
        htmlTemplate: '<p>Hi {{firstName}},</p><p>Just following up on my previous email. Would love to hear your thoughts!</p>'
      },
      {
        condition: 'delivered_not_seen',
        delayHours: 72,
        subject: 'Re: Did you see this?',
        htmlTemplate: '<p>Hi {{firstName}},</p><p>Wanted to make sure you saw my previous message.</p>'
      }
    ];

    // Process all campaigns
    const allResults = {
      evaluated: 0,
      sent: 0,
      skipped: 0,
      errors: [] as string[],
      campaigns: [] as Array<{ spreadsheetId: string; results: any }>
    };

    for (const campaign of campaigns) {
      const startTime = Date.now();
      let campaignError: string | undefined = undefined;
      
      try {
        const campaignSpreadsheetId = campaign.spreadsheetId;
        const campaignSheetName = campaign.sheetName || process.env.DEFAULT_SHEET_NAME || 'Sheet1';
        
        console.log(`[Follow-up] Processing campaign: ${campaign.campaignName || campaignSpreadsheetId} (${campaignSpreadsheetId}), sheetName="${campaignSheetName}"`);
        
        // Get campaign subject from CampaignJobs sheet
        const campaignSubject = await getCampaignSubject(campaignSpreadsheetId);
        
        const trackingData = await getTrackingData(campaignSpreadsheetId, campaignSheetName);
        const rows = trackingData.rows;
        const actualSheetName = trackingData.sheetNameUsed;
        const colIdx = trackingData.columnIndices;
        
        console.log(`[Follow-up] Loaded ${rows.length} recipients from sheet "${actualSheetName}"`);
        if (campaignSheetName !== actualSheetName) {
          console.warn(`[Follow-up] ⚠️  Sheet name mismatch! Requested "${campaignSheetName}" but using "${actualSheetName}"`);
        }
        
        const provider = createEmailProvider({ 
          smtp: finalSmtpConfig,
          ses: process.env.AWS_SES_REGION ? {
            region: process.env.AWS_SES_REGION,
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            configurationSetName: process.env.AWS_SES_CONFIGURATION_SET,
          } : undefined,
        });
        
        const campaignResults = { evaluated: 0, sent: 0, skipped: 0, errors: [] as string[] };
        const now = new Date();
        
        console.log(`[Follow-up] Starting follow-up check for sheet ${campaignSpreadsheetId}, sheetName="${actualSheetName}"`);
        console.log(`[Follow-up] Using AI: ${shouldUseAI ? 'Yes (Gemini)' : 'No (Template)'}`);

        // Helper function to safely get column value
        const getCol = (row: any[], idx: number): string => {
          if (idx < 0 || idx >= row.length) return '';
          return (row[idx] ?? '').toString();
        };

        for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 2; // Sheet is 1-indexed, +1 for header
      
      // Parse row using dynamic column indices (found from headers)
      // This handles spreadsheets with different column orders
      const email = getCol(row, colIdx.email);
      const firstName = getCol(row, colIdx.firstName);
      const productName = getCol(row, colIdx.productName);
      const discountCode = getCol(row, colIdx.discountCode);
      const emailId = getCol(row, colIdx.emailId);
      const delivered = getCol(row, colIdx.delivered);
      const deliveredAt = getCol(row, colIdx.deliveredAt);
      const seen = getCol(row, colIdx.seen);
      const seenAt = getCol(row, colIdx.seenAt);
      const replied = getCol(row, colIdx.replied);
      const repliedAt = getCol(row, colIdx.repliedAt);
      const bounced = getCol(row, colIdx.bounced);
      const bounceReason = getCol(row, colIdx.bounceReason);
      const complaint = getCol(row, colIdx.complaint);
      const suppressed = getCol(row, colIdx.suppressed);
      const followUpCount = getCol(row, colIdx.followUpCount);
      const lastFollowUpAt = getCol(row, colIdx.lastFollowUpAt);
      const status = getCol(row, colIdx.status);
      const replyContent = getCol(row, colIdx.replyContent);
      const replyMessageId = getCol(row, colIdx.replyMessageId);
      
      // Debug logging for threading values
      if (replied === 'TRUE') {
        console.log(`[Follow-up] ====== Row ${rowIndex} THREADING DEBUG ======`);
        console.log(`  - Row has ${row.length} columns`);
        console.log(`  - emailId column index: ${colIdx.emailId}, value: "${emailId}"`);
        console.log(`  - replyMessageId column index: ${colIdx.replyMessageId}, raw value at index: "${row[colIdx.replyMessageId]}"`);
        console.log(`  - replyMessageId after getCol: "${replyMessageId}"`);
        console.log(`  - replyContent column index: ${colIdx.replyContent}, value: "${(replyContent || '').substring(0, 50)}..."`);
        console.log(`  - Full row data (first 20 cols): ${JSON.stringify(row.slice(0, 20))}`);
        console.log(`  ============================================`);
      }

          campaignResults.evaluated++;

      // Skip if suppressed, bounced, or complained
      if (suppressed === 'TRUE' || bounced === 'TRUE' || complaint === 'TRUE') {
        campaignResults.skipped++;
        continue;
      }

      // Must have been delivered
      if (delivered !== 'TRUE' || !deliveredAt) {
        campaignResults.skipped++;
        continue;
      }

      const currentFollowUpCount = parseInt(followUpCount || '0');
      if (currentFollowUpCount >= 4) {
        campaignResults.skipped++; // Max follow-ups reached
        continue;
      }

      // NEW LOGIC: Handle both replied and non-replied recipients
      let shouldSend = false;
      let lastContactDate: string | null = null;
      let hoursSinceLastContact = 0;
      let daysSinceLastContact = 0;
      let isRepliedRecipient = replied === 'TRUE';

      if (isRepliedRecipient) {
        // For replied recipients: send follow-up 2 minutes after repliedAt
        // Use repliedAt as base for first follow-up, or lastFollowUpAt if they already received a follow-up
        if (currentFollowUpCount === 0) {
          // First follow-up after reply - wait 2 minutes from repliedAt
          lastContactDate = repliedAt;
        } else {
          // Subsequent follow-ups - use lastFollowUpAt
          lastContactDate = lastFollowUpAt || repliedAt;
        }
        
        if (!lastContactDate) {
          campaignResults.skipped++;
          continue;
        }

        const minutesSinceLastContact = (now.getTime() - new Date(lastContactDate).getTime()) / (1000 * 60);
        hoursSinceLastContact = minutesSinceLastContact / 60;
        daysSinceLastContact = Math.floor(hoursSinceLastContact / 24);
        
        // For first follow-up after reply: wait 2 minutes from repliedAt
        // For subsequent follow-ups: use FOLLOWUP_REPLIED_MIN_HOURS env var (default: 24 hours)
        if (currentFollowUpCount === 0) {
          // First follow-up after reply - wait 2 minutes
          const minMinutesForReplied = parseInt(process.env.FOLLOWUP_REPLIED_MIN_MINUTES || '2', 10);
          shouldSend = minutesSinceLastContact >= minMinutesForReplied;
        } else {
          // Subsequent follow-ups - wait for minimum hours
          const minHoursForReplied = parseInt(process.env.FOLLOWUP_REPLIED_MIN_HOURS || '24', 10);
          shouldSend = hoursSinceLastContact >= minHoursForReplied;
        }
      } else {
        // For non-replied recipients: use existing logic (send after delay)
        lastContactDate = lastFollowUpAt || deliveredAt;
        
        if (!lastContactDate) {
          campaignResults.skipped++;
          continue;
        }

        hoursSinceLastContact = (now.getTime() - new Date(lastContactDate).getTime()) / (1000 * 60 * 60);
        daysSinceLastContact = Math.floor(hoursSinceLastContact / 24);
        
        // Default: Send follow-up if it's been at least 2 days since last contact
        // Can be overridden with FOLLOWUP_MIN_DAYS env var (useful for testing - set to 0)
        const minDaysSinceLastContact = parseInt(process.env.FOLLOWUP_MIN_DAYS || '2', 10);
        shouldSend = daysSinceLastContact >= minDaysSinceLastContact;
      }
      
      // Detailed logging for debugging
      console.log(`[Follow-up] Evaluating ${email}:`);
      console.log(`  - delivered: ${delivered}, deliveredAt: ${deliveredAt}`);
      console.log(`  - replied: ${replied}, repliedAt: ${repliedAt}, seen: ${seen}`);
      console.log(`  - followUpCount: ${currentFollowUpCount}/4`);
      console.log(`  - lastContactDate: ${lastContactDate}`);
      console.log(`  - isRepliedRecipient: ${isRepliedRecipient}`);
      if (isRepliedRecipient) {
        if (currentFollowUpCount === 0) {
          const minutesSince = (now.getTime() - new Date(lastContactDate || repliedAt || deliveredAt).getTime()) / (1000 * 60);
          console.log(`  - minutesSinceReplied: ${minutesSince.toFixed(1)} (need 2+ minutes)`);
        } else {
          console.log(`  - hoursSinceLastFollowUp: ${hoursSinceLastContact.toFixed(1)}`);
        }
      } else {
        console.log(`  - daysSinceLastContact: ${daysSinceLastContact}`);
      }
      console.log(`  - shouldSend: ${shouldSend}`);

      if (shouldSend) {
        try {
          console.log(`[Follow-up] Generating follow-up #${currentFollowUpCount + 1} for ${email} (${daysSinceLastContact} days since last contact)`);
          
          let emailSubject: string;
          let emailHtml: string;

          if (shouldUseAI) {
            // Generate AI-powered follow-up email
            // Pass reply content if available for contextual follow-ups
            const aiEmail = await generateAIFollowUpEmail({
              firstName: firstName || 'there',
              productName: productName || 'our product',
              discountCode: discountCode || undefined,
              followUpCount: currentFollowUpCount,
              daysSinceLastContact: isRepliedRecipient ? Math.floor(hoursSinceLastContact / 24) : daysSinceLastContact,
              hasReplied: isRepliedRecipient, // Pass whether they replied
              originalSubject: campaignSubject || undefined,
            }, replyContent); // Pass reply content for context
            emailSubject = aiEmail.subject;
            emailHtml = aiEmail.html;
          } else {
            // Use template-based approach
            let ruleToApply: FollowUpRule | null = null;
            for (const rule of rules) {
              if (rule.condition === 'seen_no_reply' && seen === 'TRUE' && replied !== 'TRUE') {
                if (hoursSinceLastContact >= rule.delayHours) {
                  ruleToApply = rule;
                  break;
                }
              } else if (rule.condition === 'delivered_not_seen' && delivered === 'TRUE' && seen !== 'TRUE') {
                if (hoursSinceLastContact >= rule.delayHours) {
                  ruleToApply = rule;
                  break;
                }
              }
            }

            if (!ruleToApply) {
              // Default template
              ruleToApply = {
                condition: 'seen_no_reply',
                delayHours: 48,
                subject: `Re: ${campaignSubject || 'Following up'}`,
                htmlTemplate: `
                  <p>Hi {{firstName}},</p>
                  <p>I wanted to follow up on my previous email.</p>
                  <p>I'd love to hear your thoughts and answer any questions you might have.</p>
                  <p>Looking forward to hearing from you.</p>
                  <p>Best regards</p>
                `
              };
            }

            const recipientData = { email, firstName, productName, discountCode };
            emailSubject = ruleToApply.subject;
            emailHtml = personalizeHtml(ruleToApply.htmlTemplate, recipientData);
          }

          const inlinedHtml = juice(emailHtml);
          const newEmailId = randomUUID();
          const pixelBase = process.env.NEXT_PUBLIC_BASE_URL || '';
          
          // Add tracking pixel and links
          const pixelTag = `<img src="${pixelBase}/api/trk/open?emailId=${newEmailId}&sheetId=${campaignSpreadsheetId}&sheetName=${encodeURIComponent(actualSheetName)}" width="1" height="1" style="display:none;" alt="" />`;
          const finalHtml = inlinedHtml + pixelTag;

          // Get from address: SMTP user, or EMAIL_SENDER_ADDRESS (same as send route), or FROM_EMAIL
          // For AWS SES, the email must be verified in the SES console
          const fromAddress = finalSmtpConfig?.user 
            || process.env.EMAIL_SENDER_ADDRESS 
            || process.env.FROM_EMAIL
            || process.env.AWS_SES_FROM_EMAIL;
          
          if (!fromAddress) {
            const errorMsg = 'FROM_EMAIL not configured. Set EMAIL_SENDER_ADDRESS or FROM_EMAIL in .env.local to a verified email address.';
            console.error(`[Follow-up] ⚠️  ${errorMsg}`);
            campaignResults.errors.push(`Configuration error: ${errorMsg}`);
            continue;
          }

          // Ensure subject has "Re:" prefix for threading
          const threadedSubject = ensureRePrefix(emailSubject);
          
          // Build threading headers if we have the original emailId
          let emailHeaders: Record<string, string> = {
            'X-Email-Id': newEmailId,
            'X-Sheet-Id': campaignSpreadsheetId,
            'X-Sheet-Name': actualSheetName,
          };
          
          // Add threading headers if original emailId exists
          const trimmedEmailId = emailId?.toString().trim();
          const trimmedReplyMessageId = replyMessageId?.toString().trim();
          
          console.log(`[Follow-up] Threading check for ${email}:`);
          console.log(`  - emailId (for original Message-ID): "${trimmedEmailId || 'EMPTY'}"`);
          console.log(`  - replyMessageId (for reply threading): "${trimmedReplyMessageId || 'EMPTY'}"`);
          
          if (trimmedEmailId) {
            // Use reply Message-ID if available (threads to their reply), otherwise thread to original
            const threadingHeaders = buildThreadingHeaders(
              trimmedEmailId,
              currentFollowUpCount + 1,
              threadedSubject,
              trimmedReplyMessageId || undefined
            );
            emailHeaders = {
              ...emailHeaders,
              ...threadingHeaders,
            };
            
            console.log(`[Follow-up] Threading headers for ${email}:`);
            console.log(`  - In-Reply-To: ${threadingHeaders['In-Reply-To']}`);
            console.log(`  - References: ${threadingHeaders['References']}`);
            
            if (trimmedReplyMessageId) {
              console.log(`[Follow-up] ✅ Threading to recipient's reply`);
            } else {
              console.log(`[Follow-up] ⚠️ No replyMessageId found, threading to original email`);
            }
          } else {
            console.warn(`[Follow-up] No original emailId found for ${email}, sending as new email (no threading)`);
          }

          const result = await provider.send({
            from: fromAddress,
            to: email,
            subject: threadedSubject,
            html: finalHtml,
            headers: emailHeaders,
            tags: { 
              emailId: newEmailId, 
              sheetId: campaignSpreadsheetId, 
              type: 'followup',
              followUpNumber: String(currentFollowUpCount + 1)
            }
          });

          if (result.success) {
            await updateFollowUpSent(campaignSpreadsheetId, rowIndex, currentFollowUpCount + 1, actualSheetName);
            campaignResults.sent++;
            console.log(`[Follow-up] ✅ Successfully sent follow-up #${currentFollowUpCount + 1} to ${email}`);
          } else {
            campaignResults.errors.push(`Failed to send follow-up to ${email}: ${result.error}`);
            console.error(`[Follow-up] ❌ Failed to send to ${email}: ${result.error}`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          campaignResults.errors.push(`Error sending to ${email}: ${errorMsg}`);
          console.error(`[Follow-up] ❌ Error sending to ${email}:`, error);
        }
      } else {
        campaignResults.skipped++;
      }
    }

    await provider.close?.();
    
    // Aggregate results
    allResults.evaluated += campaignResults.evaluated;
    allResults.sent += campaignResults.sent;
    allResults.skipped += campaignResults.skipped;
    allResults.errors.push(...campaignResults.errors.map(e => `[${campaignSpreadsheetId}] ${e}`));
    allResults.campaigns.push({
      spreadsheetId: campaignSpreadsheetId,
      results: campaignResults
    });
    
    // Update master spreadsheet status on success
    if (masterSpreadsheetId && campaign.rowIndex) {
      const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
      await updateMasterSpreadsheetStatus(
        masterSpreadsheetId,
        masterSheetName,
        campaign.rowIndex,
        {
          lastProcessed: new Date().toISOString(),
          error: campaignResults.errors.length > 0 ? campaignResults.errors.join('; ') : ''
        }
      ).catch(err => console.error(`[Follow-up] Failed to update master spreadsheet status:`, err));
    }
      } catch (error: any) {
        const errorMsg = `Error processing campaign ${campaign.spreadsheetId}: ${error?.message || error}`;
        console.error(`[Follow-up] ${errorMsg}`);
        campaignError = errorMsg;
        allResults.errors.push(errorMsg);
        allResults.campaigns.push({
          spreadsheetId: campaign.spreadsheetId,
          results: { error: errorMsg }
        });
        
        // Update master spreadsheet status on error
        if (masterSpreadsheetId && campaign.rowIndex) {
          await updateMasterSpreadsheetStatus(
            masterSpreadsheetId,
            masterSheetName,
            campaign.rowIndex,
            {
              lastProcessed: new Date().toISOString(),
              error: errorMsg
            }
          ).catch(err => console.error(`[Follow-up] Failed to update master spreadsheet error status:`, err));
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${campaigns.length} campaigns. Sent: ${allResults.sent}, Skipped: ${allResults.skipped}`,
      results: allResults
    });

  } catch (error) {
    console.error('[Follow-up Scheduler] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
