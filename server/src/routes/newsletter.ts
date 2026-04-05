import express from 'express'
import NewsletterSubscriber from '../models/NewsletterSubscriber'
import { protect, checkPermission } from '../middleware/auth'

const router = express.Router()

/** POST /api/v1/newsletter/subscribe - Public newsletter signup */
router.post('/subscribe', async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email is required.' })
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : ''

    const existing = await NewsletterSubscriber.findOne({ email })
    if (existing) {
      if (existing.unsubscribedAt) {
        existing.unsubscribedAt = undefined
        existing.subscribedAt = new Date()
        if (name) existing.name = name
        await existing.save()
      }
      return res.json({ success: true, message: 'You are subscribed to our newsletter.' })
    }

    await NewsletterSubscriber.create({ email, name: name || undefined })
    res.status(201).json({ success: true, message: 'Thank you for subscribing to our newsletter.' })
  } catch (error: unknown) {
    const err = error as { code?: number }
    if (err?.code === 11000) {
      return res.json({ success: true, message: 'You are subscribed to our newsletter.' })
    }
    next(error)
  }
})

/** GET /api/v1/newsletter/subscribers - List newsletter subscribers (admin) */
router.get('/subscribers', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    const status = (req.query.status as string) || 'active' // active | unsubscribed | all
    const query: Record<string, unknown> = {}
    if (status === 'active') query.unsubscribedAt = { $in: [null, undefined] }
    if (status === 'unsubscribed') query.unsubscribedAt = { $ne: null }
    const subscribers = await NewsletterSubscriber.find(query)
      .sort({ subscribedAt: -1 })
      .lean()
    const total = await NewsletterSubscriber.countDocuments(query)
    res.json({
      success: true,
      data: {
        subscribers: subscribers.map((s) => ({
          _id: s._id,
          email: s.email,
          name: s.name || '',
          subscribedAt: s.subscribedAt,
          unsubscribedAt: s.unsubscribedAt || null,
        })),
        total,
      },
    })
  } catch (error) {
    next(error)
  }
})

export default router
