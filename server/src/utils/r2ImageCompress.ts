import sharp from 'sharp'

export const MAX_R2_IMAGE_BYTES = 2 * 1024 * 1024

export async function compressImageBufferForR2(input: Buffer): Promise<{ buffer: Buffer; contentType: string; ext: string }> {
  let quality = 82
  let width = 2048
  let out = await sharp(input)
    .rotate()
    .resize(width, width, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer()

  while (out.length > MAX_R2_IMAGE_BYTES && quality > 50) {
    quality -= 8
    width = Math.max(1200, width - 200)
    out = await sharp(input)
      .rotate()
      .resize(width, width, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer()
  }

  if (out.length > MAX_R2_IMAGE_BYTES) {
    out = await sharp(input)
      .rotate()
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 60 })
      .toBuffer()
  }

  return { buffer: out, contentType: 'image/webp', ext: '.webp' }
}
