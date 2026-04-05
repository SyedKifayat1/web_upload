import express from 'express'
import PaymentSettings, { PAYMENT_SETTINGS_KEY } from '../models/PaymentSettings'
import SiteSettings, { SITE_SETTINGS_KEY } from '../models/SiteSettings'

const router = express.Router()

/** Public config for the storefront (payment toggles + VAT for checkout). */
router.get('/', async (_req, res, next) => {
  try {
    const [paymentDoc, siteDoc] = await Promise.all([
      PaymentSettings.findOne({ key: PAYMENT_SETTINGS_KEY }).lean(),
      SiteSettings.findOne({ key: SITE_SETTINGS_KEY }).select('vatPercentage').lean(),
    ])
    const stripePublishableKey =
      paymentDoc?.stripePublishableKey?.trim() || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || ''
    const stripeEnabled = paymentDoc?.stripeEnabled !== false
    const codEnabled = paymentDoc?.codEnabled !== false
    const tabbyEnabled = paymentDoc?.tabbyEnabled === true
    const vatPercentage = typeof siteDoc?.vatPercentage === 'number' && siteDoc.vatPercentage >= 0 ? siteDoc.vatPercentage : 5
    res.json({
      success: true,
      data: { stripePublishableKey, stripeEnabled, codEnabled, tabbyEnabled, vatPercentage },
    })
  } catch (error) {
    next(error)
  }
})

export default router
