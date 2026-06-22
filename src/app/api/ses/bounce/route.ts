import { NextRequest } from 'next/server';
import { markBounced } from '@/lib/sheets';
import { verifySnsSignature, handleSubscriptionConfirmation, extractSesEvent, type SnsMessage } from '@/lib/sns-validator';

async function markBounce(emailId: string | undefined, sheetId: string | undefined, reason: string | undefined) {
  if (!emailId || !sheetId) return;
  await markBounced(sheetId, emailId, reason || 'Unknown');
}

export async function POST(req: NextRequest) {
  const body = await req.json() as SnsMessage;
  
  const isValid = await verifySnsSignature(body);
  if (!isValid) {
    return new Response('Forbidden', { status: 403 });
  }
  
  if (await handleSubscriptionConfirmation(body)) {
    return Response.json({ ok: true, subscribed: true });
  }
  
  try {
    const sesEvent = extractSesEvent(body);
    const bounce = sesEvent?.bounce;
    const reason = bounce?.bounceType || bounce?.bounceSubType;
    const emailIdHeader = sesEvent?.mail?.headers?.find((h: any) => h.name?.toLowerCase() === 'x-email-id');
    const sheetIdHeader = sesEvent?.mail?.headers?.find((h: any) => h.name?.toLowerCase() === 'x-sheet-id');
    const emailId = emailIdHeader?.value;
    const sheetId = sheetIdHeader?.value;
    await markBounce(emailId, sheetId, reason);
    return Response.json({ ok: true });
  } catch (e) {
    console.error('Bounce webhook parse error', e);
    return new Response('Bad Request', { status: 400 });
  }
}
