import express from 'express'
import OrderSettings, { ORDER_SETTINGS_KEY } from '../models/OrderSettings'

const router = express.Router()

// @route   GET /api/v1/order-settings
// @desc    Get order settings for storefront (e.g. cancellation window)
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    const doc = await OrderSettings.findOne({ key: ORDER_SETTINGS_KEY }).lean()
    const cancellationWindowMinutes = doc?.cancellationWindowMinutes ?? 1440
    res.json({
      success: true,
      data: { cancellationWindowMinutes },
    })
  } catch (error) {
    next(error)
  }
})

export default router
