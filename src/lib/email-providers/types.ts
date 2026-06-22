// lib/email-providers/types.ts
// Common interfaces for email sending providers

export interface EmailMessage {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
  tags?: Record<string, string>; // For SES message tags
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<SendResult>;
  close?(): Promise<void>;
}

export interface ProviderConfig {
  // SMTP config
  smtp?: {
    host: string;
    port: number;
    user: string;
    pass: string;
  };
  
  // SES config
  ses?: {
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    configurationSetName?: string;
  };
}
