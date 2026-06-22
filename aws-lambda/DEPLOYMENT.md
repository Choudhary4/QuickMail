# SAM CLI Deployment Guide

Deploy the QuickMail cron handler Lambda function using AWS SAM CLI.

## Prerequisites

1. **AWS CLI** installed and configured
   ```bash
   aws configure
   ```

2. **SAM CLI** installed
   ```bash
   # macOS
   brew install aws-sam-cli
   
   # Or using pip
   pip install aws-sam-cli
   ```

3. **Python 3.11+** (for building)

## Quick Deployment

### Step 1: Configure Parameters

Edit `samconfig.toml` or use command-line parameters:

```toml
[default.deploy.parameters]
stack_name = "quickmail-cron-jobs"
region = "us-east-1"  # Change to your preferred region
parameter_overrides = "ParamVercelAppUrl=\"your-app.vercel.app\" ParamCronSecretToken=\"your-secret-token\""
```

**Or set via environment variables:**
```bash
export VERCEL_APP_URL="your-app.vercel.app"
export CRON_SECRET_TOKEN="your-secret-token"
```

### Step 2: Build

```bash
cd aws-lambda
sam build
```

This will:
- Install dependencies (if any)
- Create deployment package
- Prepare template for deployment

### Step 3: Deploy

#### Option A: Guided Deployment (First Time)

```bash
sam deploy --guided
```

This will prompt you for:
- Stack name: `quickmail-cron-jobs`
- AWS Region: `us-east-1` (or your choice)
- Parameter VercelAppUrl: `your-app.vercel.app`
- Parameter CronSecretToken: `your-secret-token`
- Confirm changes: `Y`
- Allow SAM CLI IAM role creation: `Y`
- Save arguments to configuration file: `Y`

#### Option B: Deploy with Config File

```bash
sam deploy
```

This uses the `samconfig.toml` file.

#### Option C: Deploy with Parameters

```bash
sam deploy \
  --stack-name quickmail-cron-jobs \
  --parameter-overrides \
    ParamVercelAppUrl="your-app.vercel.app" \
    ParamCronSecretToken="your-secret-token" \
  --capabilities CAPABILITY_IAM \
  --region us-east-1
```

### Step 4: Verify Deployment

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name quickmail-cron-jobs \
  --query 'Stacks[0].StackStatus'

# List Lambda functions
aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `cron`)].FunctionName'

# List EventBridge rules
aws events list-rules \
  --query 'Rules[?contains(Name, `quickmail`)].Name'
```

## Testing

### Test Lambda Function

```bash
# Invoke function directly
aws lambda invoke \
  --function-name quickmail-cron-jobs-CronHandlerFunction-XXXXX \
  --payload '{"endpoint":"check-replies"}' \
  response.json

cat response.json
```

### Test EventBridge Rule

```bash
# Manually trigger a rule
aws events put-events \
  --entries '[{
    "Source": "manual.test",
    "DetailType": "Test Event",
    "Detail": "{\"endpoint\":\"check-replies\"}"
  }]'
```

### View Logs

```bash
# Tail Lambda logs
sam logs -n CronHandlerFunction --stack-name quickmail-cron-jobs --tail

# Or using AWS CLI
aws logs tail /aws/lambda/quickmail-cron-jobs-CronHandlerFunction-XXXXX --follow
```

## Updating Deployment

### Update Code

1. Make changes to `cron-handler.py`
2. Rebuild:
   ```bash
   sam build
   ```
3. Redeploy:
   ```bash
   sam deploy
   ```

### Update Environment Variables

```bash
sam deploy \
  --parameter-overrides \
    ParamVercelAppUrl="new-app.vercel.app" \
    ParamCronSecretToken="new-token"
```

## Monitoring

### CloudWatch Dashboard

1. Go to [CloudWatch Console](https://console.aws.amazon.com/cloudwatch)
2. Create dashboard or view metrics
3. Monitor:
   - Lambda invocations
   - Errors
   - Duration
   - EventBridge rule executions

### Set Up Alarms

```bash
# Create alarm for Lambda errors
aws cloudwatch put-metric-alarm \
  --alarm-name quickmail-cron-errors \
  --alarm-description "Alert on Lambda errors" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=FunctionName,Value=quickmail-cron-jobs-CronHandlerFunction-XXXXX
```

## Cleanup

### Delete Stack

```bash
sam delete --stack-name quickmail-cron-jobs
```

This will delete:
- Lambda function
- EventBridge rules
- IAM permissions
- CloudWatch log groups

## Troubleshooting

### Build Errors

**Error: "No module named 'samcli'"**
```bash
pip install aws-sam-cli
```

**Error: "Python version not found"**
- Ensure Python 3.11+ is installed
- Check `python3 --version`

### Deployment Errors

**Error: "Stack already exists"**
- Use `sam deploy` to update existing stack
- Or delete stack first: `sam delete`

**Error: "Insufficient permissions"**
- Ensure AWS credentials have CloudFormation, Lambda, EventBridge permissions
- Check IAM user/role permissions

**Error: "Parameter validation failed"**
- Verify `ParamVercelAppUrl` doesn't include `https://`
- Check `ParamCronSecretToken` is set

### Runtime Errors

**Error: "Missing environment variables"**
- Check CloudFormation stack parameters
- Verify environment variables in Lambda console

**Error: "401 Unauthorized"**
- Verify `CRON_SECRET_TOKEN` matches Vercel
- Check token doesn't have extra spaces

## Advanced Configuration

### Custom Region

Edit `samconfig.toml`:
```toml
[default.deploy.parameters]
region = "ap-south-1"  # Your region
```

### Multiple Environments

Create separate configs:
```toml
[production.deploy.parameters]
stack_name = "quickmail-cron-jobs-prod"
region = "us-east-1"

[staging.deploy.parameters]
stack_name = "quickmail-cron-jobs-staging"
region = "us-east-1"
```

Deploy to specific environment:
```bash
sam deploy --config-env production
```

### Custom Schedule

Edit `template.yaml`:
```yaml
CheckRepliesRule:
  Properties:
    ScheduleExpression: rate(5 minutes)  # Change interval
```

Then redeploy:
```bash
sam build && sam deploy
```

## Cost Estimation

**Free Tier (First 12 Months):**
- ✅ 1M Lambda invocations/month - FREE
- ✅ 1M EventBridge events/month - FREE

**After Free Tier:**
- ~21,720 invocations/month = **~$0.03/month**

## Next Steps

1. ✅ Deploy using `sam deploy --guided`
2. ✅ Verify Lambda function is created
3. ✅ Check EventBridge rules are enabled
4. ✅ Test with manual invocation
5. ✅ Monitor CloudWatch logs
6. ✅ Set up CloudWatch alarms (optional)

---

**That's it!** Your cron jobs are now deployed using SAM CLI. 🚀

