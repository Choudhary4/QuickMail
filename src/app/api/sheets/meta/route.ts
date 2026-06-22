import { NextRequest, NextResponse } from 'next/server'
import { google, sheets_v4 } from 'googleapis'

type SheetsCreds = {
  type: string
  project_id: string
  private_key_id: string
  private_key: string
  client_email: string
  client_id: string
  auth_uri: string
  token_uri: string
  auth_provider_x509_cert_url: string
  client_x509_cert_url: string
  universe_domain?: string
}

function normalizePrivateKey(key?: string) {
  if (!key) return key
  // Accept keys with \n literals and normalize to real newlines
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key
}

function loadServiceAccountFromEnv(): SheetsCreds | null {
  const filePath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
  const base64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  try {
    if (filePath) {
      const raw = require('fs').readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw)
      parsed.private_key = normalizePrivateKey(parsed.private_key)
      return parsed
    }
    if (base64) {
      const raw = Buffer.from(base64, 'base64').toString('utf8')
      const parsed = JSON.parse(raw)
      parsed.private_key = normalizePrivateKey(parsed.private_key)
      return parsed
    }
    if (inlineJson) {
      const parsed = JSON.parse(inlineJson)
      parsed.private_key = normalizePrivateKey(parsed.private_key)
      return parsed
    }
  } catch (e) {
    // fallthrough to return null and surface error later
  }
  return null
}

function validatePem(key?: string) {
  if (!key) return false
  return key.includes('-----BEGIN PRIVATE KEY-----') && key.includes('-----END PRIVATE KEY-----')
}

export async function POST(req: NextRequest) {
  try {
    const { sheetId } = await req.json()
    if (!sheetId) {
      return NextResponse.json({ ok: false, error: 'sheetId is required' }, { status: 400 })
    }

    const creds = loadServiceAccountFromEnv()
    if (!creds) {
      return NextResponse.json(
        { ok: false, error: 'Google service account credentials not configured' },
        { status: 500 }
      )
    }
    if (!validatePem(creds.private_key)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Invalid private_key PEM. Ensure correct JSON and that newlines are preserved (or use GOOGLE_SERVICE_ACCOUNT_KEY_FILE).',
        },
        { status: 500 }
      )
    }

    const jwt = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
    const sheets = google.sheets({ version: 'v4', auth: jwt })

    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId })
    const titles = (meta.data.sheets || [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => !!t)

    return NextResponse.json({ ok: true, availableSheets: titles })
  } catch (err: any) {
    const message = err?.message || 'Unknown error'
    const status = typeof err?.code === 'number' ? err.code : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
