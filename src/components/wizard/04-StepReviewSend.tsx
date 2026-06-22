"use client";

import { useState } from 'react';
import { useWizardStore } from '@/store/wizardStore';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { generateHtmlFromBlocks } from '../../lib/blockToHtml';


export function StepReviewSend({ onBack }: { onBack: () => void }) {
    const {
        smtpConfig, imapConfig, subject,
        emailBlocks, htmlContent, editorMode, googleSheetId,
        recipients, emailProvider, googleSheetTab,
        useMasterSpreadsheet, masterSpreadsheetId, masterSheetName
    } = useWizardStore();

    // State for the test email input
    const [testEmail, setTestEmail] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [checking, setChecking] = useState(false);
    const [health, setHealth] = useState<any | null>(null);
    const [testingPixel, setTestingPixel] = useState(false);
    
    
    const isAutomationEnabled = !!(imapConfig && imapConfig.host && imapConfig.user);

    const getFinalHtml = () => {
        return editorMode === 'code' ? htmlContent : generateHtmlFromBlocks(emailBlocks);
    };
    
    const finalHtmlToSend = getFinalHtml();


    // ADDED: A dedicated function to send only the test email
    const sendTestEmail = async () => {
        if (!testEmail) {
            return toast.error("Please enter a test email address.");
        }
        setIsSending(true);
        toast.loading("Sending test email...");

        // Use the first recipient's data for personalizing the test email placeholders
        const firstRecipientData = recipients[0] || {};
        const testRecipient = { ...firstRecipientData, email: testEmail };

        try {
            const payload: any = {
                recipients: [testRecipient],
                subject: `[TEST] ${subject}`,
                htmlContent: finalHtmlToSend,
                spreadsheetId: googleSheetId || undefined,
            };

            // Only send smtpConfig if using SMTP provider
            if (emailProvider === 'smtp') {
                payload.smtpConfig = smtpConfig;
            }

            const response = await fetch('/api/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await response.json();
            toast.dismiss();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to send test email.');
            }
            
            toast.success("Test email sent successfully!", { 
                description: "Check your inbox for the test email" 
            });
            setIsSending(false);

        } catch (err) {
            toast.dismiss();
            if (err instanceof Error) {
                toast.error("Failed to Send Test", { description: err.message });
            }
            setIsSending(false);
        }
    };

    const launchCampaign = async () => {
        setIsSending(true);
        toast.loading("Queueing campaign...");

        try {
            // Always use the tracking spreadsheet ID (googleSheetId), not master spreadsheet ID
            // Master spreadsheet is only for cron jobs, not for launching campaigns
            const trackingSpreadsheetId = googleSheetId;
            
            if (!trackingSpreadsheetId) {
                throw new Error(
                    useMasterSpreadsheet 
                        ? 'Please enter the Current Campaign Tracking Spreadsheet ID in Step 2'
                        : 'Please enter a Tracking Spreadsheet ID in Step 2'
                );
            }

            if (!recipients || recipients.length === 0) {
                throw new Error('No recipients found. Please add recipients via CSV upload or fetch from spreadsheet.');
            }

            const payload: any = {
                recipients,
                subject,
                htmlContent: finalHtmlToSend,
                spreadsheetId: trackingSpreadsheetId,
                sheetName: googleSheetTab || undefined,
            };

            // Include master spreadsheet info if using master spreadsheet mode
            if (useMasterSpreadsheet && masterSpreadsheetId) {
                payload.masterSpreadsheetId = masterSpreadsheetId;
                payload.masterSheetName = masterSheetName || 'Sheet1';
            }

            // Only include SMTP config when using SMTP provider
            if (emailProvider === 'smtp') {
                payload.smtpConfig = smtpConfig;
            }

            const response = await fetch('/api/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await response.json();
            toast.dismiss();

            if (!response.ok) {
                throw new Error(data?.message || 'Failed to launch campaign.');
            }

            // Show success message and reset state
            setIsSending(false);
            toast.success("Campaign launched successfully!", { 
                description: `${data.recipientCount || recipients.length} emails are being processed in the background. You can safely leave this page.` 
            });
        } catch (err) {
            toast.dismiss();
            if (err instanceof Error) {
                toast.error("Failed to Launch Campaign", { description: err.message });
            }
            setIsSending(false);
        }
    };

    const runHealthChecks = async () => {
        try {
            setChecking(true);
            const res = await fetch('/api/health/status');
            const data = await res.json();
            setHealth(data);
            if (!res.ok) throw new Error('Health check failed');
            const msgs = [] as string[];
            msgs.push(data.baseUrlOk ? 'Base URL set' : 'Base URL missing');
            msgs.push(data.pixelReachable ? 'Pixel reachable' : 'Pixel not reachable');
            msgs.push(data.sesEnvOk ? 'SES env ok' : 'SES env missing');
            msgs.push(data.sesConfigSetOk ? 'Config set ok' : 'Config set missing');
            toast.message('Health status', { description: msgs.join(' • ') });
        } catch (e: any) {
            toast.error(e?.message || 'Health check error');
        } finally {
            setChecking(false);
        }
    };

    const testPixelUpdate = async () => {
        if (!googleSheetId || recipients.length === 0) {
            return toast.error('No tracking sheet or recipients configured');
        }
        setTestingPixel(true);
        try {
            const firstEmail = recipients[0].email;
            const res = await fetch('/api/test-pixel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    spreadsheetId: googleSheetId,
                    sheetName: googleSheetTab || 'Sheet1',
                    email: firstEmail,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Test failed');
            toast.success('Pixel test success', {
                description: `Updated seen/seenAt for ${data.email} (row ${data.rowNum})`,
            });
        } catch (e: any) {
            toast.error(e?.message || 'Pixel test failed');
        } finally {
            setTestingPixel(false);
        }
    };


    return (
        <Card>
            <CardHeader>
                <CardTitle>Step 4: Review & Launch</CardTitle>
                <CardDescription>Send a test email, then launch the campaign to your recipients.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Campaign Configuration Status */}
                <div className="space-y-3">
                    <h3 className="font-semibold text-lg">Campaign Configuration</h3>
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="text-blue-600">
                            Provider: {emailProvider === 'ses' ? 'AWS SES' : 'SMTP (Nodemailer)'}
                        </Badge>
                        <Badge variant="outline">
                            Recipients: {recipients.length}
                        </Badge>
                        {useMasterSpreadsheet ? (
                            <>
                                <Badge variant="default" className="bg-blue-600">
                                    <CheckCircle2 className="h-3 w-3 mr-1" /> Master Spreadsheet Mode
                                </Badge>
                                <Badge variant="default" className="bg-green-600">
                                    <CheckCircle2 className="h-3 w-3 mr-1" /> Multi-Campaign Tracking
                                </Badge>
                            </>
                        ) : googleSheetId ? (
                            <>
                                <Badge variant="default" className="bg-green-600">
                                    <CheckCircle2 className="h-3 w-3 mr-1" /> Open Tracking
                                </Badge>
                                {emailProvider === 'ses' && (
                                    <>
                                        <Badge variant="default" className="bg-green-600">
                                            <CheckCircle2 className="h-3 w-3 mr-1" /> Delivery Tracking
                                        </Badge>
                                        <Badge variant="default" className="bg-green-600">
                                            <CheckCircle2 className="h-3 w-3 mr-1" /> Bounce/Complaint Tracking
                                        </Badge>
                                    </>
                                )}
                            </>
                        ) : (
                            <Badge variant="secondary">
                                <AlertCircle className="h-3 w-3 mr-1" /> No Tracking (Sheet ID missing)
                            </Badge>
                        )}
                        {isAutomationEnabled && (
                            <Badge variant="default" className="bg-purple-600">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Reply Tracking
                            </Badge>
                        )}
                    </div>
                    {useMasterSpreadsheet ? (
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">
                                Master Spreadsheet: <code className="bg-muted px-1 py-0.5 rounded">{masterSpreadsheetId}</code>
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Master Sheet Tab: <code className="bg-muted px-1 py-0.5 rounded">{masterSheetName}</code>
                            </p>
                            <p className="text-xs text-blue-600 dark:text-blue-400 italic">
                                Note: Cron jobs will process all active campaigns from the master spreadsheet
                            </p>
                        </div>
                    ) : googleSheetId && (
                        <p className="text-xs text-muted-foreground">
                            Tracking Sheet: <code className="bg-muted px-1 py-0.5 rounded">{googleSheetId}</code>
                            {googleSheetTab && (
                                <span className="ml-2">Tab: <code className="bg-muted px-1 py-0.5 rounded">{googleSheetTab}</code></span>
                            )}
                        </p>
                    )}
                </div>

                <div className="pt-4 border-t">
                    <Label>Final Email Preview</Label>
                    <iframe srcDoc={finalHtmlToSend} title="Final Preview" className="w-full h-80 border rounded-md bg-white" />
                </div>

                <div className="space-y-2 pt-4 border-t">
                    <h3 className="font-semibold">Delivery Health</h3>
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                        <Button variant="outline" size="sm" onClick={runHealthChecks} disabled={checking}>
                            <Loader2 className={`mr-2 h-4 w-4 ${checking ? 'animate-spin' : 'hidden'}`} />
                            {checking ? 'Checking…' : 'Run Checks'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={testPixelUpdate} disabled={testingPixel}>
                            <Loader2 className={`mr-2 h-4 w-4 ${testingPixel ? 'animate-spin' : 'hidden'}`} />
                            {testingPixel ? 'Testing…' : 'Test Pixel Update'}
                        </Button>
                        {health && (
                            <>
                                <Badge variant={health.baseUrlOk ? 'default' : 'secondary'}>Base URL</Badge>
                                <Badge variant={health.pixelReachable ? 'default' : 'secondary'}>Pixel</Badge>
                                <Badge variant={health.sesEnvOk ? 'default' : 'secondary'}>SES Env</Badge>
                                <Badge variant={health.sesConfigSetOk ? 'default' : 'secondary'}>Config Set</Badge>
                            </>
                        )}
                    </div>
                    {health?.webhookEndpoint && (
                        <p className="text-xs text-muted-foreground">
                            SNS HTTPS subscription endpoint: <code className="bg-muted px-1 py-0.5 rounded">{health.webhookEndpoint}</code>
                        </p>
                    )}
                </div>

                {/* ADDED: The entire test email section is restored here */}
                <div className="space-y-2 pt-4 border-t">
                    <h3 className="font-semibold">Send a Test Email</h3>
                    <p className="text-sm text-muted-foreground">
                        This will send a single, personalized preview to the address below using your SMTP settings.
                    </p>
                    <div className="flex gap-2">
                        <Input 
                            type="email" 
                            placeholder="your.test@email.com" 
                            value={testEmail} 
                            onChange={(e) => setTestEmail(e.target.value)} 
                            disabled={isSending} 
                        />
                        <Button onClick={sendTestEmail} disabled={isSending}>
                            <Loader2 className={`mr-2 h-4 w-4 animate-spin ${!isSending && 'hidden'}`} />
                            Send Test
                        </Button>
                    </div>
                </div>

                <div className="space-y-3 pt-4 border-t">
                    <h3 className="text-lg font-bold text-destructive">Launch Campaign</h3>
                    <p className="text-sm text-muted-foreground">
                        {isAutomationEnabled
                            ? "This will start the automated process with reply tracking."
                            : "This will perform a one-time send only. Automated features are disabled."
                        }
                    </p>
                    
                    <Button 
                        size="lg" 
                        className="w-full" 
                        onClick={launchCampaign} 
                        disabled={isSending}
                    >
                        <Loader2 className={`mr-2 h-4 w-4 animate-spin ${!isSending && 'hidden'}`} /> 
                        {isSending ? 'Processing...' : 'Launch Campaign'}
                    </Button>
                </div>
            </CardContent>
            <CardFooter className="flex justify-between">
                <Button variant="outline" onClick={onBack} disabled={isSending}>Back</Button>
            </CardFooter>
        </Card>
    );
}