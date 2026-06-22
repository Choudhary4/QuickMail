import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import fs from 'node:fs';

function loadServiceAccountJson(): any {
  const fromFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  const fromB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  const fromInline = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  let raw: string | undefined;
  
  // Try file system first (only works in local/dev, not on Vercel)
  if (fromFile) {
    try {
      if (fs.existsSync(fromFile)) {
        raw = fs.readFileSync(fromFile, 'utf8');
      }
    } catch (error) {
      // File system not available (e.g., on Vercel), continue to other methods
      console.warn('[Fetch Recipients] File system access not available, trying other credential methods');
    }
  }
  
  // Prefer base64 or inline JSON (works on Vercel)
  if (!raw && fromB64) {
    raw = Buffer.from(fromB64, 'base64').toString('utf8');
  } else if (!raw && fromInline) {
    raw = fromInline;
  }

  if (!raw) {
    throw new Error('No Google credentials found. Provide GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 or GOOGLE_SERVICE_ACCOUNT_KEY (recommended for Vercel). GOOGLE_SERVICE_ACCOUNT_KEY_FILE only works in local development.');
  }
  const parsed = JSON.parse(raw);
  if (parsed.private_key && typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

function getSheetsClient() {
  const parsed = loadServiceAccountJson();

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY: missing client_email or private_key');
  }

  // Basic sanity for PEM header
  if (!String(parsed.private_key).includes('BEGIN PRIVATE KEY')) {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY.private_key: expected PEM with BEGIN PRIVATE KEY header');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: parsed,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });

  return google.sheets({ version: 'v4', auth });
}

function toA1AllCols(title: string) {
  const escaped = title.includes("'") ? title.replace(/'/g, "''") : title;
  return `'${escaped}'!A:Z`;
}

export async function POST(request: Request) {
  try {
    const { spreadsheetId, sheetName } = await request.json();

    if (!spreadsheetId) {
      return NextResponse.json(
        { error: 'Spreadsheet ID is required' },
        { status: 400 }
      );
    }

    const sheets = getSheetsClient();

    // Discover available sheets and resolve target sheet name
    let meta;
    try {
      meta = await sheets.spreadsheets.get({ spreadsheetId });
    } catch (error: any) {
      if (error?.code === 403 || error?.status === 403) {
        // Try to get service account email from credentials
        let serviceAccountEmail = 'your-service-account@project.iam.gserviceaccount.com';
        try {
          const credentials = loadServiceAccountJson();
          serviceAccountEmail = credentials?.client_email || serviceAccountEmail;
        } catch {
          // Ignore if we can't get the email
        }
        
        return NextResponse.json(
          { 
            error: 'Permission denied. The service account does not have access to this spreadsheet.',
            hint: `Share the spreadsheet with this email address: ${serviceAccountEmail}`,
            serviceAccountEmail,
            instructions: [
              '1. Open your Google Spreadsheet',
              `2. Click "Share" button (top right)`,
              `3. Add this email: ${serviceAccountEmail}`,
              '4. Give it "Viewer" or "Editor" permission',
              '5. Click "Send"',
              '6. Try again'
            ]
          },
          { status: 403 }
        );
      }
      throw error;
    }
    const availableTitles = (meta.data.sheets || [])
      .map(s => s.properties?.title)
      .filter((t): t is string => !!t);

    if (availableTitles.length === 0) {
      return NextResponse.json({ error: 'Spreadsheet has no sheets/tabs' }, { status: 400 });
    }

    const targetTitle = sheetName && availableTitles.includes(sheetName)
      ? sheetName
      : availableTitles[0];

    // Fetch all data from resolved sheet, quoting title for spaces/special chars
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: toA1AllCols(targetTitle),
    });

    const rows = response.data.values || [];
    
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Sheet is empty' },
        { status: 404 }
      );
    }

    // First row is headers
    const headers = rows[0] as string[];
    
    // Convert remaining rows to objects
    const recipients = rows.slice(1).map((row: any[]) => {
      const recipient: Record<string, string> = {};
      headers.forEach((header, index) => {
        recipient[header] = row[index] || '';
      });
      return recipient;
    });

    // Convert to CSV format for compatibility with existing UI
    const csvHeaders = headers.join(',');
    const csvRows = recipients.map(recipient => 
      headers.map(header => {
        const value = recipient[header] || '';
        // Escape commas and quotes
        return value.includes(',') || value.includes('"') 
          ? `"${value.replace(/"/g, '""')}"` 
          : value;
      }).join(',')
    );
    const csvData = [csvHeaders, ...csvRows].join('\n');

    return NextResponse.json({
      success: true,
      recipients,
      headers,
      csvData,
      count: recipients.length,
      sheetNameUsed: targetTitle,
      availableSheets: availableTitles
    });

  } catch (error: any) {
    console.error('[FETCH RECIPIENTS ERROR]:', error);

    const message = (error && error.message) ? String(error.message) : 'Unknown error';
    const code = error?.code || '';

    if (code === 'ERR_OSSL_UNSUPPORTED' || message.includes('DECODER routines')) {
      return NextResponse.json({
        error: 'OpenSSL error while loading Google private key. If you are on Node 22+, switch to Node 20 LTS or run with NODE_OPTIONS=--openssl-legacy-provider. Also ensure private_key in GOOGLE_SERVICE_ACCOUNT_KEY is a valid PEM and uses escaped \\n newlines in .env.'
      }, { status: 500 });
    }

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
