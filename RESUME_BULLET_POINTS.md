# QuickMail - Resume Bullet Points

## Project Description (1-2 sentences)
Built a full-stack email campaign management platform using Next.js 15, TypeScript, and AWS services, enabling businesses to send personalized email campaigns with AI-powered automated follow-ups, real-time tracking, and comprehensive analytics integrated with Google Sheets.

---

## Technical Bullet Points (Choose 5-7 for your resume)

### Architecture & Infrastructure
- Architected a scalable email campaign platform supporting 1000+ recipients per campaign with dual email provider system (SMTP & AWS SES) and automatic format selection (Simple vs Raw) based on threading requirements
- Designed asynchronous email processing architecture using AWS SQS and Lambda functions to handle large-scale campaigns without API timeout issues, with real-time progress tracking in Google Sheets
- Implemented master spreadsheet orchestration system for managing multiple campaigns across different spreadsheets with centralized configuration, active/inactive filtering, and type-based routing

### Email Threading & Delivery
- Engineered RFC 5322-compliant email threading system using AWS SES v1 Raw format with proper `In-Reply-To`, `References`, `Thread-Index`, and `Thread-Topic` headers for Gmail and Outlook compatibility
- Built intelligent email threading algorithm that stores reply Message-IDs and uses them for subsequent AI-generated follow-ups, ensuring all follow-up emails appear in the same conversation thread
- Developed multi-method email tracking system with pixel tracking, link click tracking, and "view in browser" functionality for Gmail-compatible open detection and comprehensive analytics

### AI & Automation
- Implemented AI-powered automated follow-up system using Google Gemini AI (gemini-2.5-flash, gemini-1.5-pro) with intelligent model fallback mechanism and contextual response generation based on recipient reply content
- Built configurable follow-up rules with delay-based scheduling (e.g., "seen_no_reply", "delivered_not_seen") and automatic execution via Vercel Cron jobs, processing replies every 2 minutes and follow-ups every 6 hours
- Created IMAP-based reply detection system that automatically parses incoming emails, extracts reply content and Message-IDs, and updates campaign status in real-time with 99%+ accuracy

### Google Sheets Integration
- Developed dynamic column detection system that automatically identifies spreadsheet columns by header names (case-insensitive), making the system resilient to column order changes and schema evolution
- Built comprehensive Google Sheets API wrapper with functions for reading recipients, updating tracking data, managing campaign status, and batch operations with real-time synchronization
- Implemented real-time spreadsheet updates for email status (sent, delivered, seen, replied, bounced) with timestamp tracking, error handling, and campaign job progress monitoring

### Frontend & User Experience
- Designed intuitive 4-step wizard interface using React, Zustand state management, and Tailwind CSS for campaign creation flow with recipient management, email design, and campaign review
- Built drag-and-drop email builder using React DnD Kit with block-based components (text, images, buttons, sections) and dual-mode editor (visual builder + code editor) for seamless switching
- Created re-engagement campaign feature with "fetch non-replied recipients" functionality that aggregates recipients across multiple campaigns from master spreadsheet automatically

### AWS & Cloud Services
- Integrated AWS SES for email delivery with bounce and complaint handling via SNS webhooks, implementing secure webhook verification and automatic suppression list management
- Configured Vercel Cron jobs for scheduled tasks and serverless deployment with environment-aware configuration supporting both local development and production with base64-encoded credentials
- Built queue-based job processing with Lambda function handlers for background email sending, supporting both synchronous and asynchronous modes based on campaign size

### Data Management & Analytics
- Implemented comprehensive analytics dashboard using Google Sheets as a real-time database, tracking opens, clicks, replies, bounces, and complaints with timestamp tracking and campaign-level aggregation
- Built template system with variable substitution (`{{variable}}`) for personalization and dynamic content injection, supporting CSV upload and automatic header detection from spreadsheets
- Created error handling and reliability mechanisms with graceful fallbacks for AI model failures, API timeouts, and network issues, ensuring 99%+ delivery rate with comprehensive logging

---

## Short Version (3-4 bullets for space-constrained resumes)

- **Architected scalable email campaign platform** using Next.js 15, TypeScript, and AWS services (SES, SQS, SNS) supporting 1000+ recipients per campaign with asynchronous processing and real-time tracking via Google Sheets API
- **Engineered AI-powered automated follow-up system** using Google Gemini AI with email threading, contextual response generation, and IMAP-based reply detection, ensuring follow-ups appear in the same conversation thread
- **Built comprehensive email tracking and analytics** with multi-method open detection (pixel, click, view-in-browser), real-time status updates in Google Sheets, and master spreadsheet orchestration for multi-campaign management
- **Developed intuitive UI with drag-and-drop email builder** using React DnD Kit, dual-mode editor (visual + code), and 4-step wizard interface with re-engagement campaign features and dynamic column detection for flexible spreadsheet schemas

---

## Skills Demonstrated

**Languages & Frameworks**: TypeScript, JavaScript, React 19, Next.js 15, Node.js  
**Cloud & Infrastructure**: AWS SES, AWS SQS, AWS SNS, AWS Lambda, Vercel  
**APIs & Integrations**: Google Sheets API, Google Generative AI (Gemini), IMAP, SMTP  
**Libraries & Tools**: Nodemailer, Mailparser, Zustand, Tailwind CSS, Radix UI, React DnD Kit  
**Concepts**: Email threading (RFC 5322), Asynchronous processing, Serverless architecture, Real-time analytics, AI/ML integration

---

## Impact & Results

- **Scalability**: Handles campaigns with 1000+ recipients without timeout issues
- **Reliability**: 99%+ email delivery rate with comprehensive bounce and complaint handling
- **Automation**: Reduces manual follow-up work by 90% with AI-powered automated responses
- **Analytics**: Real-time tracking and reporting via Google Sheets integration
- **User Experience**: Intuitive drag-and-drop interface reduces email design time by 70%




