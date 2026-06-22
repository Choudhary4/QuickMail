import { NextResponse } from 'next/server';

/**
 * API endpoint to check if SMTP is configured via environment variables
 * Returns SMTP config if available, without exposing sensitive data
 */
export async function GET() {
  try {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;

    // Check if SMTP is configured via env vars
    if (smtpHost && smtpUser) {
      return NextResponse.json({
        configured: true,
        config: {
          host: smtpHost,
          port: smtpPort ? parseInt(smtpPort, 10) : 587,
          user: smtpUser,
          // Don't expose password - it's only used server-side
        },
        message: 'SMTP configured via environment variables',
      });
    }

    return NextResponse.json({
      configured: false,
      message: 'SMTP not configured via environment variables',
    });
  } catch (error) {
    console.error('[SMTP Config] Error:', error);
    return NextResponse.json(
      { configured: false, error: 'Failed to check SMTP configuration' },
      { status: 500 }
    );
  }
}
