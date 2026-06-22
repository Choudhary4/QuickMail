// lib/email-providers/ses-provider.ts
// AWS SES v2 email provider implementation

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { randomUUID } from 'crypto';
import type { EmailMessage, EmailProvider, SendResult } from './types';

export class SESProvider implements EmailProvider {
  private client: SESv2Client;
  private sesV1Client?: SESClient; // For raw email sending (threading support)
  private configurationSetName?: string;
  private region: string;

  constructor(config: {
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    configurationSetName?: string;
  }) {
    const credentials = config.accessKeyId && config.secretAccessKey
      ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
      : undefined;

    this.region = config.region;
    this.client = new SESv2Client({
      region: config.region,
      credentials,
    });

    // Initialize SES v1 client for raw email sending (needed for threading)
    this.sesV1Client = new SESClient({
      region: config.region,
      credentials,
    });

    this.configurationSetName = config.configurationSetName;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      // Check if we have threading headers (In-Reply-To, References)
      // SES v2 Simple format doesn't support custom headers, so we need Raw format for threading
      const hasThreadingHeaders = message.headers && (
        message.headers['In-Reply-To'] || 
        message.headers['References'] ||
        message.headers['Thread-Index'] ||
        message.headers['Thread-Topic']
      );

      console.log(`[SES Provider] Sending email to: ${message.to}`);
      console.log(`[SES Provider] Has threading headers: ${hasThreadingHeaders}`);
      if (message.headers) {
        console.log(`[SES Provider] Headers received:`, Object.keys(message.headers));
        if (message.headers['In-Reply-To']) {
          console.log(`[SES Provider] In-Reply-To: ${message.headers['In-Reply-To']}`);
        }
        if (message.headers['References']) {
          console.log(`[SES Provider] References: ${message.headers['References']}`);
        }
      }

      if (hasThreadingHeaders) {
        // Use Raw email format for threading support
        console.log(`[SES Provider] Using RAW email format for threading`);
        return await this.sendRawEmail(message);
      } else {
        // Use Simple format for non-threaded emails (faster and simpler)
        console.log(`[SES Provider] Using SIMPLE email format`);
        return await this.sendSimpleEmail(message);
      }
    } catch (error) {
      console.error('[SES Provider] Send error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown SES error',
      };
    }
  }

  private async sendSimpleEmail(message: EmailMessage): Promise<SendResult> {
    // Separate email headers from SES tags
    const emailHeaders: Record<string, string> = {};
    const emailTags: Array<{ Name: string; Value: string }> = [];
    
    // X-* headers are custom tracking headers, not email headers
    if (message.headers) {
      for (const [key, value] of Object.entries(message.headers)) {
        if (key.startsWith('X-')) {
          emailTags.push({ Name: key, Value: value });
        } else {
          // Other headers can't be used in Simple format, log warning
          console.warn(`[SES Provider] Header "${key}" cannot be used in Simple format, ignoring`);
        }
      }
    }
    
    // Add tags from message.tags
    if (message.tags) {
      for (const [key, value] of Object.entries(message.tags)) {
        emailTags.push({ Name: key, Value: String(value) });
      }
    }

    const command = new SendEmailCommand({
      FromEmailAddress: message.fromName 
        ? `${message.fromName} <${message.from}>`
        : message.from,
      Destination: {
        ToAddresses: [message.to],
      },
      Content: {
        Simple: {
          Subject: {
            Data: message.subject,
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: message.html,
              Charset: 'UTF-8',
            },
          },
        },
      },
      ...(this.configurationSetName && {
        ConfigurationSetName: this.configurationSetName,
      }),
      ...(emailTags.length > 0 && {
        EmailTags: emailTags,
      }),
    });

    const response = await this.client.send(command);

    return {
      success: true,
      messageId: response.MessageId,
    };
  }

  private async sendRawEmail(message: EmailMessage): Promise<SendResult> {
    if (!this.sesV1Client) {
      throw new Error('SES v1 client not initialized for raw email sending');
    }

    // Generate Message-ID for this email
    const messageId = message.headers?.['Message-ID'] || `<${randomUUID()}@${message.from.split('@')[1] || 'example.com'}>`;
    
    console.log(`[SES Raw Email] Building email with threading headers`);
    console.log(`[SES Raw Email] To: ${message.to}`);
    console.log(`[SES Raw Email] Subject: ${message.subject}`);
    
    // Build RFC 5322 email message
    const lines: string[] = [];
    
    // Headers
    lines.push(`From: ${message.fromName ? `"${message.fromName}" <${message.from}>` : message.from}`);
    lines.push(`To: ${message.to}`);
    lines.push(`Subject: ${message.subject}`);
    lines.push(`Message-ID: ${messageId}`);
    lines.push(`MIME-Version: 1.0`);
    lines.push(`Content-Type: text/html; charset=UTF-8`);
    
    // Add all custom headers (including threading headers)
    let threadingHeadersAdded = false;
    if (message.headers) {
      for (const [key, value] of Object.entries(message.headers)) {
        // Include threading headers (In-Reply-To, References, Thread-Index, Thread-Topic)
        // Skip X-* tracking headers (except we'll add them as SES tags)
        if (key === 'In-Reply-To' || key === 'References' || key === 'Thread-Index' || key === 'Thread-Topic') {
          console.log(`[SES Raw Email] Adding header: ${key}: ${value}`);
          lines.push(`${key}: ${value}`);
          threadingHeadersAdded = true;
        }
      }
    }
    
    if (!threadingHeadersAdded) {
      console.warn(`[SES Raw Email] WARNING: No threading headers were added!`);
      console.log(`[SES Raw Email] Available headers:`, Object.keys(message.headers || {}));
    }
    
    // Empty line between headers and body
    lines.push('');
    
    // Body
    lines.push(message.html);
    
    const rawMessage = Buffer.from(lines.join('\r\n'));
    
    // Log the raw email headers (not the body)
    const headerSection = lines.slice(0, lines.indexOf('')).join('\n');
    console.log(`[SES Raw Email] Final headers:\n${headerSection}`);
    
    const command = new SendRawEmailCommand({
      RawMessage: {
        Data: rawMessage,
      },
      ...(this.configurationSetName && {
        ConfigurationSetName: this.configurationSetName,
      }),
      // Add tags for tracking (SES v1 uses Tags, not EmailTags)
      ...(message.tags && {
        Tags: Object.entries(message.tags).map(([Name, Value]) => ({
          Name,
          Value: String(Value),
        })),
      }),
    });

    const response = await this.sesV1Client.send(command);

    return {
      success: true,
      messageId: response.MessageId,
    };
  }

  async close(): Promise<void> {
    this.client.destroy();
    if (this.sesV1Client) {
      this.sesV1Client.destroy();
    }
  }
}
