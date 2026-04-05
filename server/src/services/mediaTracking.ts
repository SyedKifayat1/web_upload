import MediaAsset from '../models/MediaAsset'
import CategoryDesign from '../models/CategoryDesign'
import AboutSettings, { ABOUT_SETTINGS_KEY } from '../models/AboutSettings'
import BlogSettings, { BLOG_SETTINGS_KEY } from '../models/BlogSettings'
import BlogPost from '../models/BlogPost'
import HeroSection from '../models/HeroSection'

function collectKeysFromProductLike(p: {
  images?: Array<{ key?: string }>
  variants?: Array<{
    options?: Array<{
      imageKey?: string
      images?: Array<{ key?: string }>
    }>
  }>
}): string[] {
  const keys: string[] = []
  for (const img of p.images || []) {
    if (img?.key && typeof img.key === 'string') keys.push(img.key)
  }
  for (const v of p.variants || []) {
    for (const o of v?.options || []) {
      if (o?.imageKey && typeof o.imageKey === 'string') keys.push(o.imageKey)
      for (const gi of o?.images || []) {
        if (gi?.key && typeof gi.key === 'string') keys.push(gi.key)
      }
    }
  }
  return [...new Set(keys)]
}

export function collectMediaKeysFromProduct(product: Record<string, unknown> | null): string[] {
  if (!product) return []
  return collectKeysFromProductLike(product as never)
}

export async function markMediaUnusedForKeys(keys: string[]): Promise<void> {
  if (!keys.length) return
  await MediaAsset.updateMany({ key: { $in: keys } }, { $set: { used: false } })
}

export async function syncMediaUsageForProduct(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>
): Promise<void> {
  const prevKeys = collectKeysFromProductLike(previous || {})
  const nextKeys = collectKeysFromProductLike(next)
  const prevSet = new Set(prevKeys)
  const nextSet = new Set(nextKeys)

  const toUnused = prevKeys.filter((k) => !nextSet.has(k))
  const toUsed = nextKeys.filter((k) => !prevSet.has(k))

  if (toUsed.length) {
    await MediaAsset.updateMany({ key: { $in: toUsed } }, { $set: { used: true } })
  }
  if (toUnused.length) {
    await MediaAsset.updateMany({ key: { $in: toUnused } }, { $set: { used: false } })
  }
}

const UPLOADS_SEGMENT_TO_FOLDER: Record<string, string> = {
  collections: 'images/collections/',
  products: 'images/products/',
  blog: 'images/blog/',
  hero: 'images/hero/',
  about: 'images/about/',
  site: 'images/site/',
  banners: 'images/banners/',
  misc: 'images/misc/',
}

/** Resolve MediaAsset.key from a stored image URL or legacy /uploads/... path. */
export function extractMediaKeyFromReference(ref: string): string | null {
  const t = ref.trim()
  if (!t) return null
  const uploads = t.match(/^\/?uploads\/([^/]+)\/(.+)$/i)
  if (uploads) {
    const seg = uploads[1].toLowerCase()
    const file = uploads[2].replace(/^\/+/, '')
    if (seg === 'hero' && /\.(mp4|webm|mov)$/i.test(file)) {
      return `videos/hero/${file}`
    }
    const prefix = UPLOADS_SEGMENT_TO_FOLDER[seg]
    if (prefix) return `${prefix}${file}`
  }
  const absImages = t.match(/^\/?images\/([^/]+)\/(.+)$/i)
  if (absImages) return `images/${absImages[1]}/${absImages[2]}`.replace(/\/+/g, '/')
  try {
    const path = new URL(t).pathname.replace(/^\/+/, '')
    return path || null
  } catch {
    return null
  }
}

function mediaRefMatchFilter(ref: string): { $or: Array<Record<string, string>> } {
  const or: Array<Record<string, string>> = [{ url: ref.trim() }]
  const key = extractMediaKeyFromReference(ref)
  if (key) or.push({ key })
  return { $or: or }
}

/** Last path segment of a URL or path-like string (for matching MediaAsset.originalName). */
function filenameFromImageRef(ref: string): string | null {
  const t = ref.trim()
  if (!t) return null
  try {
    const seg = new URL(t).pathname.split('/').filter(Boolean).pop()
    return seg ? decodeURIComponent(seg) : null
  } catch {
    const seg = t.split('/').filter(Boolean).pop()
    return seg ? decodeURIComponent(seg.replace(/[?#].*$/, '') ) : null
  }
}

/**
 * Mark the media row for the active header logo as used; clear the previous logo if URL changed.
 * Site logo is only referenced from SiteSettings.logoUrl (not product variant keys), so it was never synced before.
 */
export async function syncSiteLogoMediaUsage(
  nextLogoUrl: string | null | undefined,
  previousLogoUrl: string | null | undefined
): Promise<void> {
  const prev = typeof previousLogoUrl === 'string' ? previousLogoUrl.trim() : ''
  const next = typeof nextLogoUrl === 'string' ? nextLogoUrl.trim() : ''
  const prevNorm = prev || null
  const nextNorm = next || null
  if (prevNorm && prevNorm !== nextNorm) {
    await MediaAsset.updateMany(mediaRefMatchFilter(prevNorm), { $set: { used: false } })
  }
  if (nextNorm) {
    await MediaAsset.updateMany(mediaRefMatchFilter(nextNorm), { $set: { used: true } })
  }
}

/** Reset one media folder, then mark rows used that match any of the given URLs (CDN, key, originalName, key suffix). */
async function applyRefsToMediaFolder(folderPrefix: string, urls: string[]): Promise<void> {
  await MediaAsset.updateMany({ folder: folderPrefix }, { $set: { used: false } })
  const seen = new Set<string>()
  for (const raw of urls) {
    const u = String(raw || '').trim()
    if (!u || seen.has(u)) continue
    seen.add(u)
    await MediaAsset.updateMany(mediaRefMatchFilter(u), { $set: { used: true } })
    const fname = filenameFromImageRef(u)
    if (fname) {
      await MediaAsset.updateMany(
        { folder: folderPrefix, originalName: fname },
        { $set: { used: true } }
      )
      const esc = fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      await MediaAsset.updateMany(
        { folder: folderPrefix, key: { $regex: `${esc}$`, $options: 'i' } },
        { $set: { used: true } }
      )
    }
  }
}

/**
 * CategoryDesign.collectionImage holds a URL (CDN or legacy /uploads/...), not R2 keys like products.
 */
export async function syncAllCollectionDesignMediaUsage(): Promise<void> {
  const urls = (await CategoryDesign.distinct('collectionImage')) as string[]
  const trimmed = urls.map((x) => String(x || '').trim()).filter(Boolean)
  await applyRefsToMediaFolder('images/collections/', trimmed)
}

/** About page: hero banner + brand story images (images/about/). */
export async function syncAboutPageMediaUsage(): Promise<void> {
  const doc = await AboutSettings.findOne({ key: ABOUT_SETTINGS_KEY }).lean()
  const urls: string[] = []
  const hi = doc?.hero?.imageUrl
  const bi = doc?.brandStory?.imageUrl
  if (typeof hi === 'string' && hi.trim()) urls.push(hi.trim())
  if (typeof bi === 'string' && bi.trim()) urls.push(bi.trim())
  await applyRefsToMediaFolder('images/about/', urls)
}

/** Pull <img src="..."> URLs from HTML when they point at images/blog/ (rich-text embeds). */
function collectBlogFolderUrlsFromHtml(html: unknown): string[] {
  if (!html || typeof html !== 'string') return []
  const out: string[] = []
  const absRe = /src\s*=\s*["'](https?:\/\/[^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = absRe.exec(html)) !== null) {
    const u = m[1].trim()
    if (!u) continue
    try {
      const path = new URL(u).pathname
      if (path.includes('/images/blog/')) out.push(u)
    } catch {
      if (u.includes('images/blog/')) out.push(u)
    }
  }
  const relRe = /src\s*=\s*["'](\/uploads\/blog\/[^"']+)["']/gi
  while ((m = relRe.exec(html)) !== null) {
    const u = m[1].trim()
    if (u) out.push(u)
  }
  return out
}

/**
 * images/blog/: listing banner + every post featuredImage + inline images in post HTML.
 * Syncing only the banner used to reset the whole folder to unused and hide post assets.
 */
export async function syncBlogFolderMediaUsage(): Promise<void> {
  const doc = await BlogSettings.findOne({ key: BLOG_SETTINGS_KEY }).lean()
  const banner = doc?.bannerImageUrl ? String(doc.bannerImageUrl).trim() : ''
  const featured = (await BlogPost.distinct('featuredImage')) as string[]
  const posts = await BlogPost.find({}).select('content').lean()
  const fromHtml: string[] = []
  for (const p of posts) {
    fromHtml.push(...collectBlogFolderUrlsFromHtml((p as { content?: string }).content))
  }
  const merged = new Set<string>()
  if (banner) merged.add(banner)
  for (const x of featured) {
    const t = String(x || '').trim()
    if (t) merged.add(t)
  }
  for (const u of fromHtml) merged.add(u)
  await applyRefsToMediaFolder('images/blog/', [...merged])
}

/** After blog banner settings save — full blog folder reconcile (posts + banner). */
export async function syncBlogBannerMediaUsage(): Promise<void> {
  await syncBlogFolderMediaUsage()
}

type HeroLeanMedia = {
  backgroundImageUrl?: string
  backgroundImageUrls?: string[]
  backgroundVideoUrlMobile?: string
  backgroundVideoUrlDesktop?: string
}

/** Home hero: background images (images/hero/) and videos (videos/hero/). */
export async function syncHeroSectionMediaUsage(): Promise<void> {
  const raw = await HeroSection.findOne({ key: 'home' }).lean()
  if (!raw || Array.isArray(raw)) return
  const hero = raw as HeroLeanMedia
  const imgUrls = [hero.backgroundImageUrl, ...(hero.backgroundImageUrls || [])]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
  const vidUrls = [hero.backgroundVideoUrlMobile, hero.backgroundVideoUrlDesktop]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
  await applyRefsToMediaFolder('images/hero/', imgUrls)
  await applyRefsToMediaFolder('videos/hero/', vidUrls)
}

/** Run all URL-based reconciliations (collections, about, blog, hero). Call after startup or related saves. */
export async function syncAllContentAreaMediaUsage(): Promise<void> {
  await syncAllCollectionDesignMediaUsage()
  await syncAboutPageMediaUsage()
  await syncBlogFolderMediaUsage()
  await syncHeroSectionMediaUsage()
}
