#!/usr/bin/env node
/**
 * Local IMAP Reply Checker - Runs every 2 minutes
 * 
 * Usage:
 *   node run-imap-checker-local.js
 * 
 * Or with environment variables:
 *   IMAP_HOST=imap.gmail.com IMAP_USER=... node run-imap-checker-local.js
 * 
 * Environment variables are automatically loaded from .env.local or .env files
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env.local or .env files
function loadEnvFile() {
  const envPaths = [
    path.resolve(__dirname, '.env.local'),
    path.resolve(__dirname, '.env'),
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      console.log(`📄 Loading environment variables from: ${path.basename(envPath)}`);
      const envContent = fs.readFileSync(envPath, 'utf8');
      const lines = envContent.split('\n');

      for (const line of lines) {
        const trimmedLine = line.trim();
        // Skip empty lines and comments
        if (!trimmedLine || trimmedLine.startsWith('#')) {
          continue;
        }

        // Parse KEY=VALUE format
        const equalIndex = trimmedLine.indexOf('=');
        if (equalIndex > 0) {
          const key = trimmedLine.substring(0, equalIndex).trim();
          let value = trimmedLine.substring(equalIndex + 1).trim();

          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          // Only set if not already set (env vars take precedence)
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
      return;
    }
  }
  console.log('⚠️  No .env.local or .env file found. Using environment variables only.');
}

// Load environment variables first
loadEnvFile();

// Configuration - can be overridden by environment variables
const config = {
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  spreadsheetId: process.env.DEFAULT_TRACKING_SHEET_ID || process.env.SPREADSHEET_ID,
  sheetName: process.env.DEFAULT_SHEET_NAME || 'Sheet1',
  imapConfig: {
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.IMAP_PORT || '993'),
    user: process.env.IMAP_USER,
    pass: process.env.IMAP_PASS,
    tls: process.env.IMAP_TLS !== 'false',
  },
  intervalMinutes: parseInt(process.env.CHECK_INTERVAL_MINUTES || '2'),
};

// Validate configuration
if (!config.spreadsheetId) {
  console.error('❌ Error: DEFAULT_TRACKING_SHEET_ID or SPREADSHEET_ID must be set');
  console.error('');
  console.error('💡 Solution: Add to your .env.local or .env file:');
  console.error('   DEFAULT_TRACKING_SHEET_ID=your-google-sheet-id');
  console.error('');
  console.error('   Or set as environment variable:');
  console.error('   export DEFAULT_TRACKING_SHEET_ID=your-google-sheet-id');
  process.exit(1);
}

if (!config.imapConfig.user || !config.imapConfig.pass) {
  console.error('❌ Error: IMAP_USER and IMAP_PASS must be set');
  console.error('');
  console.error('💡 Solution: Add to your .env.local or .env file:');
  console.error('   IMAP_HOST=imap.gmail.com');
  console.error('   IMAP_PORT=993');
  console.error('   IMAP_USER=your-email@gmail.com');
  console.error('   IMAP_PASS=your-app-password');
  console.error('');
  console.error('   Or set as environment variables:');
  console.error('   export IMAP_USER=your-email@gmail.com');
  console.error('   export IMAP_PASS=your-app-password');
  process.exit(1);
}

console.log('🚀 Starting Local IMAP Reply Checker');
console.log('=====================================');
console.log(`📧 IMAP Host: ${config.imapConfig.host}`);
console.log(`📧 IMAP User: ${config.imapConfig.user}`);
console.log(`📊 Spreadsheet ID: ${config.spreadsheetId}`);
console.log(`📄 Sheet Name: ${config.sheetName}`);
console.log(`⏰ Check Interval: Every ${config.intervalMinutes} minutes`);
console.log(`🌐 API URL: ${config.apiUrl}`);
console.log('');

// Function to call the IMAP checker endpoint
async function checkReplies() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      imapConfig: config.imapConfig,
    });

    const url = new URL(`${config.apiUrl}/api/cron/check-replies`);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (res.statusCode === 200) {
            console.log(`✅ [${new Date().toLocaleTimeString()}] ${result.message || 'Check completed'}`);
            if (result.results) {
              console.log(`   Checked: ${result.results.checked}, Found: ${result.results.found}, Marked: ${result.results.marked}`);
              if (result.results.errors && result.results.errors.length > 0) {
                console.log(`   ⚠️  Errors: ${result.results.errors.length}`);
                result.results.errors.forEach(err => console.log(`      - ${err}`));
              }
            }
            resolve(result);
          } else {
            console.error(`❌ [${new Date().toLocaleTimeString()}] Error: ${result.error || 'Unknown error'}`);
            reject(new Error(result.error || 'Request failed'));
          }
        } catch (error) {
          console.error(`❌ [${new Date().toLocaleTimeString()}] Parse error:`, error.message);
          console.error(`   Response: ${data.substring(0, 200)}`);
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      console.error(`❌ [${new Date().toLocaleTimeString()}] Request error:`, error.message);
      console.error(`   Make sure Next.js server is running on ${config.apiUrl}`);
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

// Run immediately, then every intervalMinutes
console.log(`🔄 Running first check now...`);
checkReplies().catch(err => {
  console.error('   First check failed:', err.message);
});

// Then run every intervalMinutes
const intervalMs = config.intervalMinutes * 60 * 1000;
setInterval(() => {
  checkReplies().catch(err => {
    // Error already logged in checkReplies
  });
}, intervalMs);

console.log(`⏰ Will check again every ${config.intervalMinutes} minutes`);
console.log('   Press Ctrl+C to stop');
console.log('');

