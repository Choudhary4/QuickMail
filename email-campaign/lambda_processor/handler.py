"""
Lambda function to process campaign email sending jobs from SQS queue.
Receives campaign job messages, sends emails to recipients, and updates Google Sheets with progress.
"""

import json
import os
import uuid
import re
from typing import Dict, List, Any
from datetime import datetime
from urllib.parse import urlencode, quote
import boto3
from botocore.exceptions import ClientError
from google.oauth2 import service_account
from googleapiclient.discovery import build

# Initialize AWS clients
ses_client = boto3.client('ses', region_name=os.environ.get('AWS_SES_REGION', 'us-east-1'))
s3_client = boto3.client('s3')

# Google Sheets setup
SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

def get_sheets_service():
    """Initialize Google Sheets API client from service account credentials."""
    creds_json = os.environ.get('GOOGLE_SERVICE_ACCOUNT_KEY')
    if not creds_json:
        raise ValueError('GOOGLE_SERVICE_ACCOUNT_KEY environment variable not set')
    
    creds_dict = json.loads(creds_json)
    # Normalize private_key newlines
    if 'private_key' in creds_dict and isinstance(creds_dict['private_key'], str):
        creds_dict['private_key'] = creds_dict['private_key'].replace('\\n', '\n')
    
    credentials = service_account.Credentials.from_service_account_info(
        creds_dict, scopes=SCOPES
    )
    service = build('sheets', 'v4', credentials=credentials)
    return service

def update_campaign_status(spreadsheet_id: str, campaign_id: str, updates: Dict[str, Any]):
    """Update campaign job status in Google Sheets."""
    try:
        service = get_sheets_service()
        sheet = service.spreadsheets()
        
        # Find the campaign row
        result = sheet.values().get(
            spreadsheetId=spreadsheet_id,
            range='CampaignJobs!A:A'
        ).execute()
        
        rows = result.get('values', [])
        row_num = None
        for idx, row in enumerate(rows):
            if row and row[0] == campaign_id:
                row_num = idx + 1
                break
        
        if not row_num:
            print(f"Campaign {campaign_id} not found in sheet")
            return
        
        # Prepare batch update data
        data = []
        if 'sentCount' in updates:
            data.append({
                'range': f'CampaignJobs!D{row_num}',
                'values': [[updates['sentCount']]]
            })
        if 'failedCount' in updates:
            data.append({
                'range': f'CampaignJobs!E{row_num}',
                'values': [[updates['failedCount']]]
            })
        if 'status' in updates:
            data.append({
                'range': f'CampaignJobs!F{row_num}',
                'values': [[updates['status']]]
            })
        if 'completedAt' in updates:
            data.append({
                'range': f'CampaignJobs!H{row_num}',
                'values': [[updates['completedAt']]]
            })
        if 'error' in updates:
            data.append({
                'range': f'CampaignJobs!I{row_num}',
                'values': [[updates['error']]]
            })
        
        if data:
            sheet.values().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={
                    'valueInputOption': 'RAW',
                    'data': data
                }
            ).execute()
            print(f"Updated campaign {campaign_id} status: {updates}")
    
    except Exception as e:
        print(f"Error updating campaign status: {e}")

def escape_sheet_name(sheet_name: str) -> str:
    """Escape sheet name for use in A1 notation (single quotes if contains special chars)."""
    if not sheet_name:
        return 'Sheet1'  # Default
    
    # If sheet name contains single quote, double them and wrap
    if "'" in sheet_name:
        escaped = sheet_name.replace("'", "''")
        return f"'{escaped}'"
    
    # If sheet name contains spaces or special chars, wrap in single quotes
    # Note: '!' is used in A1 notation (Sheet1!A1), so don't treat it as special
    special_chars = ['@', '#', '$', '%', '^', '&', '*', '(', ')', '+', '=', '[', ']', '{', '}', '|', '\\', ':', ';', '"', '<', '>', ',', '.', '?', '/']
    if ' ' in sheet_name or '-' in sheet_name or any(c in sheet_name for c in special_chars):
        return f"'{sheet_name}'"
    
    # Simple sheet names like "Sheet1" don't need quotes
    return sheet_name

def find_row_by_email(spreadsheet_id: str, email: str, sheet_name: str = 'Sheet1'):
    """Find row number (1-indexed) by email address in column A."""
    try:
        service = get_sheets_service()
        sheet = service.spreadsheets()
        
        # First, get the actual sheet names to verify and use correct one
        actual_sheet_name = sheet_name
        try:
            spreadsheet_meta = sheet.get(spreadsheetId=spreadsheet_id).execute()
            available_sheets = [s['properties']['title'] for s in spreadsheet_meta.get('sheets', [])]
            print(f"Available sheets in spreadsheet {spreadsheet_id}: {available_sheets}")
            
            # If the requested sheet name doesn't exist, use the first available sheet
            if sheet_name not in available_sheets and available_sheets:
                print(f"WARNING: Sheet '{sheet_name}' not found. Using first available sheet: '{available_sheets[0]}'")
                actual_sheet_name = available_sheets[0]
            else:
                actual_sheet_name = sheet_name
        except Exception as meta_error:
            print(f"WARNING: Could not get sheet metadata: {meta_error}")
            # Continue with provided sheet_name
        
        # Build range - use simple format for standard sheet names
        # Google Sheets API expects: "Sheet1!A:A" (no quotes for simple names)
        range_str = f'{actual_sheet_name}!A:A'
        print(f"Searching for email '{email}' in range: {range_str} (spreadsheet: {spreadsheet_id})")
        
        try:
            result = sheet.values().get(
                spreadsheetId=spreadsheet_id,
                range=range_str
            ).execute()
        except Exception as range_error:
            # If range fails, try with escaped sheet name
            if 'Unable to parse range' in str(range_error) or '400' in str(range_error):
                print(f"Range error with '{range_str}', trying escaped version...")
                escaped = escape_sheet_name(actual_sheet_name)
                range_str = f'{escaped}!A:A'
                print(f"Trying escaped range: {range_str}")
                result = sheet.values().get(
                    spreadsheetId=spreadsheet_id,
                    range=range_str
                ).execute()
            else:
                raise
        
        rows = result.get('values', [])
        print(f"Found {len(rows)} rows in column A")
        
        # Log first few emails for debugging
        for idx, row in enumerate(rows[:5]):
            if row and len(row) > 0:
                print(f"  Row {idx + 1}: '{row[0]}'")
        
        # Search for email (case-insensitive)
        search_email = email.strip().lower()
        for idx, row in enumerate(rows):
            if row and len(row) > 0:
                row_email = row[0].strip().lower() if row[0] else ''
                if row_email == search_email:
                    print(f"✅ Found match at row {idx + 1}: '{row[0]}' == '{email}'")
                    return idx + 1
        
        print(f"❌ No match found for email '{email}' in {len(rows)} rows")
        return None
    except Exception as e:
        print(f"Error finding row by email: {e}")
        import traceback
        traceback.print_exc()
        return None

def update_recipient_fields(spreadsheet_id: str, email: str, updates: Dict[str, Any], sheet_name: str = 'Sheet1'):
    """Update multiple fields for a recipient by email address.
    
    Updates are a dict mapping column names to values:
    - emailId -> Column E
    - status -> Column R
    - delivered -> Column F
    - deliveredAt -> Column G
    - seen -> Column H
    - seenAt -> Column I
    - replied -> Column J
    - repliedAt -> Column K
    - bounced -> Column L
    - bounceReason -> Column M
    - complaint -> Column N
    - suppressed -> Column O
    - followUpCount -> Column P
    - lastFollowUpAt -> Column Q
    """
    try:
        service = get_sheets_service()
        sheet = service.spreadsheets()
        
        # First, get the actual sheet names to verify and use correct one
        actual_sheet_name = sheet_name
        try:
            spreadsheet_meta = sheet.get(spreadsheetId=spreadsheet_id).execute()
            available_sheets = [s['properties']['title'] for s in spreadsheet_meta.get('sheets', [])]
            print(f"Available sheets in spreadsheet {spreadsheet_id}: {available_sheets}")
            
            # If the requested sheet name doesn't exist, use the first available sheet
            if sheet_name not in available_sheets and available_sheets:
                print(f"WARNING: Sheet '{sheet_name}' not found. Using first available sheet: '{available_sheets[0]}'")
                actual_sheet_name = available_sheets[0]
            else:
                actual_sheet_name = sheet_name
        except Exception as meta_error:
            print(f"WARNING: Could not get sheet metadata: {meta_error}")
            # Continue with provided sheet_name
        
        # Now find the row using the actual sheet name
        row_num = find_row_by_email(spreadsheet_id, email, actual_sheet_name)
        if not row_num:
            print(f"ERROR: Email '{email}' not found in sheet '{actual_sheet_name}' of spreadsheet '{spreadsheet_id}'")
            return False
        
        print(f"Found email '{email}' at row {row_num} in sheet '{actual_sheet_name}'")
        
        # Column mapping (matching TypeScript SHEET_COLUMNS)
        column_map = {
            'email': 'A',
            'firstName': 'B',
            'productName': 'C',
            'discountCode': 'D',
            'emailId': 'E',
            'delivered': 'F',
            'deliveredAt': 'G',
            'seen': 'H',
            'seenAt': 'I',
            'replied': 'J',
            'repliedAt': 'K',
            'bounced': 'L',
            'bounceReason': 'M',
            'complaint': 'N',
            'suppressed': 'O',
            'followUpCount': 'P',
            'lastFollowUpAt': 'Q',
            'status': 'R'
        }
        
        # Prepare batch update data using the actual sheet name
        data = []
        for field, value in updates.items():
            if field in column_map:
                col_letter = column_map[field]
                # Convert boolean to uppercase string for Google Sheets
                if isinstance(value, bool):
                    value = 'TRUE' if value else 'FALSE'
                
                # Use simple range format - Google Sheets handles "Sheet1!A1" correctly
                # Only escape if sheet name has special characters
                if ' ' in actual_sheet_name or "'" in actual_sheet_name or any(c in actual_sheet_name for c in ['@', '#', '$', '%', '^', '&', '*', '(', ')', '+', '=', '[', ']', '{', '}', '|', '\\', ':', ';', '"', '<', '>', ',', '.', '?', '/', '-']):
                    escaped = escape_sheet_name(actual_sheet_name)
                    range_str = f'{escaped}!{col_letter}{row_num}'
                else:
                    range_str = f'{actual_sheet_name}!{col_letter}{row_num}'
                
                data.append({
                    'range': range_str,
                    'values': [[str(value)]]
                })
                print(f"  Preparing update: {range_str} = {value}")
        
        if data:
            print(f"Updating {len(data)} fields for {email} in spreadsheet {spreadsheet_id}, sheet '{actual_sheet_name}'...")
            try:
                response = sheet.values().batchUpdate(
                    spreadsheetId=spreadsheet_id,
                    body={
                        'valueInputOption': 'RAW',
                        'data': data
                    }
                ).execute()
                print(f"✅ SUCCESS: Updated fields for {email} at row {row_num} in sheet '{actual_sheet_name}': {list(updates.keys())}")
                print(f"Updated values: {updates}")
                return True
            except Exception as update_error:
                print(f"❌ ERROR updating fields: {update_error}")
                import traceback
                traceback.print_exc()
                return False
        else:
            print(f"WARNING: No valid fields to update for {email}")
            return False
    
    except Exception as e:
        print(f"ERROR updating recipient fields for {email}: {e}")
        import traceback
        traceback.print_exc()
        return False

def column_index_to_letter(index: int) -> str:
    """Convert column index (0-based) to Google Sheets column letter (A, B, ..., Z, AA, AB, ...)."""
    result = ''
    index += 1  # Convert to 1-based
    while index > 0:
        index -= 1
        result = chr(65 + (index % 26)) + result
        index //= 26
    return result

def update_master_sheet_status(
    master_spreadsheet_id: str,
    master_sheet_name: str,
    campaign_spreadsheet_id: str,
    updates: Dict[str, Any]
):
    """Update master spreadsheet status for a campaign.
    
    Finds the row in master spreadsheet by matching campaign_spreadsheet_id,
    then updates 'Last Processed' and 'Error' columns.
    """
    try:
        service = get_sheets_service()
        sheet = service.spreadsheets()
        
        # Get available sheets
        spreadsheet_meta = sheet.get(spreadsheetId=master_spreadsheet_id).execute()
        available_sheets = [s['properties']['title'] for s in spreadsheet_meta.get('sheets', [])]
        
        # Use provided sheet name or first available
        actual_sheet_name = master_sheet_name
        if master_sheet_name not in available_sheets and available_sheets:
            print(f"WARNING: Master sheet '{master_sheet_name}' not found. Using first available: '{available_sheets[0]}'")
            actual_sheet_name = available_sheets[0]
        
        # Read headers to find column indices
        header_range = f'{actual_sheet_name}!1:1'
        header_result = sheet.values().get(
            spreadsheetId=master_spreadsheet_id,
            range=header_range
        ).execute()
        
        headers = header_result.get('values', [[]])[0] if header_result.get('values') else []
        print(f"Master sheet headers: {headers}")
        
        # Find column indices (case-insensitive)
        def find_col_index(name: str) -> int:
            name_lower = name.lower().strip()
            for idx, header in enumerate(headers):
                if header and header.lower().strip() == name_lower:
                    return idx
            return -1
        
        # Find "Spreadsheet ID" or "spreadsheetId" column (where we'll search for the campaign)
        spreadsheet_id_col = find_col_index('spreadsheet id')
        if spreadsheet_id_col == -1:
            spreadsheet_id_col = find_col_index('spreadsheetid')
        
        if spreadsheet_id_col == -1:
            print(f"ERROR: Could not find 'Spreadsheet ID' column in master sheet")
            return False
        
        # Find "Last Processed" column
        last_processed_col = find_col_index('last processed')
        if last_processed_col == -1:
            last_processed_col = find_col_index('lastprocessed')
        
        # Find "Error" column
        error_col = find_col_index('error')
        
        # Read all rows to find the matching spreadsheet ID
        data_range = f'{actual_sheet_name}!A:ZZ'
        data_result = sheet.values().get(
            spreadsheetId=master_spreadsheet_id,
            range=data_range
        ).execute()
        
        rows = data_result.get('values', [])
        row_num = None
        
        # Search for matching spreadsheet ID (skip header row)
        for idx, row in enumerate(rows[1:], start=2):  # Start from row 2 (skip header)
            if len(row) > spreadsheet_id_col and row[spreadsheet_id_col]:
                if str(row[spreadsheet_id_col]).strip() == str(campaign_spreadsheet_id).strip():
                    row_num = idx
                    print(f"✅ Found campaign spreadsheet {campaign_spreadsheet_id} at row {row_num}")
                    break
        
        if not row_num:
            print(f"⚠️  WARNING: Campaign spreadsheet {campaign_spreadsheet_id} not found in master sheet")
            return False
        
        # Prepare batch update data
        data = []
        
        if 'lastProcessed' in updates and last_processed_col >= 0:
            col_letter = column_index_to_letter(last_processed_col)
            range_str = f'{actual_sheet_name}!{col_letter}{row_num}'
            data.append({
                'range': range_str,
                'values': [[updates['lastProcessed']]]
            })
            print(f"  Preparing update: {range_str} = {updates['lastProcessed']}")
        
        if 'error' in updates and error_col >= 0:
            col_letter = column_index_to_letter(error_col)
            range_str = f'{actual_sheet_name}!{col_letter}{row_num}'
            data.append({
                'range': range_str,
                'values': [[updates['error']]]
            })
            print(f"  Preparing update: {range_str} = {updates['error']}")
        
        if data:
            sheet.values().batchUpdate(
                spreadsheetId=master_spreadsheet_id,
                body={
                    'valueInputOption': 'RAW',
                    'data': data
                }
            ).execute()
            print(f"✅ Successfully updated master sheet row {row_num} for campaign {campaign_spreadsheet_id}")
            return True
        else:
            print(f"⚠️  No valid columns to update (lastProcessed col: {last_processed_col}, error col: {error_col})")
            return False
            
    except Exception as e:
        print(f"ERROR updating master sheet status: {e}")
        import traceback
        traceback.print_exc()
        return False

def set_email_id_by_email(spreadsheet_id: str, email: str, email_id: str, sheet_name: str = 'Sheet1'):
    """Set emailId in column E for a given email address in column A."""
    print(f"Setting emailId for {email}: {email_id}")
    result = update_recipient_fields(spreadsheet_id, email, {'emailId': email_id}, sheet_name)
    if not result:
        print(f"WARNING: Failed to set emailId for {email}")
    return result

def personalize_html(html: str, recipient: Dict[str, str]) -> str:
    """Replace {{placeholder}} with recipient data."""
    result = html
    for key, value in recipient.items():
        pattern = re.compile(r'\{\{' + re.escape(key) + r'\}\}', re.IGNORECASE)
        result = pattern.sub(value or '', result)
    return result

def inject_open_pixel(html: str, email_id: str, spreadsheet_id: str = None, sheet_name: str = None) -> str:
    """Inject tracking pixel into HTML.
    
    Gmail-friendly approach: Use a visible spacer image that looks legitimate
    instead of hidden tracking pixel (which Gmail blocks).
    """
    base_url = os.environ.get('NEXT_PUBLIC_BASE_URL', '')
    params = f'emailId={email_id}'
    if spreadsheet_id:
        params += f'&sheetId={spreadsheet_id}'
    if sheet_name:
        params += f'&sheetName={sheet_name}'
    
    pixel_url = f'{base_url}/api/trk/open?{params}'
    # Gmail-friendly: visible spacer image that looks legitimate
    pixel_tag = f'''
    <!-- Email spacer for layout -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 20px;">
      <tr>
        <td align="center" style="padding: 0;">
          <img src="{pixel_url}" alt=" " width="1" height="1" style="display: block; width: 1px; height: 1px; border: 0;" />
        </td>
      </tr>
    </table>
    '''
    
    # Insert before closing body tag or append
    if '</body>' in html:
        return html.replace('</body>', f'{pixel_tag}</body>')
    return html + pixel_tag

def inline_css(html: str) -> str:
    """Inline CSS styles (simple version - for production use premailer or similar)."""
    # For now, just return as-is. In production, use a library like premailer
    # or call an external service to inline CSS
    return html

def wrap_links_with_tracking(html: str, email_id: str, spreadsheet_id: str = None, sheet_name: str = None) -> str:
    """Wrap all links in HTML with click tracking that also marks email as seen.
    
    This works even when Gmail blocks pixel tracking.
    """
    base_url = os.environ.get('NEXT_PUBLIC_BASE_URL', '')
    
    # Regex to match <a href="..."> tags
    # Pattern: <a followed by optional attributes, then href="..." or href='...', then optional attributes, then >
    link_pattern = re.compile(
        r'<a\s+([^>]*\s+)?href=["\']([^"\']+)["\']([^>]*)>',
        re.IGNORECASE
    )
    
    def replace_link(match):
        before = match.group(1) or ''
        url = match.group(2)
        after = match.group(3) or ''
        
        # Skip if it's already a tracking link or mailto/tel/anchor links
        if '/api/trk/' in url or url.startswith('mailto:') or url.startswith('tel:') or url.startswith('#'):
            return match.group(0)
        
        # Create tracking URL
        params = {
            'emailId': email_id,
            'url': url
        }
        if spreadsheet_id:
            params['sheetId'] = spreadsheet_id
        if sheet_name:
            params['sheetName'] = sheet_name
        
        tracked_url = f"{base_url}/api/trk/click?{urlencode(params)}"
        
        # Replace href with tracked URL
        return f'<a {before}href="{tracked_url}"{after}>'
    
    return link_pattern.sub(replace_link, html)

def add_view_in_browser_link(html: str, email_id: str, spreadsheet_id: str = None, sheet_name: str = None) -> str:
    """Add "View in browser" link that marks email as seen.
    
    This works even when Gmail blocks pixel tracking.
    """
    base_url = os.environ.get('NEXT_PUBLIC_BASE_URL', '')
    
    from urllib.parse import urlencode
    params = {'emailId': email_id}
    if spreadsheet_id:
        params['sheetId'] = spreadsheet_id
    if sheet_name:
        params['sheetName'] = sheet_name
    
    view_url = f"{base_url}/api/trk/click?{urlencode(params)}"
    
    view_link = f'''
    <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 12px; color: #999;">
      <a href="{view_url}" style="color: #999; text-decoration: none;">View in browser</a>
    </div>
    '''
    
    # Insert before closing body tag or append
    if '</body>' in html:
        return html.replace('</body>', f'{view_link}</body>')
    return html + view_link

def send_email_ses(
    from_address: str,
    to: str,
    subject: str,
    html: str,
    email_id: str,
    spreadsheet_id: str = None,
    sheet_name: str = None,
    configuration_set: str = None
) -> Dict[str, Any]:
    """Send email via AWS SES."""
    try:
        params = {
            'Source': from_address,
            'Destination': {'ToAddresses': [to]},
            'Message': {
                'Subject': {'Data': subject, 'Charset': 'UTF-8'},
                'Body': {'Html': {'Data': html, 'Charset': 'UTF-8'}}
            },
            'Tags': [
                {'Name': 'emailId', 'Value': email_id}
            ]
        }
        
        # Add tracking headers
        if spreadsheet_id:
            params['Tags'].append({'Name': 'sheetId', 'Value': spreadsheet_id})
        if sheet_name:
            params['Tags'].append({'Name': 'sheetName', 'Value': sheet_name})
        
        # Add configuration set for event tracking
        if configuration_set:
            params['ConfigurationSetName'] = configuration_set
        
        response = ses_client.send_email(**params)
        
        return {
            'success': True,
            'messageId': response['MessageId']
        }
    
    except ClientError as e:
        error_msg = e.response['Error']['Message']
        print(f"SES error sending to {to}: {error_msg}")
        return {
            'success': False,
            'error': error_msg
        }
    except Exception as e:
        print(f"Error sending to {to}: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }

def process_campaign_job(job: Dict[str, Any]) -> Dict[str, Any]:
    """Process a single campaign job from SQS."""
    campaign_id = job['campaignId']
    subject = job['subject']
    html_content = job['htmlContent']
    recipients = job['recipients']
    default_spreadsheet_id = job.get('trackingSheetId')  # Fallback if recipient doesn't have one
    default_sheet_name = job.get('trackingSheetName', 'Sheet1')
    from_address = job['fromAddress']
    master_spreadsheet_id = job.get('masterSpreadsheetId')
    master_sheet_name = job.get('masterSheetName', 'Sheet1')
    configuration_set = os.environ.get('AWS_SES_CONFIGURATION_SET')
    
    print(f"Processing campaign {campaign_id} with {len(recipients)} recipients")
    print(f"Master spreadsheet: {master_spreadsheet_id}, default spreadsheet: {default_spreadsheet_id}")
    
    # Update status to processing (use first recipient's spreadsheet or default)
    first_recipient_spreadsheet = None
    if recipients and len(recipients) > 0:
        first_recipient = recipients[0]
        first_recipient_spreadsheet = first_recipient.get('_campaignSpreadsheetId') or default_spreadsheet_id
    
    if first_recipient_spreadsheet:
        update_campaign_status(first_recipient_spreadsheet, campaign_id, {
            'status': 'processing'
        })
    
    results = {
        'sent': 0,
        'failed': 0,
        'errors': []
    }
    
    # Inline CSS once for all recipients
    html_inlined = inline_css(html_content)
    
    for recipient in recipients:
        email = recipient.get('email', '').strip()
        if not email:
            results['failed'] += 1
            results['errors'].append('Missing email address')
            continue
        
        # Use recipient's campaign spreadsheet if available (from master sheet), otherwise use default
        recipient_spreadsheet_id = recipient.get('_campaignSpreadsheetId') or default_spreadsheet_id
        recipient_sheet_name = recipient.get('_campaignSheetName') or default_sheet_name
        
        print(f"Processing recipient {email}")
        print(f"  - Recipient has _campaignSpreadsheetId: {recipient.get('_campaignSpreadsheetId')}")
        print(f"  - Recipient has _campaignSheetName: {recipient.get('_campaignSheetName')}")
        print(f"  - Using spreadsheet: {recipient_spreadsheet_id}")
        print(f"  - Using sheet: {recipient_sheet_name}")
        print(f"  - Default spreadsheet: {default_spreadsheet_id}")
        
        # Log all recipient keys to debug
        recipient_keys = list(recipient.keys())
        print(f"  - Recipient keys: {recipient_keys}")
        if '_campaignSpreadsheetId' not in recipient_keys:
            print(f"  ⚠️  WARNING: _campaignSpreadsheetId not found in recipient! All recipients may use default spreadsheet.")
        
        # Generate unique email ID
        email_id = str(uuid.uuid4())
        
        # Personalize HTML
        html_personalized = personalize_html(html_inlined, recipient)
        
        # Add multiple tracking methods:
        # 1. Pixel tracking (works for non-Gmail clients)
        # 2. Link click tracking (works for Gmail - marks as seen when any link is clicked)
        # 3. "View in browser" link (works for Gmail - marks as seen when clicked)
        html_with_tracking = inject_open_pixel(html_personalized, email_id, recipient_spreadsheet_id, recipient_sheet_name)
        html_with_tracking = wrap_links_with_tracking(html_with_tracking, email_id, recipient_spreadsheet_id, recipient_sheet_name)
        html_with_tracking = add_view_in_browser_link(html_with_tracking, email_id, recipient_spreadsheet_id, recipient_sheet_name)
        
        # Set emailId in recipient's campaign spreadsheet before sending
        if recipient_spreadsheet_id:
            print(f"Setting emailId for {email} in spreadsheet {recipient_spreadsheet_id}...")
            email_id_set = set_email_id_by_email(recipient_spreadsheet_id, email, email_id, recipient_sheet_name)
            if not email_id_set:
                print(f"WARNING: Could not set emailId for {email}, but continuing with send")
        else:
            print(f"WARNING: No spreadsheet_id for recipient {email}, skipping emailId update")
        
        # Send email
        print(f"Sending email to {email}...")
        result = send_email_ses(
            from_address=from_address,
            to=email,
            subject=subject,
            html=html_with_tracking,
            email_id=email_id,
            spreadsheet_id=recipient_spreadsheet_id,
            sheet_name=recipient_sheet_name,
            configuration_set=configuration_set
        )
        
        if result['success']:
            results['sent'] += 1
            print(f"SUCCESS: Email sent to {email}, messageId: {result.get('messageId')}")
            # Update multiple fields immediately after successful send in recipient's campaign spreadsheet
            if recipient_spreadsheet_id:
                print(f"Updating spreadsheet fields for {email} in {recipient_spreadsheet_id} after successful send...")
                update_success = update_recipient_fields(recipient_spreadsheet_id, email, {
                    'status': 'Sent',
                    'delivered': True,  # Mark as delivered since SES accepted it
                    'deliveredAt': datetime.utcnow().isoformat() + 'Z'
                }, recipient_sheet_name)
                if not update_success:
                    print(f"ERROR: Failed to update spreadsheet fields for {email} after successful send")
            else:
                print(f"WARNING: No spreadsheet_id for {email}, skipping field update")
        else:
            results['failed'] += 1
            error_msg = result.get('error', 'Unknown error')
            results['errors'].append(f"{email}: {error_msg}")
            print(f"FAILED: Could not send email to {email}: {error_msg}")
            # Update status to "Failed" if send fails in recipient's campaign spreadsheet
            if recipient_spreadsheet_id:
                print(f"Updating spreadsheet status to 'Failed' for {email} in {recipient_spreadsheet_id}...")
                update_recipient_fields(recipient_spreadsheet_id, email, {
                    'status': 'Failed'
                }, recipient_sheet_name)
        
        # Update progress periodically (every 10 emails) - use first recipient's spreadsheet or default
        if first_recipient_spreadsheet and (results['sent'] + results['failed']) % 10 == 0:
            update_campaign_status(first_recipient_spreadsheet, campaign_id, {
                'sentCount': results['sent'],
                'failedCount': results['failed']
            })
    
    # Final status update in first recipient's spreadsheet or default
    if first_recipient_spreadsheet:
        update_campaign_status(first_recipient_spreadsheet, campaign_id, {
            'sentCount': results['sent'],
            'failedCount': results['failed'],
            'status': 'completed' if results['failed'] == 0 else 'completed',
            'completedAt': datetime.utcnow().isoformat() + 'Z'
        })
    
    # Update master spreadsheet status if provided
    if master_spreadsheet_id:
        try:
            print(f"Updating master spreadsheet {master_spreadsheet_id} for processed campaigns...")
            
            # Collect all unique campaign spreadsheet IDs that were processed
            processed_campaigns = set()
            for recipient in recipients:
                campaign_id = recipient.get('_campaignSpreadsheetId')
                if campaign_id:
                    processed_campaigns.add(campaign_id)
            
            # Also add default spreadsheet if it was used
            if default_spreadsheet_id:
                processed_campaigns.add(default_spreadsheet_id)
            
            print(f"Found {len(processed_campaigns)} unique campaigns to update in master sheet")
            
            # Update each campaign's row in master spreadsheet
            for campaign_spreadsheet_id in processed_campaigns:
                update_master_sheet_status(
                    master_spreadsheet_id,
                    master_sheet_name,
                    campaign_spreadsheet_id,
                    {
                        'lastProcessed': datetime.utcnow().isoformat() + 'Z',
                        'error': '' if results['failed'] == 0 else f"{results['failed']} emails failed"
                    }
                )
            
            print(f"✅ Successfully updated master spreadsheet for {len(processed_campaigns)} campaigns")
        except Exception as e:
            print(f"WARNING: Could not update master spreadsheet status: {e}")
            import traceback
            traceback.print_exc()
    
    print(f"Campaign {campaign_id} completed: {results['sent']} sent, {results['failed']} failed")
    return results

def lambda_handler(event, context):
    """
    AWS Lambda handler for SQS trigger.
    Processes campaign jobs from SQS queue.
    """
    print(f"=== Lambda Invocation Started ===")
    print(f"Event: {json.dumps(event, default=str)}")
    print(f"Received {len(event.get('Records', []))} messages")
    
    if not event.get('Records'):
        print("WARNING: No records in event")
        return {
            'statusCode': 200,
            'body': json.dumps('No records to process')
        }
    
    for idx, record in enumerate(event.get('Records', [])):
        message_body = None
        try:
            print(f"\n=== Processing Message {idx + 1} ===")
            print(f"Record: {json.dumps(record, default=str)}")
            
            # Parse SQS message
            message_body = json.loads(record['body'])
            print(f"Parsed message body: campaignId={message_body.get('campaignId')}, recipients={len(message_body.get('recipients', []))}")
            
            # Process the campaign job
            results = process_campaign_job(message_body)
            
            print(f"✅ SUCCESS: Processed campaign {message_body['campaignId']}: {results}")
        
        except json.JSONDecodeError as e:
            error_msg = f"Failed to parse JSON from SQS message: {e}"
            print(f"❌ ERROR: {error_msg}")
            print(f"Record body: {record.get('body', 'N/A')}")
            # Don't re-raise for JSON errors - message is malformed
            continue
            
        except Exception as e:
            error_msg = str(e)
            print(f"❌ ERROR processing message: {error_msg}")
            import traceback
            traceback.print_exc()
            
            # Update campaign status to failed
            if message_body:
                try:
                    spreadsheet_id = message_body.get('trackingSheetId')
                    campaign_id = message_body.get('campaignId')
                    if spreadsheet_id and campaign_id:
                        print(f"Updating campaign status to 'failed' for {campaign_id}")
                        update_campaign_status(
                            spreadsheet_id,
                            campaign_id,
                            {
                                'status': 'failed',
                                'error': error_msg[:500]  # Limit error length
                            }
                        )
                except Exception as update_error:
                    print(f"Failed to update campaign status: {update_error}")
            
            # Re-raise to trigger SQS retry/DLQ
            raise
    
    print(f"=== Lambda Invocation Completed ===")
    return {
        'statusCode': 200,
        'body': json.dumps('Processed successfully')
    }
