import express from 'express'
import TermsOfService from '../models/TermsOfService'
import { protect, checkPermission } from '../middleware/auth'

const router = express.Router()

const defaults = {
  title: 'Terms of Service',
  contentHtml: '',
}

// @route   GET /api/v1/terms
// @desc    Get terms of service (public)
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    let doc = await TermsOfService.findOne({ key: 'default' })
    if (!doc) {
      doc = await TermsOfService.create({
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

// @route   GET /api/v1/terms/admin
// @desc    Get full terms document for admin edit
// @access  Private/Admin
router.get('/admin', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc = await TermsOfService.findOne({ key: 'default' })
    if (!doc) {
      doc = await TermsOfService.create({ key: 'default', ...defaults })
    }
    res.json({ success: true, data: doc })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/terms
// @desc    Update terms of service
// @access  Private/Admin
router.put('/', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { title, contentHtml } = req.body
    let doc = await TermsOfService.findOne({ key: 'default' })
    if (!doc) {
      doc = await TermsOfService.create({ key: 'default', ...defaults })
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
