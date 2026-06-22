#!/bin/bash

# SQS Queue Monitoring Script
# Usage: ./monitor-sqs.sh

QUEUE_URL="https://sqs.ap-south-1.amazonaws.com/114607487689/email-campaign-queue"
DLQ_URL="https://sqs.ap-south-1.amazonaws.com/114607487689/email-campaign-dlq"
REGION="ap-south-1"
LAMBDA_FUNCTION="email-campaign-async-CampaignProcessorFunction-xiozRRz9bRaQ"

echo "📊 SQS Queue Status"
echo "==================="
aws sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names All \
  --region "$REGION" \
  --output json | jq -r '
    .Attributes | 
    "Queue: \(.QueueArn | split(":")[-1])
Messages Available: \(.ApproximateNumberOfMessages)
Messages In Flight (processing): \(.ApproximateNumberOfMessagesNotVisible)
Messages Delayed: \(.ApproximateNumberOfMessagesDelayed)
Visibility Timeout: \(.VisibilityTimeout)s
Message Retention: \(.MessageRetentionPeriod)s"
'

echo ""
echo "💀 Dead Letter Queue Status"
echo "============================"
aws sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --region "$REGION" \
  --output json | jq -r '.Attributes.ApproximateNumberOfMessages as $count | 
    if $count == "0" then "✅ No failed messages" 
    else "⚠️  Failed messages: \($count)" 
    end'

echo ""
echo "🔍 Recent Lambda Logs (last 10 lines)"
echo "======================================"
aws logs tail "/aws/lambda/$LAMBDA_FUNCTION" \
  --region "$REGION" \
  --since 10m \
  --format short \
  --follow false 2>/dev/null || echo "No recent logs (function may not have been invoked yet)"

echo ""
echo "📈 Lambda Function Status"
echo "========================"
aws lambda get-function \
  --function-name "$LAMBDA_FUNCTION" \
  --region "$REGION" \
  --query 'Configuration.[FunctionName,LastModified,Runtime,Timeout,MemorySize]' \
  --output table 2>/dev/null || echo "Could not fetch Lambda details"

echo ""
echo "💡 Quick Commands:"
echo "=================="
echo "  View live logs:     aws logs tail /aws/lambda/$LAMBDA_FUNCTION --follow --region $REGION"
echo "  Check queue:       aws sqs get-queue-attributes --queue-url $QUEUE_URL --attribute-names All --region $REGION"
echo "  Purge queue:       aws sqs purge-queue --queue-url $QUEUE_URL --region $REGION"
echo "  List messages:     aws sqs receive-message --queue-url $QUEUE_URL --max-number-of-messages 1 --region $REGION"

