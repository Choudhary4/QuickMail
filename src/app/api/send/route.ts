import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import juice from 'juice';
import { enqueueCampaignJob } from '@/lib/sqs';
import { createCampaignJob, updateCampaignJobStatus } from '@/lib/sheets';
import { createEmailProvider } from '@/lib/email-providers';

type Recipient = Record<string, string>;

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

interface RequestBody {
  smtpConfig?: SmtpConfig;
  recipients: Recipient[];
  subject: string;
  htmlContent: string;
  spreadsheetId?: string;
  sheetName?: string;
  masterSpreadsheetId?: string;
  masterSheetName?: string;
}

function personalizeHtml(html: string, recipient: Recipient): string {
  let result = html;
  for (const key of Object.keys(recipient)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    result = result.replace(regex, recipient[key] ?? '');
  }
  return result;
}

function injectOpenPixel(html: string, emailId: string, spreadsheetId?: string, sheetName?: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';
  const params = new URLSearchParams({ emailId });
  if (spreadsheetId) params.set('sheetId', spreadsheetId);
  if (sheetName) params.set('sheetName', sheetName);
  const pixelUrl = `${baseUrl}/api/trk/open?${params.toString()}`;
  
  // Gmail-friendly pixel injection:
  // 1. Use a visible spacer image (Gmail blocks hidden tracking pixels)
  // 2. Make it look like a legitimate email spacer
  // 3. Place it at the end of the email content, not hidden
  const pixelTag = `
    <!-- Email spacer for layout -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 20px;">
      <tr>
        <td align="center" style="padding: 0;">
          <img src="${pixelUrl}" alt=" " width="1" height="1" style="display: block; width: 1px; height: 1px; border: 0;" />
        </td>
      </tr>
    </table>
  `;
  return html.includes('</body>') ? html.replace('</body>', `${pixelTag}</body>`) : html + pixelTag;
}

/**
 * Wrap links with click tracking that also marks email as seen
 * This works even when Gmail blocks pixel tracking
 */
function wrapLinksWithTracking(html: string, emailId: string, spreadsheetId?: string, sheetName?: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';
  
  // Match all href attributes in anchor tags
  // This regex finds <a href="..."> and replaces with tracked version
  const linkRegex = /<a\s+([^>]*\s+)?href=["']([^"']+)["']([^>]*)>/gi;
  
  return html.replace(linkRegex, (match, before, url, after) => {
    // Skip if it's already a tracking link or mailto/tel links
    if (url.includes('/api/trk/') || url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('#')) {
      return match;
    }
    
    // Create tracking URL
    const trackingParams = new URLSearchParams({
      emailId,
      url: encodeURIComponent(url)
    });
    if (spreadsheetId) trackingParams.set('sheetId', spreadsheetId);
    if (sheetName) trackingParams.set('sheetName', sheetName);
    
    const trackedUrl = `${baseUrl}/api/trk/click?${trackingParams.toString()}`;
    
    // Replace href with tracked URL
    return `<a ${before || ''}href="${trackedUrl}"${after}>`;
  });
}

/**
 * Add "View in browser" link that marks email as seen
 */
function addViewInBrowserLink(html: string, emailId: string, spreadsheetId?: string, sheetName?: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';
  const params = new URLSearchParams({ emailId });
  if (spreadsheetId) params.set('sheetId', spreadsheetId);
  if (sheetName) params.set('sheetName', sheetName);
  
  // Create a "view in browser" link that marks as seen
  const viewUrl = `${baseUrl}/api/trk/click?${params.toString()}&url=${encodeURIComponent(baseUrl)}`;
  
  const viewLink = `
    <div style="text-align: center; padding: 20px; font-size: 12px; color: #666;">
      <a href="${viewUrl}" style="color: #666; text-decoration: underline;">View in browser</a>
    </div>
  `;
  
  return html.includes('</body>') ? html.replace('</body>', `${viewLink}</body>`) : html + viewLink;
}

async function sendEmailsSynchronously(
  campaignId: string,
  recipients: Recipient[],
  subject: string,
  htmlContent: string,
  spreadsheetId: string | undefined,
  sheetName: string | undefined,
  smtpConfig: SmtpConfig | undefined,
  providerType: string
) {
  const provider = createEmailProvider({
    smtp: smtpConfig,
    ses: process.env.AWS_SES_REGION
      ? {
          region: process.env.AWS_SES_REGION,
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          configurationSetName: process.env.AWS_SES_CONFIGURATION_SET,
        }
      : undefined,
  });

  const results = { success: 0, failed: 0, errors: [] as string[] };
  const inlined = juice(htmlContent);

  for (const r of recipients) {
    const to = r.email?.trim();
    if (!to) {
      results.failed++;
      results.errors.push('Missing recipient.email');
      continue;
    }

    // Use recipient's campaign spreadsheet if available (from master sheet), otherwise use default
    const recipientSpreadsheetId = (r as any)._campaignSpreadsheetId || spreadsheetId;
    const recipientSheetName = (r as any)._campaignSheetName || sheetName || 'Sheet1';

    const emailId = randomUUID();
    const bodyPersonalized = personalizeHtml(inlined, r);
    
    // Add multiple tracking methods:
    // 1. Pixel tracking (works for non-Gmail clients)
    // 2. Link click tracking (works for Gmail - marks as seen when any link is clicked)
    // 3. "View in browser" link (works for Gmail - marks as seen when clicked)
    let bodyWithTracking = injectOpenPixel(bodyPersonalized, emailId, recipientSpreadsheetId, recipientSheetName);
    bodyWithTracking = wrapLinksWithTracking(bodyWithTracking, emailId, recipientSpreadsheetId, recipientSheetName);
    bodyWithTracking = addViewInBrowserLink(bodyWithTracking, emailId, recipientSpreadsheetId, recipientSheetName);

    try {
      if (recipientSpreadsheetId) {
        const { setEmailIdByEmail } = await import('@/lib/sheets');
        await setEmailIdByEmail(recipientSpreadsheetId, to, emailId, recipientSheetName);
      }

      const res = await provider.send({
        from: providerType === 'ses' ? process.env.EMAIL_SENDER_ADDRESS || 'noreply@example.com' : smtpConfig!.user,
        fromName: process.env.EMAIL_SENDER_NAME || 'QuickMail',
        to,
        subject,
        html: bodyWithTracking,
        headers: {
          'X-Email-Id': emailId,
          ...(recipientSpreadsheetId ? { 'X-Sheet-Id': recipientSpreadsheetId } : {}),
          ...(recipientSheetName ? { 'X-Sheet-Name': recipientSheetName } : {}),
        },
        tags: {
          emailId,
          ...(recipientSpreadsheetId ? { sheetId: recipientSpreadsheetId } : {}),
          ...(recipientSheetName ? { sheetName: recipientSheetName } : {}),
        },
      });

      if (res.success) {
        results.success++;
        // Update status, delivered, and deliveredAt immediately after successful send
        if (spreadsheetId) {
          try {
            const { batchUpdateByEmailId } = await import('@/lib/sheets');
            await batchUpdateByEmailId(spreadsheetId, emailId, {
              status: 'Sent',
              delivered: true,
              deliveredAt: new Date().toISOString()
            }, sheetName || 'Sheet1');
          } catch (e) {
            console.warn(`[Send] Failed to update recipient fields for ${to}:`, e);
          }
        }
      } else {
        results.failed++;
        results.errors.push(`Failed to send to ${to}: ${res.error || 'Unknown error'}`);
        // Update status to "Failed" if send fails
        if (spreadsheetId) {
          try {
            const { batchUpdateByEmailId } = await import('@/lib/sheets');
            await batchUpdateByEmailId(spreadsheetId, emailId, {
              status: 'Failed'
            }, sheetName || 'Sheet1');
          } catch (e) {
            console.warn(`[Send] Failed to update status for ${to}:`, e);
          }
        }
      }
    } catch (e: any) {
      results.failed++;
      results.errors.push(`Failed to send to ${to}: ${e?.message || 'Unknown error'}`);
    }

    // Update progress every 10 emails
    if (spreadsheetId && (results.success + results.failed) % 10 === 0) {
      try {
        await updateCampaignJobStatus(spreadsheetId, campaignId, {
          sentCount: results.success,
          failedCount: results.failed,
        });
      } catch (e) {
        console.warn('[Send] Failed to update progress:', e);
      }
    }
  }

  await provider.close?.();

  // Final update
  if (spreadsheetId) {
    try {
      await updateCampaignJobStatus(spreadsheetId, campaignId, {
        sentCount: results.success,
        failedCount: results.failed,
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[Send] Failed to update final status:', e);
    }
  }

  return results;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const { smtpConfig, recipients, subject, htmlContent, spreadsheetId, sheetName, masterSpreadsheetId, masterSheetName } = body;

    if (!recipients?.length || !subject || !htmlContent) {
      return NextResponse.json({ message: 'Missing required fields for sending email.' }, { status: 400 });
    }

    const providerType = process.env.EMAIL_PROVIDER || 'smtp';
    
    let finalSmtpConfig = smtpConfig;
    if (providerType === 'smtp' && (!finalSmtpConfig || !finalSmtpConfig.host || !finalSmtpConfig.pass)) {
        const envSmtpHost = process.env.SMTP_HOST;
        const envSmtpUser = process.env.SMTP_USER;
        const envSmtpPass = process.env.SMTP_PASS;
        if (envSmtpHost && envSmtpUser && envSmtpPass) {
            finalSmtpConfig = {
                host: envSmtpHost,
                port: parseInt(process.env.SMTP_PORT || '587', 10),
                user: envSmtpUser,
                pass: envSmtpPass,
            };
        }
    }

    if (providerType === 'smtp' && !finalSmtpConfig) {
      return NextResponse.json({ message: 'SMTP configuration required when EMAIL_PROVIDER is smtp' }, { status: 400 });
    }

    if (providerType === 'ses') {
      const required = ['AWS_SES_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
      const missing = required.filter((v) => !process.env[v]);
      if (missing.length) {
        return NextResponse.json({ message: `AWS SES environment variables not configured: ${missing.join(', ')}` }, { status: 400 });
      }
    }

    // Generate campaign ID
    const campaignId = randomUUID();

    // Create campaign job tracking in Google Sheets
    if (spreadsheetId) {
      try {
        await createCampaignJob(spreadsheetId, campaignId, subject, recipients.length);
      } catch (error) {
        console.warn('[Send] Failed to create campaign job tracking:', error);
      }
    }

    // Check if SQS is configured
    // Note: For Vercel deployments, use SQS for large campaigns to avoid timeout
    // Vercel Hobby: 10s timeout, Pro: 60s timeout, Enterprise: 300s timeout
    const queueUrl = process.env.AWS_SQS_QUEUE_URL;
    
    if (queueUrl) {
      // Async mode: Enqueue job to SQS (recommended for production)
      const enqueueResult = await enqueueCampaignJob({
        campaignId,
        subject,
        htmlContent,
        recipients,
        trackingSheetId: spreadsheetId, // Keep for backward compatibility, but recipients have their own
        trackingSheetName: sheetName,
        emailProvider: providerType as 'smtp' | 'ses',
        smtpConfig: finalSmtpConfig,
        fromAddress: providerType === 'ses' 
          ? process.env.EMAIL_SENDER_ADDRESS || 'noreply@example.com' 
          : finalSmtpConfig!.user,
        masterSpreadsheetId,
        masterSheetName,
      });

      if (!enqueueResult.success) {
        return NextResponse.json({ 
          message: `Failed to enqueue campaign: ${enqueueResult.error}` 
        }, { status: 500 });
      }

      return NextResponse.json({ 
        message: 'Campaign queued successfully', 
        campaignId,
        recipientCount: recipients.length
      });
    } else {
      // Sync mode: Send emails immediately (fallback when SQS not configured)
      console.log('[Send] SQS not configured, sending emails synchronously');
      
      if (spreadsheetId) {
        try {
          await updateCampaignJobStatus(spreadsheetId, campaignId, { status: 'processing' });
        } catch (e) {
          console.warn('[Send] Failed to update status to processing:', e);
        }
      }

      const results = await sendEmailsSynchronously(
        campaignId,
        recipients,
        subject,
        htmlContent,
        spreadsheetId,
        sheetName,
        finalSmtpConfig,
        providerType,
        masterSpreadsheetId,
        masterSheetName
      );

      return NextResponse.json({ 
        message: `Campaign completed. Sent: ${results.success}, Failed: ${results.failed}`,
        campaignId,
        recipientCount: recipients.length,
        results
      });
    }
  } catch (error: any) {
    console.error('Email Sending API Error:', error);
    return NextResponse.json({ 
      message: 'An unexpected server error occurred.', 
      error: error?.message || String(error) 
    }, { status: 500 });
  }
}