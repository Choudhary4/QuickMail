"use client";

import { useState, useEffect } from 'react';
import { useWizardStore } from '@/store/wizardStore';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Terminal, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function StepSmtpConfig({ onNext }: { onNext: () => void }) {
  const { 
    smtpConfig, setSmtpConfig, 
    imapConfig, setImapConfig,
    areConnectionsVerified, setConnectionsVerified,
    emailProvider, setEmailProvider
  } = useWizardStore();
  
  const [isLoading, setIsLoading] = useState(false);
  const [isTestingImap, setIsTestingImap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imapTestResult, setImapTestResult] = useState<string | null>(null);
  const [imapFromEnv, setImapFromEnv] = useState(false);
  const [isLoadingImapConfig, setIsLoadingImapConfig] = useState(true);
  const [smtpFromEnv, setSmtpFromEnv] = useState(false);
  const [isLoadingSmtpConfig, setIsLoadingSmtpConfig] = useState(true);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const configType = e.currentTarget.dataset.configType;
    const isPort = name === 'port';
    const parsedValue = isPort ? parseInt(value) || 0 : value;

    if (configType === 'smtp') {
      setSmtpConfig({ [name]: parsedValue });
    } else if (configType === 'imap') {
      setImapConfig({ [name]: parsedValue });
    }
    setConnectionsVerified(false); // Reset verification on any change
    setImapTestResult(null); // Clear IMAP test result when config changes
  };

  // Load IMAP config from environment variables on mount
  useEffect(() => {
    const loadImapConfig = async () => {
      try {
        const response = await fetch('/api/imap-config');
        const data = await response.json();
        
        if (data.configured && data.config) {
          // IMAP is configured via env vars
          setImapFromEnv(true);
          setImapConfig({
            host: data.config.host,
            port: data.config.port,
            user: data.config.user,
            pass: '', // Password is not exposed, will be used server-side
          });
        } else {
          setImapFromEnv(false);
        }
      } catch (error) {
        console.error('Failed to load IMAP config:', error);
        setImapFromEnv(false);
      } finally {
        setIsLoadingImapConfig(false);
      }
    };

    loadImapConfig();
  }, [setImapConfig]);

  // Load SMTP config from environment variables on mount
  useEffect(() => {
    const loadSmtpConfig = async () => {
      try {
        const response = await fetch('/api/smtp-config');
        const data = await response.json();
        
        if (data.configured && data.config) {
          setSmtpFromEnv(true);
          setSmtpConfig({
            host: data.config.host,
            port: data.config.port,
            user: data.config.user,
            pass: '', // Password is not exposed
          });
        } else {
          setSmtpFromEnv(false);
        }
      } catch (error) {
        console.error('Failed to load SMTP config:', error);
        setSmtpFromEnv(false);
      } finally {
        setIsLoadingSmtpConfig(false);
      }
    };

    loadSmtpConfig();
  }, [setSmtpConfig]);

  const handleTestImap = async () => {
    // If IMAP is from env, we don't need to send password (it's server-side)
    // If manual, check if fields are filled
    if (!imapFromEnv && (!imapConfig.host || !imapConfig.user || !imapConfig.pass)) {
      setImapTestResult('Please fill in IMAP host, user, and password');
      return;
    }

    setIsTestingImap(true);
    setImapTestResult(null);
    toast.loading("Testing IMAP connection...");

    try {
      // If IMAP is from env, send empty config (server will use env vars)
      // If manual, send the provided config
      const requestBody: any = {};
      if (!imapFromEnv && imapConfig.host && imapConfig.user) {
        requestBody.imapConfig = {
          host: imapConfig.host,
          port: imapConfig.port || 993,
          user: imapConfig.user,
          pass: imapConfig.pass,
        };
      }
      // If from env, don't send imapConfig - server will use env vars

      const response = await fetch('/api/test-all-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      toast.dismiss();

      if (data.imapSuccess) {
        setImapTestResult('✅ IMAP connection successful!');
        toast.success("IMAP connection verified!");
      } else {
        const errorMsg = data.error || 'IMAP connection failed';
        setImapTestResult(`❌ ${errorMsg}`);
        toast.error("IMAP connection failed", { description: errorMsg });
      }
    } catch (error: unknown) {
      toast.dismiss();
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      setImapTestResult(`❌ ${errorMessage}`);
      toast.error("IMAP test failed", { description: errorMessage });
    } finally {
      setIsTestingImap(false);
    }
  };

  const handleTestConnection = async () => {
    setIsLoading(true);
    setError(null);
    setConnectionsVerified(false);
    toast.loading(emailProvider === 'ses' ? "Verifying AWS credentials..." : "Testing connections...");

    try {
      if (emailProvider === 'ses') {
        // For SES, verify AWS credentials and optionally test IMAP
        const payload: any = { provider: 'ses' };
        
        // Include IMAP config only if manually provided (not from env)
        // If from env, don't send it - server will use env vars automatically
        if (!imapFromEnv && imapConfig && imapConfig.host && imapConfig.user) {
          payload.imapConfig = imapConfig;
        }
        // If imapFromEnv is true, don't include imapConfig - server will use env vars

        const response = await fetch('/api/test-all-connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(errorData?.error || 'AWS credentials not configured properly');
        }

        const data = await response.json();
        toast.dismiss();
        
        if (data.sesSuccess) {
          setConnectionsVerified(true);
          let successMessage = "AWS SES configured successfully!";
          if (data.imapSuccess) {
            successMessage += " IMAP connection also successful.";
          } else if (data.imapSkipped) {
            successMessage += " IMAP was not configured.";
          } else if (data.imapSuccess === false) {
            successMessage += " IMAP connection failed (check credentials).";
          }
          toast.success(successMessage);
        } else {
          throw new Error(data.error || 'AWS SES verification failed.');
        }
      } else {
        // Original SMTP flow
        const payload: any = { provider: 'smtp' };
        
        // Only include SMTP config if not from env
        if (!smtpFromEnv && smtpConfig.host && smtpConfig.user) {
          payload.smtpConfig = smtpConfig;
        }
        
        // Include IMAP config if manually provided (not from env)
        // If from env, don't send it - server will use env vars
        if (!imapFromEnv && imapConfig.host && imapConfig.user) {
          payload.imapConfig = imapConfig;
        }
        // If imapFromEnv is true, don't include imapConfig - server will use env vars

        const response = await fetch('/api/test-all-connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null); 
          throw new Error(errorData?.error || `Request failed with status ${response.status}.`);
        }

        const data = await response.json();
        toast.dismiss();

        if (data.smtpSuccess) {
          setConnectionsVerified(true);
          let successMessage = "SMTP Connection successful!";
          if (data.imapSuccess) {
            successMessage += " IMAP connection also successful.";
          } else if (data.imapSkipped) {
            successMessage += " IMAP was not configured.";
          }
          toast.success(successMessage);
        } else {
          throw new Error(data.error || 'SMTP connection failed.');
        }
      }

    } catch (error: unknown) {
      toast.dismiss();
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      setError(errorMessage);
      toast.error("Connection Failed", { description: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 1: Configure Your Email Account</CardTitle>
        <CardDescription>Provide credentials for sending emails. Reply tracking is optional.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <Terminal className="h-4 w-4" />
          <AlertTitle>Your Credentials Are Secure</AlertTitle>
          <AlertDescription>Your details are sent directly to the backend to run the campaign.</AlertDescription>
        </Alert>

        {/* Provider Selection */}
        <div className="space-y-3 pt-4 border-t">
          <Label>Email Provider</Label>
          <RadioGroup value={emailProvider} onValueChange={(value: 'smtp' | 'ses') => {
            setEmailProvider(value);
            setConnectionsVerified(false);
          }}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="smtp" id="smtp" />
              <Label htmlFor="smtp" className="font-normal cursor-pointer">
                SMTP (Nodemailer) - Use your existing email account
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="ses" id="ses" />
              <Label htmlFor="ses" className="font-normal cursor-pointer">
                AWS SES - High-volume, cost-efficient ($0.10 per 1,000 emails)
              </Label>
            </div>
          </RadioGroup>
        </div>

        {/* SMTP Settings */}
        {emailProvider === 'smtp' && (
          <div className="space-y-4 pt-4 border-t">
            <h3 className="font-semibold text-lg">SMTP Server Configuration</h3>
            {isLoadingSmtpConfig ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Loading SMTP configuration...</span>
              </div>
            ) : smtpFromEnv ? (
              <>
                <Alert>
                  <Terminal className="h-4 w-4" />
                  <AlertTitle>Auto-Configured from Environment</AlertTitle>
                  <AlertDescription>
                    SMTP credentials are loaded from your .env file. No manual input required.
                  </AlertDescription>
                </Alert>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-60">
                  <div className="space-y-2">
                    <Label>SMTP Server Host</Label>
                    <Input value={smtpConfig.host} disabled />
                    <p className="text-xs text-muted-foreground">From: SMTP_HOST</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input value={smtpConfig.port || 587} disabled />
                    <p className="text-xs text-muted-foreground">From: SMTP_PORT (default: 587)</p>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Username / Email</Label>
                    <Input value={smtpConfig.user} disabled />
                    <p className="text-xs text-muted-foreground">From: SMTP_USER</p>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Password</Label>
                    <Input value="••••••••••••••••" disabled />
                    <p className="text-xs text-muted-foreground">From: SMTP_PASS (hidden for security)</p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Enter your email provider's SMTP credentials (Gmail, Outlook, Zoho, etc.)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label htmlFor="smtp-host">SMTP Server Host</Label><Input id="smtp-host" name="host" data-config-type="smtp" value={smtpConfig.host} onChange={handleInputChange} placeholder="smtp.gmail.com" /></div>
                  <div className="space-y-2"><Label htmlFor="smtp-port">Port</Label><Input id="smtp-port" name="port" data-config-type="smtp" type="number" value={smtpConfig.port} onChange={handleInputChange} placeholder="587" /></div>
                  <div className="space-y-2"><Label htmlFor="smtp-user">Username / Email</Label><Input id="smtp-user" name="user" data-config-type="smtp" type="email" value={smtpConfig.user} onChange={handleInputChange} placeholder="you@gmail.com" /></div>
                  <div className="space-y-2"><Label htmlFor="smtp-pass">Password</Label><Input id="smtp-pass" name="pass" data-config-type="smtp" type="password" value={smtpConfig.pass} onChange={handleInputChange} placeholder="App password" /></div>
                </div>
              </>
            )}
          </div>
        )}

        {/* AWS SES Settings */}
        {emailProvider === 'ses' && (
          <div className="space-y-4 pt-4 border-t">
            <h3 className="font-semibold text-lg">AWS SES Configuration</h3>
            <Alert>
              <Terminal className="h-4 w-4" />
              <AlertTitle>Auto-Configured from Environment</AlertTitle>
              <AlertDescription>
                AWS credentials are loaded from your .env file. No manual input required.
              </AlertDescription>
            </Alert>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-60">
              <div className="space-y-2">
                <Label>Region</Label>
                <Input value={process.env.NEXT_PUBLIC_AWS_SES_REGION || "us-east-1"} disabled />
                <p className="text-xs text-muted-foreground">From: AWS_SES_REGION</p>
              </div>
              <div className="space-y-2">
                <Label>Configuration Set</Label>
                <Input value={process.env.NEXT_PUBLIC_AWS_SES_CONFIGURATION_SET || "email-tracking"} disabled />
                <p className="text-xs text-muted-foreground">From: AWS_SES_CONFIGURATION_SET</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>AWS Access Key</Label>
                <Input value="••••••••••••••••" disabled />
                <p className="text-xs text-muted-foreground">From: AWS_ACCESS_KEY_ID (hidden for security)</p>
              </div>
            </div>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Before Using AWS SES</AlertTitle>
              <AlertDescription>
                1. Verify your domain in AWS Console<br />
                2. Create SNS topics and webhooks<br />
                3. Configure environment variables in .env<br />
                <br />
                See <strong>SES_SETUP_GUIDE.md</strong> for complete instructions.
              </AlertDescription>
            </Alert>
          </div>
        )}
        
        {/* IMAP Settings */}
        <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">Reply Checker Settings (IMAP) - Optional</h3>
                <p className="text-sm text-muted-foreground">
                  {imapFromEnv 
                    ? "IMAP configured via environment variables. Configured automatically from .env file."
                    : "Fill these fields to enable automated reply tracking. Leave blank to disable."}
                </p>
              </div>
              {(imapConfig.host && imapConfig.user) && !isLoadingImapConfig && (
                <Button 
                  type="button"
                  variant="outline" 
                  size="sm"
                  onClick={handleTestImap}
                  disabled={isTestingImap}
                >
                  {isTestingImap ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Test IMAP
                </Button>
              )}
            </div>
            
            {isLoadingImapConfig ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Loading IMAP configuration...</span>
              </div>
            ) : imapFromEnv ? (
              <>
                <Alert>
                  <Terminal className="h-4 w-4" />
                  <AlertTitle>Auto-Configured from Environment</AlertTitle>
                  <AlertDescription>
                    IMAP credentials are loaded from your .env file. No manual input required.
                  </AlertDescription>
                </Alert>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-60">
                  <div className="space-y-2">
                    <Label>IMAP Server Host</Label>
                    <Input value={imapConfig.host} disabled />
                    <p className="text-xs text-muted-foreground">From: IMAP_HOST</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input value={imapConfig.port || 993} disabled />
                    <p className="text-xs text-muted-foreground">From: IMAP_PORT (default: 993)</p>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Username / Email</Label>
                    <Input value={imapConfig.user} disabled />
                    <p className="text-xs text-muted-foreground">From: IMAP_USER</p>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Password</Label>
                    <Input value="••••••••••••••••" disabled />
                    <p className="text-xs text-muted-foreground">From: IMAP_PASS (hidden for security)</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2"><Label htmlFor="imap-host">IMAP Server Host</Label><Input id="imap-host" name="host" data-config-type="imap" value={imapConfig.host} onChange={handleInputChange} placeholder="imap.gmail.com" /></div>
                <div className="space-y-2"><Label htmlFor="imap-port">Port</Label><Input id="imap-port" name="port" data-config-type="imap" type="number" value={imapConfig.port} onChange={handleInputChange} placeholder="993" /></div>
                <div className="space-y-2"><Label htmlFor="imap-user">Username / Email</Label><Input id="imap-user" name="user" data-config-type="imap" type="email" value={imapConfig.user} onChange={handleInputChange} placeholder="you@gmail.com" /></div>
                <div className="space-y-2"><Label htmlFor="imap-pass">Password</Label><Input id="imap-pass" name="pass" data-config-type="imap" type="password" value={imapConfig.pass} onChange={handleInputChange} placeholder="App password" /></div>
              </div>
            )}
            
            {imapTestResult && (
              <Alert variant={imapTestResult.includes('successful') ? 'default' : 'destructive'}>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{imapTestResult}</AlertDescription>
              </Alert>
            )}
        </div>

        {error && (<Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Connection Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>)}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={handleTestConnection} disabled={isLoading}>
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} 
          {emailProvider === 'ses' ? 'Verify AWS Credentials' : 'Test Connection(s)'}
        </Button>
        <Button onClick={onNext} disabled={!areConnectionsVerified}>Next</Button>
      </CardFooter>
    </Card>
  );
}