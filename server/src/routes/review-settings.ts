import express from 'express'
import ReviewSettings, { REVIEW_SETTINGS_KEY } from '../models/ReviewSettings'

const router = express.Router()

// @route   GET /api/v1/review-settings
// @desc    Get review display settings (public, for storefront)
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    let showDateOnReviews = true
    const doc = await ReviewSettings.findOne({ key: REVIEW_SETTINGS_KEY }).lean()
    if (doc) {
      showDateOnReviews = doc.showDateOnReviews !== false
    } else {
      const created = await ReviewSettings.create({ key: REVIEW_SETTINGS_KEY, showDateOnReviews: true })
      showDateOnReviews = created.showDateOnReviews !== false
    }
    res.json({
      success: true,
      data: { showDateOnReviews },
    })
  } catch (error) {
    next(error)
  }
})

export default router
