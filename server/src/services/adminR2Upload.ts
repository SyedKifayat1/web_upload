import MediaAsset from '../models/MediaAsset'
import { putObjectToR2 } from './r2Storage'
import { getResolvedR2Config } from './storageConfig'
import { compressImageBufferForR2, MAX_R2_IMAGE_BYTES } from '../utils/r2ImageCompress'

function safeBasename(name: string): string {
  const base = (name || 'file').split(/[/\\]/).pop() || 'file'
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'file'
}

/** Folder prefix must end with / and be in mediaFolders allowlist */
export async function uploadAdminImageToR2(
  buffer: Buffer,
  originalName: string,
  folderPrefix: string
): Promise<{ url: string; key: string; size: number; originalName: string }> {
  const cfg = await getResolvedR2Config()
  if (!cfg) {
    throw new Error('R2 not configured')
  }
  const processed = await compressImageBufferForR2(buffer)
  if (processed.buffer.length > MAX_R2_IMAGE_BYTES) {
    throw new Error('Could not compress image under 2MB')
  }
  const base = `${Date.now()}-${safeBasename(originalName.replace(/\.[^.]+$/, ''))}`
  const key = `${folderPrefix}${base}${processed.ext}`
  const put = await putObjectToR2({
    key,
    body: processed.buffer,
    contentType: processed.contentType,
  })
  if (!put) {
    throw new Error('R2 upload failed')
  }
  const size = processed.buffer.length
  const orig = safeBasename(originalName)
  await MediaAsset.create({
    url: put.publicUrl,
    key,
    type: 'image',
    used: false,
    size,
    originalName: orig,
    folder: folderPrefix,
  })
  return { url: put.publicUrl, key, size, originalName: orig }
}

export async function uploadAdminVideoToR2(
  buffer: Buffer,
  originalName: string,
  folderPrefix: string
): Promise<{ url: string; key: string; size: number; originalName: string }> {
  const cfg = await getResolvedR2Config()
  if (!cfg) {
    throw new Error('R2 not configured')
  }
  const ext = '.mp4'
  const base = `${Date.now()}-${safeBasename(originalName.replace(/\.[^.]+$/, ''))}`
  const key = `${folderPrefix}${base}${ext}`
  const put = await putObjectToR2({
    key,
    body: buffer,
    contentType: 'video/mp4',
  })
  if (!put) {
    throw new Error('R2 upload failed')
  }
  const orig = safeBasename(originalName)
  await MediaAsset.create({
    url: put.publicUrl,
    key,
    type: 'video',
    used: false,
    size: buffer.length,
    originalName: orig,
    folder: folderPrefix,
  })
  return { url: put.publicUrl, key, size: buffer.length, originalName: orig }
}

export async function isR2UploadAvailable(): Promise<boolean> {
  const cfg = await getResolvedR2Config()
  return !!cfg?.cdnUrl
}
