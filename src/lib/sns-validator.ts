// lib/sns-validator.ts
// SNS signature verification utility

// Use require to avoid type declaration dependency
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MessageValidator: any = require('sns-validator');

const validator = new MessageValidator();

export interface SnsMessage {
  Type?: string;
  MessageId?: string;
  TopicArn?: string;
  Message?: string;
  Timestamp?: string;
  Signature?: string;
  SigningCertURL?: string;
  SignatureVersion?: string;
  SubscribeURL?: string;
  UnsubscribeURL?: string;
}

/**
 * Verify SNS message signature
 * Returns true if valid, false otherwise
 */
export async function verifySnsSignature(message: SnsMessage): Promise<boolean> {
  try {
    await validator.validate(message);
    return true;
  } catch (error) {
    console.error('[SNS Validator] Signature verification failed:', error);
    return false;
  }
}

/**
 * Handle SNS subscription confirmation
 * Returns true if this was a subscription confirmation message
 */
export async function handleSubscriptionConfirmation(message: SnsMessage): Promise<boolean> {
  if (message.Type !== 'SubscriptionConfirmation') {
    return false;
  }

  if (!message.SubscribeURL) {
    console.error('[SNS] Missing SubscribeURL in subscription confirmation');
    return false;
  }

  try {
    // Confirm subscription by hitting the subscribe URL
    const response = await fetch(message.SubscribeURL);
    if (response.ok) {
      console.log('[SNS] Subscription confirmed successfully');
      return true;
    } else {
      console.error('[SNS] Failed to confirm subscription:', response.status);
      return false;
    }
  } catch (error) {
    console.error('[SNS] Error confirming subscription:', error);
    return false;
  }
}

/**
 * Extract SES event from SNS message
 */
export function extractSesEvent(snsMessage: SnsMessage): any {
  if (!snsMessage.Message) {
    throw new Error('No Message field in SNS payload');
  }
  
  try {
    return JSON.parse(snsMessage.Message);
  } catch (error) {
    throw new Error('Failed to parse SES event from SNS Message');
  }
}
