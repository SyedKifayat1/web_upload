import express from 'express'
import BlogSettings, { BLOG_SETTINGS_KEY } from '../models/BlogSettings'

const router = express.Router()

// @route   GET /api/v1/blog-settings
// @desc    Get blog page settings (banner image URL) for storefront
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    let bannerImageUrl = ''
    const doc = await BlogSettings.findOne({ key: BLOG_SETTINGS_KEY }).lean()
    if (doc && doc.bannerImageUrl) {
      bannerImageUrl = doc.bannerImageUrl
    }
    res.json({
      success: true,
      data: { bannerImageUrl },
    })
  } catch (error) {
    next(error)
  }
})

export default router
