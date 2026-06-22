// src/components/wizard/02-StepRecipients.tsx
"use client";

import { useState, useRef } from 'react';
import { useEffect, useMemo } from 'react';
import { useWizardStore } from '@/store/wizardStore';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input"; // Import Input component
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from "@/components/ui/badge";
import { UploadCloud, FileText, XCircle, Download, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function StepRecipients({ onNext, onBack }: { onNext: () => void, onBack: () => void }) {
  const { 
    recipients, headers, rawCsvData, setRecipientData, 
    googleSheetId, setGoogleSheetId,
    useMasterSpreadsheet, setUseMasterSpreadsheet,
    masterSpreadsheetId, setMasterSpreadsheetId,
    masterSheetName, setMasterSheetName
  } = useWizardStore();
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [availableTabs, setAvailableTabs] = useState<string[]>([]);
  const googleSheetTab = useWizardStore((state) => state.googleSheetTab);
  const setGoogleSheetTab = useWizardStore((state) => state.setGoogleSheetTab);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isFetchingFromMaster, setIsFetchingFromMaster] = useState(false);
  const [fetchOnlyNonReplied, setFetchOnlyNonReplied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processCsvText = (text: string) => {
    // This function will handle both file content and pasted text
    if (!text || text.trim() === '') {
        setRecipientData(''); // Clear everything if input is empty
        return;
    }
    setRecipientData(text);
    // The parsing logic is in Zustand, we just need to wait a moment for the state to update
    // A small timeout helps ensure the UI reflects the result of parsing large files
    setTimeout(() => {
        // The check will be against the store's state after it has been updated
    }, 100);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        processCsvText(text);
        toast.success(`Processed "${file.name}" successfully.`);
      } else {
        toast.error("File appears to be empty.");
        setFileName(null);
      }
    };
    reader.onerror = () => {
        toast.error("Error reading the file.");
        setFileName(null);
    };
    reader.readAsText(file);
    
    // Reset file input to allow uploading the same file again
    event.target.value = '';
  };
  
  const handlePaste = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFileName(null); // Clear file name if user starts pasting
    processCsvText(e.target.value);
  };

  const handleClear = () => {
    setRecipientData('');
    setFileName(null);
  };

  const handleFetchFromSheet = async () => {
    if (!googleSheetId.trim()) {
      return toast.error("Please enter a Google Sheet ID first");
    }

    setIsFetching(true);
    toast.loading("Fetching recipients from Google Sheets...");

    try {
      const response = await fetch('/api/fetch-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          spreadsheetId: googleSheetId,
          sheetName: googleSheetTab || undefined,
        }),
      });

      const data = await response.json();
      toast.dismiss();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch recipients');
      }

      // Load the CSV data into the UI
      processCsvText(data.csvData);
      setFileName(null);
      
      toast.success(`Loaded ${data.count} recipients from Google Sheets!`);
    } catch (error) {
      toast.dismiss();
      if (error instanceof Error) {
        toast.error("Failed to fetch recipients", { description: error.message });
      }
    } finally {
      setIsFetching(false);
    }
  };

  const handleLoadTabs = async () => {
    if (!googleSheetId) {
      toast.error('Please enter a Google Sheet ID');
      return;
    }
    try {
      setLoadingTabs(true);
      const res = await fetch('/api/sheets/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetId: googleSheetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load tabs');
      const tabs: string[] = data.availableSheets || [];
      setAvailableTabs(tabs);
      if (tabs.length && !googleSheetTab) setGoogleSheetTab(tabs[0]);
      toast.success(`Found ${tabs.length} tab${tabs.length === 1 ? '' : 's'}`);
    } catch (e: any) {
      toast.error(e.message || 'Error loading tabs');
    } finally {
      setLoadingTabs(false);
    }
  };

  const handleFetchFromMaster = async () => {
    setIsFetchingFromMaster(true);
    const loadingMsg = fetchOnlyNonReplied 
      ? "Fetching non-replied recipients from master spreadsheet..."
      : "Fetching campaigns from master spreadsheet and loading recipients...";
    toast.loading(loadingMsg);

    try {
      // Master spreadsheet ID comes from environment variable, not user input
      const response = await fetch('/api/fetch-master-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          onlyNonReplied: fetchOnlyNonReplied 
        }),
      });

      const data = await response.json();
      toast.dismiss();

      if (!response.ok) {
        // Show detailed error message if MASTER_SPREADSHEET_ID is not set
        if (data.error && data.error.includes('MASTER_SPREADSHEET_ID')) {
          const errorMsg = data.hint || data.error;
          const instructions = data.instructions || [];
          toast.error(errorMsg, {
            description: instructions.length > 0 
              ? instructions.slice(0, 3).join('\n') + '\n\nSee ENV_SETUP.md for full instructions'
              : 'Please set MASTER_SPREADSHEET_ID in Vercel environment variables and redeploy.',
            duration: 10000, // Show for 10 seconds
          });
          throw new Error(errorMsg);
        }
        throw new Error(data.error || 'Failed to fetch campaigns from master spreadsheet');
      }

      if (data.totalRecipients === 0) {
        toast.warning('No recipients found in active campaigns');
        return;
      }

      // Load the aggregated CSV data into the UI
      processCsvText(data.csvData);
      setFileName(null);
      
      // Set the tracking spreadsheet ID to the first successful campaign's spreadsheet ID
      // This will be used for tracking this launch
      const firstSuccessfulCampaign = data.campaigns.find((c: any) => c.success);
      if (firstSuccessfulCampaign && !googleSheetId) {
        setGoogleSheetId(firstSuccessfulCampaign.spreadsheetId);
        if (firstSuccessfulCampaign.sheetName) {
          setGoogleSheetTab(firstSuccessfulCampaign.sheetName);
        }
      }
      
      const successCount = data.campaigns.filter((c: any) => c.success).length;
      const totalCampaigns = data.campaigns.length;
      const recipientType = fetchOnlyNonReplied ? 'non-replied recipients' : 'recipients';
      
      toast.success(
        `Loaded ${data.totalRecipients} ${recipientType} from ${successCount}/${totalCampaigns} campaigns!`,
        {
          description: successCount < totalCampaigns 
            ? `${totalCampaigns - successCount} campaigns failed to load`
            : firstSuccessfulCampaign 
              ? `Using ${firstSuccessfulCampaign.spreadsheetId} as tracking spreadsheet`
              : undefined
        }
      );
    } catch (error) {
      toast.dismiss();
      if (error instanceof Error) {
        toast.error("Failed to fetch from master spreadsheet", { description: error.message });
      }
    } finally {
      setIsFetchingFromMaster(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 2: Add Your Recipients</CardTitle>
        <CardDescription>Upload a CSV file or paste contacts, then provide the target Google Sheet ID.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
            <Label>Upload a File</Label>
            <div className="flex items-center gap-4">
                <Button type="button" onClick={() => fileInputRef.current?.click()}>
                    <UploadCloud className="mr-2 h-4 w-4" />
                    Select CSV File
                </Button>
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange}
                    className="hidden"
                    accept=".csv, text/csv"
                />
                {fileName && (
                    <div className="flex items-center text-sm text-muted-foreground p-2 bg-muted rounded-md">
                        <FileText className="mr-2 h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{fileName}</span>
                    </div>
                )}
            </div>
        </div>
        
        <div>
          <Label htmlFor="csv-data">Or Paste/Review CSV Data</Label>
          <Textarea
            id="csv-data"
            placeholder="Your CSV content will appear here after uploading or pasting..."
            className="min-h-[150px] font-mono text-sm"
            value={rawCsvData}
            onChange={handlePaste}
          />
        </div>
        
        {/* Master Spreadsheet Configuration */}
        <div className="space-y-4 pt-4 border-t">
              <div className="space-y-4 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-800">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Master Spreadsheet Mode</AlertTitle>
                  <AlertDescription className="text-xs mt-1">
                    The system automatically uses <code className="px-1 py-0.5 bg-muted rounded">MASTER_SPREADSHEET_ID</code> from environment variables.
                    Click "Fetch All Campaigns" to load recipients from all active campaigns listed in the master spreadsheet.
                    Each recipient's tracking data (delivered, replied, status, etc.) will be updated in their respective campaign spreadsheet.
                  </AlertDescription>
                </Alert>
                
                <div className="space-y-2">
                  <Label>Fetch Recipients from Master Spreadsheet</Label>
                  
                  {/* Checkbox for Non-Replied Only */}
                  <div className="flex items-center space-x-2 mb-2">
                    <input
                      type="checkbox"
                      id="onlyNonReplied"
                      checked={fetchOnlyNonReplied}
                      onChange={(e) => setFetchOnlyNonReplied(e.target.checked)}
                      className="rounded"
                    />
                    <label htmlFor="onlyNonReplied" className="text-sm font-medium cursor-pointer">
                      Fetch Non-Replied Recipients Only
                    </label>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button 
                      type="button" 
                      variant="outline"
                      onClick={handleFetchFromMaster}
                      disabled={isFetchingFromMaster}
                      className="w-full"
                    >
                      {isFetchingFromMaster ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Fetching...
                        </>
                      ) : (
                        <>
                          <Download className="mr-2 h-4 w-4" />
                          {fetchOnlyNonReplied ? 'Fetch Non-Replied Recipients' : 'Fetch All Campaigns'}
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The master spreadsheet (configured via <code className="px-1 py-0.5 bg-muted rounded">MASTER_SPREADSHEET_ID</code> env variable) contains a list of all your campaign spreadsheet IDs. 
                    {fetchOnlyNonReplied ? (
                      <> Load only recipients who have <strong>not replied</strong> from all active campaigns.</>
                    ) : (
                      <> Click "Fetch All Campaigns" to load recipients from all active campaigns.</>
                    )}
                    {' '}Each recipient will be tracked in their own campaign spreadsheet.
                  </p>
                </div>

                <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200 dark:border-amber-800">
                  <p className="text-xs font-medium text-amber-900 dark:text-amber-200 mb-1">
                    Master Spreadsheet Format:
                  </p>
                  <div className="text-xs text-amber-800 dark:text-amber-300 font-mono bg-white dark:bg-gray-900 p-2 rounded border">
                    <div className="grid grid-cols-4 gap-2 font-semibold border-b pb-1 mb-1">
                      <div>Campaign Name</div>
                      <div>Spreadsheet ID</div>
                      <div>Sheet Name</div>
                      <div>Active</div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-amber-700 dark:text-amber-400">
                      <div>Hiring Team</div>
                      <div>abc123xyz</div>
                      <div>Sheet1</div>
                      <div>TRUE</div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-amber-700 dark:text-amber-400">
                      <div>SaaS Outreach</div>
                      <div>def456uvw</div>
                      <div>Recipients</div>
                      <div>TRUE</div>
                    </div>
                  </div>
                  <p className="text-xs text-amber-800 dark:text-amber-300 mt-2">
                    <strong>How it works:</strong> Each campaign spreadsheet contains recipient emails. 
                    When you send emails, tracking fields (delivered, deliveredAt, replied, repliedAt, status, etc.) 
                    will be updated in each recipient's respective campaign spreadsheet automatically.
                  </p>
                </div>
              </div>
        </div>

        {recipients.length > 0 && (
          <div className="p-4 bg-muted rounded-md space-y-3">
            <div className="flex justify-between items-center">
                <p className="font-semibold text-green-600">
                  Successfully found {recipients.length} recipients.
                </p>
                <Button variant="ghost" size="sm" onClick={handleClear}>
                    <XCircle className="mr-2 h-4 w-4" /> Clear
                </Button>
            </div>
            <div>
              <span className="font-medium">Available Placeholders:</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {headers.map((header) => (
                  <Badge key={header} variant="secondary">{`{{${header}}}`}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button 
          onClick={onNext} 
          disabled={recipients.length === 0}
        >
          Next
        </Button>
      </CardFooter>
    </Card>
  );
}