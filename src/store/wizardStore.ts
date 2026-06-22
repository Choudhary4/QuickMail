// store/wizardStore.ts
import { create } from 'zustand';
import Papa from 'papaparse';
import { EmailBlock } from '@/lib/types';

// --- INTERFACES ---
export interface SmtpConfig { host: string; port: number; user: string; pass: string; }
export interface ImapConfig { host: string; port: number; user: string; pass: string; }
export interface Recipient { [key: string]: string; }

// --- INITIAL STATE VALUES ---
// const initialElements: AnyCanvasElement[] = [
//   { id: "header-shape-init", type: "shape", style: { top: 0, left: 0, width: 600, height: 80, zIndex: 1, backgroundColor: "#004AAD" } },
//   { id: "header-text-init", type: "text", content: "Your Company", style: { top: 20, left: 20, width: 560, height: 40, zIndex: 2, color: "#FFFFFF", fontSize: 32, fontWeight: "bold", textAlign: "center" } },
// ];
const initialHtmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF--8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>A Special Offer Just For You</title>
    <style>
        /* Basic Resets */
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
        table { border-collapse: collapse !important; }
        body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; }
        
        /* Main Styles */
        body {
            background-color: #f4f4f4;
            font-family: Arial, sans-serif;
        }
    </style>
</head>
<body style="margin: 0 !important; padding: 0 !important; background-color: #f4f4f4;">

    <!-- Main Table -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td align="center" style="background-color: #f4f4f4;">
                
                <!-- Wrapper Table -->
                <table border="0" cellpadding="0" cellspacing="0" width="600" style="width: 100%; max-width: 600px;">
                    
                    <!-- Header Section -->
                    <tr>
                        <td align="center" style="padding: 20px 0; background-color: #004AAD; color: #ffffff;">
                            <h1 style="font-size: 32px; font-weight: bold; margin: 0;">QuickMail</h1>
                        </td>
                    </tr>

                    <!-- Body Section -->
                    <tr>
                        <td align="left" style="padding: 40px 30px; background-color: #ffffff;">
                            <h2 style="font-size: 24px; color: #333333; margin: 0 0 20px 0;">
                                A Special Offer Just For You,!{{firstName}}
                            </h2>
                            <p style="font-size: 16px; color: #555555; line-height: 1.5; margin: 0 0 20px 0;">
                                Thank you for your interest in the <strong>QuickMail</strong>. We've noticed you're a valued customer, and we want to offer you something special to help you get started.
                            </p>
                            <p style="font-size: 16px; color: #555555; line-height: 1.5; margin: 0 0 30px 0;">
                                For a limited time, use the discount code below to get an exclusive offer on your purchase.
                            </p>

                            <!-- Discount Code Block -->
                            <table border="0" cellspacing="0" cellpadding="0" width="100%">
                                <tr>
                                    <td align="center" style="padding: 20px; background-color: #eeeeee; border-radius: 5px;">
                                        <span style="font-size: 22px; font-weight: bold; color: #004AAD; letter-spacing: 2px;">{{discountCode}}</span>
                                    </td>
                                </tr>
                            </table>

                            <!-- Call to Action Button -->
                            <table border="0" cellspacing="0" cellpadding="0" width="100%">
                                <tr>
                                    <td align="center" style="padding: 30px 0 0 0;">
                                        <a href="https://example.com/product-link" target="_blank" style="background-color: #28a745; color: #ffffff; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 18px; font-weight: bold; display: inline-block;">
                                            Shop Now & Save
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Footer Section -->
                    <tr>
                        <td align="center" style="padding: 20px 30px; background-color: #f4f4f4; color: #888888; font-size: 12px;">
                            <p style="margin: 0 0 10px 0;">You received this email because you signed up on our website.</p>
                            <p style="margin: 0;">Your Company Name | 123 Street, City, Country | <a href="https://example.com/unsubscribe" style="color: #888888;">Unsubscribe</a></p>
                        </td>
                    </tr>

                </table>
                <!-- /Wrapper Table -->

            </td>
        </tr>
    </table>
    <!-- /Main Table -->

</body>
</html>`;

const initialEmailBlocks: EmailBlock[] = [
  {
    id: `text-${Date.now()}`,
    type: 'text',
    content: '<h1>Your Awesome Subject Line</h1><p>This is a starting point for your new email. Click on me to edit my content and styles!</p>',
    styles: {
      padding: '20px',
      fontFamily: 'Arial, sans-serif',
      textAlign: 'center',
    }
  },
  {
    id: `button-${Date.now()}`,
    type: 'button',
    content: 'Click Me!',
    link: '#',
    styles: {
      backgroundColor: '#3b82f6',
      color: '#ffffff',
      padding: '12px 24px',
      borderRadius: '6px',
      fontSize: '16px',
      textAlign: 'center',
      margin: '16px auto',
      border: 'none'
    }
  }
];

interface WizardState {
  step: number;
  setStep: (step: number) => void;

  emailProvider: 'smtp' | 'ses';
  setEmailProvider: (provider: 'smtp' | 'ses') => void;

  smtpConfig: SmtpConfig;
  setSmtpConfig: (config: Partial<SmtpConfig>) => void;
  imapConfig: ImapConfig;
  setImapConfig: (config: Partial<ImapConfig>) => void;
  
  // Renamed for clarity
  areConnectionsVerified: boolean;
  setConnectionsVerified: (isVerified: boolean) => void;

  rawCsvData: string;
  recipients: Recipient[];
  headers: string[];
  setRecipientData: (csvData: string) => void;

  googleSheetId: string;
  setGoogleSheetId: (id: string) => void;
  googleSheetTab?: string;
  setGoogleSheetTab: (name?: string) => void;
  
  // Master spreadsheet support
  useMasterSpreadsheet: boolean; // Always true now - master sheet is the only mode
  setUseMasterSpreadsheet: (use: boolean) => void;
  masterSpreadsheetId: string;
  setMasterSpreadsheetId: (id: string) => void;
  masterSheetName: string;
  setMasterSheetName: (name: string) => void;

  subject: string;
  setSubject: (subject: string) => void;
  
  editorMode: 'visual' | 'code';
  setEditorMode: (mode: 'visual' | 'code') => void;
  
  emailBlocks: EmailBlock[];
  setEmailBlocks: (blocks: EmailBlock[]) => void;
  addEmailBlock: (block: EmailBlock) => void;
  updateEmailBlock: (blockId: string, updates: Partial<EmailBlock>) => void;
  deleteEmailBlock: (blockId: string) => void;
  
  htmlContent: string;
  setHtmlContent: (html: string) => void;
}

export const useWizardStore = create<WizardState>((set) => ({
  step: 1,
  setStep: (step) => set({ step }),

  emailProvider: 'smtp',
  setEmailProvider: (provider) => set({ emailProvider: provider }),

  smtpConfig: { host: '', port: 587, user: '', pass: '' },
  setSmtpConfig: (config) => set((state) => ({ smtpConfig: { ...state.smtpConfig, ...config } })),

  imapConfig: { host: '', port: 993, user: '', pass: '' },
  setImapConfig: (config) => set((state) => ({ imapConfig: { ...state.imapConfig, ...config } })),
  
  // Renamed state and setter
  areConnectionsVerified: false,
  setConnectionsVerified: (isVerified) => set({ areConnectionsVerified: isVerified }),

  rawCsvData: '',
  recipients: [],
  headers: [],
  setRecipientData: (csvText: string) => {
    set({ rawCsvData: csvText });
    if (!csvText.trim()) { set({ recipients: [], headers: [] }); return; }
    Papa.parse<Recipient>(csvText.trim(), {
      header: true, skipEmptyLines: true,
      complete: (results) => {
        if (results.data && results.meta.fields) { set({ recipients: results.data, headers: results.meta.fields }); } 
        else { set({ recipients: [], headers: [] }); }
      },
      error: () => set({ recipients: [], headers: [] })
    });
  },

  // Add implementation for Google Sheet ID
  googleSheetId: '',
  setGoogleSheetId: (id) => set({ googleSheetId: id }),
  googleSheetTab: undefined,
  setGoogleSheetTab: (name) => set({ googleSheetTab: name }),
  
  // Master spreadsheet support (always enabled now)
  useMasterSpreadsheet: true,
  setUseMasterSpreadsheet: (use) => set({ useMasterSpreadsheet: use }),
  masterSpreadsheetId: '',
  setMasterSpreadsheetId: (id) => set({ masterSpreadsheetId: id }),
  masterSheetName: 'Sheet1',
  setMasterSheetName: (name) => set({ masterSheetName: name }),

  subject: 'A Special Offer For You!',
  setSubject: (subject) => set({ subject }),
  
  // --- IMPLEMENTATION FOR DUAL-MODE STATE ---
  editorMode: 'visual',
  setEditorMode: (mode) => set({ editorMode: mode }),
  // REFACTOR: Implementation for new block state
  // --- THIS IS THE FIX ---
  // 2. USE the initial state variable here when creating the store.
  emailBlocks: initialEmailBlocks,
  setEmailBlocks: (blocks) => set({ emailBlocks: blocks }),
  addEmailBlock: (block) => set((state) => ({ emailBlocks: [...state.emailBlocks, block] })),
  updateEmailBlock: (blockId, updates) => set((state) => ({
    emailBlocks: state.emailBlocks.map(b => {
      if (b.id === blockId) {
        // Deep merge styles to avoid overwriting nested properties
        const newStyles = updates.styles ? { ...b.styles, ...updates.styles } : b.styles;
        return { ...b, ...updates, styles: newStyles };
      }
      return b;
    })
  })),
  deleteEmailBlock: (blockId) => set((state) => ({
    emailBlocks: state.emailBlocks.filter(b => b.id !== blockId)
  })),
  
  htmlContent: initialHtmlContent,
  setHtmlContent: (html) => set({ htmlContent: html }),
}));