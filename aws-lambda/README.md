# AWS Lambda + EventBridge Setup for QuickMail

This directory contains the **Python** AWS Lambda function and setup instructions for running QuickMail cron jobs using AWS EventBridge.

**Note**: This Lambda function calls your Vercel API endpoints. For processing email campaigns from SQS, see `../email-campaign/lambda_processor/`.

## 📦 Deployment

### Quick Deploy with SAM CLI (Recommended)

```bash
cd aws-lambda
sam build
sam deploy --guided
```

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for detailed SAM CLI instructions.

### Manual Setup

See sections below for AWS Console setup.

## 🎯 Why AWS EventBridge + Lambda?

- ✅ **Free Tier**: 1 million Lambda invocations/month (free for 12 months)
- ✅ **1 million EventBridge events/month** (free forever)
- ✅ **Very reliable** (AWS infrastructure)
- ✅ **1-minute minimum interval** (perfect for 2-minute reply check)
- ✅ **Scalable** and production-ready

## 📋 Prerequisites

1. **AWS Account** (free tier eligible)
2. **AWS CLI** installed and configured
3. **Python 3.11+** (for local testing)

## 🚀 Deployment Options

### Option A: SAM CLI (Recommended) ⭐

**Best for**: Infrastructure as code, version control, easy updates

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for complete SAM CLI deployment guide.

**Quick start:**
```bash
cd aws-lambda
sam build
sam deploy --guided
```

### Option B: AWS Console (Manual)

**Best for**: Quick one-time setup, learning AWS

## 🚀 Quick Setup (5 Steps) - Manual Method

### Step 1: Create Lambda Function

#### Option A: Using AWS Console

1. Go to [AWS Lambda Console](https://console.aws.amazon.com/lambda)
2. Click **"Create function"**
3. Choose **"Author from scratch"**
4. **Function name**: `quickmail-cron-handler`
5. **Runtime**: Python 3.11 (or Python 3.12)
6. **Architecture**: x86_64
7. Click **"Create function"**

#### Option B: Using AWS CLI

```bash
aws lambda create-function \
  --function-name quickmail-cron-handler \
  --runtime python3.11 \
  --role arn:aws:iam::YOUR_ACCOUNT_ID:role/lambda-execution-role \
  --handler cron-handler.lambda_handler \
  --zip-file fileb://function.zip \
  --timeout 30 \
  --memory-size 128
```

### Step 2: Upload Function Code

#### Option A: Using AWS Console

1. In Lambda function page, scroll to **"Code source"**
2. Click **"Upload from"** → **".zip file"**
3. Create zip file:
   ```bash
   cd aws-lambda
   zip function.zip cron-handler.py requirements.txt
   ```
4. Upload `function.zip`

#### Option B: Using AWS CLI

```bash
cd aws-lambda
zip function.zip cron-handler.py requirements.txt
aws lambda update-function-code \
  --function-name quickmail-cron-handler \
  --zip-file fileb://function.zip
```

#### Option C: Using Deploy Script

```bash
cd aws-lambda
./deploy.sh quickmail-cron-handler us-east-1
```

### Step 3: Configure Environment Variables

In Lambda function → **Configuration** → **Environment variables**:

```
VERCEL_APP_URL=your-app.vercel.app
CRON_SECRET_TOKEN=your-secret-token-here
```

**Important**: 
- `VERCEL_APP_URL` should NOT include `https://`
- `CRON_SECRET_TOKEN` must match the token in your Vercel environment variables

**Using AWS CLI:**
```bash
aws lambda update-function-configuration \
  --function-name quickmail-cron-handler \
  --environment Variables="{VERCEL_APP_URL=your-app.vercel.app,CRON_SECRET_TOKEN=your-token}"
```

### Step 4: Create EventBridge Rules

#### Rule 1: Check Replies (Every 2 minutes)

**Using AWS Console:**

1. Go to [EventBridge Console](https://console.aws.amazon.com/events)
2. Click **"Create rule"**
3. **Name**: `quickmail-check-replies`
4. **Description**: `Check for email replies every 2 minutes`
5. **Event bus**: default
6. **Rule type**: Schedule
7. **Schedule pattern**: 
   - **Schedule type**: Rate-based schedule
   - **Rate expression**: `2 minutes`
8. **Target**: 
   - **Target type**: AWS service
   - **Select a target**: Lambda function
   - **Function**: `quickmail-cron-handler`
9. **Configure input**:
   - **Event JSON**: 
     ```json
     {
       "endpoint": "check-replies"
     }
     ```
10. Click **"Create"**

**Using AWS CLI:**

```bash
aws events put-rule \
  --name quickmail-check-replies \
  --schedule-expression "rate(2 minutes)" \
  --description "Check for email replies every 2 minutes"

aws lambda add-permission \
  --function-name quickmail-cron-handler \
  --statement-id allow-eventbridge \
  --action 'lambda:InvokeFunction' \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:REGION:ACCOUNT_ID:rule/quickmail-check-replies

aws events put-targets \
  --rule quickmail-check-replies \
  --targets "Id=1,Arn=arn:aws:lambda:REGION:ACCOUNT_ID:function:quickmail-cron-handler,Input='{\"endpoint\":\"check-replies\"}'"
```

#### Rule 2: Send Follow-ups (Every 6 hours)

**Using AWS Console:**

1. Create another rule: **"Create rule"**
2. **Name**: `quickmail-followups`
3. **Description**: `Send follow-up emails every 6 hours`
4. **Schedule pattern**: 
   - **Schedule type**: Cron-based schedule
   - **Cron expression**: `0 */6 * * ? *` (every 6 hours at minute 0)
5. **Target**: Same Lambda function
6. **Configure input**:
   ```json
   {
     "endpoint": "followups"
   }
   ```
7. Click **"Create"**

**Using AWS CLI:**

```bash
aws events put-rule \
  --name quickmail-followups \
  --schedule-expression "cron(0 */6 * * ? *)" \
  --description "Send follow-up emails every 6 hours"

aws lambda add-permission \
  --function-name quickmail-cron-handler \
  --statement-id allow-eventbridge-followups \
  --action 'lambda:InvokeFunction' \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:REGION:ACCOUNT_ID:rule/quickmail-followups

aws events put-targets \
  --rule quickmail-followups \
  --targets "Id=1,Arn=arn:aws:lambda:REGION:ACCOUNT_ID:function:quickmail-cron-handler,Input='{\"endpoint\":\"followups\"}'"
```

### Step 5: Test the Setup

#### Test Lambda Function Directly

1. Go to Lambda function → **Test**
2. Create test event:
   ```json
   {
     "endpoint": "check-replies"
   }
   ```
3. Click **"Test"**
4. Check execution result

#### Test EventBridge Rule

1. Go to EventBridge → Rules
2. Select rule → **"Run rule now"**
3. Check Lambda function logs

#### Verify in Vercel

1. Check Vercel function logs
2. Verify cron jobs are executing
3. Check Google Sheets for updates

## 📊 Monitoring

### CloudWatch Logs

Lambda automatically creates CloudWatch log groups:
- `/aws/lambda/quickmail-cron-handler`

View logs:
```bash
aws logs tail /aws/lambda/quickmail-cron-handler --follow
```

### CloudWatch Metrics

Monitor:
- Invocations
- Errors
- Duration
- Throttles

### Set Up Alarms

1. Go to CloudWatch → Alarms
2. Create alarm for Lambda errors
3. Set up SNS notification (optional)

## 💰 Cost Estimation

### Free Tier (First 12 Months)
- ✅ **1 million Lambda invocations/month** - FREE
- ✅ **400,000 GB-seconds compute time** - FREE
- ✅ **1 million EventBridge events/month** - FREE

### After Free Tier
- **Lambda**: $0.20 per 1M requests
- **Lambda compute**: $0.0000166667 per GB-second
- **EventBridge**: $1.00 per 1M events

### Example Monthly Cost (After Free Tier)

**Assumptions:**
- Reply check: Every 2 minutes = 720/day = 21,600/month
- Follow-ups: Every 6 hours = 4/day = 120/month
- **Total**: ~21,720 invocations/month

**Cost:**
- Lambda invocations: $0.004 (negligible)
- EventBridge: $0.02 (negligible)
- **Total**: ~$0.03/month (practically free!)

## 🔧 Troubleshooting

### Lambda Function Errors

**Error: "Missing environment variables"**
- ✅ Check `VERCEL_APP_URL` and `CRON_SECRET_TOKEN` are set
- ✅ Verify no typos in variable names

**Error: "Network timeout"**
- ✅ Increase Lambda timeout (default 3s, set to 30s)
- ✅ Check Vercel function is accessible

**Error: "401 Unauthorized"**
- ✅ Verify `CRON_SECRET_TOKEN` matches Vercel
- ✅ Check token in URL is correct

### EventBridge Not Triggering

**Rule not running:**
- ✅ Check rule is enabled
- ✅ Verify schedule expression is correct
- ✅ Check Lambda permissions

**Lambda not receiving events:**
- ✅ Verify EventBridge target is configured
- ✅ Check Lambda resource-based policy

### Debugging

**View Lambda logs:**
```bash
aws logs tail /aws/lambda/quickmail-cron-handler --follow
```

**Test Lambda locally:**
```python
# test_lambda.py
import json
from cron_handler import lambda_handler

event = {
    "endpoint": "check-replies"
}

result = lambda_handler(event, None)
print(json.dumps(result, indent=2))
```

## 🔒 Security Best Practices

1. **Use IAM roles** (not access keys) for Lambda
2. **Store secrets** in AWS Secrets Manager (optional upgrade)
3. **Enable VPC** if needed (not required for this use case)
4. **Set up CloudWatch alarms** for errors
5. **Rotate `CRON_SECRET_TOKEN`** periodically

## 📚 Additional Resources

- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [EventBridge Documentation](https://docs.aws.amazon.com/eventbridge/)
- [Lambda Pricing](https://aws.amazon.com/lambda/pricing/)
- [EventBridge Pricing](https://aws.amazon.com/eventbridge/pricing/)

## ✅ Checklist

- [ ] Lambda function created
- [ ] Function code uploaded
- [ ] Environment variables configured
- [ ] EventBridge rule 1 created (check-replies)
- [ ] EventBridge rule 2 created (followups)
- [ ] Lambda permissions configured
- [ ] Tested Lambda function
- [ ] Verified cron jobs running
- [ ] Set up CloudWatch alarms (optional)

---

**That's it!** Your cron jobs are now running on AWS EventBridge + Lambda. 🚀
