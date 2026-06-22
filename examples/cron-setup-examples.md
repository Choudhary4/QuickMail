# Cron Setup Examples

Quick examples for setting up free cron jobs with different services.

## 1. cron-job.org Setup

### Job 1: Check Replies (Every 2 minutes)

**Settings:**
- **Title**: QuickMail - Check Replies
- **URL**: `https://your-app.vercel.app/api/cron/check-replies?token=YOUR_SECRET_TOKEN`
- **Schedule**: `*/2 * * * *` (every 2 minutes)
- **Method**: GET
- **Timeout**: 60 seconds

### Job 2: Send Follow-ups (Every 6 hours)

**Settings:**
- **Title**: QuickMail - Follow-ups
- **URL**: `https://your-app.vercel.app/api/cron/followups?token=YOUR_SECRET_TOKEN`
- **Schedule**: `0 */6 * * *` (every 6 hours at minute 0)
- **Method**: GET
- **Timeout**: 300 seconds

---

## 2. GitHub Actions Setup

See `.github/workflows/cron-jobs.yml` in the repository.

**Required Secrets:**
- `CRON_SECRET_TOKEN` - Your secret token
- `VERCEL_APP_URL` - Your Vercel app URL (e.g., `your-app.vercel.app`)

**Note**: GitHub Actions minimum interval is 5 minutes, so reply checking will run every 5 minutes instead of 2.

---

## 3. EasyCron Setup

Same as cron-job.org, but with additional features:

**Job 1: Check Replies**
- URL: `https://your-app.vercel.app/api/cron/check-replies?token=YOUR_SECRET_TOKEN`
- Schedule: `*/2 * * * *`
- Method: GET
- **Enable**: Email notifications on failure

**Job 2: Send Follow-ups**
- URL: `https://your-app.vercel.app/api/cron/followups?token=YOUR_SECRET_TOKEN`
- Schedule: `0 */6 * * *`
- Method: GET
- **Enable**: Email notifications on failure

---

## 4. AWS EventBridge + Lambda ⭐ (Recommended)

**See complete setup guide**: [`../aws-lambda/README.md`](../aws-lambda/README.md)

### Quick Setup:

1. **Use the Lambda function code** in `aws-lambda/cron-handler.js`
2. **Deploy using AWS Console** or `aws-lambda/deploy.sh` script
3. **Set environment variables**:
   - `VERCEL_APP_URL=your-app.vercel.app`
   - `CRON_SECRET_TOKEN=your-token`

### EventBridge Rules:

**Rule 1: Check Replies (Every 2 minutes)**
- Schedule: `rate(2 minutes)`
- Target: Lambda function (`quickmail-cron-handler`)
- Input: `{"endpoint": "check-replies"}`

**Rule 2: Follow-ups (Every 6 hours)**
- Schedule: `cron(0 */6 * * ? *)`
- Target: Lambda function (`quickmail-cron-handler`)
- Input: `{"endpoint": "followups"}`

### Using AWS CLI:

```bash
# Create function (first time only)
cd aws-lambda
zip function.zip cron-handler.js package.json
aws lambda create-function \
  --function-name quickmail-cron-handler \
  --runtime nodejs20.x \
  --role arn:aws:iam::ACCOUNT_ID:role/lambda-execution-role \
  --handler cron-handler.handler \
  --zip-file fileb://function.zip \
  --timeout 30 \
  --memory-size 128

# Set environment variables
aws lambda update-function-configuration \
  --function-name quickmail-cron-handler \
  --environment Variables="{VERCEL_APP_URL=your-app.vercel.app,CRON_SECRET_TOKEN=your-token}"

# Create EventBridge rules
aws events put-rule \
  --name quickmail-check-replies \
  --schedule-expression "rate(2 minutes)"

aws events put-targets \
  --rule quickmail-check-replies \
  --targets "Id=1,Arn=arn:aws:lambda:REGION:ACCOUNT_ID:function:quickmail-cron-handler,Input='{\"endpoint\":\"check-replies\"}'"
```

**Full guide**: See [`../aws-lambda/README.md`](../aws-lambda/README.md) for complete instructions

---

## 5. Google Cloud Scheduler

### Job 1: Check Replies

```bash
gcloud scheduler jobs create http quickmail-check-replies \
  --schedule="*/2 * * * *" \
  --uri="https://your-app.vercel.app/api/cron/check-replies?token=YOUR_SECRET_TOKEN" \
  --http-method=GET \
  --time-zone="UTC"
```

### Job 2: Follow-ups

```bash
gcloud scheduler jobs create http quickmail-followups \
  --schedule="0 */6 * * *" \
  --uri="https://your-app.vercel.app/api/cron/followups?token=YOUR_SECRET_TOKEN" \
  --http-method=GET \
  --time-zone="UTC"
```

---

## 6. UptimeRobot Setup

**Note**: UptimeRobot has 5-minute minimum, so reply checking will be slower.

### Monitor 1: Check Replies
- Type: HTTP(s)
- URL: `https://your-app.vercel.app/api/cron/check-replies?token=YOUR_SECRET_TOKEN`
- Interval: 5 minutes
- Method: GET

### Monitor 2: Follow-ups
- Type: HTTP(s)
- URL: `https://your-app.vercel.app/api/cron/followups?token=YOUR_SECRET_TOKEN`
- Interval: 6 hours
- Method: GET

---

## Testing Your Setup

### Test with curl:

```bash
# Test reply check
curl "https://your-app.vercel.app/api/cron/check-replies?token=YOUR_SECRET_TOKEN"

# Test follow-ups
curl "https://your-app.vercel.app/api/cron/followups?token=YOUR_SECRET_TOKEN"
```

### Expected Response:

```json
{
  "success": true,
  "message": "Checked 5 emails, found 1 reply, marked 1 as replied",
  "results": {
    "checked": 5,
    "found": 1,
    "marked": 1,
    "errors": []
  }
}
```

---

## Security Checklist

- [ ] Generated strong `CRON_SECRET_TOKEN` (32+ characters)
- [ ] Added token to Vercel environment variables
- [ ] Using HTTPS URLs only
- [ ] Token is in query parameter (for GET) or Authorization header (for POST)
- [ ] Not sharing token publicly
- [ ] Monitoring cron job execution logs

---

## Troubleshooting

### 401 Unauthorized
- Check `CRON_SECRET_TOKEN` is set in Vercel
- Verify token in URL matches Vercel env var
- Check for extra spaces or encoding issues

### 500 Internal Server Error
- Check Vercel function logs
- Verify environment variables are set
- Check Google Sheets API credentials
- Verify IMAP credentials (for reply check)

### Job Not Running
- Verify cron schedule syntax
- Check service-specific logs
- Test endpoint manually with curl
- Verify service account permissions

---

For more details, see [FREE_CRON_ALTERNATIVES.md](../FREE_CRON_ALTERNATIVES.md)

