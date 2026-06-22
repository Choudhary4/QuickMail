// lib/email-providers/index.ts
// Factory for creating email provider instances

import { SMTPProvider } from './smtp-provider';
import { SESProvider } from './ses-provider';
import type { EmailProvider, ProviderConfig } from './types';

export * from './types';

export function createEmailProvider(config: ProviderConfig): EmailProvider {
  // Priority: If SES config is provided, use SES (unless EMAIL_PROVIDER explicitly says 'smtp')
  // Otherwise, use SMTP if provided
  if (config.ses && process.env.EMAIL_PROVIDER !== 'smtp') {
    return new SESProvider(config.ses);
  }

  if (config.smtp) {
    return new SMTPProvider(config.smtp);
  }

  // If only SES is provided but EMAIL_PROVIDER is 'smtp', that's an error
  if (config.ses && process.env.EMAIL_PROVIDER === 'smtp') {
    throw new Error('EMAIL_PROVIDER is set to "smtp" but only SES config is provided');
  }

  throw new Error('No valid email provider configuration provided');
}
