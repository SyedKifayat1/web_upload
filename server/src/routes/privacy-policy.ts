import express from 'express'
import PrivacyPolicy from '../models/PrivacyPolicy'
import { protect, checkPermission } from '../middleware/auth'
import { DEFAULT_PRIVACY_POLICY_HTML } from '../content/default-privacy-policy'

const router = express.Router()

const defaults = {
  title: 'Privacy Policy',
  contentHtml: '',
}

// @route   GET /api/v1/privacy-policy
// @desc    Get privacy policy (public)
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    let doc = await PrivacyPolicy.findOne({ key: 'default' })
    if (!doc) {
      doc = await PrivacyPolicy.create({
        key: 'default',
        ...defaults,
      })
    }
    const storedContent = (doc.contentHtml && doc.contentHtml.trim()) ? doc.contentHtml : ''
    const data = {
      title: doc.title || defaults.title,
      contentHtml: storedContent || DEFAULT_PRIVACY_POLICY_HTML,
      updatedAt: doc.updatedAt,
    }
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/privacy-policy/admin
// @desc    Get full privacy policy document for admin edit
// @access  Private/Admin
router.get('/admin', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc = await PrivacyPolicy.findOne({ key: 'default' })
    if (!doc) {
      doc = await PrivacyPolicy.create({ key: 'default', ...defaults })
    }
    const storedContent = (doc.contentHtml && doc.contentHtml.trim()) ? doc.contentHtml : ''
    const data = {
      ...doc.toObject(),
      contentHtml: storedContent || DEFAULT_PRIVACY_POLICY_HTML,
    }
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/privacy-policy
// @desc    Update privacy policy
// @access  Private/Admin
router.put('/', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { title, contentHtml } = req.body
    let doc = await PrivacyPolicy.findOne({ key: 'default' })
    if (!doc) {
      doc = await PrivacyPolicy.create({ key: 'default', ...defaults })
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
