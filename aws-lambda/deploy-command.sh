#!/bin/bash
# Deployment command with your Vercel app URL
# Replace YOUR_CRON_SECRET_TOKEN with your actual token

VERCEL_APP_URL="smtp-mail-sigma.vercel.app"
CRON_SECRET_TOKEN="${1:-YOUR_CRON_SECRET_TOKEN}"

if [ "$CRON_SECRET_TOKEN" == "YOUR_CRON_SECRET_TOKEN" ]; then
    echo "❌ Error: Please provide your CRON_SECRET_TOKEN"
    echo ""
    echo "Usage: ./deploy-command.sh YOUR_CRON_SECRET_TOKEN"
    echo ""
    echo "Or set it as environment variable:"
    echo "  export CRON_SECRET_TOKEN='your-token'"
    echo "  ./deploy-command.sh"
    exit 1
fi

echo "🚀 Deploying with:"
echo "  Vercel App URL: $VERCEL_APP_URL"
echo "  CRON Secret Token: ${CRON_SECRET_TOKEN:0:10}..."
echo ""

sam deploy \
  --stack-name quickmail-cron-jobs \
  --capabilities CAPABILITY_IAM \
  --region us-east-1 \
  --parameter-overrides \
    ParamVercelAppUrl="$VERCEL_APP_URL" \
    ParamCronSecretToken="$CRON_SECRET_TOKEN" \
  --confirm-changeset

