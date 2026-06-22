import { NextResponse } from 'next/server'
import { SESv2Client, GetConfigurationSetCommand } from '@aws-sdk/client-sesv2'

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
  const configSet = process.env.AWS_SES_CONFIGURATION_SET || ''
  const region = process.env.AWS_SES_REGION || ''
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY

  const result: any = {
    baseUrl,
    baseUrlOk: !!baseUrl,
    pixelReachable: false,
    sesEnvOk: !!(region && accessKeyId && secretAccessKey),
    sesConfigSetOk: false,
    webhookEndpoint: baseUrl ? `${baseUrl}/api/ses/notify` : null,
  }

  // Pixel reachability (dry run to avoid writes)
  if (baseUrl) {
    try {
      const u = `${baseUrl.replace(/\/$/, '')}/api/trk/open?emailId=_health&dryRun=1`
      const r = await fetch(u, { method: 'GET' })
      result.pixelReachable = r.ok
    } catch (e) {
      result.pixelReachable = false
    }
  }

  // SES configuration set check only (no event destination listing to avoid SDK version issues)
  if (result.sesEnvOk && configSet) {
    try {
      const client = new SESv2Client({ region, credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! } })
      const cfg = await client.send(new GetConfigurationSetCommand({ ConfigurationSetName: configSet }))
      result.sesConfigSetOk = !!cfg
    } catch (e) {
      result.sesConfigSetOk = false
    }
  }

  return NextResponse.json(result)
}
