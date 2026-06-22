import { NextRequest, NextResponse } from 'next/server'
import { verifySnsSignature, handleSubscriptionConfirmation, extractSesEvent, SnsMessage } from '@/lib/sns-validator'
import { markDelivered, markBounced, markComplaint } from '@/lib/sheets'

async function safeParseBody(req: NextRequest): Promise<any> {
  try {
    const text = await req.text()
    return JSON.parse(text)
  } catch {
    try {
      return await req.json()
    } catch {
      return null
    }
  }
}

export async function POST(req: NextRequest) {
  const payload = (await safeParseBody(req)) as SnsMessage | null
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'Invalid SNS payload' }, { status: 400 })
  }

  // Optionally verify signature (recommended in production)
  try {
    const valid = await verifySnsSignature(payload)
    if (!valid) {
      return NextResponse.json({ ok: false, error: 'Invalid SNS signature' }, { status: 400 })
    }
  } catch (e) {
    // Proceed even if verification library not available in dev
    console.warn('[SES Notify] Signature verification skipped:', (e as any)?.message)
  }

  if (payload.Type === 'SubscriptionConfirmation') {
    const confirmed = await handleSubscriptionConfirmation(payload)
    return NextResponse.json({ ok: confirmed, type: 'SubscriptionConfirmation' })
  }

  if (payload.Type !== 'Notification') {
    return NextResponse.json({ ok: true, message: 'Ignored non-notification' })
  }

  try {
    const event = extractSesEvent(payload)
    const notifType = event.notificationType || event.eventType
    console.log(`[SES Notify] Received notification type: ${notifType}`)
    console.log(`[SES Notify] Event structure:`, JSON.stringify(event, null, 2))
    
    // Try multiple ways to extract tags
    const tags = event.mail?.tags || {}
    console.log(`[SES Notify] Tags from event.mail.tags:`, tags)
    
    // SES tags can be in different formats - try all possibilities
    let emailId: string | undefined = 
      (tags.emailId && (Array.isArray(tags.emailId) ? tags.emailId[0] : tags.emailId)) ||
      (tags['X-Email-Id'] && (Array.isArray(tags['X-Email-Id']) ? tags['X-Email-Id'][0] : tags['X-Email-Id'])) ||
      event.mail?.commonHeaders?.['X-Email-Id']
    
    let sheetId: string | undefined = 
      (tags.sheetId && (Array.isArray(tags.sheetId) ? tags.sheetId[0] : tags.sheetId)) ||
      (tags['X-Sheet-Id'] && (Array.isArray(tags['X-Sheet-Id']) ? tags['X-Sheet-Id'][0] : tags['X-Sheet-Id'])) ||
      event.mail?.commonHeaders?.['X-Sheet-Id']
    
    let sheetName: string | undefined = 
      (tags.sheetName && (Array.isArray(tags.sheetName) ? tags.sheetName[0] : tags.sheetName)) ||
      (tags['X-Sheet-Name'] && (Array.isArray(tags['X-Sheet-Name']) ? tags['X-Sheet-Name'][0] : tags['X-Sheet-Name'])) ||
      event.mail?.commonHeaders?.['X-Sheet-Name']

    console.log(`[SES Notify] Extracted - emailId: ${emailId}, sheetId: ${sheetId}, sheetName: ${sheetName}`)

    if (!emailId || !sheetId) {
      console.warn(`[SES Notify] Missing emailId or sheetId. emailId: ${emailId}, sheetId: ${sheetId}`)
      return NextResponse.json({ ok: false, error: 'Missing emailId or sheetId in tags' }, { status: 200 })
    }

    if (/delivery/i.test(notifType)) {
      console.log(`[SES Notify] Processing delivery event for emailId=${emailId}`)
      await markDelivered(sheetId, emailId, sheetName || 'Sheet1')
      console.log(`[SES Notify] Successfully marked delivered for emailId=${emailId}`)
    } else if (/bounce/i.test(notifType)) {
      const reasons = event.bounce?.bouncedRecipients?.map((r: any) => r.diagnosticCode || r.status) || []
      console.log(`[SES Notify] Processing bounce event for emailId=${emailId}, reasons: ${reasons.join(', ')}`)
      await markBounced(sheetId, emailId, reasons.join('; ') || 'Bounced', sheetName || 'Sheet1')
      console.log(`[SES Notify] Successfully marked bounced for emailId=${emailId}`)
    } else if (/complaint/i.test(notifType)) {
      console.log(`[SES Notify] Processing complaint event for emailId=${emailId}`)
      await markComplaint(sheetId, emailId, sheetName || 'Sheet1')
      console.log(`[SES Notify] Successfully marked complaint for emailId=${emailId}`)
    } else {
      console.log(`[SES Notify] Unknown notification type: ${notifType}, ignoring`)
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[SES Notify] Error processing notification:', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
