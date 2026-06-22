import os
import re
import json
import time
import requests
import smtplib
import email.utils
import boto3
from email.utils import parseaddr
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from google.oauth2 import service_account
from googleapiclient.discovery import build
from imap_tools import MailBox, AND
from premailer import transform
import datetime

# --- CONFIGURATION (Loaded from Lambda Environment Variables) ---
SERVICE_ACCOUNT_FILE = os.getenv('SERVICE_ACCOUNT_FILE', 'hirezapp-e360834ad79b.json')
SECRETS_CLIENT = boto3.client('secretsmanager')
SHEET_NAME = 'Sheet1'
OPENROUTER_API_KEY = os.getenv('OPENROUTER_API_KEY')
SMTP_SERVER = 'smtppro.zoho.in'
SMTP_PORT = 465
IMAP_SERVER = 'imappro.zoho.in'
IMAP_PORT = 993
EMAIL_USER = os.getenv('EMAIL_USER')
EMAIL_PASS = os.getenv('EMAIL_PASS')


def normalize_addr(addr: str) -> str:
    if not addr: return ""
    return parseaddr(addr)[1].strip().lower()

def to_date(dt) -> datetime.date:
    if not dt: return None
    if isinstance(dt, datetime.datetime):
        try:
            return dt.astimezone().date() if dt.tzinfo else dt.date()
        except Exception:
            return dt.date()
    return dt

def safe_parse_sheet_date(s: str):
    try:
        return datetime.datetime.strptime(s.strip(), '%Y-%m-%d').date()
    except Exception:
        return None

def load_email_template():
    try:
        with open('email.html', 'r', encoding='utf-8') as file:
            return file.read()
    except Exception as e:
        print(f"Error loading email template: {e}")
        return None

def get_sheets_service():
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=['https://www.googleapis.com/auth/spreadsheets']
    )
    service = build('sheets', 'v4', credentials=creds, cache_discovery=False)
    return service.spreadsheets()

def ensure_sheet_header(spreadsheet_id, sheet_name='Sheet1'):
    """Ensures the correct header exists in the specified Google Sheet."""
    try:
        sheets = get_sheets_service()
        # The required header, now including the new columns
        header = ['Company Name', 'HR Name', 'HR Email', 'Profile', 'Email Sent', 'Sent Date', 'Replied', 'Reply Date', 'FollowUpCount', 'LastFollowUpDate', 'ConversationStatus']
        
        result = sheets.values().get(spreadsheetId=spreadsheet_id, range=f'{sheet_name}!A1:K1').execute()
        values = result.get('values', [])
        
        if not values or values[0] != header:
            print(f"Header missing or incorrect in sheet {spreadsheet_id}. Creating/updating header.")
            sheets.values().update(
                spreadsheetId=spreadsheet_id,
                range=f'{sheet_name}!A1',
                valueInputOption='RAW',
                body={'values': [header]}
            ).execute()
        else:
            print(f"Header already exists in sheet {spreadsheet_id}.")
    except Exception as e:
        print(f"ERROR: Could not ensure header for sheet {spreadsheet_id}: {e}")

def generate_email_subject(company, profile):
    return f"Transform Your Hiring Process at {company} with HireZapp"

def generate_followup_body(hr_name, company, profile):
    return f"Dear {hr_name},\n\nI'm following up on my previous email about how HireZapp can help streamline your {profile} hiring process at {company}.\n\nDid you get a chance to review the information? I'd be happy to answer any questions or schedule a quick 15-minute demo to show you how our platform works.\n\nLooking forward to hearing from you.\n\nBest regards,\nThe HireZapp Team"

def update_conversation_status(spreadsheet_id, sheet_name='Sheet1'):
    """
    Updates conversation status based on current state of replies and follow-ups.
    """
    sheets = get_sheets_service()
    result = sheets.values().get(spreadsheetId=spreadsheet_id, range=f'{sheet_name}!A2:K').execute()
    rows = result.get('values', [])
    
    if not rows:
        return
    
    updates = []
    today = datetime.date.today()
    
    for idx, row in enumerate(rows, start=2):
        row += [''] * (11 - len(row))
        company, hr_name, hr_email, profile, email_sent, sent_date_str, replied, reply_date_str, followup_count_str, last_followup_date_str, current_status = row
        
        if email_sent.strip().upper() != 'Y':
            continue
            
        new_status = current_status
        
        # Determine new status based on current state
        if replied.strip().upper() == 'Y':
            if 'unsubscribe' in (current_status or '').lower():
                new_status = 'Unsubscribed'
            elif 'ai responded' in (current_status or '').lower():
                new_status = 'AI Responded'
            elif 'needs manual review' in (current_status or '').lower():
                new_status = 'Needs Manual Review'
            else:
                new_status = 'Replied'
        else:
            followup_count = int(followup_count_str or 0)
            if followup_count >= 4:
                new_status = 'Max Follow-ups Reached'
            elif followup_count > 0:
                new_status = f'Follow-up {followup_count}'
            else:
                new_status = 'No Reply'
        
        # Only update if status has changed
        if new_status != current_status:
            updates.append({
                'range': f'{sheet_name}!K{idx}',
                'values': [[new_status]]
            })
            print(f"Row {idx}: {company} - Status updated to: {new_status}")
    
    if updates:
        try:
            body = {'valueInputOption': 'RAW', 'data': updates}
            sheets.values().batchUpdate(spreadsheetId=spreadsheet_id, body=body).execute()
            print(f"Successfully updated {len(updates)} conversation statuses.")
        except Exception as e:
            print(f"Error updating conversation statuses: {e}")

def generate_email(company, hr_name, profile, hr_email="", html_content=""):
    if not html_content: return None
    replacements = {
        "{{COMPANY_NAME}}": company or "your company",
        "{{FIRST_NAME}}": hr_name or "there",
        "{{PROFILE}}": profile or "the role",
        "{{EMAIL}}": hr_email or "hr@example.com"
    }
    email_body = html_content
    for placeholder, value in replacements.items():
        email_body = email_body.replace(placeholder, value)
    return transform(email_body)

def send_email(to_email, subject, body, smtp_config, is_html=False):
    """Sends an email using the provided SMTP configuration."""
    if not all(k in smtp_config for k in ['host', 'port', 'user', 'pass']):
        print(f"ERROR: SMTP configuration is incomplete. Could not send email to {to_email}.")
        return False
        
    msg = MIMEMultipart('alternative')
    msg.attach(MIMEText(body, 'html' if is_html else 'plain', 'utf-8'))
    msg['From'] = email.utils.formataddr(('HireZapp Team', smtp_config['user']))
    msg['To'] = to_email
    msg['Subject'] = subject

    try:
        with smtplib.SMTP_SSL(smtp_config['host'], smtp_config['port']) as server:
            server.login(smtp_config['user'], smtp_config['pass'])
            server.sendmail(smtp_config['user'], to_email, msg.as_string())
        # print(f"Email sent successfully to {to_email}") # This can get noisy, print in the calling function instead.
        return True
    except Exception as e:
        print(f"ERROR: Failed to send email to {to_email} using {smtp_config['user']}: {e}")
        return False

def is_likely_reply(subject, body_snippet="", from_email="", original_subject=""):
    if not subject:
        subject = ""

    subject_lower = subject.lower().strip()

    direct_indicators = [
        're:', 'reply', 'response', 'regarding', 'about your', 'thanks for',
        'thank you for', 'fw:', 'fwd:', 'regarding your email', 'your email'
    ]
    for indicator in direct_indicators:
        if indicator in subject_lower:
            return True

    hirezapp_terms = [
        'hirezapp', 'hiring', 'recruitment', 'opportunity', 'position',
        'job', 'interview', 'resume', 'cv', 'candidate'
    ]
    for term in hirezapp_terms:
        if term in subject_lower:
            return True

    if original_subject:
        original_words = set(original_subject.lower().split())
        subject_words = set(subject_lower.split())
        common_words = original_words.intersection(subject_words)
        if len(common_words) >= 2:
            return True

    if body_snippet:
        body_lower = body_snippet.lower()
        reply_body_indicators = [
            'thank you for reaching out', 'thanks for your email',
            'interested in learning more', 'schedule a call', 'demo',
            'not interested', 'unsubscribe', 'remove me'
        ]
        for indicator in reply_body_indicators:
            if indicator in body_lower:
                return True

    return len(subject_lower) > 0


def list_all_folders(mailbox: MailBox) -> list:
    folders = []
    try:
        for f in mailbox.folder.list():
            folders.append(f.name)
    except Exception as e:
        print(f"Warning: Could not list folders: {e}")
    return folders

def candidate_folders(all_folders: list) -> list:
    
    preferred = []
    lower_set = {f.lower(): f for f in all_folders}

    candidates = [
        "INBOX", "Inbox", "inbox",
        "Junk", "Spam", "Junk E-mail",
        "INBOX.Junk", "INBOX.Spam",
        "[Gmail]/All Mail", "All Mail", "All Mail/"
    ]

    for c in candidates:
        match = lower_set.get(c.lower())
        if match and match not in preferred:
            preferred.append(match)

    if "INBOX" not in preferred and any(f.lower() == "inbox" for f in all_folders):
        preferred.append([f for f in all_folders if f.lower() == "inbox"][0])


    skip_keywords = ["sent", "draft", "trash", "deleted", "archive"]
    filtered = [f for f in preferred if not any(k in f.lower() for k in skip_keywords)]

    if not filtered:
        filtered = ["INBOX"]

    return filtered

def fetch_messages_paranoid(mailbox: MailBox, folders: list, earliest_date: datetime.date):
    for folder in folders:
        try:
            mailbox.folder.set(folder)
            print(f"Scanning folder: {folder}")
            cushion_date = earliest_date - datetime.timedelta(days=1)
            try:

                for msg in mailbox.fetch(AND(date_gte=cushion_date), charset="UTF-8", reverse=True):
                    yield folder, msg
            except Exception:
                
                for msg in mailbox.fetch(AND(all=True), charset="UTF-8", reverse=True):
                    yield folder, msg
        except Exception as e:
            print(f"Warning: Could not open folder '{folder}': {e}")




# In app.py, replace the check_for_replies_and_update function with this FINAL version.

def check_for_replies_and_update(spreadsheet_id, imap_config, smtp_config, openrouter_key):
    """
    Checks for replies via IMAP across multiple folders by fetching ALL messages
    and filtering them in Python for maximum reliability.
    """
    sheets = get_sheets_service()
    result = sheets.values().get(spreadsheetId=spreadsheet_id, range=f'{SHEET_NAME}!A2:K').execute()
    rows = result.get('values', [])
    if not rows: return

    updates = []
    
    try:
        with MailBox(imap_config['host']).login(imap_config['user'], imap_config['pass']) as mailbox:
            hr_contacts = {}
            for idx, row in enumerate(rows, start=2):
                if len(row) < 7: continue
                if row[4].strip().upper() == 'Y' and row[6].strip().upper() != 'Y':
                    hr_email = row[2].strip().lower()
                    sent_dt = safe_parse_sheet_date(row[5])
                    if hr_email and sent_dt:
                        hr_contacts[hr_email] = {'row_idx': idx, 'sent_date': sent_dt, 'company': row[0], 'profile': row[3]}

            if not hr_contacts:
                print("No contacts to monitor for replies.")
                return

            print(f"Monitoring {len(hr_contacts)} contacts for replies...")
            
            folders_to_scan = ["INBOX", "Junk", "Spam"]

            for folder in folders_to_scan:
                if not hr_contacts: break
                try:
                    mailbox.folder.set(folder)
                    print(f"\n--- Scanning folder: {folder} ---")
                    
                    # --- THE CRITICAL CHANGE IS HERE ---
                    # Fetch ALL messages from the folder and filter by date in Python.
                    # This is more reliable than server-side date filtering.
                    for msg in mailbox.fetch(): 
                        print(f"  [DEBUG] Found message UID: {msg.uid}, From: {msg.from_}, Subject: {msg.subject}")
                        from_email = normalize_addr(msg.from_)
                        if from_email in hr_contacts:
                            contact = hr_contacts[from_email]
                            msg_date = to_date(msg.date)
                            
                            # The Python-side date check remains
                            if msg_date >= contact['sent_date']:
                                print(f"  SUCCESS: Reply found from: {from_email} in folder '{folder}'")
                                
                                email_body = msg.text or msg.html
                                email_subject = msg.subject.lower()
                                
                                # --- NEW: Pre-filter for Out-of-Office ---
                                ooo_keywords = ['out of office', 'autoreply', 'automatic reply', 'away from my desk']
                                if any(keyword in email_subject for keyword in ooo_keywords):
                                    print("    -> Detected as Out-of-Office. Flagging as NEUTRAL.")
                                    ai_action = "NEUTRAL"
                                else:
                                    # Only call the AI if it's not an obvious auto-reply
                                    ai_action = process_ai_reply(email_body, openrouter_key)
                                
                                status_update = []
                                if ai_action == "UNSUBSCRIBE":
                                    print("    -> AI classified as UNSUBSCRIBE.")
                                    status_update = ['Y', msg_date.strftime('%Y-%m-%d'), '', '', 'Unsubscribed']
                                elif ai_action == "NEUTRAL":
                                    print("    -> AI classified as NEUTRAL. Flagging for manual review.")
                                    status_update = ['Y', msg_date.strftime('%Y-%m-%d'), '', '', 'Needs Manual Review']
                                else:
                                    print("    -> AI classified as POSITIVE. Sending Calendly link.")
                                    send_email(from_email, f"Re: {msg.subject}", ai_action, smtp_config, is_html=False)
                                    status_update = ['Y', msg_date.strftime('%Y-%m-%d'), '', '', 'AI Responded']

                                updates.append({'range': f'{SHEET_NAME}!G{contact["row_idx"]}:K{contact["row_idx"]}', 'values': [status_update]})
                                del hr_contacts[from_email]
                
                except Exception as e:
                    print(f"  Warning: Could not scan folder '{folder}'. It might not exist. Error: {e}")

    except Exception as e:
        print(f"FATAL: Could not connect to IMAP server or process replies: {e}")
        return

    if updates:
        body = {'valueInputOption': 'RAW', 'data': updates}
        sheets.values().batchUpdate(spreadsheetId=spreadsheet_id, body=body).execute()
        print(f"\nSuccessfully updated {len(updates)} reply records in the Google Sheet.")
    else:
        print("\nNo new replies found to update across all scanned folders.")

# In app.py, replace the old send_follow_up_emails function with this one.
def send_follow_up_emails(spreadsheet_id, smtp_config):
    """
    Sends follow-up emails based on a strict 2-day interval and a 4-email limit.
    This function is designed to be run once daily at 8 AM UTC.
    """
    sheets = get_sheets_service()
    result = sheets.values().get(spreadsheetId=spreadsheet_id, range=f'{SHEET_NAME}!A2:K').execute()
    rows = result.get('values', [])

    if not rows:
        print("No data in sheet for follow-ups.")
        return

    today = datetime.date.today()
    updates = []

    print("\n" + "="*60)
    print(f"CHECKING FOLLOW-UPS FOR {today.strftime('%Y-%m-%d')}")
    print("="*60)

    for idx, row in enumerate(rows, start=2):
        row += [''] * (11 - len(row))
        company, hr_name, hr_email, profile, email_sent, sent_date_str, replied, _, followup_count_str, last_followup_date_str, status = row

        status_lower = (status or '').lower()

        # --- UPDATED CONDITION ---
        if not (email_sent.strip().upper() == 'Y' and
                replied.strip().upper() != 'Y' and
                'unsubscribe' not in status_lower and
                'ai responded' not in status_lower and # Also stop if AI has taken over
                'manual reply sent' not in status_lower and  # <--- NEW CHECK
                hr_email.strip()):
            continue

        followup_count = int(followup_count_str or 0)
        if followup_count >= 4:
            continue

        sent_dt = safe_parse_sheet_date(sent_date_str)
        if not sent_dt:
            continue

        last_contact_date = safe_parse_sheet_date(last_followup_date_str) or sent_dt
        days_passed = (today - last_contact_date).days

        print(f"Row {idx}: {company} - Last contact: {last_contact_date.strftime('%Y-%m-%d')}, Days: {days_passed}, Follow-ups: {followup_count}")

        if days_passed >= 2:
            next_followup_num = followup_count + 1
            followup_subject = f"Re: Opportunity for {profile} at {company}"
            followup_body = generate_followup_body(hr_name, company, profile)

            print(f"  -> SENDING Follow-up #{next_followup_num} to {hr_email}")
            
            # Note: Assumes send_email is refactored to accept smtp_config
            if send_email(hr_email, followup_subject, followup_body, smtp_config, is_html=False):
                updates.append({
                    'range': f'{SHEET_NAME}!I{idx}:J{idx}',
                    'values': [[next_followup_num, today.strftime('%Y-%m-%d')]]
                })
                time.sleep(1)
        else:
            print("  -> Too soon for follow-up.")

    if updates:
        body = {'valueInputOption': 'RAW', 'data': updates}
        sheets.values().batchUpdate(spreadsheetId=spreadsheet_id, body=body).execute()
        print(f"\nSuccessfully applied {len(updates)} follow-up updates to the Google Sheet.")
    else:
        print("\nNo follow-ups were required to be sent today.") 
        

# In app.py, add this new function.
def process_ai_reply(body, openrouter_key):
    """
    Analyzes an email body using OpenRouter AI and returns a specific action.
    """
    your_calendly_link = "https://calendly.com/your-username/15min" # <-- IMPORTANT: CHANGE THIS
    # your_calendly_link = os.getenv('CALENDLY_LINK')
    
    your_company_name = "HireZapp"
    your_name = "Devdeep" # Or whoever the email should be from

    prompt = f"""
    You are an intelligent, friendly, and professional sales assistant for a recruitment technology company called "{your_company_name}".
    Your goal is to book a 15-minute introductory call with interested leads by providing a Calendly link.
    You must analyze the lead's email reply and respond with ONLY ONE of the three options below.

    ## Rules:
    - Keep your responses brief, professional, and friendly.
    - Always sign off with "{your_name} from {your_company_name}".
    - Do not make up information or promise features. Stick to booking the meeting.

    ## Options:

    1.  **POSITIVE RESPONSE:**
        If the lead's reply is positive, shows any interest, or is a polite acknowledgement (e.g., "thanks for the email", "we'll take a look", "sounds interesting"), compose a response that does the following:
        - Acknowledges their reply briefly.
        - Gently nudges them towards the next step (a quick call).
        - Provides the Calendly link: {your_calendly_link}
        - Example: "Thanks for getting back to me! To make it easy to find a time for a quick 15-minute chat, here is a link to my calendar: {your_calendly_link}. I look forward to connecting."

    2.  **NEGATIVE RESPONSE (UNSUBSCRIBE):**
        If the lead's reply is clearly negative, says they are not interested, or asks to be removed/unsubscribed, you MUST respond with ONLY the single word: UNSUBSCRIBE

    3.  **NEUTRAL RESPONSE (NEEDS HUMAN):**
        If the reply is an out-of-office message, an automatic bounce-back, or asks a specific question you cannot answer (e.g., "What is your pricing?", "Do you integrate with X?"), you MUST respond with ONLY the single word: NEUTRAL

    ---
    Lead's Email Reply to Analyze:
    {body}
    ---
    """

    try:
        response = requests.post(
            url="https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {openrouter_key}",
                "Content-Type": "application/json"
            },
            data=json.dumps({
                "model": "mistralai/mistral-7b-instruct:free", # Using a fast, free model
                "messages": [{"role": "user", "content": prompt}]
            })
        )
        response.raise_for_status()
        ai_response = response.json()['choices'][0]['message']['content'].strip()
        
        # Check if the response is a simple keyword or a full email body
        if ai_response.upper() == "UNSUBSCRIBE":
            return "UNSUBSCRIBE"
        elif ai_response.upper() == "NEUTRAL":
            return "NEUTRAL"
        else:
            # Assume it's the email draft to be sent
            return ai_response

    except Exception as e:
        print(f"Error calling OpenRouter AI: {e}")
        return "NEUTRAL" # Default to neutral on error to be safe
    
            
        
def handle_api_request(event):
    """
    Parses campaign configuration from the frontend and saves it to AWS Secrets Manager.
    """
    try:
        config_data = json.loads(event.get('body', '{}'))
        spreadsheet_id = config_data.get('spreadsheet_id')
        if not spreadsheet_id:
            raise ValueError("spreadsheet_id is missing from the payload")
        
        secret_name = f"email-campaign/{spreadsheet_id}"
        secret_string = json.dumps(config_data)

        try:
            SECRETS_CLIENT.update_secret(SecretId=secret_name, SecretString=secret_string)
            message = f'Campaign configuration for {spreadsheet_id} updated successfully!'
        except SECRETS_CLIENT.exceptions.ResourceNotFoundException:
            SECRETS_CLIENT.create_secret(Name=secret_name, Description=f"Config for sheet {spreadsheet_id}", SecretString=secret_string)
            message = f'Campaign configuration for {spreadsheet_id} saved successfully!'

        # If requested, run the campaign immediately after saving
        run_now = bool(config_data.get('run_now'))
        if run_now:
            print(f"run_now requested for {spreadsheet_id}. Executing workflow now...")
            try:
                run_single_campaign_workflow(config_data)
                message = message + ' Immediate run executed.'
            except Exception as e:
                err_msg = f'Immediate run failed: {e}'
                print(err_msg)
                return {
                    'statusCode': 500,
                    'headers': { 'Access-Control-Allow-Origin': '*' },
                    'body': json.dumps({'detail': err_msg})
                }

        return {
            'statusCode': 200,
            'headers': { 'Access-Control-Allow-Origin': '*' }, # Crucial for frontend
            'body': json.dumps({'message': message})
        }
    except Exception as e:
        print(f"Error saving configuration: {e}")
        return {'statusCode': 500, 'headers': { 'Access-Control-Allow-Origin': '*' }, 'body': json.dumps({'detail': str(e)})}

def handle_scheduled_event(event):
    """
    Lists all saved campaign configurations and executes the workflow for each one.
    """
    paginator = SECRETS_CLIENT.get_paginator('list_secrets')
    pages = paginator.paginate(Filters=[{'Key': 'name', 'Values': ['email-campaign/']}])
    
    for page in pages:
        for secret_meta in page.get('SecretList', []):
            secret_name = secret_meta['Name']
            print(f"\n--- Processing campaign: {secret_name} ---")
            response = SECRETS_CLIENT.get_secret_value(SecretId=secret_name)
            campaign_config = json.loads(response['SecretString'])
            run_single_campaign_workflow(campaign_config) # Call the workflow

    return {'statusCode': 200, 'body': json.dumps('All scheduled workflows completed.')}


def send_initial_emails(spreadsheet_id, subject, html_content, smtp_config, sheet_name='Sheet1'):
    """Sends the initial outreach email to new leads in the sheet."""
    print(f"Getting Google Sheets service for spreadsheet: {spreadsheet_id}")
    sheets = get_sheets_service()
    result = sheets.values().get(spreadsheetId=spreadsheet_id, range=f'{sheet_name}!A2:K').execute()
    rows = result.get('values', [])
    print(f"Found {len(rows)} rows in the sheet")
    
    if not rows:
        print("No leads found in the sheet to send initial emails.")
        return

    now_str = datetime.datetime.now().strftime('%Y-%m-%d')
    updates = []
    
    print("\n" + "="*60)
    print("SENDING INITIAL OUTREACH EMAILS")
    print("="*60)

    for idx, row in enumerate(rows, start=2):
        row += [''] * (11 - len(row))
        company, hr_name, hr_email, profile, email_sent, _, _, _, _, _, _ = row
        
        print(f"Row {idx}: Company={company}, HR={hr_name}, Email={hr_email}, Profile={profile}, Sent={email_sent}")

        if email_sent.strip().upper() != 'Y' and hr_email.strip():
            print(f"  - Preparing email for {hr_email} at {company}...")
            
            # Personalize the HTML content
            personalized_html = html_content.replace("{{COMPANY_NAME}}", company or "your company")
            personalized_html = personalized_html.replace("{{FIRST_NAME}}", hr_name or "there")
            personalized_html = personalized_html.replace("{{PROFILE}}", profile or "the role")
            
            final_html = transform(personalized_html) # Inline CSS styles
            print(f"  - Sending email with subject: {subject}")

            if send_email(hr_email, subject, final_html, smtp_config, is_html=True):
                updates.append({'range': f'{sheet_name}!E{idx}:F{idx}', 'values': [['Y', now_str]]})
                print(f"    -> Email sent successfully to {hr_email}")
                time.sleep(1) # Rate limit
            else:
                print(f"    -> FAILED to send email to {hr_email}")
        else:
            if email_sent.strip().upper() == 'Y':
                print(f"  - Skipping {hr_email} (already sent)")
            elif not hr_email.strip():
                print(f"  - Skipping row {idx} (no email address)")

    if updates:
        body = {'valueInputOption': 'RAW', 'data': updates}
        sheets.values().batchUpdate(spreadsheetId=spreadsheet_id, body=body).execute()
        print(f"\nSuccessfully marked {len(updates)} initial emails as sent in the sheet.")
    else:
        print("\nNo new initial emails were sent.")

# In app.py, update this function
def run_single_campaign_workflow(config):
    """
    The main business logic for one campaign.
    FOR TESTING: Reads sensitive credentials from Lambda Environment Variables.
    """
    try:
        # --- Configuration Extraction from Frontend Payload ---
        spreadsheet_id = config['spreadsheet_id']
        sheet_name = config.get('sheet_name', 'Sheet1')
        subject = config['subject']
        html_content = config['html_content']

        # --- Credential Extraction from Environment Variables (The "Testing" Approach) ---
        smtp_user = os.getenv('EMAIL_USER')
        smtp_pass = os.getenv('EMAIL_PASS')
        openrouter_key = os.getenv('OPENROUTER_API_KEY')

        # We must manually build the smtp_config and imap_config dicts here
        if not (smtp_user and smtp_pass):
            raise ValueError("EMAIL_USER and EMAIL_PASS environment variables are not set. Cannot proceed.")

        smtp_config = {
            'host': 'smtppro.zoho.in', # Hardcoded for Zoho for now
            'port': 465,
            'user': smtp_user,
            'pass': smtp_pass
        }
        imap_config = {
            'host': 'imappro.zoho.in', # Hardcoded for Zoho for now
            'port': 993,
            'user': smtp_user,
            'pass': smtp_pass
        }

        print(f"Starting workflow for Sheet ID: {spreadsheet_id}")

        # --- Workflow Steps ---
        # 1. Ensure header is correct
        ensure_sheet_header(spreadsheet_id, sheet_name)
        
        # 2. Check for replies FIRST for ongoing conversations
        if imap_config and openrouter_key:
            print("\nStep 2: Checking for replies...")
            check_for_replies_and_update(spreadsheet_id, imap_config, smtp_config, openrouter_key)
        else:
            print("\nStep 2: Skipping reply check (IMAP/AI key not configured).")

        # 3. THEN, send initial emails to new leads
        print("\nStep 3: Sending initial emails...")
        send_initial_emails(spreadsheet_id, subject, html_content, smtp_config, sheet_name)
        
        # 4. Send sequence follow-ups
        send_follow_up_emails(spreadsheet_id, smtp_config)
        
        # 5. Update conversation status
        update_conversation_status(spreadsheet_id, sheet_name)

        print(f"Finished workflow for Sheet ID: {spreadsheet_id}")
    
    except Exception as e:
        # Adding traceback for better debugging
        import traceback
        print(f"FATAL ERROR during workflow for config {config.get('spreadsheet_id')}: {e}")
        traceback.print_exc()
        
# --- Main Lambda Handler ---

def lambda_handler(event, context):
    """
    Main entry point. Differentiates between an API call to save a new campaign
    and a scheduled event to run all active campaigns.
    """
    # Check if this is an API Gateway event to launch a new campaign
    if 'httpMethod' in event and event['httpMethod'] == 'POST':
        print("--- API Call Received: Saving Campaign Configuration ---")
        return handle_api_request(event)
    
    # Otherwise, assume it's a scheduled event from EventBridge
    else:
        print("--- Scheduled Event Received: Running All Email Workflows ---")
        return handle_scheduled_event(event)