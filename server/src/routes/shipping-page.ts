import express from 'express'
import ShippingPage from '../models/ShippingPage'
import { protect, checkPermission } from '../middleware/auth'

const router = express.Router()

const defaults = {
  title: 'Shipping & Delivery',
  contentHtml: '',
}

// @route   GET /api/v1/shipping-page
// @desc    Get shipping page content (public)
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    let doc = await ShippingPage.findOne({ key: 'default' })
    if (!doc) {
      doc = await ShippingPage.create({
        key: 'default',
        ...defaults,
      })
    }
    const data = {
      title: doc.title || defaults.title,
      contentHtml: doc.contentHtml ?? defaults.contentHtml,
      updatedAt: doc.updatedAt,
    }
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/shipping-page/admin
// @desc    Get full shipping page document for admin edit
// @access  Private/Admin
router.get('/admin', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc = await ShippingPage.findOne({ key: 'default' })
    if (!doc) {
      doc = await ShippingPage.create({ key: 'default', ...defaults })
    }
    res.json({ success: true, data: doc })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/shipping-page
// @desc    Update shipping page content
// @access  Private/Admin
router.put('/', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { title, contentHtml } = req.body
    let doc = await ShippingPage.findOne({ key: 'default' })
    if (!doc) {
      doc = await ShippingPage.create({ key: 'default', ...defaults })
    }
    if (title !== undefined) doc.title = title
    if (contentHtml !== undefined) doc.contentHtml = contentHtml
    await doc.save()
    res.json({ success: true, data: doc })
  } catch (error) {
    next(error)
  }
})

export default router
