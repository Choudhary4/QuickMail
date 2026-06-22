import { NextRequest, NextResponse } from 'next/server';
import { getRecipientsFromSheet, markReplied, findRowByEmailId, findRowByEmail, getSheetsClient, escapeSheetName, getActiveCampaigns, CampaignConfig, updateMasterSpreadsheetStatus } from '@/lib/sheets';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { createEmailProvider } from '@/lib/email-providers';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  tls?: boolean;
}

/**
 * IMAP-based reply checker
 * Checks inbox for replies and marks emails as replied in Google Sheet
 * 
 * Usage:
 * POST /api/cron/check-replies
 * Body: {
 *   spreadsheetId: string,
 *   sheetName?: string,
 *   imapConfig: { host, port, user, pass, tls? }
 * }
 * 
 * GET /api/cron/check-replies?token=CRON_SECRET_TOKEN
 * (Uses environment variables for config)
 * 
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
  return handleCheckReplies(req, {});
}

export async function POST(req: NextRequest) {
  // Verify token if set
  if (process.env.CRON_SECRET_TOKEN && !verifyCronToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const body = await req.json().catch(() => ({}));
  return handleCheckReplies(req, body);
}

/**
 * Get recipient row data by emailId or email
 */
async function getRecipientRowData(
  spreadsheetId: string,
  emailId: string | undefined,
  email: string,
  sheetName: string
): Promise<Record<string, any> | null> {
  try {
    const sheets = getSheetsClient();
    const escapedSheetName = escapeSheetName(sheetName);
    
    let rowNum: number | null = null;
    if (emailId) {
      rowNum = await findRowByEmailId(spreadsheetId, emailId, sheetName);
    }
    if (!rowNum) {
      rowNum = await findRowByEmail(spreadsheetId, email, sheetName);
    }
    
    if (!rowNum) {
      return null;
    }
    
    // Get the full row data (assuming standard columns: A=email, B=firstName, C=productName, etc.)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${escapedSheetName}!A${rowNum}:R${rowNum}`, // Get columns A-R
    });
    
    const row = response.data.values?.[0] || [];
    if (row.length === 0) {
      return null;
    }
    
    // Map row to object (standard column order)
    return {
      email: row[0] || '',
      firstName: row[1] || '',
      productName: row[2] || '',
      discountCode: row[3] || '',
      emailId: row[4] || emailId || '',
      delivered: row[5] || '',
      deliveredAt: row[6] || '',
      seen: row[7] || '',
      seenAt: row[8] || '',
      replied: row[9] || '',
      repliedAt: row[10] || '',
      bounced: row[11] || '',
      bounceReason: row[12] || '',
      complaint: row[13] || '',
      suppressed: row[14] || '',
      followUpCount: parseInt(row[15] || '0') || 0,
      lastFollowUpAt: row[16] || '',
      status: row[17] || '',
      rowIndex: rowNum,
    };
  } catch (error: any) {
    console.error(`[Follow-up] Error getting recipient data:`, error);
    return null;
  }
}

/**
 * Generate AI-powered follow-up email using Gemini
 */
async function generateAIFollowUpEmail(
  recipientData: {
    firstName: string;
    productName: string;
    discountCode?: string;
    followUpCount: number;
    originalSubject?: string;
  },
  replyContent?: string
): Promise<{ subject: string; html: string }> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  if (!geminiApiKey) {
    console.warn('[Follow-up] GEMINI_API_KEY not set, using default template');
    return {
      subject: `Re: Following up on ${recipientData.productName}`,
      html: `
        <p>Hi ${recipientData.firstName},</p>
        <p>Thank you for your reply! I wanted to follow up and continue our conversation about ${recipientData.productName}.</p>
        <p>I'd love to hear more of your thoughts and answer any questions you might have.</p>
        ${recipientData.discountCode ? `<p>Don't forget, you can use code <strong>${recipientData.discountCode}</strong> for a special discount!</p>` : ''}
        <p>Looking forward to continuing our conversation.</p>
        <p>Best regards</p>
      `
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const prompt = `
You are a professional email marketer writing a follow-up email to someone who just replied to your initial email. Generate a personalized, friendly, and engaging follow-up email.

Context:
- Recipient's name: ${recipientData.firstName}
- Product/Service: ${recipientData.productName}
${recipientData.discountCode ? `- Discount code: ${recipientData.discountCode}` : ''}
- This is follow-up #${recipientData.followUpCount + 1} after their reply
${recipientData.originalSubject ? `- Original email subject: ${recipientData.originalSubject}` : ''}
${replyContent ? `- They replied with: ${replyContent.substring(0, 500)}` : '- They just replied to your email'}

Requirements:
1. Acknowledge their reply and show appreciation
2. Keep it concise (2-3 short paragraphs)
3. Be conversational and engaging, not pushy
4. Reference their reply if relevant
5. Include a clear call-to-action
6. ${recipientData.discountCode ? `Mention the discount code ${recipientData.discountCode} naturally` : ''}
7. Make it feel personal and relevant
8. Use HTML format with inline CSS for email compatibility
9. Use proper email structure with <p> tags

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

    // Generate subject using AI
    let subject = `Re: Following up on ${recipientData.productName}`;
    const subjectPrompt = `Generate a short, professional email subject line (max 60 characters) for a follow-up email to ${recipientData.firstName} who just replied about ${recipientData.productName}. This is follow-up #${recipientData.followUpCount + 1}. Return ONLY the subject line, no quotes, no explanation.`;
    const subjectResult = await model.generateContent(subjectPrompt);
    const subjectResponse = await subjectResult.response;
    const generatedSubject = subjectResponse.text().trim().replace(/^["']|["']$/g, '');
    if (generatedSubject && generatedSubject.length < 100) {
      subject = generatedSubject;
    }

    // Clean up HTML
    const cleanHtml = htmlContent
      .replace(/<subject>.*?<\/subject>/gi, '')
      .replace(/```html/gi, '')
      .replace(/```/gi, '')
      .trim();

    return {
      subject,
      html: cleanHtml || `
        <p>Hi ${recipientData.firstName},</p>
        <p>Thank you for your reply! I wanted to follow up and continue our conversation about ${recipientData.productName}.</p>
        <p>I'd love to hear more of your thoughts and answer any questions you might have.</p>
        <p>Best regards</p>
      `
    };
  } catch (error) {
    console.error('[Follow-up] Gemini AI error:', error);
    return {
      subject: `Re: Following up on ${recipientData.productName}`,
      html: `
        <p>Hi ${recipientData.firstName},</p>
        <p>Thank you for your reply! I wanted to follow up and continue our conversation about ${recipientData.productName}.</p>
        <p>I'd love to hear more of your thoughts and answer any questions you might have.</p>
        ${recipientData.discountCode ? `<p>Don't forget, you can use code <strong>${recipientData.discountCode}</strong> for a special discount!</p>` : ''}
        <p>Looking forward to continuing our conversation.</p>
        <p>Best regards</p>
      `
    };
  }
}

/**
 * Send immediate follow-up email when reply is detected
 */
async function sendImmediateFollowUp(
  spreadsheetId: string,
  sheetName: string,
  recipientData: Record<string, any>,
  replyContent?: string,
  justMarkedAsReplied: boolean = true
): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if follow-up limit reached (max 4)
    const followUpCount = recipientData.followUpCount || 0;
    if (followUpCount >= 4) {
      console.log(`[Follow-up] Skipping follow-up for ${recipientData.email} - max limit reached (${followUpCount})`);
      return { success: false, error: 'Max follow-up limit reached' };
    }

    // If we just marked them as replied, we know they replied (skip the check)
    // Otherwise, check if already replied
    if (!justMarkedAsReplied && recipientData.replied !== 'TRUE' && recipientData.replied !== true) {
      console.log(`[Follow-up] Skipping follow-up for ${recipientData.email} - not marked as replied yet`);
      return { success: false, error: 'Not marked as replied' };
    }

    console.log(`[Follow-up] Sending immediate follow-up #${followUpCount + 1} to ${recipientData.email}`);

    // Generate AI follow-up email
    const { subject, html } = await generateAIFollowUpEmail(
      {
        firstName: recipientData.firstName || 'there',
        productName: recipientData.productName || 'our product',
        discountCode: recipientData.discountCode,
        followUpCount,
      },
      replyContent
    );

    // Create email provider
    const provider = createEmailProvider({
      smtp: undefined, // Will use SES if configured
      ses: process.env.AWS_SES_REGION ? {
        region: process.env.AWS_SES_REGION,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        configurationSetName: process.env.AWS_SES_CONFIGURATION_SET,
      } : undefined,
    });

    // Get from address
    const fromAddress = process.env.EMAIL_SENDER_ADDRESS || process.env.FROM_EMAIL;
    if (!fromAddress) {
      return { success: false, error: 'EMAIL_SENDER_ADDRESS not configured' };
    }

    // Send email
    const result = await provider.sendEmail({
      from: fromAddress,
      to: recipientData.email,
      subject,
      html,
    });

    if (result.success) {
      console.log(`[Follow-up] ✅ Successfully sent follow-up #${followUpCount + 1} to ${recipientData.email}`);
      
      // Update follow-up fields in spreadsheet
      const sheets = getSheetsClient();
      const escapedSheetName = escapeSheetName(sheetName);
      const rowIndex = recipientData.rowIndex;
      const newFollowUpCount = followUpCount + 1;
      const now = new Date().toISOString();
      
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: `${escapedSheetName}!P${rowIndex}`, values: [[newFollowUpCount]] }, // followUpCount
            { range: `${escapedSheetName}!Q${rowIndex}`, values: [[now]] }, // lastFollowUpAt
            { range: `${escapedSheetName}!R${rowIndex}`, values: [['Replied - Follow-up ' + newFollowUpCount]] }, // status
          ]
        }
      });

      console.log(`[Follow-up] ✅ Updated follow-up fields for ${recipientData.email}`);
      return { success: true };
    } else {
      console.error(`[Follow-up] ❌ Failed to send follow-up to ${recipientData.email}: ${result.error}`);
      return { success: false, error: result.error };
    }
  } catch (error: any) {
    const errorMsg = `Error sending follow-up: ${error?.message || error}`;
    console.error(`[Follow-up] ❌ ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Process reply checking for a single campaign
 */
async function processCampaignReplies(
  campaign: CampaignConfig,
  imapConfig: { host: string; port: number; user: string; pass: string; tls?: boolean }
): Promise<{ checked: number; found: number; marked: number; errors: string[] }> {
  const spreadsheetId = campaign.spreadsheetId;
  const sheetName = campaign.sheetName || process.env.DEFAULT_SHEET_NAME || 'Sheet1';
  
  console.log(`[IMAP] Processing campaign: spreadsheetId=${spreadsheetId}, sheetName="${sheetName}"`);

  // Get all recipients from sheet to build email -> emailId mapping
  const recipientsData = await getRecipientsFromSheet(spreadsheetId, sheetName);
  const recipients = recipientsData.recipients || [];
  const headers = recipientsData.headers || [];
  
  // Use the actual sheet name that was loaded (might be different from requested)
  const actualSheetName = recipientsData.sheetNameUsed;
  
  console.log(`[IMAP] Loaded ${recipients.length} recipients from sheet "${actualSheetName}"`);
  
  // Find email column (case-insensitive, try common variations)
  const emailColumnKeys = ['email', 'e-mail', 'email address', 'emailaddress', 'mail'];
  let emailKey = 'email'; // default
  for (const key of emailColumnKeys) {
    const found = headers.find(h => h.toLowerCase().trim() === key);
    if (found) {
      emailKey = found;
      console.log(`[IMAP] Using email column: "${emailKey}"`);
      break;
    }
  }
  
  // Find emailId column
  const emailIdColumnKeys = ['emailid', 'email id', 'email_id', 'email-id'];
  let emailIdKey = 'emailId'; // default
  for (const key of emailIdColumnKeys) {
    const found = headers.find(h => h.toLowerCase().trim() === key);
    if (found) {
      emailIdKey = found;
      console.log(`[IMAP] Using emailId column: "${emailIdKey}"`);
      break;
    }
  }
  
  // Create email -> emailId mapping (case-insensitive, normalized)
  const emailToIdMap = new Map<string, string>();
  const emailList: string[] = [];
  // Map email to deliveredAt date to verify reply came after we sent
  const emailToDeliveredAtMap = new Map<string, Date>();
  
  // Helper to normalize email (remove whitespace, lowercase, trim)
  const normalizeEmail = (email: string | undefined): string | null => {
    if (!email) return null;
    return email.toString().trim().toLowerCase().replace(/\s+/g, '');
  };
  
  // Find deliveredAt column
  const deliveredAtColumnKeys = ['deliveredat', 'delivered at', 'delivered_at', 'delivered-date', 'sentat', 'sent at'];
  let deliveredAtKey = 'deliveredAt'; // default
  for (const key of deliveredAtColumnKeys) {
    const found = headers.find(h => h.toLowerCase().trim() === key);
    if (found) {
      deliveredAtKey = found;
      console.log(`[IMAP] Using deliveredAt column: "${deliveredAtKey}"`);
      break;
    }
  }
  
  recipients.forEach((r) => {
    const emailValue = r[emailKey] || r.email || r.Email || r.EMAIL;
    const email = normalizeEmail(emailValue);
    const emailIdValue = r[emailIdKey] || r.emailId || r.emailId || r.EMAILID;
    const emailId = emailIdValue?.toString().trim();
    const deliveredAtValue = r[deliveredAtKey] || r.deliveredAt || r.DeliveredAt;
    
    if (email) {
      emailList.push(email);
      if (emailId) {
        emailToIdMap.set(email, emailId);
      }
      // Store deliveredAt date for validation
      if (deliveredAtValue) {
        try {
          const deliveredDate = new Date(deliveredAtValue);
          if (!isNaN(deliveredDate.getTime())) {
            emailToDeliveredAtMap.set(email, deliveredDate);
          }
        } catch (e) {
          // Invalid date, skip
        }
      }
    }
  });

  if (emailToIdMap.size === 0 && emailList.length === 0) {
    console.warn(`[IMAP] No recipients found in sheet ${spreadsheetId}`);
    return { checked: 0, found: 0, marked: 0, errors: [] };
  }

  console.log(`[IMAP] Monitoring ${emailToIdMap.size} recipients with emailId, ${emailList.length} total recipients for replies`);

  // Connect to IMAP
  const imap = new Imap({
    user: imapConfig.user,
    password: imapConfig.pass,
    host: imapConfig.host,
    port: imapConfig.port || 993,
    tls: imapConfig.tls !== false,
    connTimeout: 10000,
    authTimeout: 5000,
  });

  const results = { 
    checked: 0, 
    found: 0, 
    marked: 0,
    errors: [] as string[] 
  };

  await new Promise<void>((resolve, reject) => {
    imap.once('ready', () => {
      console.log('[IMAP] Connected successfully');
      
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error('[IMAP] Error opening INBOX:', err);
          reject(err);
          return;
        }

        console.log(`[IMAP] Opened INBOX, ${box.messages.total} total messages`);

        const since = new Date();
        since.setHours(since.getHours() - 24);
        
        imap.search(['UNSEEN', ['SINCE', since]], (err, uids) => {
          if (err) {
            console.error('[IMAP] Search error:', err);
            reject(err);
            return;
          }

          if (!uids || uids.length === 0) {
            console.log('[IMAP] No unread messages found');
            imap.end();
            resolve();
            return;
          }

          console.log(`[IMAP] Found ${uids.length} unread messages, checking for replies...`);

          const fetch = imap.fetch(uids, { 
            bodies: '',
            struct: true 
          });

          let processed = 0;

          fetch.on('message', (msg) => {
            let emailBuffer = Buffer.alloc(0);
            
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => {
                emailBuffer = Buffer.concat([emailBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
              });
            });

            msg.once('end', async () => {
              try {
                results.checked++;
                const parsed = await simpleParser(emailBuffer);

                const fromAddress = parsed.from?.value[0]?.address || '';
                const fromEmail = fromAddress.toLowerCase().trim().replace(/\s+/g, '');
                
                if (!fromEmail) {
                  processed++;
                  if (processed === uids.length) {
                    imap.end();
                    resolve();
                  }
                  return;
                }
                
                // IMPORTANT: Skip emails from our own address (to avoid detecting our own follow-ups)
                const imapUserEmail = imapConfig.user.toLowerCase().trim();
                const senderEmail = process.env.EMAIL_SENDER_ADDRESS?.toLowerCase().trim() || '';
                if (fromEmail === imapUserEmail || fromEmail === senderEmail) {
                  console.log(`[IMAP] Skipping email from our own address: ${fromEmail}`);
                  processed++;
                  if (processed === uids.length) {
                    imap.end();
                    resolve();
                  }
                  return;
                }
                
                // Check if sender is in recipient list FIRST (before checking reply indicators)
                let isInRecipientList = emailToIdMap.has(fromEmail) || emailList.includes(fromEmail);
                let matchedEmail = fromEmail;
                
                if (!isInRecipientList) {
                  const emailVariations = [
                    fromEmail.replace(/\+.*@/, '@'),
                    fromEmail.split('@')[0] + '@' + fromEmail.split('@')[1],
                  ];
                  
                  for (const emailVar of emailVariations) {
                    if (emailVar !== fromEmail && (emailToIdMap.has(emailVar) || emailList.includes(emailVar))) {
                      isInRecipientList = true;
                      matchedEmail = emailVar;
                      break;
                    }
                  }
                }
                
                // Only process if sender is in recipient list
                if (!isInRecipientList) {
                  processed++;
                  if (processed === uids.length) {
                    imap.end();
                    resolve();
                  }
                  return;
                }
                
                // Now check if it's actually a reply (stricter validation)
                const inReplyTo = parsed.inReplyTo || '';
                const references = parsed.references || [];
                const subject = parsed.subject || '';
                const messageDate = parsed.date ? new Date(parsed.date) : null;
                
                // Check if email has reply indicators
                const hasReplyIndicators = inReplyTo || 
                                         references.length > 0 || 
                                         subject.toLowerCase().startsWith('re:') ||
                                         subject.toLowerCase().startsWith('re[');
                
                // CRITICAL: Verify the email was sent AFTER we sent them an email
                let isValidReply = hasReplyIndicators;
                const deliveredAt = emailToDeliveredAtMap.get(matchedEmail);
                
                if (deliveredAt && messageDate) {
                  // Email must be sent after we delivered the original email
                  if (messageDate < deliveredAt) {
                    console.log(`[IMAP] Skipping ${fromEmail} - email date (${messageDate.toISOString()}) is before delivery date (${deliveredAt.toISOString()})`);
                    isValidReply = false;
                  }
                }
                
                // Additional validation: If no reply indicators but email is from recipient,
                // it might still be a reply if it's recent (within 7 days of delivery)
                if (!hasReplyIndicators && deliveredAt && messageDate) {
                  const daysSinceDelivery = (messageDate.getTime() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24);
                  if (daysSinceDelivery > 0 && daysSinceDelivery <= 7) {
                    // Could be a reply without "Re:" - but be more cautious
                    // Only accept if it's very recent (within 1 day) and has some reply-like content
                    const emailText = (parsed.text || parsed.html || '').toLowerCase();
                    const replyKeywords = ['thank', 'thanks', 'interested', 'reply', 'response', 'question', 'hi', 'hello'];
                    const hasReplyKeywords = replyKeywords.some(keyword => emailText.includes(keyword));
                    
                    if (daysSinceDelivery <= 1 && hasReplyKeywords && emailText.length > 20) {
                      console.log(`[IMAP] Accepting potential reply from ${fromEmail} (recent, has keywords, no "Re:" prefix)`);
                      isValidReply = true;
                    } else {
                      isValidReply = false;
                    }
                  } else {
                    isValidReply = false;
                  }
                }
                
                if (!isValidReply) {
                  console.log(`[IMAP] Skipping ${fromEmail} - not a valid reply (no reply indicators or invalid date)`);
                  processed++;
                  if (processed === uids.length) {
                    imap.end();
                    resolve();
                  }
                  return;
                }
                
                // All validations passed - this is a real reply
                const emailId = emailToIdMap.get(matchedEmail);
                results.found++;
                
                // Extract reply content (prefer text, fallback to HTML, strip HTML tags)
                let replyContent: string | undefined = undefined;
                if (parsed.text) {
                  replyContent = parsed.text.trim();
                } else if (parsed.html) {
                  // Simple HTML stripping (remove tags, keep text)
                  replyContent = parsed.html
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                }
                
                // Truncate to reasonable length for storage
                if (replyContent && replyContent.length > 5000) {
                  replyContent = replyContent.substring(0, 5000) + '... [truncated]';
                }
                
                // Extract reply's Message-ID (for threading follow-ups)
                // mailparser provides messageId directly, or we can get it from headers
                let replyMessageId: string | undefined = undefined;
                if (parsed.messageId) {
                  replyMessageId = parsed.messageId;
                } else if (parsed.headers) {
                  // Try different header formats
                  const msgIdHeader = parsed.headers.get('message-id') || 
                                     parsed.headers.get('Message-ID') ||
                                     (parsed.headers as any)['message-id'];
                  if (msgIdHeader) {
                    replyMessageId = Array.isArray(msgIdHeader) ? msgIdHeader[0] : msgIdHeader;
                  }
                }
                
                // Ensure Message-ID is in proper format (<...@...>)
                if (replyMessageId && !replyMessageId.includes('<')) {
                  replyMessageId = `<${replyMessageId}>`;
                }
                
                console.log(`[IMAP] ✅ Found reply from ${fromEmail} (matched as: ${matchedEmail})${emailId ? ` (emailId: ${emailId})` : ''}${replyContent ? ` (content: ${replyContent.substring(0, 100)}...)` : ''}${replyMessageId ? ` (Message-ID: ${replyMessageId})` : ''}`);

                try {
                  let success = false;
                  let rowNum: number | null = null;
                  let actualEmailId: string | undefined = emailId;
                  
                  if (emailId) {
                    rowNum = await findRowByEmailId(spreadsheetId, emailId, actualSheetName);
                    if (rowNum) {
                      success = await markReplied(spreadsheetId, emailId, actualSheetName, replyContent, replyMessageId);
                      if (success) {
                        results.marked++;
                        console.log(`[IMAP] ✅ Successfully marked emailId=${emailId} as replied${replyContent ? ' with content' : ''}${replyMessageId ? ` with Message-ID: ${replyMessageId}` : ''}`);
                      } else {
                        results.errors.push(`Failed to mark ${fromEmail} as replied (emailId found but update failed)`);
                      }
                    }
                  }
                  
                  if (!rowNum) {
                    rowNum = await findRowByEmail(spreadsheetId, fromEmail, actualSheetName);
                    if (rowNum) {
                      const sheets = getSheetsClient();
                      const escapedSheetName = escapeSheetName(actualSheetName);
                      const emailIdResponse = await sheets.spreadsheets.values.get({
                        spreadsheetId,
                        range: `${escapedSheetName}!E${rowNum}`,
                      });
                      actualEmailId = emailIdResponse.data.values?.[0]?.[0]?.toString().trim();
                      
                      if (actualEmailId) {
                        success = await markReplied(spreadsheetId, actualEmailId, actualSheetName, replyContent, replyMessageId);
                        if (success) {
                          results.marked++;
                          console.log(`[IMAP] ✅ Successfully marked emailId=${actualEmailId} as replied${replyContent ? ' with content' : ''}${replyMessageId ? ` with Message-ID: ${replyMessageId}` : ''}`);
                        } else {
                          results.errors.push(`Failed to mark ${fromEmail} as replied`);
                        }
                      }
                    } else {
                      results.errors.push(`No row found for email=${fromEmail} in spreadsheet ${spreadsheetId}`);
                    }
                  }

                  // Note: Follow-up will be sent by cron job 2 minutes after reply is detected
                  console.log(`[IMAP] ✅ Reply marked. Follow-up will be sent by cron job 2 minutes after repliedAt timestamp`);
                } catch (error: any) {
                  const errorMsg = `Error marking ${fromEmail}: ${error?.message || error}`;
                  console.error(`[IMAP] ${errorMsg}`);
                  results.errors.push(errorMsg);
                }

                processed++;
                if (processed === uids.length) {
                  console.log(`[IMAP] Finished processing ${processed} messages for campaign ${spreadsheetId}`);
                  imap.end();
                  resolve();
                }
              } catch (parseError: any) {
                const errorMsg = `Parse error: ${parseError?.message || parseError}`;
                console.error(`[IMAP] ${errorMsg}`);
                results.errors.push(errorMsg);
                processed++;
                if (processed === uids.length) {
                  imap.end();
                  resolve();
                }
              }
            });
          });

          fetch.once('error', (err) => {
            console.error('[IMAP] Fetch error:', err);
            reject(err);
          });
        });
      });
    });

    imap.once('error', (err) => {
      console.error('[IMAP] Connection error:', err);
      reject(err);
    });

    imap.once('end', () => {
      console.log('[IMAP] Connection closed');
    });

    imap.connect();
  });

  return results;
}

async function handleCheckReplies(req: NextRequest, body: any) {
  try {
    const { spreadsheetId, sheetName, imapConfig } = body;

    // Allow IMAP config from environment variables for automated cron jobs
    const finalImapConfig = imapConfig || {
      host: process.env.IMAP_HOST,
      port: parseInt(process.env.IMAP_PORT || '993'),
      user: process.env.IMAP_USER,
      pass: process.env.IMAP_PASS,
      tls: process.env.IMAP_TLS !== 'false',
    };

    if (!finalImapConfig.host || !finalImapConfig.user || !finalImapConfig.pass) {
      return NextResponse.json(
        { 
          error: 'Missing IMAP configuration. Set IMAP_HOST, IMAP_USER, IMAP_PASS in environment variables.',
          received: {
            imapHost: !!finalImapConfig.host,
            imapUser: !!finalImapConfig.user,
            imapPass: !!finalImapConfig.pass
          }
        },
        { status: 400 }
      );
    }

    // Check if using master spreadsheet or single spreadsheet
    const masterSpreadsheetId = process.env.MASTER_SPREADSHEET_ID;
    const masterSheetName = process.env.MASTER_SHEET_NAME || 'Sheet1';
    
    let campaigns: CampaignConfig[] = [];
    
    if (spreadsheetId) {
      // Single spreadsheet mode (backward compatible)
      campaigns = [{ spreadsheetId, sheetName: sheetName || process.env.DEFAULT_SHEET_NAME }];
      console.log(`[IMAP] Single spreadsheet mode: ${spreadsheetId}`);
    } else if (masterSpreadsheetId) {
      // Master spreadsheet mode - get all active campaigns filtered by REPLIES type
      console.log(`[IMAP] Master spreadsheet mode: reading campaigns from ${masterSpreadsheetId}`);
      try {
        campaigns = await getActiveCampaigns(masterSpreadsheetId, masterSheetName, 'REPLIES');
        console.log(`[IMAP] Found ${campaigns.length} active REPLIES campaigns to process`);
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
      console.log(`[IMAP] Using DEFAULT_TRACKING_SHEET_ID: ${defaultSpreadsheetId}`);
    }

    if (campaigns.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active campaigns found',
        results: { checked: 0, found: 0, marked: 0, errors: [] }
      });
    }

    // Process all campaigns
    const allResults = {
      checked: 0,
      found: 0,
      marked: 0,
      errors: [] as string[],
      campaigns: [] as Array<{ spreadsheetId: string; results: any }>
    };

    for (const campaign of campaigns) {
      const startTime = Date.now();
      let campaignError: string | undefined = undefined;
      
      try {
        console.log(`[IMAP] Processing campaign: ${campaign.campaignName || campaign.spreadsheetId} (${campaign.spreadsheetId})`);
        const campaignResults = await processCampaignReplies(campaign, finalImapConfig);
        
        allResults.checked += campaignResults.checked;
        allResults.found += campaignResults.found;
        allResults.marked += campaignResults.marked;
        allResults.errors.push(...campaignResults.errors.map(e => `[${campaign.spreadsheetId}] ${e}`));
        allResults.campaigns.push({
          spreadsheetId: campaign.spreadsheetId,
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
          ).catch(err => console.error(`[IMAP] Failed to update master spreadsheet status:`, err));
        }
      } catch (error: any) {
        const errorMsg = `Error processing campaign ${campaign.spreadsheetId}: ${error?.message || error}`;
        console.error(`[IMAP] ${errorMsg}`);
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
          ).catch(err => console.error(`[IMAP] Failed to update master spreadsheet error status:`, err));
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${campaigns.length} campaigns. Checked ${allResults.checked} emails, found ${allResults.found} replies, marked ${allResults.marked} as replied. Follow-ups will be sent by cron job 2 minutes after reply.`,
      results: allResults
    });

  } catch (error: any) {
    console.error('[IMAP Reply Checker] Error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error?.message || 'Unknown error',
        details: error?.toString()
      },
      { status: 500 }
    );
  }
}

