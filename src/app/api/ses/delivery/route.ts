import { NextRequest } from 'next/server';
import { markDelivered } from '@/lib/sheetsClient';

// Generic SNS message wrapper type (partial)
interface SnsMessage {
  Type?: string;
  MessageId?: string;
  TopicArn?: string;
  Message?: string; // JSON string with SES event
  Timestamp?: string;
  Signature?: string;
}

// TODO: Implement real SNS signature verification
function verifySnsStub(_msg: SnsMessage): boolean { return true; }

async function updateDelivered(emailId: string | undefined) {
  if (!emailId) return;
  const sheetId = process.env.DEFAULT_TRACKING_SHEET_ID || '';
  if (!sheetId) {
    console.warn('[DELIVERY] No spreadsheet ID configured');
    return;
  }
  await markDelivered(sheetId, emailId);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as SnsMessage;
  if (!verifySnsStub(body)) {
    return new Response('Invalid SNS signature', { status: 403 });
  }
  try {
    const sesEvent = JSON.parse(body.Message || '{}');
    const emailIdHeader = sesEvent?.mail?.headers?.find((h: any) => h.name?.toLowerCase() === 'x-email-id');
    const sheetIdHeader = sesEvent?.mail?.headers?.find((h: any) => h.name?.toLowerCase() === 'x-sheet-id');
    const emailId = emailIdHeader?.value;
    const sheetId = sheetIdHeader?.value;
    await updateDelivered(emailId, sheetId);
    return Response.json({ ok: true });
  } catch (e) {
    console.error('Delivery webhook parse error', e);
    return new Response('Bad Request', { status: 400 });
  }
}
