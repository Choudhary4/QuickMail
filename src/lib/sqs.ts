import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({
  region: process.env.AWS_SQS_REGION || process.env.AWS_SES_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export interface CampaignJob {
  campaignId: string;
  subject: string;
  htmlContent: string;
  recipients: Array<{ email: string; [key: string]: string }>;
  trackingSheetId?: string;
  trackingSheetName?: string;
  emailProvider: 'smtp' | 'ses';
  smtpConfig?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  fromAddress: string;
  masterSpreadsheetId?: string;
  masterSheetName?: string;
}

export async function enqueueCampaignJob(job: CampaignJob): Promise<{ success: boolean; error?: string }> {
  const queueUrl = process.env.AWS_SQS_QUEUE_URL;
  
  if (!queueUrl) {
    return { success: false, error: 'AWS_SQS_QUEUE_URL not configured' };
  }

  try {
    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(job),
      MessageAttributes: {
        campaignId: {
          DataType: 'String',
          StringValue: job.campaignId,
        },
        emailProvider: {
          DataType: 'String',
          StringValue: job.emailProvider,
        },
      },
    });

    await sqsClient.send(command);
    return { success: true };
  } catch (error: any) {
    console.error('Error enqueuing campaign job:', error);
    return { success: false, error: error.message };
  }
}
