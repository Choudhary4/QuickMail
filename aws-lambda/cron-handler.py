"""
AWS Lambda function to trigger QuickMail cron jobs via Vercel API.

This Lambda function calls your Vercel API endpoints for:
- Reply checking (every 2 minutes)
- Follow-up emails (every 6 hours)

Triggered by AWS EventBridge scheduled rules.
"""

import json
import os
import urllib.request
import urllib.error
from typing import Dict, Any, Optional

def call_vercel_api(url: str) -> Dict[str, Any]:
    """
    Make HTTP GET request to Vercel API endpoint.
    
    Args:
        url: Full URL to Vercel API endpoint with token
        
    Returns:
        Dict with statusCode, body (parsed JSON), and success flag
    """
    try:
        req = urllib.request.Request(url)
        req.add_header('User-Agent', 'AWS-Lambda-QuickMail-Cron/1.0')
        
        with urllib.request.urlopen(req, timeout=30) as response:
            status_code = response.getcode()
            body_bytes = response.read()
            body_str = body_bytes.decode('utf-8')
            
            try:
                body_json = json.loads(body_str)
            except json.JSONDecodeError:
                body_json = {'raw': body_str}
            
            return {
                'statusCode': status_code,
                'body': body_json,
                'success': status_code == 200
            }
    
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8') if e.fp else ''
        try:
            error_json = json.loads(error_body)
        except:
            error_json = {'error': error_body or str(e)}
        
        return {
            'statusCode': e.code,
            'body': error_json,
            'success': False,
            'error': f'HTTP {e.code}: {e.reason}'
        }
    
    except urllib.error.URLError as e:
        return {
            'statusCode': 500,
            'body': {'error': str(e.reason)},
            'success': False,
            'error': f'Network error: {e.reason}'
        }
    
    except Exception as e:
        return {
            'statusCode': 500,
            'body': {'error': str(e)},
            'success': False,
            'error': f'Unexpected error: {str(e)}'
        }

def determine_endpoint(event: Dict[str, Any]) -> str:
    """
    Determine which cron endpoint to call based on EventBridge event.
    
    Args:
        event: Lambda event from EventBridge
        
    Returns:
        Endpoint name: 'check-replies' or 'followups'
    """
    # Check for explicit endpoint in event
    if 'endpoint' in event:
        return event['endpoint']
    
    # Check EventBridge rule name
    if 'resources' in event and len(event['resources']) > 0:
        rule_arn = event['resources'][0]
        rule_name = rule_arn.split('/')[-1] if '/' in rule_arn else rule_arn
        
        if 'followup' in rule_name.lower() or 'follow-up' in rule_name.lower():
            return 'followups'
    
    # Default to check-replies
    return 'check-replies'

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler for EventBridge scheduled events.
    
    Args:
        event: EventBridge event (contains rule info and custom input)
        context: Lambda context object
        
    Returns:
        Dict with statusCode and body
    """
    print(f"Event received: {json.dumps(event, default=str)}")
    
    # Get configuration from environment variables
    vercel_app_url = os.environ.get('VERCEL_APP_URL')
    cron_secret_token = os.environ.get('CRON_SECRET_TOKEN')
    
    if not vercel_app_url or not cron_secret_token:
        error_msg = (
            'Missing required environment variables. '
            'VERCEL_APP_URL and CRON_SECRET_TOKEN must be set.'
        )
        print(f"ERROR: {error_msg}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'success': False,
                'error': error_msg
            })
        }
    
    # Determine which endpoint to call
    endpoint = determine_endpoint(event)
    
    # Build the API URL
    # Remove https:// if present in VERCEL_APP_URL
    clean_url = vercel_app_url.replace('https://', '').replace('http://', '')
    api_url = f'https://{clean_url}/api/cron/{endpoint}?token={cron_secret_token}'
    
    print(f"Calling endpoint: {endpoint}")
    print(f"URL: {api_url.replace(cron_secret_token, '***REDACTED***')}")
    
    # Call Vercel API
    result = call_vercel_api(api_url)
    
    print(f"Response status: {result['statusCode']}")
    print(f"Response body: {json.dumps(result['body'], indent=2)}")
    
    if result['success']:
        return {
            'statusCode': 200,
            'body': json.dumps({
                'success': True,
                'endpoint': endpoint,
                'result': result['body']
            }, indent=2)
        }
    else:
        return {
            'statusCode': result.get('statusCode', 500),
            'body': json.dumps({
                'success': False,
                'endpoint': endpoint,
                'error': result.get('body') or result.get('error', 'Unknown error')
            }, indent=2)
        }

