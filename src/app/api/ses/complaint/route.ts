import { NextRequest } from 'next/server';
import { markComplaint as markComplaintInSheet } from '@/lib/sheets';
import { verifySnsSignature, handleSubscriptionConfirmation, extractSesEvent, type SnsMessage } from '@/lib/sns-validator';

async function markComplaint(emailId: string | undefined, sheetId: string | undefined) {
  if (!emailId || !sheetId) return;
  await markComplaintInSheet(sheetId, emailId);
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
    const emailIdHeader = sesEvent?.mail?.headers?.find((h: any) => h.name?.toLowerCase() === 'x-email-id');
    const sheetIdHeader = sesEvent?.mail?.headers?.find((h: any) => h.name?.toLowerCase() === 'x-sheet-id');
    const emailId = emailIdHeader?.value;
    const sheetId = sheetIdHeader?.value;
    await markComplaint(emailId, sheetId);
    return Response.json({ ok: true });
  } catch (e) {
    console.error('Complaint webhook parse error', e);
    return new Response('Bad Request', { status: 400 });
  }
}
