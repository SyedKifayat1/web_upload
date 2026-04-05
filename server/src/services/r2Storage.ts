import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getResolvedR2Config } from './storageConfig'

let clientCache: { sig: string; client: S3Client } | null = null

export function clearR2ClientCache(): void {
  clientCache = null
}

function configSignature(c: { endpoint: string; accessKeyId: string; secretAccessKey: string }): string {
  return `${c.endpoint}|${c.accessKeyId}|${c.secretAccessKey}`
}

export async function getS3Client(): Promise<S3Client | null> {
  const cfg = await getResolvedR2Config()
  if (!cfg) return null
  const sig = configSignature(cfg)
  if (clientCache && clientCache.sig === sig) return clientCache.client
  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: true,
  })
  clientCache = { sig, client }
  return client
}

export async function putObjectToR2(params: {
  key: string
  body: Buffer
  contentType: string
}): Promise<{ bucket: string; publicUrl: string } | null> {
  const cfg = await getResolvedR2Config()
  const client = await getS3Client()
  if (!cfg || !client) return null

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    })
  )

  const publicUrl = `${cfg.cdnUrl.replace(/\/$/, '')}/${params.key.replace(/^\//, '')}`
  return { bucket: cfg.bucket, publicUrl }
}

export async function deleteObjectFromR2(key: string): Promise<boolean> {
  const cfg = await getResolvedR2Config()
  const client = await getS3Client()
  if (!cfg || !client) return false
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
      })
    )
    return true
  } catch {
    return false
  }
}
