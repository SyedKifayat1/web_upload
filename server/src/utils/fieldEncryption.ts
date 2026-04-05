import crypto from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 16
const AUTH_TAG_LEN = 16

function getEncryptionKey(): Buffer {
  const hex = process.env.MEDIA_ENCRYPTION_KEY?.trim()
  if (hex && hex.length >= 64) {
    const buf = Buffer.from(hex, 'hex')
    if (buf.length === 32) return buf
  }
  return crypto.scryptSync(process.env.JWT_SECRET || 'change-me-in-production', 'sky-media-field-salt', 32)
}

export function encryptField(plain: string): string {
  if (!plain) return ''
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64url')
}

export function decryptField(blob: string): string {
  if (!blob) return ''
  const key = getEncryptionKey()
  const raw = Buffer.from(blob, 'base64url')
  if (raw.length < IV_LEN + AUTH_TAG_LEN + 1) {
    throw new Error('Invalid encrypted payload')
  }
  const iv = raw.subarray(0, IV_LEN)
  const tag = raw.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN)
  const data = raw.subarray(IV_LEN + AUTH_TAG_LEN)
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
