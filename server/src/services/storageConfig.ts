import StorageSettings, { STORAGE_SETTINGS_KEY } from '../models/StorageSettings'
import { decryptField } from '../utils/fieldEncryption'

export interface ResolvedR2Config {
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
  bucket: string
  cdnUrl: string
}

function pickNonEmpty(dbVal: string | undefined, fallback: string): string {
  const d = typeof dbVal === 'string' ? dbVal.trim() : ''
  return d || fallback
}

export async function getResolvedR2Config(): Promise<ResolvedR2Config | null> {
  const doc = await StorageSettings.findOne({ key: STORAGE_SETTINGS_KEY }).lean()

  const env = {
    accessKeyId: (process.env.R2_ACCESS_KEY || '').trim(),
    secretAccessKey: (process.env.R2_SECRET_KEY || '').trim(),
    endpoint: (process.env.R2_ENDPOINT || '').trim(),
    bucket: (process.env.R2_BUCKET || '').trim(),
    cdnUrl: (process.env.CDN_URL || '').trim(),
  }

  let accessKeyId = env.accessKeyId
  let secretAccessKey = env.secretAccessKey
  let endpoint = env.endpoint
  let bucket = env.bucket
  let cdnUrl = env.cdnUrl

  if (doc) {
    endpoint = pickNonEmpty(doc.r2Endpoint, endpoint)
    bucket = pickNonEmpty(doc.r2Bucket, bucket)
    cdnUrl = pickNonEmpty(doc.cdnUrl, cdnUrl)
    try {
      if (doc.r2AccessKeyEnc?.trim()) {
        accessKeyId = decryptField(doc.r2AccessKeyEnc)
      }
      if (doc.r2SecretKeyEnc?.trim()) {
        secretAccessKey = decryptField(doc.r2SecretKeyEnc)
      }
    } catch {
      return null
    }
  }

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null
  }

  const cdn = cdnUrl.replace(/\/$/, '')
  return {
    accessKeyId,
    secretAccessKey,
    endpoint: endpoint.replace(/\/$/, ''),
    bucket,
    cdnUrl: cdn || endpoint,
  }
}
