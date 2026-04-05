import express from 'express'
import FaqSettings, { type IFaqItem } from '../models/FaqSettings'
import { protect, checkPermission } from '../middleware/auth'

const router = express.Router()

const defaults = {
  title: 'Frequently Asked Questions',
  items: [] as { question: string; answerHtml: string }[],
}

// @route   GET /api/v1/faq
// @desc    Get FAQ (public)
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    let doc = await FaqSettings.findOne({ key: 'default' })
    if (!doc) {
      doc = await FaqSettings.create({
        key: 'default',
        ...defaults,
      })
    }
    const data = {
      title: doc.title || defaults.title,
      items: Array.isArray(doc.items) && doc.items.length > 0
        ? doc.items.map((item: IFaqItem) => ({
            question: item.question || '',
            answerHtml: item.answerHtml ?? '',
          }))
        : defaults.items,
    }
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/faq/admin
// @desc    Get full FAQ document for admin edit
// @access  Private/Admin
router.get('/admin', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc = await FaqSettings.findOne({ key: 'default' })
    if (!doc) {
      doc = await FaqSettings.create({ key: 'default', ...defaults })
    }
    res.json({ success: true, data: doc })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/faq
// @desc    Update FAQ
// @access  Private/Admin
router.put('/', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { title, items } = req.body
    let doc = await FaqSettings.findOne({ key: 'default' })
    if (!doc) {
      doc = await FaqSettings.create({ key: 'default', ...defaults })
    }
    if (title !== undefined) doc.title = title
    if (Array.isArray(items)) {
      doc.items = items.map((item: { question?: string; answerHtml?: string }) => ({
        question: typeof item.question === 'string' ? item.question : '',
        answerHtml: typeof item.answerHtml === 'string' ? item.answerHtml : '',
      }))
    }
    await doc.save()
    res.json({ success: true, data: doc })
  } catch (error) {
    next(error)
  }
})

export default router
