import multer from 'multer'
import path from 'path'
import fs from 'fs'

// Create uploads directories if they don't exist
const blogUploadsDir = path.join(process.cwd(), 'uploads', 'blog')
const heroUploadsDir = path.join(process.cwd(), 'uploads', 'hero')
const productUploadsDir = path.join(process.cwd(), 'uploads', 'products')
const collectionsUploadsDir = path.join(process.cwd(), 'uploads', 'collections')
const aboutUploadsDir = path.join(process.cwd(), 'uploads', 'about')
const siteUploadsDir = path.join(process.cwd(), 'uploads', 'site')
const miscUploadsDir = path.join(process.cwd(), 'uploads', 'misc')
;[
  blogUploadsDir,
  heroUploadsDir,
  productUploadsDir,
  collectionsUploadsDir,
  aboutUploadsDir,
  siteUploadsDir,
  miscUploadsDir,
].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
})

// Any raster/vector MIME browsers send as image/* (Sharp converts to WebP for storage)
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true)
  } else {
    cb(new Error('Invalid file type. Only image files are allowed.'))
  }
}

// File filter - video only (hero background)
const videoFileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = ['video/mp4', 'video/webm', 'video/quicktime']
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('Invalid file type. Only MP4 and WebM videos are allowed.'))
  }
}

// Memory storage for images - files will be converted to WebP before saving
const memoryStorage = multer.memoryStorage()

// Blog upload storage (memory - converted to WebP in route)
const blogStorage = memoryStorage

// Product upload storage (memory - converted to WebP in route)
const productStorage = memoryStorage

// Hero image upload storage (memory - converted to WebP in route)
const heroStorage = memoryStorage

// Configure multer - blog (default) - stores in memory, route converts to WebP
export const upload = multer({
  storage: blogStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
})

// Hero image upload (for homepage hero background) - stores in memory, route converts to WebP
export const heroUpload = multer({
  storage: heroStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
})

// Hero video upload (for homepage hero background) - same folder, video only, larger limit
const heroVideoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, heroUploadsDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const ext = path.extname(file.originalname) || '.mp4'
    cb(null, `hero-video-${uniqueSuffix}${ext}`)
  },
})
// Product image upload (for product gallery)
export const productUpload = multer({
  storage: productStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per image
})

/** Rich-text inline images (larger limit before server compresses to WebP) */
export const editorInlineUpload = multer({
  storage: memoryStorage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 },
})

export const heroVideoUpload = multer({
  storage: heroVideoStorage,
  fileFilter: videoFileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
})

export default upload
