#!/bin/bash
# Quick deployment script for AWS Lambda function

set -e

echo "🚀 Deploying QuickMail Lambda Function"
echo "======================================"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ Error: AWS CLI is not installed"
    echo "   Install from: https://aws.amazon.com/cli/"
    exit 1
fi

# Check if function name is provided
FUNCTION_NAME=${1:-quickmail-cron-handler}
REGION=${2:-us-east-1}

echo "Function name: $FUNCTION_NAME"
echo "Region: $REGION"
echo ""

# Create zip file
echo "📦 Creating deployment package..."
cd "$(dirname "$0")"
zip -q function.zip cron-handler.py requirements.txt

if [ ! -f function.zip ]; then
    echo "❌ Error: Failed to create function.zip"
    exit 1
fi

echo "✅ Package created"
echo ""

# Check if function exists
echo "🔍 Checking if function exists..."
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &> /dev/null; then
    echo "✅ Function exists, updating code..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file fileb://function.zip \
        --region "$REGION"
    
    echo "✅ Function code updated"
else
    echo "⚠️  Function does not exist"
    echo "   Please create the function first using AWS Console or:"
    echo ""
    echo "   aws lambda create-function \\"
    echo "     --function-name $FUNCTION_NAME \\"
    echo "     --runtime python3.11 \\"
    echo "     --role arn:aws:iam::YOUR_ACCOUNT_ID:role/lambda-execution-role \\"
    echo "     --handler cron-handler.lambda_handler \\"
    echo "     --zip-file fileb://function.zip \\"
    echo "     --timeout 30 \\"
    echo "     --memory-size 128 \\"
    echo "     --region $REGION"
    echo ""
    echo "   Then set environment variables:"
    echo "   aws lambda update-function-configuration \\"
    echo "     --function-name $FUNCTION_NAME \\"
    echo "     --environment Variables='{VERCEL_APP_URL=your-app.vercel.app,CRON_SECRET_TOKEN=your-token}' \\"
    echo "     --region $REGION"
    exit 1
fi

# Clean up
rm -f function.zip

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Verify environment variables are set:"
echo "      aws lambda get-function-configuration --function-name $FUNCTION_NAME --region $REGION"
echo ""
echo "   2. Create EventBridge rules (see README.md)"
echo ""
echo "   3. Test the function:"
echo "      aws lambda invoke --function-name $FUNCTION_NAME --payload '{\"endpoint\":\"check-replies\"}' --region $REGION response.json"

