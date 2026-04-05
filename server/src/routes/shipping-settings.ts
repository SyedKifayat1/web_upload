import express from 'express'
import ShippingSettings, { SHIPPING_SETTINGS_KEY } from '../models/ShippingSettings'
import ShippingMethod from '../models/ShippingMethod'

const router = express.Router()

// @route   GET /api/v1/shipping-settings
// @desc    Get shipping settings and methods for storefront
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    const doc = await ShippingSettings.findOne({ key: SHIPPING_SETTINGS_KEY }).lean()
    const flatRate = doc?.flatRate ?? 0
    const freeShippingAbove = doc?.freeShippingAbove ?? null
    const methods = await ShippingMethod.find().sort({ order: 1 }).lean()
    const methodsList = methods.map((m: any) => ({
      id: m._id.toString(),
      name: m.name,
      price: m.price,
      deliveryDescription: m.deliveryDescription || '',
      freeShippingAbove: m.freeShippingAbove ?? null,
      isDefault: m.isDefault === true,
      order: m.order,
    }))
    res.json({
      success: true,
      data: { flatRate, freeShippingAbove, methods: methodsList },
    })
  } catch (error) {
    next(error)
  }
})

export default router
