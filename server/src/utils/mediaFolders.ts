/**
 * R2 object key prefixes under the bucket (matches former uploads/* layout: products, blog, …).
 * All admin image uploads map to images/<area>/ ; videos use videos/<area>/.
 */
export const MEDIA_FOLDER_PREFIXES = [
  'images/products/',
  'images/categories/',
  'images/banners/',
  'images/misc/',
  'images/blog/',
  'images/about/',
  'images/collections/',
  'images/hero/',
  'images/site/',
  'videos/products/',
  'videos/ads/',
  'videos/hero/',
] as const

const ALLOWED = new Set<string>([...MEDIA_FOLDER_PREFIXES])

export function normalizeMediaFolder(input: string): string {
  let f = (input || 'images/products').trim().replace(/^\/+|\/+$/g, '')
  if (!f) return 'images/products/'
  return f.endsWith('/') ? f : `${f}/`
}

export function isAllowedMediaFolder(folder: string): boolean {
  return ALLOWED.has(folder)
}

/** Map legacy / contextual upload routes to R2 folder prefixes */
export const ADMIN_UPLOAD_CONTEXT_FOLDERS = {
  products: 'images/products/',
  blog: 'images/blog/',
  about: 'images/about/',
  collections: 'images/collections/',
  hero: 'images/hero/',
  heroVideo: 'videos/hero/',
  site: 'images/site/',
  categories: 'images/categories/',
  banners: 'images/banners/',
  misc: 'images/misc/',
} as const
