# Deploy Now - Quick Instructions

## Prerequisites

✅ SAM CLI is installed  
✅ AWS credentials are configured  
✅ Build completed successfully  

## Required Information

Before deploying, you need:

1. **Vercel App URL**: Your Vercel app domain (without https://)
   - Example: `your-app.vercel.app`
   - Find it in Vercel Dashboard → Your Project → Settings → Domains

2. **CRON_SECRET_TOKEN**: The secret token you set in Vercel environment variables
   - This should match `CRON_SECRET_TOKEN` in your Vercel project
   - Generate one if you don't have it: `openssl rand -hex 32`

## Deploy Command

Run this command with your values:

```bash
cd aws-lambda

sam deploy \
  --stack-name quickmail-cron-jobs \
  --capabilities CAPABILITY_IAM \
  --region us-east-1 \
  --parameter-overrides \
    ParamVercelAppUrl="YOUR_VERCEL_APP_URL" \
    ParamCronSecretToken="YOUR_SECRET_TOKEN" \
  --confirm-changeset
```

**Replace:**
- `YOUR_VERCEL_APP_URL` with your actual Vercel app URL (e.g., `my-app.vercel.app`)
- `YOUR_SECRET_TOKEN` with your actual CRON_SECRET_TOKEN

## Example

```bash
sam deploy \
  --stack-name quickmail-cron-jobs \
  --capabilities CAPABILITY_IAM \
  --region us-east-1 \
  --parameter-overrides \
    ParamVercelAppUrl="smtp-mail-sigma.vercel.app" \
    ParamCronSecretToken="abc123def456..." \
  --confirm-changeset
```

## Alternative: Use Environment Variables

```bash
export VERCEL_APP_URL="your-app.vercel.app"
export CRON_SECRET_TOKEN="your-secret-token"

sam deploy \
  --stack-name quickmail-cron-jobs \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    ParamVercelAppUrl="$VERCEL_APP_URL" \
    ParamCronSecretToken="$CRON_SECRET_TOKEN" \
  --confirm-changeset
```

## After Deployment

1. **Verify deployment:**
   ```bash
   aws cloudformation describe-stacks \
     --stack-name quickmail-cron-jobs \
     --query 'Stacks[0].StackStatus'
   ```

2. **Test Lambda:**
   ```bash
   aws lambda invoke \
     --function-name quickmail-cron-jobs-CronHandlerFunction-XXXXX \
     --payload '{"endpoint":"check-replies"}' \
     response.json
   ```

3. **View logs:**
   ```bash
   sam logs -n CronHandlerFunction --stack-name quickmail-cron-jobs --tail
   ```

## Troubleshooting

If deployment fails:
- Check AWS credentials: `aws sts get-caller-identity`
- Verify region is correct
- Ensure IAM user has CloudFormation, Lambda, EventBridge permissions

