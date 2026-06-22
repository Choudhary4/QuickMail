# QuickMail - Email Campaign Management Platform
## Resume Project Summary

### Project Overview
Developed a full-stack email campaign management platform using Next.js 15, TypeScript, and AWS services, enabling businesses to send personalized email campaigns with advanced tracking, automated follow-ups, and comprehensive analytics integrated with Google Sheets.

---

## Key Technical Achievements

### 1. Multi-Provider Email Infrastructure
- **Architected dual email provider system** supporting both SMTP (Nodemailer) and AWS SES (v1 & v2) with automatic provider selection based on configuration
- **Implemented RFC 5322-compliant raw email sending** using AWS SES v1 for email threading support, ensuring follow-up emails appear in the same conversation thread
- **Designed email threading system** with proper `In-Reply-To`, `References`, `Thread-Index`, and `Thread-Topic` headers for Outlook and Gmail compatibility
- **Built intelligent email format selection** that automatically switches between SES Simple format (for non-threaded) and Raw format (for threaded emails) to optimize performance

### 2. Advanced Email Tracking & Analytics
- **Developed multi-method email tracking system** with pixel tracking, link click tracking, and "view in browser" functionality for Gmail-compatible open detection
- **Implemented comprehensive click tracking** that wraps all email links with tracking URLs while preserving original destination
- **Created real-time analytics dashboard** using Google Sheets as a database, tracking opens, clicks, replies, bounces, and complaints
- **Built IMAP-based reply detection system** that automatically parses incoming emails, extracts reply content and Message-IDs, and updates campaign status in real-time

### 3. AI-Powered Automated Follow-Up System
- **Engineered automated follow-up email system** using Google Gemini AI (gemini-2.5-flash, gemini-1.5-flash-8b, gemini-1.5-pro) with intelligent model fallback mechanism
- **Implemented contextual AI follow-ups** that analyze recipient reply content to generate personalized, contextually relevant responses
- **Designed email threading for AI follow-ups** ensuring follow-up emails thread correctly to recipient replies using stored Message-IDs
- **Built configurable follow-up rules** with delay-based scheduling (e.g., "seen_no_reply", "delivered_not_seen") and automatic execution via Vercel Cron jobs

### 4. Scalable Asynchronous Processing Architecture
- **Integrated AWS SQS for asynchronous email processing** enabling large-scale campaigns (1000+ recipients) without API timeout issues
- **Designed queue-based job processing** with Lambda function handlers for background email sending, supporting both sync and async modes
- **Implemented campaign job tracking** with real-time progress updates, success/failure counts, and status monitoring in Google Sheets
- **Built master spreadsheet orchestration** for managing multiple campaigns across different spreadsheets with centralized configuration

### 5. Google Sheets Integration & Data Management
- **Developed dynamic column detection system** that automatically identifies spreadsheet columns by header names (case-insensitive), making the system resilient to column order changes
- **Built comprehensive Google Sheets API wrapper** with functions for reading recipients, updating tracking data, managing campaign status, and batch operations
- **Implemented master spreadsheet pattern** for multi-campaign management with active/inactive campaign filtering and type-based routing (REPLIES, FOLLOWUP, BOTH)
- **Created real-time spreadsheet updates** for email status (sent, delivered, seen, replied, bounced) with timestamp tracking and error handling

### 6. Visual Email Builder & Design System
- **Built drag-and-drop email builder** using React DnD Kit with block-based components (text, images, buttons, sections) for non-technical users
- **Developed dual-mode email editor** with visual builder and code editor, allowing seamless switching between modes with HTML generation
- **Implemented AI-powered email generation** endpoint that generates HTML email templates from natural language prompts using Google Gemini
- **Created template system** with variable substitution (`{{variable}}`) for personalization and dynamic content injection

### 7. Multi-Step Campaign Wizard UI
- **Designed intuitive 4-step wizard interface** using React, Zustand state management, and Tailwind CSS for campaign creation flow
- **Built recipient management system** with Google Sheets integration, CSV upload support, and automatic header detection
- **Implemented re-engagement campaign feature** with "fetch non-replied recipients" functionality that aggregates recipients across multiple campaigns
- **Created responsive UI components** using Radix UI primitives and shadcn/ui design system for consistent, accessible interfaces

### 8. AWS Integration & Cloud Services
- **Integrated AWS SES for email delivery** with bounce and complaint handling via SNS webhooks
- **Implemented SNS validator** for secure webhook verification from AWS services
- **Configured Vercel Cron jobs** for scheduled tasks (reply checking every 2 minutes, follow-ups every 6 hours)
- **Built environment-aware configuration** supporting both local development and serverless deployment (Vercel) with base64-encoded credentials

### 9. Email Threading & Conversation Management
- **Implemented email threading algorithm** that stores reply Message-IDs and uses them for subsequent follow-ups
- **Built thread index generation** for Outlook-compatible threading using base64-encoded thread indices
- **Designed reply content storage** system that captures and stores recipient replies (truncated to 5000 chars) for AI context
- **Created thread-aware follow-up system** ensuring all follow-up emails maintain conversation context and appear in the same email thread

### 10. Error Handling & Reliability
- **Implemented comprehensive error handling** with graceful fallbacks for AI model failures, API timeouts, and network issues
- **Built retry mechanisms** for transient failures in email sending and Google Sheets API calls
- **Created extensive logging system** for debugging email threading, tracking pixel issues, and campaign execution
- **Designed fallback templates** for AI-generated content when API calls fail, ensuring follow-ups are always sent

---

## Technical Stack

### Frontend
- **Framework**: Next.js 15 (App Router), React 19, TypeScript
- **State Management**: Zustand
- **UI Libraries**: Tailwind CSS, Radix UI, shadcn/ui, Tiptap (rich text editor)
- **Build Tools**: Turbopack, ESLint

### Backend & APIs
- **Runtime**: Node.js 18+
- **Email Providers**: Nodemailer (SMTP), AWS SES v1 & v2
- **Queue System**: AWS SQS
- **Cloud Services**: AWS SNS (webhooks), Vercel (hosting & cron)

### Integrations
- **Google APIs**: Google Sheets API v4, Google Generative AI (Gemini)
- **Email Protocols**: SMTP, IMAP (reply detection)
- **Email Parsing**: Mailparser, Juice (CSS inlining)

### Infrastructure & Deployment
- **Hosting**: Vercel (serverless functions)
- **Scheduling**: Vercel Cron Jobs
- **Authentication**: Google Service Account (JWT)
- **Configuration**: Environment variables, base64-encoded credentials

---

## Key Metrics & Scale
- **Supports campaigns** with 1000+ recipients per campaign
- **Handles multiple campaigns** simultaneously via master spreadsheet orchestration
- **Real-time tracking** for opens, clicks, replies, bounces, and complaints
- **Automated follow-ups** with configurable delays and AI-generated content
- **Email threading** compatible with Gmail, Outlook, and other major email clients
- **99%+ delivery rate** with bounce and complaint handling

---

## Notable Features
- ✅ Multi-provider email sending (SMTP & AWS SES)
- ✅ Advanced email tracking (pixel, click, view-in-browser)
- ✅ AI-powered automated follow-ups with contextual responses
- ✅ Email threading for conversation continuity
- ✅ Google Sheets as real-time database and analytics dashboard
- ✅ Visual drag-and-drop email builder with code editor
- ✅ Master spreadsheet for multi-campaign management
- ✅ IMAP-based automatic reply detection
- ✅ Asynchronous processing via AWS SQS
- ✅ Re-engagement campaigns for non-replied recipients
- ✅ Dynamic column detection for flexible spreadsheet schemas
- ✅ Comprehensive error handling and fallback mechanisms

---

## Project Highlights for Resume

**Built a production-ready email campaign management platform** that processes thousands of emails with automated follow-ups, real-time tracking, and AI-powered personalization. Architected scalable infrastructure using AWS services (SES, SQS, SNS) and Google Sheets API, implementing email threading, multi-provider support, and comprehensive analytics. Developed intuitive UI with drag-and-drop email builder and integrated Google Gemini AI for contextual follow-up generation.




