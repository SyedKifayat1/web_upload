import express from 'express'
import { protect, checkPermission } from '../middleware/auth'
import { mediaAnyUpload } from '../middleware/mediaUpload'
import MediaAsset from '../models/MediaAsset'
import { putObjectToR2, deleteObjectFromR2 } from '../services/r2Storage'
import { getResolvedR2Config } from '../services/storageConfig'
import { normalizeMediaFolder, isAllowedMediaFolder } from '../utils/mediaFolders'
import { compressImageBufferForR2, MAX_R2_IMAGE_BYTES } from '../utils/r2ImageCompress'

const router = express.Router()

// @route   GET /api/v1/media/overview
// @desc    Aggregate stats + per-folder counts (for media library UI)
// @access  Private/Admin
router.get('/overview', protect, checkPermission('media:view'), async (_req, res, next) => {
  try {
    const [totalsAgg, byFolderAgg] = await Promise.all([
      MediaAsset.aggregate([
        {
          $group: {
            _id: null,
            totalBytes: { $sum: '$size' },
            totalFiles: { $sum: 1 },
            imageCount: { $sum: { $cond: [{ $eq: ['$type', 'image'] }, 1, 0] } },
            videoCount: { $sum: { $cond: [{ $eq: ['$type', 'video'] }, 1, 0] } },
            usedImageCount: {
              $sum: {
                $cond: [{ $and: [{ $eq: ['$type', 'image'] }, { $eq: ['$used', true] }] }, 1, 0],
              },
            },
            unusedImageCount: {
              $sum: {
                $cond: [{ $and: [{ $eq: ['$type', 'image'] }, { $eq: ['$used', false] }] }, 1, 0],
              },
            },
          },
        },
      ]),
      MediaAsset.aggregate([
        {
          $group: {
            _id: '$folder',
            totalBytes: { $sum: '$size' },
            fileCount: { $sum: 1 },
            imageCount: { $sum: { $cond: [{ $eq: ['$type', 'image'] }, 1, 0] } },
            videoCount: { $sum: { $cond: [{ $eq: ['$type', 'video'] }, 1, 0] } },
            lastModified: { $max: '$createdAt' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ])

    const t = totalsAgg[0] || {
      totalBytes: 0,
      totalFiles: 0,
      imageCount: 0,
      videoCount: 0,
      usedImageCount: 0,
      unusedImageCount: 0,
    }

    res.json({
      success: true,
      data: {
        stats: {
          totalBytes: t.totalBytes,
          totalFiles: t.totalFiles,
          imageCount: t.imageCount,
          videoCount: t.videoCount,
          usedImageCount: t.usedImageCount,
          unusedImageCount: t.unusedImageCount,
        },
        byFolder: byFolderAgg.map((x) => ({
          folder: x._id as string,
          totalBytes: x.totalBytes,
          fileCount: x.fileCount,
          imageCount: x.imageCount,
          videoCount: x.videoCount,
          lastModified: x.lastModified,
        })),
      },
    })
  } catch (error) {
    next(error)
  }
})

function safeBasename(name: string): string {
  const base = (name || 'file').split(/[/\\]/).pop() || 'file'
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'file'
}

// @route   GET /api/v1/media
// @desc    List media assets (filters: type, folder, used, page, limit)
// @access  Private/Admin
router.get('/', protect, checkPermission('media:view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '24'), 10) || 24))
    const type = (req.query.type as string)?.trim()
    const folder = (req.query.folder as string)?.trim()
    const used = req.query.used
    const searchRaw = (req.query.search as string)?.trim().slice(0, 200)

    const query: Record<string, unknown> = {}
    if (type === 'image' || type === 'video') query.type = type
    if (folder) {
      const f = normalizeMediaFolder(folder)
      if (!isAllowedMediaFolder(f)) {
        return res.status(400).json({ success: false, error: 'Invalid folder filter' })
      }
      query.folder = f
    }
    if (used === 'true') query.used = true
    else if (used === 'false') query.used = false
    if (searchRaw) {
      const esc = searchRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      query.$or = [
        { originalName: { $regex: esc, $options: 'i' } },
        { key: { $regex: esc, $options: 'i' } },
      ]
    }

    const [items, total] = await Promise.all([
      MediaAsset.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      MediaAsset.countDocuments(query),
    ])

    res.json({
      success: true,
      data: items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/media/upload
// @desc    Upload image or video to R2 (field: file, body: folder, type=image|video)
// @access  Private/Admin
router.post(
  '/upload',
  protect,
  checkPermission('media:manage'),
  mediaAnyUpload.single('file'),
  async (req: any, res, next) => {
    try {
      const cfg = await getResolvedR2Config()
      if (!cfg?.cdnUrl) {
        return res.status(503).json({
          success: false,
          error: 'Object storage is not configured. Set R2 / CDN in environment or Admin → Settings → Storage.',
        })
      }

      const file = req.file as Express.Multer.File | undefined
      if (!file?.buffer) {
        return res.status(400).json({ success: false, error: 'No file uploaded' })
      }

      const folder = normalizeMediaFolder(String(req.body?.folder || 'images/products'))
      if (!isAllowedMediaFolder(folder)) {
        return res.status(400).json({ success: false, error: 'Invalid folder. Use a predefined media folder path.' })
      }

      const isVideo = file.mimetype === 'video/mp4'
      const kind = isVideo ? 'video' : 'image'
      let key: string
      let publicUrl: string
      let contentType: string
      let size: number
      let originalName = safeBasename(file.originalname)

      if (kind === 'video') {
        if (file.size > 50 * 1024 * 1024) {
          return res.status(400).json({ success: false, error: 'Video must be at most 50MB' })
        }
        const ext = '.mp4'
        key = `${folder}${Date.now()}-${safeBasename(file.originalname.replace(/\.[^.]+$/, ''))}${ext}`
        contentType = 'video/mp4'
        size = file.buffer.length
        const put = await putObjectToR2({ key, body: file.buffer, contentType })
        if (!put) {
          return res.status(503).json({ success: false, error: 'Upload failed. Check storage configuration.' })
        }
        publicUrl = put.publicUrl
      } else {
        const processed = await compressImageBufferForR2(file.buffer)
        if (processed.buffer.length > MAX_R2_IMAGE_BYTES) {
          return res.status(400).json({ success: false, error: 'Could not compress image under 2MB' })
        }
        key = `${folder}${Date.now()}-${safeBasename(file.originalname.replace(/\.[^.]+$/, ''))}${processed.ext}`
        contentType = processed.contentType
        size = processed.buffer.length
        const put = await putObjectToR2({ key, body: processed.buffer, contentType })
        if (!put) {
          return res.status(503).json({ success: false, error: 'Upload failed. Check storage configuration.' })
        }
        publicUrl = put.publicUrl
      }

      const doc = await MediaAsset.create({
        url: publicUrl,
        key,
        type: kind,
        used: false,
        size,
        originalName,
        folder,
      })

      res.status(201).json({
        success: true,
        data: {
          _id: doc._id,
          url: doc.url,
          key: doc.key,
          type: doc.type,
          used: doc.used,
          size: doc.size,
          originalName: doc.originalName,
          folder: doc.folder,
          createdAt: doc.createdAt,
        },
      })
    } catch (error) {
      next(error)
    }
  }
)

// @route   DELETE /api/v1/media/:id
// @desc    Delete media by Mongo id (unused only)
// @access  Private/Admin
router.delete('/:id', protect, checkPermission('media:manage'), async (req, res, next) => {
  try {
    const doc = await MediaAsset.findById(req.params.id)
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Media not found' })
    }
    if (doc.used) {
      return res.status(400).json({ success: false, error: 'Cannot delete media that is in use' })
    }
    const removed = await deleteObjectFromR2(doc.key)
    if (!removed) {
      return res.status(503).json({ success: false, error: 'Could not delete from storage' })
    }
    await doc.deleteOne()
    res.json({ success: true, data: {} })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/media/bulk-delete-unused
// @desc    Delete many unused assets by id[]
// @access  Private/Admin
router.post('/bulk-delete-unused', protect, checkPermission('media:manage'), async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: unknown) => String(x)) : []
    if (!ids.length) {
      return res.status(400).json({ success: false, error: 'ids array required' })
    }
    const docs = await MediaAsset.find({ _id: { $in: ids }, used: false })
    let deleted = 0
    for (const d of docs) {
      const ok = await deleteObjectFromR2(d.key)
      if (ok) {
        await d.deleteOne()
        deleted++
      }
    }
    res.json({ success: true, data: { deleted } })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/media/purge-unused
// @desc    Delete all unused assets in a folder (optional type: image | video | all)
// @access  Private/Admin
router.post('/purge-unused', protect, checkPermission('media:manage'), async (req, res, next) => {
  try {
    const folderRaw = String(req.body?.folder ?? '').trim()
    const folder = normalizeMediaFolder(folderRaw)
    if (!isAllowedMediaFolder(folder)) {
      return res.status(400).json({ success: false, error: 'Invalid folder' })
    }
    const typeRaw = String(req.body?.type ?? 'all').toLowerCase()
    const query: Record<string, unknown> = { folder, used: false }
    if (typeRaw === 'image' || typeRaw === 'video') query.type = typeRaw

    const docs = await MediaAsset.find(query)
    let deleted = 0
    let failed = 0
    for (const d of docs) {
      const ok = await deleteObjectFromR2(d.key)
      if (ok) {
        await d.deleteOne()
        deleted++
      } else {
        failed++
      }
    }
    res.json({ success: true, data: { deleted, failed } })
  } catch (error) {
    next(error)
  }
})

export default router
