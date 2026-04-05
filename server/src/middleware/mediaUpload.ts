import multer from 'multer'

const memory = multer.memoryStorage()

const imageMimes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const videoMimes = new Set(['video/mp4'])

const imageFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (imageMimes.has(file.mimetype)) cb(null, true)
  else cb(new Error('Invalid image type. Allowed: JPG, PNG, WebP.'))
}

const videoFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (videoMimes.has(file.mimetype)) cb(null, true)
  else cb(new Error('Invalid video type. Allowed: MP4.'))
}

export const mediaImageUpload = multer({
  storage: memory,
  fileFilter: imageFilter,
  limits: { fileSize: 12 * 1024 * 1024 },
})

export const mediaVideoUpload = multer({
  storage: memory,
  fileFilter: videoFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
})

/** Hero background video: memory, MP4/WebM/MOV (local fallback); R2 path uses MP4 only */
const heroVideoWideFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const allowed = new Set(['video/mp4', 'video/webm', 'video/quicktime'])
  if (allowed.has(file.mimetype)) cb(null, true)
  else cb(new Error('Invalid video type. Allowed: MP4, WebM, QuickTime.'))
}

export const heroVideoMemoryUpload = multer({
  storage: memory,
  fileFilter: heroVideoWideFilter,
  // Intentionally no fileSize limit for homepage hero video uploads.
})

const combinedFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (imageMimes.has(file.mimetype)) cb(null, true)
  else if (videoMimes.has(file.mimetype)) cb(null, true)
  else cb(new Error('Invalid file. Images: JPG, PNG, WebP. Video: MP4.'))
}

/** Accepts image or video; route handler enforces per-type size limits */
export const mediaAnyUpload = multer({
  storage: memory,
  fileFilter: combinedFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
})
