import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import Imap from 'imap';

interface SmtpConfig { host: string; port: number; user: string; pass: string; }
interface ImapConfig { host: string; port: number; user: string; pass: string; }

interface RequestBody {
    provider?: string;
    smtpConfig?: SmtpConfig;
    imapConfig?: ImapConfig;
}

export async function POST(request: Request) {
    try {
        const { provider, smtpConfig, imapConfig: providedImapConfig } = await request.json() as RequestBody;
        
        // If IMAP config not provided, try to load from environment variables
        let imapConfig = providedImapConfig;
        if (!imapConfig || !imapConfig.host || !imapConfig.user) {
            const envImapHost = process.env.IMAP_HOST;
            const envImapUser = process.env.IMAP_USER;
            const envImapPass = process.env.IMAP_PASS;
            
            if (envImapHost && envImapUser && envImapPass) {
                imapConfig = {
                    host: envImapHost,
                    port: parseInt(process.env.IMAP_PORT || '993', 10),
                    user: envImapUser,
                    pass: envImapPass,
                };
            }
        }

        // Handle AWS SES verification
        if (provider === 'ses') {
            const requiredEnvVars = [
                'AWS_SES_REGION',
                'AWS_ACCESS_KEY_ID',
                'AWS_SECRET_ACCESS_KEY',
                'AWS_SES_CONFIGURATION_SET'
            ];

            const missing = requiredEnvVars.filter(varName => !process.env[varName]);

            if (missing.length > 0) {
                return NextResponse.json({
                    error: `Missing AWS environment variables: ${missing.join(', ')}. Please configure your .env file.`,
                    sesSuccess: false
                }, { status: 400 });
            }

            let sesVerified = false;
            let imapVerified = false;
            let imapSkipped = false;

            // Verify AWS SES credentials
            try {
                const { SESv2Client, GetAccountCommand } = await import('@aws-sdk/client-sesv2');
                const sesClient = new SESv2Client({
                    region: process.env.AWS_SES_REGION,
                    credentials: {
                        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                    },
                });

                // Test credentials by fetching account details
                await sesClient.send(new GetAccountCommand({}));
                sesVerified = true;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown AWS error.";
                return NextResponse.json({
                    error: `AWS SES verification failed: ${errorMessage}`,
                    sesSuccess: false
                }, { status: 400 });
            }

            // Test IMAP Connection (if provided) - even for SES provider
            if (imapConfig && imapConfig.host && imapConfig.user) {
                try {
                    const imap = new Imap({
                        user: imapConfig.user,
                        password: imapConfig.pass,
                        host: imapConfig.host,
                        port: imapConfig.port || 993,
                        tls: true,
                        tlsOptions: { rejectUnauthorized: false },
                        connTimeout: 10000,
                        authTimeout: 5000,
                    });

                    await new Promise<void>((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            imap.end();
                            reject(new Error('IMAP connection timeout'));
                        }, 10000);

                        imap.once('ready', () => {
                            clearTimeout(timeout);
                            imap.end();
                            resolve();
                        });
                        imap.once('error', (err: Error) => {
                            clearTimeout(timeout);
                            reject(err);
                        });
                        imap.connect();
                    });
                    imapVerified = true;
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : "Unknown IMAP error.";
                    return NextResponse.json({
                        sesSuccess: sesVerified,
                        imapSuccess: false,
                        error: `IMAP check failed: ${errorMessage}`,
                        message: 'AWS SES verified, but IMAP connection failed.'
                    }, { status: 400 });
                }
            } else {
                imapSkipped = true;
            }

            // Return response with both SES and IMAP results
            let message = 'AWS SES credentials verified successfully.';
            if (imapVerified) {
                message += ' IMAP connection also successful.';
            } else if (imapSkipped) {
                message += ' IMAP was not configured.';
            }

            return NextResponse.json({
                sesSuccess: sesVerified,
                imapSuccess: imapVerified,
                imapSkipped: imapSkipped,
                message,
            });
        }

        // Handle IMAP-only test (when only imapConfig is provided, no smtpConfig or provider)
        if (!smtpConfig && !provider && imapConfig && imapConfig.host && imapConfig.user) {
            try {
                const imap = new Imap({
                    user: imapConfig.user,
                    password: imapConfig.pass,
                    host: imapConfig.host,
                    port: imapConfig.port || 993,
                    tls: true,
                    tlsOptions: { rejectUnauthorized: false },
                    connTimeout: 10000,
                    authTimeout: 5000,
                });

                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        imap.end();
                        reject(new Error('IMAP connection timeout'));
                    }, 10000);

                    imap.once('ready', () => {
                        clearTimeout(timeout);
                        imap.end();
                        resolve();
                    });
                    imap.once('error', (err: Error) => {
                        clearTimeout(timeout);
                        reject(err);
                    });
                    imap.connect();
                });

                return NextResponse.json({
                    imapSuccess: true,
                    message: 'IMAP connection verified successfully.',
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown IMAP error.";
                return NextResponse.json({
                    imapSuccess: false,
                    error: `IMAP check failed: ${errorMessage}`
                }, { status: 400 });
            }
        }

        // Handle SMTP verification (original flow)
        let finalSmtpConfig = smtpConfig;
        
        // If SMTP config not fully provided, try to load from environment variables
        if (!finalSmtpConfig || !finalSmtpConfig.host || !finalSmtpConfig.user || !finalSmtpConfig.pass) {
            const envSmtpHost = process.env.SMTP_HOST;
            const envSmtpUser = process.env.SMTP_USER;
            const envSmtpPass = process.env.SMTP_PASS;
            
            if (envSmtpHost && envSmtpUser && envSmtpPass) {
                finalSmtpConfig = {
                    host: envSmtpHost,
                    port: parseInt(process.env.SMTP_PORT || '587', 10),
                    user: envSmtpUser,
                    pass: envSmtpPass,
                };
            }
        }

        if (!finalSmtpConfig || !finalSmtpConfig.host) {
            return NextResponse.json({ error: 'SMTP configuration required' }, { status: 400 });
        }

        let smtpVerified = false;
        let imapVerified = false;
        let imapSkipped = false;

        // 1. Test SMTP Connection
        try {
            const smtpTransporter = nodemailer.createTransport({
                host: finalSmtpConfig.host, port: finalSmtpConfig.port,
                secure: finalSmtpConfig.port === 465, auth: { user: finalSmtpConfig.user, pass: finalSmtpConfig.pass },
            });
            await smtpTransporter.verify();
            smtpVerified = true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown SMTP error.";
            return NextResponse.json({ error: `SMTP check failed: ${errorMessage}` }, { status: 400 });
        }

        // 2. Test IMAP Connection (if provided)
        if (imapConfig && imapConfig.host && imapConfig.user) {
            try {
                const imap = new Imap({
                    user: imapConfig.user,
                    password: imapConfig.pass,
                    host: imapConfig.host,
                    port: imapConfig.port || 993,
                    tls: true,
                    tlsOptions: { rejectUnauthorized: false },
                    connTimeout: 10000,
                    authTimeout: 5000,
                });

                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        imap.end();
                        reject(new Error('IMAP connection timeout'));
                    }, 10000);

                    imap.once('ready', () => {
                        clearTimeout(timeout);
                        imap.end();
                        resolve();
                    });
                    imap.once('error', (err: Error) => {
                        clearTimeout(timeout);
                        reject(err);
                    });
                    imap.connect();
                });
                imapVerified = true;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown IMAP error.";
                return NextResponse.json({
                    smtpSuccess: smtpVerified,
                    imapSuccess: false,
                    error: `IMAP check failed: ${errorMessage}`,
                    message: 'SMTP verified, but IMAP connection failed.'
                }, { status: 400 });
            }
        } else {
            imapSkipped = true;
        }

        // 3. Return successful response
        return NextResponse.json({
            smtpSuccess: smtpVerified,
            imapSuccess: imapVerified,
            imapSkipped: imapSkipped,
            message: 'Connection tests complete.',
        });

    } catch (error) {
        console.error("[API TEST ERROR]", error);
        const errorMessage = error instanceof Error ? error.message : "An unexpected server error occurred.";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}