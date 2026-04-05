import sharp from 'sharp'
import path from 'path'
import fs from 'fs'

/**
 * Converts an image buffer to WebP and saves to the given directory.
 * All uploaded images should be stored only as WebP.
 * @param buffer - Image buffer (JPEG, PNG, GIF, etc.)
 * @param destDir - Destination directory (e.g. uploads/products)
 * @param prefix - Filename prefix (e.g. product-, blog-, hero-)
 * @returns The saved filename (e.g. product-1234567890.webp)
 */
export async function convertToWebpAndSave(
  buffer: Buffer,
  destDir: string,
  prefix: string
): Promise<string> {
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
  const filename = `${prefix}${uniqueSuffix}.webp`
  const filepath = path.join(destDir, filename)

  await sharp(buffer)
    .webp({ quality: 85 })
    .toFile(filepath)

  return filename
}

/**
 * Converts multiple image buffers to WebP and saves to the given directory.
 */
export async function convertMultipleToWebpAndSave(
  buffers: Buffer[],
  destDir: string,
  prefix: string
): Promise<string[]> {
  const filenames: string[] = []
  for (let i = 0; i < buffers.length; i++) {
    const filename = await convertToWebpAndSave(buffers[i], destDir, prefix)
    filenames.push(filename)
  }
  return filenames
}

/**
 * Converts an image to WebP for use as the site logo. Uses higher quality (92)
 * so the header logo stays sharp; dimensions are preserved (no resizing).
 */
export async function convertLogoToWebpAndSave(
  buffer: Buffer,
  destDir: string,
  prefix: string
): Promise<string> {
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
  const filename = `${prefix}${uniqueSuffix}.webp`
  const filepath = path.join(destDir, filename)
  await sharp(buffer)
    .webp({ quality: 92, effort: 6 })
    .toFile(filepath)
  return filename
}
