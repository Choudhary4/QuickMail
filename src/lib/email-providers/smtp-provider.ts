// lib/email-providers/smtp-provider.ts
// Nodemailer SMTP provider implementation

import nodemailer from 'nodemailer';
import type { EmailMessage, EmailProvider, SendResult } from './types';

export class SMTPProvider implements EmailProvider {
  private transporter: any;

  constructor(config: {
    host: string;
    port: number;
    user: string;
    pass: string;
  }) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      pool: true,
    });
  }

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: message.fromName 
          ? `"${message.fromName}" <${message.from}>`
          : message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        headers: message.headers,
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      console.error('[SMTP Provider] Send error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown SMTP error',
      };
    }
  }

  async close(): Promise<void> {
    this.transporter.close();
  }
}
