import { NextRequest, NextResponse } from 'next/server'
import { markSeen } from '@/lib/sheets'

export async function POST(req: NextRequest) {
  try {
    const { spreadsheetId, sheetName, email } = await req.json()
    if (!spreadsheetId || !email) {
      return NextResponse.json({ error: 'Missing spreadsheetId or email' }, { status: 400 })
    }

    // Find the row by email and get emailId, then mark as seen
    const { findRowByEmail } = await import('@/lib/sheets')
    const rowNum = await findRowByEmail(spreadsheetId, email, sheetName || 'Sheet1')
    if (!rowNum) {
      return NextResponse.json({ error: `No row found for ${email}` }, { status: 404 })
    }

    // Read emailId from column E using the same method as sheets.ts
    const { google } = await import('googleapis')
    const fs = await import('node:fs')
    
    // Try multiple ways to get credentials (matching sheets.ts)
    const fromFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
    const fromB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64
    const fromInline = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    
    let raw: string | undefined
    
    // Try file system first (only works in local/dev, not on Vercel)
    if (fromFile) {
      try {
        if (fs.existsSync(fromFile)) {
          raw = fs.readFileSync(fromFile, 'utf8')
        }
      } catch (error) {
        // File system not available (e.g., on Vercel), continue to other methods
        console.warn('[Test Pixel] File system access not available, trying other credential methods')
      }
    }
    
    // Prefer base64 or inline JSON (works on Vercel)
    if (!raw && fromB64) {
      raw = Buffer.from(fromB64, 'base64').toString('utf8')
    } else if (!raw && fromInline) {
      raw = fromInline
    }
    
    if (!raw) {
      return NextResponse.json({ error: 'Google credentials not found. Provide GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 or GOOGLE_SERVICE_ACCOUNT_KEY (recommended for Vercel).' }, { status: 500 })
    }
    
    const credentials = JSON.parse(raw)
    if (credentials.private_key && typeof credentials.private_key === 'string') {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n')
    }
    
    const googleAuthClient = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    const sheetsClient = google.sheets({ version: 'v4', auth: googleAuthClient })
    
    const range = `${sheetName || 'Sheet1'}!E${rowNum}`
    const resp = await sheetsClient.spreadsheets.values.get({ spreadsheetId, range })
    const emailId = resp.data.values?.[0]?.[0]
    
    if (!emailId) {
      // If emailId doesn't exist, it means the email hasn't been sent yet or emailId wasn't set
      // Let's provide a helpful error message
      return NextResponse.json({ 
        error: `No emailId found at row ${rowNum}. The email may not have been sent yet, or emailId wasn't set. Please send a test email first.`,
        rowNum,
        email,
        hint: 'Make sure you have sent an email to this address first. The emailId is set when the email is sent.'
      }, { status: 404 })
    }

    // Mark as seen
    const success = await markSeen(spreadsheetId, emailId, sheetName || 'Sheet1')
    if (!success) {
      return NextResponse.json({ error: 'Failed to update sheet' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, email, emailId, rowNum })
  } catch (e: any) {
    console.error('[Test Pixel] Error:', e)
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 })
  }
}
