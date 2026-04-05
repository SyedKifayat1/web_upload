import { getResolvedR2Config } from '../services/storageConfig'

/** Maps legacy disk path segment under /uploads/<seg>/ to R2 key prefix (no leading slash). */
const UPLOADS_SEGMENT_TO_R2_PREFIX: Record<string, string> = {
  products: 'images/products',
  blog: 'images/blog',
  hero: 'images/hero',
  collections: 'images/collections',
  about: 'images/about',
  site: 'images/site',
}

/**
 * Base URL for public media (R2 custom domain or *.r2.dev). Used to rewrite old /uploads/... URLs in API JSON.
 * Uses full R2 config when present; otherwise CDN_URL / NEXT_PUBLIC_CDN_URL for rewrite-only.
 */
export async function getPublicCdnBase(): Promise<string | null> {
  const cfg = await getResolvedR2Config()
  if (cfg?.cdnUrl) return cfg.cdnUrl.replace(/\/$/, '')
  const fallback = (process.env.CDN_URL || process.env.NEXT_PUBLIC_CDN_URL || '').trim().replace(/\/$/, '')
  return fallback || null
}

/**
 * Rewrites legacy server-local URLs (e.g. http://localhost:5000/uploads/products/x.webp or /uploads/products/x)
 * to CDN URLs when the same object exists at images/<area>/... on R2.
 */
export function rewriteLegacyUploadUrlToCdn(url: string, cdnBase: string): string {
  const trimmed = (url || '').trim()
  if (!trimmed || !/\/uploads\//i.test(trimmed)) return trimmed

  const pathOnly = trimmed.replace(/^https?:\/\/[^/]+/i, '')
  const m = pathOnly.match(/^\/uploads\/(products|blog|hero|collections|about|site)\/(.+)$/i)
  if (!m) return trimmed

  const seg = m[1].toLowerCase()
  const rest = m[2].replace(/^\/+/, '')
  const prefix = UPLOADS_SEGMENT_TO_R2_PREFIX[seg]
  if (!prefix || !rest) return trimmed

  const base = cdnBase.replace(/\/$/, '')
  return `${base}/${prefix}/${rest}`.replace(/([^:]\/)\/+/g, '$1')
}

function cloneProductDoc(p: any): any {
  if (p != null && typeof p.toObject === 'function') {
    return p.toObject({ flattenMaps: true })
  }
  try {
    return JSON.parse(JSON.stringify(p))
  } catch {
    return { ...p }
  }
}

/** Rewrite image URLs on a product for public API responses (storefront). */
export function rewriteProductMediaUrlsForPublic(product: any, cdnBase: string): any {
  const o = cloneProductDoc(product)

  if (Array.isArray(o.images)) {
    for (const img of o.images) {
      if (img && typeof img.url === 'string') img.url = rewriteLegacyUploadUrlToCdn(img.url, cdnBase)
    }
  }

  if (Array.isArray(o.variants)) {
    for (const v of o.variants) {
      if (!v?.options) continue
      for (const opt of v.options) {
        if (opt && typeof opt.image === 'string') {
          opt.image = rewriteLegacyUploadUrlToCdn(opt.image, cdnBase)
        }
        if (Array.isArray(opt.images)) {
          for (const img of opt.images) {
            if (img && typeof img.url === 'string') {
              img.url = rewriteLegacyUploadUrlToCdn(img.url, cdnBase)
            }
          }
        }
      }
    }
  }

  return o
}

export async function rewriteProductsForPublicResponse(products: any[]): Promise<any[]> {
  const cdnBase = await getPublicCdnBase()
  if (!cdnBase || !products?.length) return products
  return products.map((p) => rewriteProductMediaUrlsForPublic(p, cdnBase))
}

export async function rewriteSingleProductForPublicResponse(product: any): Promise<any> {
  const cdnBase = await getPublicCdnBase()
  if (!cdnBase || !product) return product
  return rewriteProductMediaUrlsForPublic(product, cdnBase)
}
