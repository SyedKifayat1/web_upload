import express from 'express'
import SiteSettings, { SITE_SETTINGS_KEY } from '../models/SiteSettings'

const router = express.Router()

// @route   GET /api/v1/site-settings
// @desc    Get site settings for storefront (store name, logo URL)
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    const doc = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY }).lean() as any
    const logoWidth = typeof doc?.logoWidth === 'number' && doc.logoWidth > 0 ? doc.logoWidth : 180
    const logoHeight = typeof doc?.logoHeight === 'number' && doc.logoHeight > 0 ? doc.logoHeight : 40
    const currencies = Array.isArray(doc?.currencies) && doc.currencies.length > 0 ? doc.currencies : [doc?.currency ?? 'AED']
    const timezones = Array.isArray(doc?.timezones) && doc.timezones.length > 0 ? doc.timezones : [doc?.timezone ?? 'Asia/Dubai']
    res.json({
      success: true,
      data: {
        storeName: doc?.storeName ?? 'Sky Cashmere',
        logoUrl: doc?.logoUrl ?? null,
        logoWidth,
        logoHeight,
        currency: doc?.currency ?? 'AED',
        timezone: doc?.timezone ?? 'Asia/Dubai',
        currencies,
        timezones,
      },
    })
  } catch (error) {
    next(error)
  }
})

export default router
