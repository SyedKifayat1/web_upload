import express from 'express'
import ReturnPolicy from '../models/ReturnPolicy'
import { protect, checkPermission } from '../middleware/auth'

const router = express.Router()

const defaults = {
  title: 'Easy and Hassle Free Returns',
  mainText: 'You can return this item for FREE within the allowed return period for any reason and without any shipping charges. The item must be returned in new and unused condition.',
  readMoreLabel: "Read more about the return period and our return policy.",
  readMoreUrl: '/policy/returns',
  howToReturnSteps: [
    'Go to "Orders" to start the return',
    'Select your refund method and pickup date',
    "Keep the item ready for pickup in its original packaging",
  ],
  fullPolicyHtml: '',
}

// @route   GET /api/v1/return-policy
// @desc    Get return policy (public, for modal and policy page)
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    let doc = await ReturnPolicy.findOne({ key: 'default' })
    if (!doc) {
      doc = await ReturnPolicy.create({
        key: 'default',
        ...defaults,
      })
    }
    const data = {
      title: doc.title || defaults.title,
      mainText: doc.mainText || defaults.mainText,
      readMoreLabel: doc.readMoreLabel || defaults.readMoreLabel,
      readMoreUrl: doc.readMoreUrl || defaults.readMoreUrl,
      howToReturnSteps: Array.isArray(doc.howToReturnSteps) && doc.howToReturnSteps.length > 0
        ? doc.howToReturnSteps
        : defaults.howToReturnSteps,
      fullPolicyHtml: doc.fullPolicyHtml ?? defaults.fullPolicyHtml,
    }
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/return-policy/admin
// @desc    Get full return policy document for admin edit
// @access  Private/Admin
router.get('/admin', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc = await ReturnPolicy.findOne({ key: 'default' })
    if (!doc) {
      doc = await ReturnPolicy.create({ key: 'default', ...defaults })
    }
    res.json({ success: true, data: doc })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/return-policy
// @desc    Update return policy
// @access  Private/Admin
router.put('/', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { title, mainText, readMoreLabel, readMoreUrl, howToReturnSteps, fullPolicyHtml } = req.body
    let doc = await ReturnPolicy.findOne({ key: 'default' })
    if (!doc) {
      doc = await ReturnPolicy.create({ key: 'default', ...defaults })
    }
    if (title !== undefined) doc.title = title
    if (mainText !== undefined) doc.mainText = mainText
    if (readMoreLabel !== undefined) doc.readMoreLabel = readMoreLabel
    if (readMoreUrl !== undefined) doc.readMoreUrl = readMoreUrl
    if (Array.isArray(howToReturnSteps)) doc.howToReturnSteps = howToReturnSteps
    if (fullPolicyHtml !== undefined) doc.fullPolicyHtml = fullPolicyHtml
    await doc.save()
    res.json({ success: true, data: doc })
  } catch (error) {
    next(error)
  }
})

export default router
