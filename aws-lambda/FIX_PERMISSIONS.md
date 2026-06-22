# Fix IAM Permissions for Deployment

The deployment failed because your IAM user needs EventBridge permissions.

## Quick Fix

Add this policy to your IAM user (`saurabh`):

### Option 1: Using AWS Console

1. Go to [IAM Console](https://console.aws.amazon.com/iam)
2. Click **Users** → **saurabh**
3. Click **Add permissions** → **Attach policies directly**
4. Search for and attach: **AmazonEventBridgeFullAccess**
5. Or create a custom policy with these permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "events:*",
                "lambda:*",
                "iam:CreateRole",
                "iam:AttachRolePolicy",
                "iam:PutRolePolicy",
                "iam:GetRole",
                "iam:PassRole",
                "cloudformation:*",
                "s3:*",
                "logs:*"
            ],
            "Resource": "*"
        }
    ]
}
```

### Option 2: Using AWS CLI

```bash
# Attach EventBridge full access policy
aws iam attach-user-policy \
  --user-name saurabh \
  --policy-arn arn:aws:iam::aws:policy/AmazonEventBridgeFullAccess

# Or attach CloudFormation full access (includes EventBridge)
aws iam attach-user-policy \
  --user-name saurabh \
  --policy-arn arn:aws:iam::aws:policy/AWSCloudFormationFullAccess
```

### Option 3: Use Admin Access (For Testing)

If you have admin access, you can use:
```bash
aws iam attach-user-policy \
  --user-name saurabh \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

## After Adding Permissions

Wait a few seconds for permissions to propagate, then redeploy:

```bash
cd aws-lambda
sam deploy --stack-name quickmail-cron-jobs \
  --capabilities CAPABILITY_IAM \
  --region ap-south-1 \
  --parameter-overrides \
    ParamVercelAppUrl="smtp-mail-sigma.vercel.app" \
    ParamCronSecretToken="62a602c3ec34a29eb451b7fecf51bb8f6447aac1aba5766ba5ffcf6b8419441f" \
  --no-confirm-changeset
```

## Required Permissions Summary

Your IAM user needs:
- ✅ **EventBridge**: `events:*` (or at least `events:PutRule`, `events:DescribeRule`, `events:PutTargets`)
- ✅ **Lambda**: `lambda:*` (or create/invoke permissions)
- ✅ **IAM**: `iam:CreateRole`, `iam:PassRole` (for Lambda execution role)
- ✅ **CloudFormation**: `cloudformation:*` (for stack management)
- ✅ **S3**: `s3:*` (for SAM deployment bucket)
- ✅ **CloudWatch Logs**: `logs:*` (for Lambda logs)

