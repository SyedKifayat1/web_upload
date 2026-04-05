import express from 'express'
import SizeGuide from '../models/SizeGuide'
import { protect, checkPermission } from '../middleware/auth'
import { DEFAULT_SIZE_GUIDE_HTML } from '../content/default-size-guide'
import { DEFAULT_SIZE_GUIDE_SECTIONS } from '../content/default-size-guide-sections'
import { sizeGuideTablesToHtml } from '../utils/sizeGuideTablesToHtml'
import { sizeGuideSectionsToHtml } from '../utils/sizeGuideSectionsToHtml'

const router = express.Router()

const defaults = {
  title: 'Size Guide',
  sections: [] as Array<{ type: string; contentHtml?: string; title?: string; subtitle?: string; note?: string; headers?: string[]; rows?: string[][] }>,
  contentHtml: '',
  contentAfterHtml: '',
  tableHtml: '',
  tables: [] as Array<{ title: string; subtitle?: string; note?: string; headers: string[]; rows: string[][] }>,
}

function normalizeSection(s: { type?: string; contentHtml?: string; title?: string; subtitle?: string; note?: string; headers?: string[]; rows?: string[][] }) {
  const type = s.type === 'table' ? 'table' : 'text'
  if (type === 'text') {
    return { type: 'text' as const, contentHtml: typeof s.contentHtml === 'string' ? s.contentHtml : '' }
  }
  return {
    type: 'table' as const,
    title: typeof s.title === 'string' ? s.title : '',
    subtitle: typeof s.subtitle === 'string' ? s.subtitle : '',
    note: typeof s.note === 'string' ? s.note : '',
    headers: Array.isArray(s.headers) ? s.headers.map((h) => String(h)) : [],
    rows: Array.isArray(s.rows) ? s.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c)) : [])) : [],
  }
}

// @route   GET /api/v1/size-guide
// @desc    Get size guide content (public)
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    let doc = await SizeGuide.findOne({ key: 'default' })
    if (!doc) {
      doc = await SizeGuide.create({ key: 'default', ...defaults })
    }
    const sections = Array.isArray(doc.sections) && doc.sections.length > 0 ? doc.sections : []
    let contentHtml: string
    if (sections.length > 0) {
      contentHtml = sizeGuideSectionsToHtml(sections)
    } else {
      const storedContent = (doc.contentHtml && doc.contentHtml.trim()) ? doc.contentHtml : ''
      const storedAfter = (doc.contentAfterHtml && doc.contentAfterHtml.trim()) ? doc.contentAfterHtml : ''
      const tables = Array.isArray(doc.tables) && doc.tables.length > 0 ? doc.tables : []
      const tablesHtml = sizeGuideTablesToHtml(tables)
      const legacyTableHtml = (doc.tableHtml && doc.tableHtml.trim()) ? doc.tableHtml : ''
      contentHtml = [storedContent, tablesHtml || legacyTableHtml, storedAfter].filter(Boolean).join('\n\n').trim()
    }
    const data = {
      title: doc.title || defaults.title,
      contentHtml: contentHtml || sizeGuideSectionsToHtml(DEFAULT_SIZE_GUIDE_SECTIONS) || DEFAULT_SIZE_GUIDE_HTML,
      updatedAt: doc.updatedAt,
    }
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/size-guide/default-sections
// @desc    Get default sections template (for admin "Load default")
// @access  Private/Admin
router.get('/default-sections', protect, checkPermission('settings:view'), (_req, res, next) => {
  try {
    res.json({ success: true, data: DEFAULT_SIZE_GUIDE_SECTIONS })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/size-guide/admin
// @desc    Get full size guide document for admin edit
// @access  Private/Admin
router.get('/admin', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc = await SizeGuide.findOne({ key: 'default' })
    if (!doc) {
      doc = await SizeGuide.create({ key: 'default', ...defaults })
    }
    let sections = Array.isArray(doc.sections) && doc.sections.length > 0 ? doc.sections : []
    if (sections.length === 0 && (doc.contentHtml?.trim() || doc.contentAfterHtml?.trim() || (Array.isArray(doc.tables) && doc.tables.length > 0))) {
      sections = []
      if (doc.contentHtml?.trim()) sections.push({ type: 'text' as const, contentHtml: doc.contentHtml })
      if (Array.isArray(doc.tables)) for (const t of doc.tables) sections.push({ type: 'table' as const, title: t.title, subtitle: t.subtitle, note: t.note, headers: t.headers || [], rows: t.rows || [] })
      if (doc.contentAfterHtml?.trim()) sections.push({ type: 'text' as const, contentHtml: doc.contentAfterHtml })
    }
    if (sections.length === 0) sections = DEFAULT_SIZE_GUIDE_SECTIONS
    const data = {
      ...doc.toObject(),
      sections,
    }
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/size-guide
// @desc    Update size guide content
// @access  Private/Admin
router.put('/', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { title, sections } = req.body
    let doc = await SizeGuide.findOne({ key: 'default' })
    if (!doc) {
      doc = await SizeGuide.create({ key: 'default', ...defaults })
    }
    if (title !== undefined) doc.title = title
    if (sections !== undefined) {
      doc.sections = Array.isArray(sections) ? sections.map(normalizeSection) : []
    }
    await doc.save()
    res.json({ success: true, data: doc })
  } catch (error) {
    next(error)
  }
})

export default router
