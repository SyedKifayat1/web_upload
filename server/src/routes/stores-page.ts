import express from 'express'
import StoresPage from '../models/StoresPage'
import { protect, checkPermission } from '../middleware/auth'

const router = express.Router()

const defaults = {
  title: 'Store Locations',
  introHtml: '',
  locations: [] as Array<{
    name: string
    address: string
    city: string
    country: string
    phone: string
    email: string
    hours?: string
    mapUrl?: string
  }>,
}

function normalizeLocation(l: Record<string, unknown>) {
  return {
    name: typeof l.name === 'string' ? l.name : '',
    address: typeof l.address === 'string' ? l.address : '',
    city: typeof l.city === 'string' ? l.city : '',
    country: typeof l.country === 'string' ? l.country : '',
    phone: typeof l.phone === 'string' ? l.phone : '',
    email: typeof l.email === 'string' ? l.email : '',
    hours: typeof l.hours === 'string' ? l.hours : '',
    mapUrl: typeof l.mapUrl === 'string' ? l.mapUrl : '',
  }
}

// @route   GET /api/v1/stores-page
// @desc    Get stores page content (public)
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    let doc = await StoresPage.findOne({ key: 'default' })
    if (!doc) {
      doc = await StoresPage.create({ key: 'default', ...defaults })
    }
    const data = {
      title: doc.title || defaults.title,
      introHtml: doc.introHtml ?? defaults.introHtml,
      locations: Array.isArray(doc.locations) ? doc.locations.map(normalizeLocation) : [],
      updatedAt: doc.updatedAt,
    }
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/stores-page/admin
// @desc    Get full stores page document for admin edit
// @access  Private/Admin
router.get('/admin', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc = await StoresPage.findOne({ key: 'default' })
    if (!doc) {
      doc = await StoresPage.create({ key: 'default', ...defaults })
    }
    res.json({ success: true, data: doc })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/stores-page
// @desc    Update stores page content
// @access  Private/Admin
router.put('/', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { title, introHtml, locations } = req.body
    let doc = await StoresPage.findOne({ key: 'default' })
    if (!doc) {
      doc = await StoresPage.create({ key: 'default', ...defaults })
    }
    if (title !== undefined) doc.title = title
    if (introHtml !== undefined) doc.introHtml = introHtml
    if (locations !== undefined) {
      doc.locations = Array.isArray(locations) ? locations.map(normalizeLocation) : []
    }
    await doc.save()
    res.json({ success: true, data: doc })
  } catch (error) {
    next(error)
  }
})

export default router
