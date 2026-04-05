import express from 'express'
import AboutSettings, { ABOUT_SETTINGS_KEY } from '../models/AboutSettings'

const router = express.Router()

// @route   GET /api/v1/about-settings
// @desc    Get about page content for storefront
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    const doc = await AboutSettings.findOne({ key: ABOUT_SETTINGS_KEY }).lean()
    if (!doc) {
      return res.json({ success: true, data: null })
    }
    const { key, _id, __v, createdAt, ...data } = doc as any
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

export default router
