import { NextResponse } from 'next/server';

/**
 * API endpoint to check if IMAP is configured via environment variables
 * Returns IMAP config if available, without exposing sensitive data
 */
export async function GET() {
  try {
    const imapHost = process.env.IMAP_HOST;
    const imapPort = process.env.IMAP_PORT;
    const imapUser = process.env.IMAP_USER;
    const imapTls = process.env.IMAP_TLS;

    // Check if IMAP is configured via env vars
    if (imapHost && imapUser) {
      return NextResponse.json({
        configured: true,
        config: {
          host: imapHost,
          port: imapPort ? parseInt(imapPort, 10) : 993,
          user: imapUser,
          // Don't expose password - it's only used server-side
          tls: imapTls !== 'false',
        },
        message: 'IMAP configured via environment variables',
      });
    }

    return NextResponse.json({
      configured: false,
      message: 'IMAP not configured via environment variables',
    });
  } catch (error) {
    console.error('[IMAP Config] Error:', error);
    return NextResponse.json(
      { configured: false, error: 'Failed to check IMAP configuration' },
      { status: 500 }
    );
  }
}

