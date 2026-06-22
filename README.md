# QuickMail - Email Campaign Management Platform

A powerful Next.js application for sending personalized email campaigns with tracking, automated follow-ups, and Google Sheets integration.

## Features

- 📧 **Multi-Provider Email Sending**: Support for SMTP and AWS SES
- 📊 **Google Sheets Integration**: Track campaigns, opens, clicks, and replies
- 🎯 **Email Tracking**: Open tracking, click tracking, and reply detection
- 🤖 **Automated Follow-ups**: AI-powered follow-up emails with configurable rules
- 🎨 **Visual Email Editor**: Drag-and-drop email builder with code editor
- 📈 **Campaign Analytics**: Real-time tracking in Google Sheets
- ⚡ **Async Processing**: AWS SQS integration for large campaigns

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm, yarn, pnpm, or bun
- Google Cloud Service Account (for Sheets API)
- SMTP credentials or AWS SES setup

### Local Development

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd smtp_mail
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env.local` file (see [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for all variables):
   ```bash
   # Required
   GOOGLE_SERVICE_ACCOUNT_KEY_BASE64=<your-base64-encoded-key>
   NEXT_PUBLIC_BASE_URL=http://localhost:3000
   
   # Email Provider
   EMAIL_PROVIDER=smtp
   
   # IMAP (for reply detection)
   IMAP_HOST=imap.gmail.com
   IMAP_PORT=993
   IMAP_USER=your-email@gmail.com
   IMAP_PASS=your-app-password
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Deployment

### Deploy to Vercel

This app is ready for Vercel deployment! See the comprehensive guide:

📖 **[VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md)** - Complete deployment guide

**Quick Deploy:**
1. Push your code to GitHub
2. Import project on [vercel.com/new](https://vercel.com/new)
3. Configure environment variables (see deployment guide)
4. Deploy!

### Environment Variables

See [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md#environment-variables) for complete list.

**Required:**
- `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` - Google Sheets API credentials
- `NEXT_PUBLIC_BASE_URL` - Your app URL
- Email provider config (SMTP or SES)

**Optional:**
- `AWS_SQS_QUEUE_URL` - For async email sending
- `GEMINI_API_KEY` - For AI follow-up generation
- `IMAP_*` - For reply detection

## Project Structure

```
smtp_mail/
├── src/
│   ├── app/              # Next.js app router
│   │   ├── api/          # API routes
│   │   │   ├── send/     # Email sending endpoint
│   │   │   ├── trk/      # Tracking endpoints
│   │   │   └── cron/     # Scheduled jobs
│   │   └── page.tsx      # Main page
│   ├── components/       # React components
│   │   └── wizard/      # Multi-step wizard
│   ├── lib/             # Utilities
│   │   ├── email-providers/  # SMTP/SES providers
│   │   └── sheets.ts    # Google Sheets integration
│   └── store/           # Zustand state management
├── vercel.json          # Vercel configuration
└── next.config.ts       # Next.js configuration
```

## Key Features

### 1. Email Sending
- Support for SMTP and AWS SES
- Personalized emails with `{{variable}}` templating
- Inline CSS processing for email compatibility

### 2. Tracking
- **Open Tracking**: Pixel + link click tracking (Gmail-compatible)
- **Click Tracking**: All links wrapped with tracking
- **Reply Detection**: IMAP-based automatic reply detection

### 3. Google Sheets Integration
- Recipient management
- Campaign tracking
- Real-time status updates

### 4. Automated Follow-ups
- AI-powered follow-up generation (Gemini)
- Configurable rules and delays
- Automatic scheduling via Vercel Cron

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State**: Zustand
- **Email**: Nodemailer (SMTP) / AWS SES
- **Storage**: Google Sheets API
- **Queue**: AWS SQS (optional)
- **AI**: Google Gemini

## Documentation

- **[VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md)** - Complete Vercel deployment guide
- **[AI_FOLLOWUP_GUIDE.md](./AI_FOLLOWUP_GUIDE.md)** - AI follow-up setup guide

## License

[Add your license here]

## Support

For issues and questions, please open a GitHub issue.
