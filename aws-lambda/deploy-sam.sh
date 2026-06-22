#!/bin/bash
# Quick deployment script using SAM CLI

set -e

echo "🚀 Deploying QuickMail Cron Jobs with SAM CLI"
echo "=============================================="
echo ""

# Check if SAM CLI is installed
if ! command -v sam &> /dev/null; then
    echo "❌ Error: SAM CLI is not installed"
    echo "   Install from: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
    echo ""
    echo "   macOS: brew install aws-sam-cli"
    echo "   Or: pip install aws-sam-cli"
    exit 1
fi

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ Error: AWS CLI is not configured"
    echo "   Run: aws configure"
    exit 1
fi

# Get parameters from environment or prompt
VERCEL_APP_URL=${VERCEL_APP_URL:-""}
CRON_SECRET_TOKEN=${CRON_SECRET_TOKEN:-""}

if [ -z "$VERCEL_APP_URL" ]; then
    read -p "Enter Vercel App URL (without https://): " VERCEL_APP_URL
fi

if [ -z "$CRON_SECRET_TOKEN" ]; then
    read -sp "Enter CRON_SECRET_TOKEN: " CRON_SECRET_TOKEN
    echo ""
fi

# Remove https:// if present
VERCEL_APP_URL=$(echo "$VERCEL_APP_URL" | sed 's|https://||' | sed 's|http://||')

echo ""
echo "Configuration:"
echo "  Vercel App URL: $VERCEL_APP_URL"
echo "  CRON Secret Token: ${CRON_SECRET_TOKEN:0:10}..."
echo ""

# Build
echo "📦 Building SAM application..."
sam build

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build successful"
echo ""

# Deploy
echo "🚀 Deploying to AWS..."
sam deploy \
  --stack-name quickmail-cron-jobs \
  --parameter-overrides \
    ParamVercelAppUrl="$VERCEL_APP_URL" \
    ParamCronSecretToken="$CRON_SECRET_TOKEN" \
  --capabilities CAPABILITY_IAM \
  --confirm-changeset

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Deployment successful!"
    echo ""
    echo "📝 Next steps:"
    echo "   1. Verify Lambda function in AWS Console"
    echo "   2. Check EventBridge rules are enabled"
    echo "   3. Test with: aws lambda invoke --function-name <function-name> --payload '{\"endpoint\":\"check-replies\"}' response.json"
    echo ""
    echo "📊 View logs:"
    echo "   sam logs -n CronHandlerFunction --stack-name quickmail-cron-jobs --tail"
else
    echo ""
    echo "❌ Deployment failed"
    exit 1
fi

