import express from 'express'
import TrustIndicatorSection from '../models/TrustIndicatorSection'
import { protect, checkPermission } from '../middleware/auth'

const router = express.Router()

const defaultIndicators = [
  { icon: 'shipping', title: 'Free Shipping', description: 'On orders over AED 500', color: 'text-green-600' },
  { icon: 'returns', title: 'Easy Returns', description: '30-day hassle-free return policy', color: 'text-blue-600' },
  { icon: 'secure', title: 'Secure Payment', description: 'SSL encrypted secure checkout', color: 'text-purple-600' },
  { icon: 'support', title: '24/7 Support', description: 'Dedicated customer service team', color: 'text-orange-600' },
]

// @route   GET /api/v1/trust-indicators
// @desc    Get trust indicators (public)
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    let doc = await TrustIndicatorSection.findOne({ key: 'home' })
    if (!doc) {
      doc = await TrustIndicatorSection.create({ key: 'home', indicators: defaultIndicators })
    }
    const indicators = Array.isArray(doc.indicators) && doc.indicators.length > 0 ? doc.indicators : defaultIndicators
    res.json({ success: true, data: { indicators } })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/trust-indicators/admin
// @desc    Get trust indicators for admin
// @access  Private/Admin
router.get('/admin', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc = await TrustIndicatorSection.findOne({ key: 'home' })
    if (!doc) {
      doc = await TrustIndicatorSection.create({ key: 'home', indicators: defaultIndicators })
    }
    res.json({ success: true, data: doc })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/trust-indicators
// @desc    Update trust indicators
// @access  Private/Admin
router.put('/', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { indicators } = req.body
    let doc = await TrustIndicatorSection.findOne({ key: 'home' })
    if (!doc) {
      doc = await TrustIndicatorSection.create({ key: 'home', indicators: defaultIndicators })
    }
    if (Array.isArray(indicators) && indicators.length > 0) {
      doc.indicators = indicators
      await doc.save()
    }
    res.json({ success: true, data: doc })
  } catch (error) {
    next(error)
  }
})

export default router
