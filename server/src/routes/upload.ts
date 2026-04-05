import express from 'express'
import fs from 'fs'
import path from 'path'
import { protect, checkPermission } from '../middleware/auth'
import upload, { editorInlineUpload, heroUpload, productUpload } from '../middleware/upload'
import { heroVideoMemoryUpload } from '../middleware/mediaUpload'
import { convertToWebpAndSave, convertMultipleToWebpAndSave, convertLogoToWebpAndSave } from '../utils/convertToWebp'
import { ADMIN_UPLOAD_CONTEXT_FOLDERS } from '../utils/mediaFolders'
import {
  isR2UploadAvailable,
  uploadAdminImageToR2,
  uploadAdminVideoToR2,
} from '../services/adminR2Upload'
import { syncSiteLogoMediaUsage } from '../services/mediaTracking'
import SiteSettings, { SITE_SETTINGS_KEY } from '../models/SiteSettings'

const router = express.Router()

/** Save header logo URL to site settings so it survives refresh without a separate Save click */
async function persistSiteLogoUrl(publicUrl: string): Promise<void> {
  let doc = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY })
  const previous = doc?.logoUrl ?? null
  if (!doc) {
    doc = new SiteSettings({ key: SITE_SETTINGS_KEY })
  }
  doc.logoUrl = publicUrl
  await doc.save()
  await syncSiteLogoMediaUsage(publicUrl, previous)
}

const productUploadsDir = path.join(process.cwd(), 'uploads', 'products')
const blogUploadsDir = path.join(process.cwd(), 'uploads', 'blog')
const heroUploadsDir = path.join(process.cwd(), 'uploads', 'hero')
const collectionsUploadsDir = path.join(process.cwd(), 'uploads', 'collections')
const aboutUploadsDir = path.join(process.cwd(), 'uploads', 'about')
const siteUploadsDir = path.join(process.cwd(), 'uploads', 'site')
const miscUploadsDir = path.join(process.cwd(), 'uploads', 'misc')

function localBaseUrl(): string {
  return process.env.SERVER_URL || process.env.API_URL || `http://localhost:${process.env.PORT || 5000}`
}

// @route   POST /api/v1/upload/product-images
// @desc    Upload multiple product images → R2 images/products/ when configured, else local disk
// @access  Private/Admin (products:create or products:update)
router.post(
  '/product-images',
  protect,
  (req: any, res, next) => {
    const perms = req.user?.permissions || []
    if (!perms.includes('products:create') && !perms.includes('products:update') && !perms.includes('all')) {
      return res.status(403).json({ success: false, error: 'Permission denied' })
    }
    next()
  },
  productUpload.array('images', 20),
  async (req: any, res, next) => {
    try {
      const files = req.files || []
      if (files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No image files provided',
        })
      }

      if (await isR2UploadAvailable()) {
        const folder = ADMIN_UPLOAD_CONTEXT_FOLDERS.products
        const data = await Promise.all(
          files.map(async (file: Express.Multer.File, index: number) => {
            const r = await uploadAdminImageToR2(file.buffer, file.originalname, folder)
            return {
              url: r.url,
              key: r.key,
              alt: file.originalname,
              order: index + 1,
            }
          })
        )
        return res.status(200).json({ success: true, data })
      }

      if (process.env.ALLOW_LOCAL_MEDIA_UPLOAD !== 'true') {
        return res.status(503).json({
          success: false,
          error:
            'Object storage (R2) is not configured or unavailable. Configure R2 in Admin → Settings → Storage (or R2_* and CDN_URL in .env). To allow saving uploads on this server’s disk for local dev only, set ALLOW_LOCAL_MEDIA_UPLOAD=true.',
        })
      }

      const buffers = files.map((f: Express.Multer.File) => f.buffer)
      const filenames = await convertMultipleToWebpAndSave(buffers, productUploadsDir, 'product-')
      const baseUrl = localBaseUrl()
      const data = filenames.map((filename: string, index: number) => ({
        url: `${baseUrl.replace(/\/$/, '')}/uploads/products/${filename}`,
        alt: (files[index] as Express.Multer.File).originalname,
        order: index + 1,
      }))
      res.status(200).json({
        success: true,
        data,
      })
    } catch (error) {
      next(error)
    }
  }
)

// @route   POST /api/v1/upload/hero-video
router.post(
  '/hero-video',
  protect,
  checkPermission('settings:update'),
  heroVideoMemoryUpload.single('video'),
  async (req: any, res, next) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({
          success: false,
          error: 'No video file provided',
        })
      }

      if (await isR2UploadAvailable() && req.file.mimetype === 'video/mp4') {
        const r = await uploadAdminVideoToR2(req.file.buffer, req.file.originalname, ADMIN_UPLOAD_CONTEXT_FOLDERS.heroVideo)
        return res.status(200).json({
          success: true,
          data: {
            url: r.url,
            key: r.key,
            filename: r.key,
            originalName: req.file.originalname,
            size: req.file.size,
          },
        })
      }

      // Local disk (non-MP4 or no R2)
      fs.mkdirSync(heroUploadsDir, { recursive: true })
      const ext = path.extname(req.file.originalname) || '.mp4'
      const filename = `hero-video-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
      fs.writeFileSync(path.join(heroUploadsDir, filename), req.file.buffer)
      const fileUrl = `/uploads/hero/${filename}`
      res.status(200).json({
        success: true,
        data: {
          url: fileUrl,
          filename,
          originalName: req.file.originalname,
          size: req.file.size,
        },
      })
    } catch (error) {
      next(error)
    }
  }
)

// @route   POST /api/v1/upload/hero-image
router.post('/hero-image', protect, checkPermission('settings:update'), heroUpload.single('image'), async (req: any, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided',
      })
    }

    if (await isR2UploadAvailable()) {
      const r = await uploadAdminImageToR2(req.file.buffer, req.file.originalname, ADMIN_UPLOAD_CONTEXT_FOLDERS.hero)
      return res.status(200).json({
        success: true,
        data: {
          url: r.url,
          key: r.key,
          filename: r.key,
          originalName: req.file.originalname,
          size: req.file.size,
        },
      })
    }

    const filename = await convertToWebpAndSave(req.file.buffer, heroUploadsDir, 'hero-')
    const fileUrl = `/uploads/hero/${filename}`
    res.status(200).json({
      success: true,
      data: {
        url: fileUrl,
        filename,
        originalName: req.file.originalname,
        size: req.file.size,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/upload/collection-image
router.post(
  '/collection-image',
  protect,
  (req: any, res, next) => {
    const perms = req.user?.permissions || []
    if (!perms.includes('products:create') && !perms.includes('products:update') && !perms.includes('all')) {
      return res.status(403).json({ success: false, error: 'Permission denied' })
    }
    next()
  },
  upload.single('image'),
  async (req: any, res, next) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          success: false,
          error: 'No image file provided',
        })
      }

      if (await isR2UploadAvailable()) {
        const r = await uploadAdminImageToR2(req.file.buffer, req.file.originalname, ADMIN_UPLOAD_CONTEXT_FOLDERS.collections)
        return res.status(200).json({
          success: true,
          data: {
            url: r.url,
            key: r.key,
            filename: r.key,
            originalName: req.file.originalname,
            size: req.file.size,
          },
        })
      }

      if (process.env.ALLOW_LOCAL_MEDIA_UPLOAD !== 'true') {
        return res.status(503).json({
          success: false,
          error:
            'Object storage (R2) is not configured. Collection images for Our Collections are stored in R2 (images/collections/). Configure Admin → Settings → Storage or R2_* + CDN_URL in .env. For local disk only, set ALLOW_LOCAL_MEDIA_UPLOAD=true.',
        })
      }

      const filename = await convertToWebpAndSave(req.file.buffer, collectionsUploadsDir, 'collection-')
      const baseUrl = localBaseUrl()
      const fileUrl = `${baseUrl.replace(/\/$/, '')}/uploads/collections/${filename}`
      res.status(200).json({
        success: true,
        data: {
          url: fileUrl,
          filename,
          originalName: req.file.originalname,
          size: req.file.size,
        },
      })
    } catch (error) {
      next(error)
    }
  }
)

// @route   POST /api/v1/upload/blog-banner
router.post(
  '/blog-banner',
  protect,
  (req: any, res, next) => {
    const perms = req.user?.permissions || []
    if (!perms.includes('blog:update') && !perms.includes('all')) {
      return res.status(403).json({ success: false, error: 'Permission denied' })
    }
    next()
  },
  upload.single('image'),
  async (req: any, res, next) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          success: false,
          error: 'No image file provided',
        })
      }

      if (await isR2UploadAvailable()) {
        const r = await uploadAdminImageToR2(req.file.buffer, req.file.originalname, ADMIN_UPLOAD_CONTEXT_FOLDERS.blog)
        return res.status(200).json({
          success: true,
          data: {
            url: r.url,
            key: r.key,
            filename: r.key,
            originalName: req.file.originalname,
            size: req.file.size,
          },
        })
      }

      const filename = await convertToWebpAndSave(req.file.buffer, blogUploadsDir, 'banner-')
      const baseUrl = localBaseUrl()
      const fileUrl = `${baseUrl.replace(/\/$/, '')}/uploads/blog/${filename}`
      res.status(200).json({
        success: true,
        data: {
          url: fileUrl,
          filename,
          originalName: req.file.originalname,
          size: req.file.size,
        },
      })
    } catch (error) {
      next(error)
    }
  }
)

// @route   POST /api/v1/upload/about-image
router.post(
  '/about-image',
  protect,
  checkPermission('settings:update'),
  upload.single('image'),
  async (req: any, res, next) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          success: false,
          error: 'No image file provided',
        })
      }

      if (await isR2UploadAvailable()) {
        const r = await uploadAdminImageToR2(req.file.buffer, req.file.originalname, ADMIN_UPLOAD_CONTEXT_FOLDERS.about)
        return res.status(200).json({
          success: true,
          data: {
            url: r.url,
            key: r.key,
            filename: r.key,
            originalName: req.file.originalname,
            size: req.file.size,
          },
        })
      }

      const filename = await convertToWebpAndSave(req.file.buffer, aboutUploadsDir, 'about-')
      const baseUrl = localBaseUrl()
      const fileUrl = `${baseUrl.replace(/\/$/, '')}/uploads/about/${filename}`
      res.status(200).json({
        success: true,
        data: {
          url: fileUrl,
          filename,
          originalName: req.file.originalname,
          size: req.file.size,
        },
      })
    } catch (error) {
      next(error)
    }
  }
)

// @route   POST /api/v1/upload/logo
router.post(
  '/logo',
  protect,
  checkPermission('settings:update'),
  upload.single('image'),
  async (req: any, res, next) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          success: false,
          error: 'No image file provided',
        })
      }

      if (await isR2UploadAvailable()) {
        const r = await uploadAdminImageToR2(req.file.buffer, req.file.originalname, ADMIN_UPLOAD_CONTEXT_FOLDERS.site)
        await persistSiteLogoUrl(r.url)
        return res.status(200).json({
          success: true,
          data: {
            url: r.url,
            key: r.key,
            filename: r.key,
            originalName: req.file.originalname,
            size: req.file.size,
          },
        })
      }

      const filename = await convertLogoToWebpAndSave(req.file.buffer, siteUploadsDir, 'logo-')
      const fileUrl = `/uploads/site/${filename}`
      await persistSiteLogoUrl(fileUrl)
      res.status(200).json({
        success: true,
        data: {
          url: fileUrl,
          filename,
          originalName: req.file.originalname,
          size: req.file.size,
        },
      })
    } catch (error) {
      next(error)
    }
  }
)

const EDITOR_INLINE_CONTEXT_TO_FOLDER: Record<string, string> = {
  blog: ADMIN_UPLOAD_CONTEXT_FOLDERS.blog,
  product: ADMIN_UPLOAD_CONTEXT_FOLDERS.products,
  about: ADMIN_UPLOAD_CONTEXT_FOLDERS.about,
  misc: ADMIN_UPLOAD_CONTEXT_FOLDERS.misc,
}

function canUploadEditorInlineImage(user: any, context: string): boolean {
  if (!user) return false
  if (user.isAdmin) return true
  const p: string[] = user.permissions || []
  if (!p.length || p.includes('all')) return true
  if (context === 'blog' && (p.includes('blog:create') || p.includes('blog:update'))) return true
  if (context === 'product' && (p.includes('products:create') || p.includes('products:update'))) return true
  if ((context === 'about' || context === 'misc') && p.includes('settings:update')) return true
  return false
}

// @route   POST /api/v1/upload/editor-inline-image
// @desc    Rich-text embedded images → R2 (blog / products / about / misc) by context
// @access  Private/Admin (permissions depend on context)
router.post('/editor-inline-image', protect, editorInlineUpload.single('image'), async (req: any, res, next) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'No image file provided' })
    }
    const ctx = String(req.body?.context || 'blog').toLowerCase()
    const folder = EDITOR_INLINE_CONTEXT_TO_FOLDER[ctx]
    if (!folder) {
      return res.status(400).json({ success: false, error: 'Invalid context. Use blog, product, about, or misc.' })
    }
    if (!canUploadEditorInlineImage(req.user, ctx)) {
      return res.status(403).json({ success: false, error: 'Permission denied' })
    }

    if (await isR2UploadAvailable()) {
      const r = await uploadAdminImageToR2(req.file.buffer, req.file.originalname, folder)
      return res.status(200).json({
        success: true,
        data: {
          url: r.url,
          key: r.key,
          filename: r.key,
          originalName: req.file.originalname,
          size: req.file.size,
        },
      })
    }

    if (process.env.ALLOW_LOCAL_MEDIA_UPLOAD !== 'true') {
      return res.status(503).json({
        success: false,
        error:
          'Object storage (R2) is not configured. Configure Admin → Settings → Storage or set ALLOW_LOCAL_MEDIA_UPLOAD=true for local disk only.',
      })
    }

    const dirByCtx: Record<string, string> = {
      blog: blogUploadsDir,
      product: productUploadsDir,
      about: aboutUploadsDir,
      misc: miscUploadsDir,
    }
    const prefixByCtx: Record<string, string> = {
      blog: 'blog-',
      product: 'product-',
      about: 'about-',
      misc: 'misc-',
    }
    const dir = dirByCtx[ctx]
    const prefix = prefixByCtx[ctx]
    const filename = await convertToWebpAndSave(req.file.buffer, dir, prefix)
    const pathSegByCtx: Record<string, string> = {
      blog: 'blog',
      product: 'products',
      about: 'about',
      misc: 'misc',
    }
    const seg = pathSegByCtx[ctx]
    const fileUrl = `/uploads/${seg}/${filename}`
    res.status(200).json({
      success: true,
      data: {
        url: fileUrl,
        filename,
        originalName: req.file.originalname,
        size: req.file.size,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/upload/image
router.post('/image', protect, (req: any, res, next) => {
  if (req.user.isAdmin) {
    return next()
  }
  if (!req.user.permissions?.includes('blog:create') && !req.user.permissions?.includes('blog:update')) {
    return res.status(403).json({
      success: false,
      error: 'Permission denied',
    })
  }
  next()
}, upload.single('image'), async (req: any, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided',
      })
    }

    if (await isR2UploadAvailable()) {
      const r = await uploadAdminImageToR2(req.file.buffer, req.file.originalname, ADMIN_UPLOAD_CONTEXT_FOLDERS.blog)
      return res.status(200).json({
        success: true,
        data: {
          url: r.url,
          key: r.key,
          filename: r.key,
          originalName: req.file.originalname,
          size: req.file.size,
        },
      })
    }

    const filename = await convertToWebpAndSave(req.file.buffer, blogUploadsDir, 'blog-')
    const fileUrl = `/uploads/blog/${filename}`
    res.status(200).json({
      success: true,
      data: {
        url: fileUrl,
        filename,
        originalName: req.file.originalname,
        size: req.file.size,
      },
    })
  } catch (error) {
    next(error)
  }
})

export default router
