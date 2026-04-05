import express from 'express'
import fs from 'fs'
import path from 'path'
import mongoose from 'mongoose'
import Order from '../models/Order'
import Product from '../models/Product'
import Review from '../models/Review'
import ReviewSettings, { REVIEW_SETTINGS_KEY } from '../models/ReviewSettings'
import BlogSettings, { BLOG_SETTINGS_KEY } from '../models/BlogSettings'
import AboutSettings, { ABOUT_SETTINGS_KEY } from '../models/AboutSettings'
import ShippingSettings, { SHIPPING_SETTINGS_KEY } from '../models/ShippingSettings'
import OrderSettings, { ORDER_SETTINGS_KEY } from '../models/OrderSettings'
import SiteSettings, { SITE_SETTINGS_KEY } from '../models/SiteSettings'
import PaymentSettings, { PAYMENT_SETTINGS_KEY } from '../models/PaymentSettings'
import EmailSettings, { EMAIL_SETTINGS_KEY } from '../models/EmailSettings'
import StorageSettings, { STORAGE_SETTINGS_KEY } from '../models/StorageSettings'
import ShippingMethod from '../models/ShippingMethod'
import BlogPost from '../models/BlogPost'
import User from '../models/User'
import { protect, checkPermission } from '../middleware/auth'
import { encryptField } from '../utils/fieldEncryption'
import { clearR2ClientCache } from '../services/r2Storage'
import {
  syncSiteLogoMediaUsage,
  syncAboutPageMediaUsage,
  syncBlogBannerMediaUsage,
} from '../services/mediaTracking'
import { restockOrderItem } from '../services/stock'
import { getDefaultOrderConfirmationTemplate } from '../services/email'
import { recalcOrderDiscountForEligibleItems } from './orders'
import { emitOrderUpdate } from '../config/socket'

const router = express.Router()

// Product images manifest for resolving imageFolder URLs (same logic as cart)
let productImagesManifest: Record<string, string[]> | null = null
function getProductImagesManifest(): Record<string, string[]> | null {
  if (productImagesManifest !== null) return productImagesManifest
  const candidates = [
    path.join(process.cwd(), 'client', 'public', 'product_images', 'manifest.json'),
    path.join(process.cwd(), '..', 'client', 'public', 'product_images', 'manifest.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8')
        productImagesManifest = JSON.parse(raw) as Record<string, string[]>
        return productImagesManifest
      }
    } catch {
      continue
    }
  }
  return null
}

function getOrderItemDisplayImageUrl(
  product: any,
  manifest: Record<string, string[]> | null,
  itemVariants?: Record<string, string> | null
): string | null {
  if (!product) return null
  const colorKey = product.variants?.length && itemVariants
    ? (Object.keys(itemVariants).find((k) => /^colou?r$/i.test(k)) ?? null)
    : null
  const colorValue = colorKey ? itemVariants?.[colorKey] : null
  if (colorValue && product.variants) {
    for (const v of product.variants) {
      if (!/^colou?r$/i.test(v.name)) continue
      const option = v.options?.find((o: any) =>
        (o.value || '').toString().trim().toLowerCase() === String(colorValue).trim().toLowerCase()
      )
      if (option) {
        const optImg =
          option.image ||
          (option.images?.[0] ? (typeof option.images[0] === 'string' ? option.images[0] : option.images[0]?.url) : null)
        if (optImg) return optImg
        break
      }
    }
  }
  const fromApi = product.images?.[0]
    ? (typeof product.images[0] === 'string' ? product.images[0] : product.images[0]?.url)
    : null
  if (fromApi) return fromApi
  const folder = product.imageFolder
  if (folder && manifest?.[folder]?.[0]) {
    return `/product_images/${folder}/${manifest[folder][0]}`
  }
  return null
}

// @route   GET /api/v1/admin/products
// @desc    Get all products (including drafts) for admin
// @access  Private/Admin
router.get('/products', protect, checkPermission('products:view'), async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort = '-createdAt',
      category,
      published,
      search,
      bestSelling,
    } = req.query

    const query: any = {}
    if (published !== undefined && published !== 'all') {
      query.published = published === 'true'
    }
    if (bestSelling !== undefined && bestSelling !== 'all') {
      query.bestSelling = bestSelling === 'true'
    }
    if (category) query.category = category
    const searchStr = typeof search === 'string' ? search.trim() : ''
    if (searchStr) {
      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      query.$or = [
        { $text: { $search: searchStr } },
        { sku: new RegExp(escapeRegex(searchStr), 'i') },
      ]
    }

    const products = await Product.find(query)
      .populate('category', 'name slug')
      .sort(sort as string)
      .limit(Number(limit) * 1)
      .skip((Number(page) - 1) * Number(limit))

    const total = await Product.countDocuments(query)

    res.json({
      success: true,
      data: products,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/reviews
// @desc    Get all reviews (with filters)
// @access  Private/Admin
router.get('/reviews', protect, checkPermission('reviews:view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 20, sort = '-createdAt', approved, product: productId } = req.query
    const query: any = {}
    if (approved !== undefined && approved !== '' && approved !== 'all') {
      const isApproved = String(approved) === 'true'
      query.approved = isApproved ? true : { $ne: true }  // Pending: false, null, or missing
    }
    if (productId) query.product = productId

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('product', 'name slug')
        .sort(sort as string)
        .limit(Number(limit) * 1)
        .skip((Number(page) - 1) * Number(limit))
        .lean(),
      Review.countDocuments(query),
    ])

    res.json({
      success: true,
      data: reviews,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/admin/reviews
// @desc    Create a review (admin)
// @access  Private/Admin
router.post('/reviews', protect, checkPermission('reviews:create'), async (req: any, res, next) => {
  try {
    const { product, reviewerName, reviewerEmail, rating, comment, verified, approved, reviewDate } = req.body

    if (!product) {
      return res.status(400).json({ success: false, error: 'Product is required' })
    }
    const prod = await Product.findById(product)
    if (!prod) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }
    if (!reviewerName || typeof reviewerName !== 'string' || reviewerName.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Name is required' })
    }
    const email = reviewerEmail?.trim?.()?.toLowerCase?.()
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Valid email is required' })
    }
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5' })
    }
    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Comment is required' })
    }

    const reviewPayload: any = {
      product,
      reviewerName: reviewerName.trim(),
      reviewerEmail: email,
      rating: Number(rating),
      comment: comment.trim(),
      verified: !!verified,
      approved: !!approved,
    }
    if (reviewDate) {
      const d = new Date(reviewDate)
      if (!isNaN(d.getTime())) reviewPayload.reviewDate = d
    }
    const review = await Review.create(reviewPayload)

    if (approved) {
      const productId = mongoose.Types.ObjectId.isValid(product) ? new mongoose.Types.ObjectId(product) : product
      const stats = await Review.aggregate([
        { $match: { product: productId, approved: true } },
        { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
      await Product.findByIdAndUpdate(product, {
        rating: stats[0] ? Math.round(stats[0].avgRating * 10) / 10 : rating,
        reviewCount: stats[0]?.count ?? 1,
      })
    }

    res.status(201).json({ success: true, data: review })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/admin/reviews/:id
// @desc    Update review (approve/reject, or edit)
// @access  Private/Admin
router.put('/reviews/:id', protect, checkPermission('reviews:update'), async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.id)
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found' })
    }

    const { reviewerName, reviewerEmail, rating, comment, verified, approved } = req.body
    const oldApproved = review.approved
    if (reviewerName !== undefined) review.reviewerName = String(reviewerName).trim()
    if (reviewerEmail !== undefined) review.reviewerEmail = String(reviewerEmail).trim().toLowerCase()
    if (rating !== undefined) review.rating = Number(rating)
    if (comment !== undefined) review.comment = String(comment).trim()
    if (verified !== undefined) review.verified = !!verified
    if (approved !== undefined) (review as any).approved = !!approved

    await review.save()

    if (approved !== undefined && approved !== oldApproved) {
      const stats = await Review.aggregate([
        { $match: { product: review.product, approved: true } },
        { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
      await Product.findByIdAndUpdate(review.product, {
        rating: stats[0] ? Math.round(stats[0].avgRating * 10) / 10 : 0,
        reviewCount: stats[0]?.count ?? 0,
      })
    }

    res.json({ success: true, data: review })
  } catch (error) {
    next(error)
  }
})

// @route   DELETE /api/v1/admin/reviews/:id
// @desc    Delete review
// @access  Private/Admin
router.delete('/reviews/:id', protect, checkPermission('reviews:delete'), async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.id)
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found' })
    }
    const productId = review.product
    await review.deleteOne()

    const stats = await Review.aggregate([
      { $match: { product: productId, approved: true } },
      { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ])
    await Product.findByIdAndUpdate(productId, {
      rating: stats[0] ? Math.round(stats[0].avgRating * 10) / 10 : 0,
      reviewCount: stats[0]?.count ?? 0,
    })

    res.json({ success: true, message: 'Review deleted' })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/review-settings
// @desc    Get review display settings (show date on reviews)
// @access  Private/Admin
router.get('/review-settings', protect, checkPermission('reviews:view'), async (req, res, next) => {
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

// @route   PUT /api/v1/admin/review-settings
// @desc    Update review display settings
// @access  Private/Admin
router.put('/review-settings', protect, checkPermission('reviews:update'), async (req, res, next) => {
  try {
    const { showDateOnReviews } = req.body
    const doc = await ReviewSettings.findOneAndUpdate(
      { key: REVIEW_SETTINGS_KEY },
      { key: REVIEW_SETTINGS_KEY, showDateOnReviews: showDateOnReviews !== false },
      { new: true, upsert: true }
    )
    res.json({
      success: true,
      data: { showDateOnReviews: doc.showDateOnReviews !== false },
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/blog/posts
// @desc    List all blog posts for admin (including drafts); used e.g. for related-posts selector
// @access  Private/Admin (blog:view)
router.get('/blog/posts', protect, checkPermission('blog:view'), async (req, res, next) => {
  try {
    const { limit = 200 } = req.query
    const posts = await BlogPost.find({})
      .select('_id title slug published')
      .sort('-createdAt')
      .limit(Number(limit))
      .lean()
    res.json({
      success: true,
      data: posts,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/blog-settings
// @desc    Get blog page settings (banner image)
// @access  Private/Admin (blog:view)
router.get('/blog-settings', protect, checkPermission('blog:view'), async (req, res, next) => {
  try {
    let bannerImageUrl = ''
    const doc = await BlogSettings.findOne({ key: BLOG_SETTINGS_KEY }).lean()
    if (doc && doc.bannerImageUrl) bannerImageUrl = doc.bannerImageUrl
    res.json({
      success: true,
      data: { bannerImageUrl },
    })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/admin/blog-settings
// @desc    Update blog page settings (banner image URL)
// @access  Private/Admin (blog:update)
router.put('/blog-settings', protect, checkPermission('blog:update'), async (req, res, next) => {
  try {
    const { bannerImageUrl } = req.body
    const doc = await BlogSettings.findOneAndUpdate(
      { key: BLOG_SETTINGS_KEY },
      { key: BLOG_SETTINGS_KEY, bannerImageUrl: typeof bannerImageUrl === 'string' ? bannerImageUrl : '' },
      { new: true, upsert: true }
    )
    await syncBlogBannerMediaUsage()
    res.json({
      success: true,
      data: { bannerImageUrl: doc.bannerImageUrl || '' },
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/about-settings
// @desc    Get about page settings for admin edit
// @access  Private/Admin (settings:view)
router.get('/about-settings', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    const doc = await AboutSettings.findOne({ key: ABOUT_SETTINGS_KEY }).lean()
    if (!doc) {
      return res.json({ success: true, data: null })
    }
    const { key, _id, __v, createdAt, updatedAt, ...data } = doc as any
    res.json({ success: true, data: { ...data, updatedAt: (doc as any).updatedAt } })
  } catch (error) {
    next(error)
  }
})

const ABOUT_SECTION_KEYS = ['hero', 'brandStory', 'craftsmanship', 'philosophy', 'whyChoose', 'sustainability', 'missionVision', 'customerPromise', 'cta'] as const

// @route   PUT /api/v1/admin/about-settings
// @desc    Update about page settings and section visibility
// @access  Private/Admin (settings:update)
router.put('/about-settings', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const body = req.body || {}
    const update: Record<string, unknown> = {}
    for (const key of ABOUT_SECTION_KEYS) {
      if (body[key] && typeof body[key] === 'object') {
        update[key] = body[key]
      }
    }
    let doc = await AboutSettings.findOne({ key: ABOUT_SETTINGS_KEY })
    if (!doc) {
      doc = new AboutSettings({ key: ABOUT_SETTINGS_KEY })
      await doc.save()
    }
    doc.set(update)
    await doc.save()
    await syncAboutPageMediaUsage()
    const out = doc.toObject()
    const { key, _id, __v, createdAt, ...data } = out as any
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/shipping-settings
// @desc    Get shipping settings for admin
// @access  Private/Admin (settings:view)
router.get('/shipping-settings', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc: any = await ShippingSettings.findOne({ key: SHIPPING_SETTINGS_KEY }).lean()
    if (!doc) {
      const created = await ShippingSettings.create({ key: SHIPPING_SETTINGS_KEY })
      doc = created.toObject()
    }
    const { key, _id, __v, createdAt, ...data } = doc
    res.json({ success: true, data: { ...data, updatedAt: doc.updatedAt } })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/admin/shipping-settings
// @desc    Update shipping settings (flat rate, free shipping threshold)
// @access  Private/Admin (settings:update)
router.put('/shipping-settings', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { flatRate, freeShippingAbove } = req.body || {}
    let doc = await ShippingSettings.findOne({ key: SHIPPING_SETTINGS_KEY })
    if (!doc) {
      doc = new ShippingSettings({ key: SHIPPING_SETTINGS_KEY })
      await doc.save()
    }
    const flatNum = typeof flatRate === 'number' ? flatRate : parseFloat(flatRate)
    if (!Number.isNaN(flatNum) && flatNum >= 0) doc.flatRate = flatNum
    if (freeShippingAbove === null || freeShippingAbove === '' || freeShippingAbove === undefined) {
      doc.freeShippingAbove = null
    } else {
      const aboveNum = typeof freeShippingAbove === 'number' ? freeShippingAbove : parseFloat(freeShippingAbove)
      if (!Number.isNaN(aboveNum) && aboveNum >= 0) doc.freeShippingAbove = aboveNum
    }
    await doc.save()
    const out = doc.toObject()
    const { key, _id, __v, createdAt, ...data } = out as any
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/order-settings
// @desc    Get order settings (cancellation window)
// @access  Private/Admin (settings:view)
router.get('/order-settings', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc: any = await OrderSettings.findOne({ key: ORDER_SETTINGS_KEY }).lean()
    if (!doc) {
      const created = await OrderSettings.create({ key: ORDER_SETTINGS_KEY })
      doc = created.toObject()
    }
    const { key, _id, __v, createdAt, ...data } = doc
    res.json({ success: true, data: { ...data, updatedAt: doc.updatedAt } })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/admin/order-settings
// @desc    Update order settings (cancellation window in minutes)
// @access  Private/Admin (settings:update)
router.put('/order-settings', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { cancellationWindowMinutes } = req.body || {}
    let doc = await OrderSettings.findOne({ key: ORDER_SETTINGS_KEY })
    if (!doc) {
      doc = new OrderSettings({ key: ORDER_SETTINGS_KEY })
      await doc.save()
    }
    const num = typeof cancellationWindowMinutes === 'number' ? cancellationWindowMinutes : parseFloat(cancellationWindowMinutes)
    if (!Number.isNaN(num) && num >= 0) doc.cancellationWindowMinutes = Math.round(num)
    await doc.save()
    const out = doc.toObject()
    const { key, _id, __v, createdAt, ...data } = out as any
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/payment-settings
// @desc    Get payment gateway settings (Stripe keys; secret is masked)
// @access  Private/Admin (settings:view)
router.get('/payment-settings', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc: any = await PaymentSettings.findOne({ key: PAYMENT_SETTINGS_KEY }).lean()
    if (!doc) {
      const created = await PaymentSettings.create({ key: PAYMENT_SETTINGS_KEY })
      doc = created.toObject()
    }
    const { key, _id, __v, createdAt, stripeSecretKey, tabbySecretKey, ...rest } = doc
    const data = {
      ...rest,
      stripePublishableKey: doc.stripePublishableKey ?? '',
      stripeSecretKeyMasked: doc.stripeSecretKey
        ? `${doc.stripeSecretKey.slice(0, 7)}••••${doc.stripeSecretKey.slice(-4)}`
        : '',
      stripeEnabled: doc.stripeEnabled !== false,
      codEnabled: doc.codEnabled !== false,
      tabbyPublicKey: doc.tabbyPublicKey ?? '',
      tabbySecretKeyMasked: doc.tabbySecretKey
        ? `${doc.tabbySecretKey.slice(0, 7)}••••${doc.tabbySecretKey.slice(-4)}`
        : '',
      tabbyEnabled: doc.tabbyEnabled === true,
      tabbyMerchantCode: doc.tabbyMerchantCode ?? '',
      updatedAt: doc.updatedAt,
    }
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/admin/payment-settings
// @desc    Update payment gateway settings (Stripe publishable and secret key)
// @access  Private/Admin (settings:update)
router.put('/payment-settings', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const {
      stripePublishableKey,
      stripeSecretKey,
      stripeEnabled,
      codEnabled,
      tabbyPublicKey,
      tabbySecretKey,
      tabbyEnabled,
      tabbyMerchantCode,
    } = req.body || {}
    let doc = await PaymentSettings.findOne({ key: PAYMENT_SETTINGS_KEY })
    if (!doc) {
      doc = new PaymentSettings({ key: PAYMENT_SETTINGS_KEY })
      await doc.save()
    }
    if (typeof stripePublishableKey === 'string') {
      doc.stripePublishableKey = stripePublishableKey.trim() || null
    }
    if (typeof stripeSecretKey === 'string') {
      doc.stripeSecretKey = stripeSecretKey.trim() || null
    }
    if (typeof stripeEnabled === 'boolean') doc.stripeEnabled = stripeEnabled
    if (typeof codEnabled === 'boolean') doc.codEnabled = codEnabled
    if (typeof tabbyPublicKey === 'string') {
      doc.tabbyPublicKey = tabbyPublicKey.trim() || null
    }
    if (typeof tabbySecretKey === 'string') {
      doc.tabbySecretKey = tabbySecretKey.trim() || null
    }
    if (typeof tabbyEnabled === 'boolean') doc.tabbyEnabled = tabbyEnabled
    if (typeof tabbyMerchantCode === 'string') {
      doc.tabbyMerchantCode = tabbyMerchantCode.trim() || null
    }
    await doc.save()
    const out = doc.toObject() as any
    res.json({
      success: true,
      data: {
        stripePublishableKey: out.stripePublishableKey ?? '',
        stripeSecretKeyMasked: out.stripeSecretKey
          ? `${out.stripeSecretKey.slice(0, 7)}••••${out.stripeSecretKey.slice(-4)}`
          : '',
        stripeEnabled: out.stripeEnabled !== false,
        codEnabled: out.codEnabled !== false,
        tabbyPublicKey: out.tabbyPublicKey ?? '',
        tabbySecretKeyMasked: out.tabbySecretKey
          ? `${out.tabbySecretKey.slice(0, 7)}••••${out.tabbySecretKey.slice(-4)}`
          : '',
        tabbyEnabled: out.tabbyEnabled === true,
        tabbyMerchantCode: out.tabbyMerchantCode ?? '',
        updatedAt: out.updatedAt,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/storage-settings
// @desc    R2/CDN settings (secrets masked; never returns raw keys)
// @access  Private/Admin (settings:view)
router.get('/storage-settings', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc: any = await StorageSettings.findOne({ key: STORAGE_SETTINGS_KEY }).lean()
    if (!doc) {
      const created = await StorageSettings.create({ key: STORAGE_SETTINGS_KEY })
      doc = created.toObject()
    }
    const envFallback = {
      R2_ENDPOINT: process.env.R2_ENDPOINT || '',
      R2_BUCKET: process.env.R2_BUCKET || '',
      CDN_URL: process.env.CDN_URL || '',
    }
    const hasDbAccess = Boolean(doc.r2AccessKeyEnc?.trim())
    const hasDbSecret = Boolean(doc.r2SecretKeyEnc?.trim())
    const hasEnvAccess = Boolean((process.env.R2_ACCESS_KEY || '').trim())
    const hasEnvSecret = Boolean((process.env.R2_SECRET_KEY || '').trim())

    res.json({
      success: true,
      data: {
        R2_ENDPOINT: doc.r2Endpoint?.trim() || envFallback.R2_ENDPOINT,
        R2_BUCKET: doc.r2Bucket?.trim() || envFallback.R2_BUCKET,
        CDN_URL: doc.cdnUrl?.trim() || envFallback.CDN_URL,
        R2_ACCESS_KEY_MASKED: hasDbAccess || hasEnvAccess ? '••••••••' : '',
        R2_SECRET_KEY_MASKED: hasDbSecret || hasEnvSecret ? '••••••••' : '',
        hasR2AccessKey: hasDbAccess || hasEnvAccess,
        hasR2SecretKey: hasDbSecret || hasEnvSecret,
        updatedAt: doc.updatedAt,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/admin/storage-settings
// @desc    Update R2/CDN (encrypts access/secret in DB)
// @access  Private/Admin (settings:update)
router.put('/storage-settings', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { R2_ENDPOINT, R2_BUCKET, CDN_URL, R2_ACCESS_KEY, R2_SECRET_KEY } = req.body || {}

    let doc = await StorageSettings.findOne({ key: STORAGE_SETTINGS_KEY })
    if (!doc) {
      doc = new StorageSettings({ key: STORAGE_SETTINGS_KEY })
    }

    if (typeof R2_ENDPOINT === 'string') doc.r2Endpoint = R2_ENDPOINT.trim()
    if (typeof R2_BUCKET === 'string') doc.r2Bucket = R2_BUCKET.trim()
    if (typeof CDN_URL === 'string') doc.cdnUrl = CDN_URL.trim()

    if (typeof R2_ACCESS_KEY === 'string') {
      const v = R2_ACCESS_KEY.trim()
      if (v) doc.r2AccessKeyEnc = encryptField(v)
    }
    if (typeof R2_SECRET_KEY === 'string') {
      const v = R2_SECRET_KEY.trim()
      if (v) doc.r2SecretKeyEnc = encryptField(v)
    }

    await doc.save()
    clearR2ClientCache()
    const out = doc.toObject() as any

    res.json({
      success: true,
      data: {
        R2_ENDPOINT: out.r2Endpoint ?? '',
        R2_BUCKET: out.r2Bucket ?? '',
        CDN_URL: out.cdnUrl ?? '',
        R2_ACCESS_KEY_MASKED: out.r2AccessKeyEnc ? '••••••••' : '',
        R2_SECRET_KEY_MASKED: out.r2SecretKeyEnc ? '••••••••' : '',
        hasR2AccessKey: Boolean(out.r2AccessKeyEnc?.trim()),
        hasR2SecretKey: Boolean(out.r2SecretKeyEnc?.trim()),
        updatedAt: out.updatedAt,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/email-settings
// @desc    Get email settings (SMTP, from address; password masked)
// @access  Private/Admin (settings:view)
router.get('/email-settings', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc: any = await EmailSettings.findOne({ key: EMAIL_SETTINGS_KEY }).lean()
    if (!doc) {
      const created = await EmailSettings.create({ key: EMAIL_SETTINGS_KEY })
      doc = created.toObject()
    }
    const { smtpPass, ...rest } = doc
    const data = {
      ...rest,
      fromEmail: doc.fromEmail ?? '',
      fromName: doc.fromName ?? '',
      smtpHost: doc.smtpHost ?? '',
      smtpPort: doc.smtpPort ?? 587,
      smtpSecure: doc.smtpSecure === true,
      smtpUser: doc.smtpUser ?? '',
      smtpPassMasked: doc.smtpPass ? '••••••••' : '',
      orderConfirmationEnabled: doc.orderConfirmationEnabled === true,
      restrictOrderToValidEmail: doc.restrictOrderToValidEmail === true,
      orderConfirmationTemplateHtml: doc.orderConfirmationTemplateHtml ?? null,
      defaultOrderConfirmationTemplate: getDefaultOrderConfirmationTemplate(),
      updatedAt: doc.updatedAt,
    }
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/admin/email-settings
// @desc    Update email settings (from address, SMTP, order confirmation toggle, custom template)
// @access  Private/Admin (settings:update)
router.put('/email-settings', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { fromEmail, fromName, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, orderConfirmationEnabled, restrictOrderToValidEmail, orderConfirmationTemplateHtml } = req.body || {}
    let doc = await EmailSettings.findOne({ key: EMAIL_SETTINGS_KEY })
    if (!doc) {
      doc = new EmailSettings({ key: EMAIL_SETTINGS_KEY })
      await doc.save()
    }
    if (typeof fromEmail === 'string') doc.fromEmail = fromEmail.trim() || null
    if (typeof fromName === 'string') doc.fromName = fromName.trim() || null
    if (typeof smtpHost === 'string') doc.smtpHost = smtpHost.trim() || null
    if (typeof smtpPort === 'number' || (typeof smtpPort === 'string' && smtpPort !== '')) {
      const port = Number(smtpPort)
      doc.smtpPort = !Number.isNaN(port) ? port : 587
    }
    if (typeof smtpSecure === 'boolean') doc.smtpSecure = smtpSecure
    if (typeof smtpUser === 'string') doc.smtpUser = smtpUser.trim() || null
    if (typeof smtpPass === 'string' && smtpPass.trim() !== '') doc.smtpPass = smtpPass.trim()
    if (typeof orderConfirmationEnabled === 'boolean') doc.orderConfirmationEnabled = orderConfirmationEnabled
    if (typeof restrictOrderToValidEmail === 'boolean') doc.restrictOrderToValidEmail = restrictOrderToValidEmail
    if (orderConfirmationTemplateHtml !== undefined) {
      doc.orderConfirmationTemplateHtml = typeof orderConfirmationTemplateHtml === 'string' && orderConfirmationTemplateHtml.trim() ? orderConfirmationTemplateHtml.trim() : null
    }
    await doc.save()
    const out = doc.toObject() as any
    res.json({
      success: true,
      data: {
        fromEmail: out.fromEmail ?? '',
        fromName: out.fromName ?? '',
        smtpHost: out.smtpHost ?? '',
        smtpPort: out.smtpPort ?? 587,
        smtpSecure: out.smtpSecure === true,
        smtpUser: out.smtpUser ?? '',
        smtpPassMasked: out.smtpPass ? '••••••••' : '',
        orderConfirmationEnabled: out.orderConfirmationEnabled === true,
        restrictOrderToValidEmail: out.restrictOrderToValidEmail === true,
        orderConfirmationTemplateHtml: out.orderConfirmationTemplateHtml ?? null,
        defaultOrderConfirmationTemplate: getDefaultOrderConfirmationTemplate(),
        updatedAt: out.updatedAt,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/site-settings
// @desc    Get site settings (store name, logo URL)
// @access  Private/Admin (settings:view)
router.get('/site-settings', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let doc: any = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY }).lean()
    if (!doc) {
      const created = await SiteSettings.create({ key: SITE_SETTINGS_KEY })
      doc = created.toObject()
    }
    const { key, _id, __v, createdAt, ...data } = doc
    res.json({ success: true, data: { ...data, updatedAt: doc.updatedAt } })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/admin/site-settings
// @desc    Update site settings (store name, logo URL)
// @access  Private/Admin (settings:update)
router.put('/site-settings', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { storeName, logoUrl, logoWidth, logoHeight, currency, timezone, currencies, timezones, vatPercentage, legalName, companyAddress, trn } = req.body || {}
    let doc = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY })
    if (!doc) {
      doc = new SiteSettings({ key: SITE_SETTINGS_KEY })
      await doc.save()
    }
    const previousLogoUrl = doc.logoUrl ?? null
    if (typeof storeName === 'string' && storeName.trim()) doc.storeName = storeName.trim()
    if (logoUrl !== undefined) doc.logoUrl = logoUrl === null || logoUrl === '' ? null : String(logoUrl)
    const w = typeof logoWidth === 'number' ? logoWidth : parseInt(logoWidth, 10)
    const h = typeof logoHeight === 'number' ? logoHeight : parseInt(logoHeight, 10)
    if (!Number.isNaN(w) && w > 0 && w <= 600) doc.logoWidth = Math.round(w)
    if (!Number.isNaN(h) && h > 0 && h <= 120) doc.logoHeight = Math.round(h)
    if (Array.isArray(currencies) && currencies.length > 0) {
      doc.currencies = currencies.filter((c: unknown) => typeof c === 'string' && c.trim()).map((c: string) => c.trim())
      if (doc.currencies.length > 0) doc.currency = doc.currencies[0]
    } else if (typeof currency === 'string' && currency.trim()) doc.currency = currency.trim()
    if (Array.isArray(timezones) && timezones.length > 0) {
      doc.timezones = timezones.filter((t: unknown) => typeof t === 'string' && t.trim()).map((t: string) => t.trim())
      if (doc.timezones.length > 0) doc.timezone = doc.timezones[0]
    } else if (typeof timezone === 'string' && timezone.trim()) doc.timezone = timezone.trim()
    if (typeof vatPercentage === 'number' && vatPercentage >= 0 && vatPercentage <= 100) {
      doc.vatPercentage = vatPercentage
    } else if (vatPercentage !== undefined) {
      const v = parseFloat(vatPercentage)
      if (!Number.isNaN(v) && v >= 0 && v <= 100) doc.vatPercentage = v
    }
    if (typeof legalName === 'string') doc.legalName = legalName.trim()
    if (typeof companyAddress === 'string') doc.companyAddress = companyAddress.trim()
    if (typeof trn === 'string') doc.trn = trn.trim()
    await doc.save()
    if (logoUrl !== undefined) {
      await syncSiteLogoMediaUsage(doc.logoUrl ?? null, previousLogoUrl)
    }
    const out = doc.toObject()
    const { key, _id, __v, createdAt, ...data } = out as any
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/shipping-methods
// @desc    List all shipping methods
// @access  Private/Admin (settings:view)
router.get('/shipping-methods', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    const list = await ShippingMethod.find().sort({ order: 1 }).lean()
    const data = list.map((m: any) => ({
      id: m._id.toString(),
      name: m.name,
      price: m.price,
      deliveryDescription: m.deliveryDescription || '',
      freeShippingAbove: m.freeShippingAbove ?? null,
      isDefault: m.isDefault === true,
      order: m.order,
    }))
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/admin/shipping-methods
// @desc    Create a shipping method
// @access  Private/Admin (settings:update)
router.post('/shipping-methods', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const { name, price, deliveryDescription, order, freeShippingAbove, isDefault } = req.body || {}
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Name is required' })
    }
    const numPrice = typeof price === 'number' ? price : parseFloat(price)
    if (Number.isNaN(numPrice) || numPrice < 0) {
      return res.status(400).json({ success: false, error: 'Valid price is required' })
    }
    const count = await ShippingMethod.countDocuments()
    if (isDefault === true) {
      await ShippingMethod.updateMany({}, { $set: { isDefault: false } })
    }
    const freeAbove = freeShippingAbove === null || freeShippingAbove === '' || freeShippingAbove === undefined
      ? null
      : (typeof freeShippingAbove === 'number' ? freeShippingAbove : parseFloat(freeShippingAbove))
    const doc = await ShippingMethod.create({
      name: name.trim(),
      price: numPrice,
      deliveryDescription: typeof deliveryDescription === 'string' ? deliveryDescription.trim() : '',
      freeShippingAbove: Number.isNaN(freeAbove) || freeAbove == null ? null : freeAbove,
      isDefault: isDefault === true,
      order: typeof order === 'number' ? order : count,
    })
    res.status(201).json({
      success: true,
      data: {
        id: doc._id.toString(),
        name: doc.name,
        price: doc.price,
        deliveryDescription: doc.deliveryDescription || '',
        freeShippingAbove: doc.freeShippingAbove ?? null,
        isDefault: doc.isDefault === true,
        order: doc.order,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/admin/shipping-methods/:id
// @desc    Update a shipping method
// @access  Private/Admin (settings:update)
router.put('/shipping-methods/:id', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const doc = await ShippingMethod.findById(req.params.id)
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Shipping method not found' })
    }
    const { name, price, deliveryDescription, order, freeShippingAbove, isDefault } = req.body || {}
    if (name !== undefined) doc.name = typeof name === 'string' ? name.trim() : doc.name
    if (price !== undefined) {
      const numPrice = typeof price === 'number' ? price : parseFloat(price)
      if (!Number.isNaN(numPrice) && numPrice >= 0) doc.price = numPrice
    }
    if (deliveryDescription !== undefined) doc.deliveryDescription = typeof deliveryDescription === 'string' ? deliveryDescription.trim() : ''
    if (typeof order === 'number') doc.order = order
    if (freeShippingAbove === null || freeShippingAbove === '' || freeShippingAbove === undefined) {
      doc.freeShippingAbove = null
    } else {
      const freeAbove = typeof freeShippingAbove === 'number' ? freeShippingAbove : parseFloat(freeShippingAbove)
      if (!Number.isNaN(freeAbove) && freeAbove >= 0) doc.freeShippingAbove = freeAbove
    }
    if (isDefault === true) {
      await ShippingMethod.updateMany({ _id: { $ne: doc._id } }, { $set: { isDefault: false } })
      doc.isDefault = true
    } else if (isDefault === false) doc.isDefault = false
    await doc.save()
    res.json({
      success: true,
      data: {
        id: doc._id.toString(),
        name: doc.name,
        price: doc.price,
        deliveryDescription: doc.deliveryDescription || '',
        freeShippingAbove: doc.freeShippingAbove ?? null,
        isDefault: doc.isDefault === true,
        order: doc.order,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   DELETE /api/v1/admin/shipping-methods/:id
// @desc    Delete a shipping method
// @access  Private/Admin (settings:update)
router.delete('/shipping-methods/:id', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    const doc = await ShippingMethod.findByIdAndDelete(req.params.id)
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Shipping method not found' })
    }
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

// Parse date range from query for dashboard: range=today|last7|last30|thisMonth|custom, from, to
function getDashboardDateRange(req: { query: Record<string, unknown> }): { start: Date; end: Date; label: string } {
  const range = (req.query.range as string)?.trim().toLowerCase()
  const fromStr = (req.query.from as string)?.trim()
  const toStr = (req.query.to as string)?.trim()
  const dateFmt = /^\d{4}-\d{2}-\d{2}$/
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setHours(0, 0, 0, 0)

  if (range === 'custom' && fromStr && dateFmt.test(fromStr) && toStr && dateFmt.test(toStr)) {
    start.setTime(new Date(fromStr + 'T00:00:00.000Z').getTime())
    const endDate = new Date(toStr + 'T23:59:59.999Z')
    if (endDate >= start) end.setTime(endDate.getTime())
    return { start, end, label: 'Custom' }
  }
  if (range === 'last7') {
    start.setDate(start.getDate() - 6)
    return { start, end, label: 'Last 7 days' }
  }
  if (range === 'last30') {
    start.setDate(start.getDate() - 29)
    return { start, end, label: 'Last 30 days' }
  }
  if (range === 'thismonth') {
    start.setDate(1)
    return { start, end, label: 'This month' }
  }
  // today (default)
  return { start, end, label: 'Today' }
}

// @route   GET /api/v1/admin/dashboard/stats
// @desc    Get dashboard statistics. Query: range=today|last7|last30|thisMonth|custom, from, to (for custom)
// @access  Private/Admin
router.get('/dashboard/stats', protect, checkPermission('dashboard:view'), async (req, res, next) => {
  try {
    const { start: rangeStart, end: rangeEnd, label: rangeLabel } = getDashboardDateRange(req)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [
      totalSalesInRange,
      ordersInRange,
      pendingOrders,
      lowStockProducts,
      adminCount,
      recentOrdersList,
      salesByDay,
    ] = await Promise.all([
      Order.aggregate([
        { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      Order.countDocuments({ status: { $ne: 'cancelled' }, createdAt: { $gte: rangeStart, $lte: rangeEnd } }),
      Order.countDocuments({ status: 'pending' }),
      Product.countDocuments({
        $expr: { $lte: ['$stock', '$lowStockThreshold'] },
        published: true,
      }),
      User.countDocuments({ isAdmin: true }),
      Order.find({ status: { $ne: 'cancelled' } })
        .sort({ createdAt: -1 })
        .limit(8)
        .select('orderNumber total status createdAt')
        .lean(),
      (() => {
        const chartDays = Math.min(90, Math.max(7, parseInt(String(req.query.chartDays), 10) || 14))
        const chartStart = new Date(rangeEnd.getTime() - chartDays * 24 * 60 * 60 * 1000)
        return Order.aggregate([
          { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: chartStart, $lte: rangeEnd } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$total' }, count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ])
      })(),
    ])

    res.json({
      success: true,
      data: {
        totalSales: totalSalesInRange[0]?.total || 0,
        ordersToday: ordersInRange,
        pendingOrders,
        lowStock: lowStockProducts,
        adminCount,
        dateRangeLabel: rangeLabel,
        dateRangeStart: rangeStart.toISOString().slice(0, 10),
        dateRangeEnd: rangeEnd.toISOString().slice(0, 10),
        recentOrders: recentOrdersList.map((o: any) => ({
          orderNumber: o.orderNumber,
          total: o.total,
          status: o.status,
          createdAt: o.createdAt,
        })),
        salesByDay: (salesByDay || []).map((d: any) => ({ date: d._id, total: d.total, count: d.count })),
      },
    })
  } catch (error) {
    next(error)
  }
})

// Build tax report/summary query from request (date range + optional orderStatus, paymentStatus).
function buildTaxQuery(req: { query: Record<string, unknown> }): { query: Record<string, unknown>; start: Date; end: Date } {
  const fromStr = (req.query.from as string)?.trim()
  const toStr = (req.query.to as string)?.trim()
  const dateFmt = /^\d{4}-\d{2}-\d{2}$/
  let start: Date
  let end: Date
  if (fromStr && dateFmt.test(fromStr) && toStr && dateFmt.test(toStr)) {
    start = new Date(fromStr + 'T00:00:00.000Z')
    end = new Date(toStr + 'T23:59:59.999Z')
    if (end < start) end = start
  } else {
    end = new Date()
    start = new Date(end)
    start.setMonth(start.getMonth() - 3)
    start.setHours(0, 0, 0, 0)
  }
  const query: Record<string, unknown> = { createdAt: { $gte: start, $lte: end } }

  const orderStatus = (req.query.orderStatus as string)?.trim().toLowerCase()
  if (orderStatus === 'complete') {
    query.status = { $in: ['delivered', 'shipped', 'processing'] }
  } else if (orderStatus && ['pending', 'processing', 'shipped', 'delivered', 'cancelled'].includes(orderStatus)) {
    query.status = orderStatus
  } else {
    query.status = { $nin: ['cancelled'] }
  }

  const paymentStatus = (req.query.paymentStatus as string)?.trim().toLowerCase()
  if (paymentStatus && ['paid', 'pending', 'failed', 'refunded'].includes(paymentStatus)) {
    query.paymentStatus = paymentStatus
  }

  return { query, start, end }
}

// Derive selling price (excl. tax) and tax from order total (tax-inclusive). Uses VAT % from site settings (default 5).
function getSellingPriceAndTaxFromTotal(orderTotal: number, vatPct: number): { sellingPriceExclTax: number; tax: number } {
  const total = Math.round(Number(orderTotal || 0) * 100) / 100
  if (total <= 0) return { sellingPriceExclTax: 0, tax: 0 }
  const rate = 1 + (vatPct || 0) / 100
  const sellingPriceExclTax = Math.round((total / rate) * 100) / 100
  const tax = Math.round((total - sellingPriceExclTax) * 100) / 100
  return { sellingPriceExclTax, tax }
}

// @route   GET /api/v1/admin/tax/summary
// @desc    Tax summary for date range. Query: from, to (default last 3 months), orderStatus (all|complete|pending|...), paymentStatus (all|paid|pending|...).
// @access  Private/Admin
router.get('/tax/summary', protect, checkPermission('orders:view'), async (req, res, next) => {
  try {
    const { query, start, end } = buildTaxQuery(req)
    const orders = await Order.find(query).select('subtotal tax shipping discount total createdAt orderNumber').lean()
    const siteDoc = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY }).select('vatPercentage').lean()
    const vatPct = typeof siteDoc?.vatPercentage === 'number' && siteDoc.vatPercentage >= 0 ? siteDoc.vatPercentage : 5
    let totalTax = 0
    let totalSubtotal = 0
    for (const o of orders) {
      const tot = Number(o.total) || 0
      const { sellingPriceExclTax, tax } = getSellingPriceAndTaxFromTotal(tot, vatPct)
      totalSubtotal += sellingPriceExclTax
      totalTax += tax
    }
    const totalSales = orders.reduce((s, o) => s + (Number(o.total) || 0), 0)
    const totalShipping = orders.reduce((s, o) => s + (Number(o.shipping) || 0), 0)
    const totalDiscount = orders.reduce((s, o) => s + (Number(o.discount) || 0), 0)
    res.json({
      success: true,
      data: {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        orderCount: orders.length,
        totalTax,
        totalSales,
        totalSubtotal,
        totalShipping,
        totalDiscount,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/tax/report
// @desc    Full tax report: summary + every order with full details. Query: from, to, orderStatus, paymentStatus.
// @access  Private/Admin
router.get('/tax/report', protect, checkPermission('orders:view'), async (req, res, next) => {
  try {
    const { query, start, end } = buildTaxQuery(req)
    const orders = await Order.find(query)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .lean()
    const siteDoc = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY }).select('vatPercentage').lean()
    const vatPct = typeof siteDoc?.vatPercentage === 'number' && siteDoc.vatPercentage >= 0 ? siteDoc.vatPercentage : 5
    let totalTax = 0
    const totalSales = orders.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0)
    const reportOrders = orders.map((o: any) => {
      const tot = Number(o.total) || 0
      const { sellingPriceExclTax, tax } = getSellingPriceAndTaxFromTotal(tot, vatPct)
      totalTax += tax
      return {
        orderId: o._id?.toString(),
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        customerName: o.shippingAddress?.name || o.user?.name || '—',
        customerEmail: o.customerEmail || o.user?.email || '—',
        shippingAddress: o.shippingAddress,
        billingAddress: o.billingAddress,
        items: o.items?.map((i: any) => ({ name: i.name, quantity: i.quantity, price: i.price, lineTotal: (i.quantity || 0) * (i.price || 0) })),
        subtotal: sellingPriceExclTax,
        tax,
        shipping: o.shipping,
        discount: o.discount,
        total: o.total,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        status: o.status,
      }
    })
    res.json({
      success: true,
      data: {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        summary: {
          orderCount: orders.length,
          totalTax,
          totalSales,
        },
        orders: reportOrders,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/orders
// @desc    Get all orders (admin list)
// @access  Private/Admin
router.get('/orders', protect, checkPermission('orders:view'), async (req, res, next) => {
  try {
    const { status, paymentStatus, search, date, dateFrom, dateTo, startISO, endISO, sort = '-createdAt' } = req.query
    const query: any = {}
    if (status && String(status) !== 'all') query.status = status
    if (paymentStatus && String(paymentStatus) !== 'all') query.paymentStatus = paymentStatus
    // Prefer startISO/endISO (client sends local-day boundaries as UTC) so "Today" matches admin timezone
    const startStr = startISO && String(startISO).trim()
    const endStr = endISO && String(endISO).trim()
    if (startStr && endStr) {
      const start = new Date(startStr)
      const end = new Date(endStr)
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        query.createdAt = { $gte: start, $lte: end }
      }
    } else {
      const fromStr = (dateFrom || date) && String(dateFrom || date).trim()
      const toStr = (dateTo || date) && String(dateTo || date).trim()
      const dateFmt = /^\d{4}-\d{2}-\d{2}$/
      if (fromStr && dateFmt.test(fromStr)) {
        const start = new Date(fromStr + 'T00:00:00.000Z')
        const end = toStr && dateFmt.test(toStr)
          ? new Date(toStr + 'T23:59:59.999Z')
          : new Date(fromStr + 'T23:59:59.999Z')
        if (end < start) {
          query.createdAt = { $gte: start, $lte: start }
        } else {
          query.createdAt = { $gte: start, $lte: end }
        }
      }
    }
    if (search && String(search).trim()) {
      const term = String(search).trim()
      const orConditions: any[] = [
        { orderNumber: { $regex: term, $options: 'i' } },
        { 'shippingAddress.name': { $regex: term, $options: 'i' } },
        { 'shippingAddress.phone': { $regex: term, $options: 'i' } },
      ]
      const users = await User.find({
        $or: [
          { email: { $regex: term, $options: 'i' } },
          { name: { $regex: term, $options: 'i' } },
        ],
      }).select('_id')
      const userIds = users.map((u) => u._id)
      if (userIds.length) orConditions.push({ user: { $in: userIds } })
      query.$or = orConditions
    }

    const orders = await Order.find(query)
      .populate('user', 'name email')
      .sort(sort as string)
      .lean()

    res.json({
      success: true,
      data: orders,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/orders/:id
// @desc    Get single order (admin)
// @access  Private/Admin
router.get('/orders/:id', protect, checkPermission('orders:view'), async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name slug images imageFolder variants')
      .populate('user', 'name email')
      .populate('coupon')
      .lean()

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      })
    }

    const manifest = getProductImagesManifest()
    const orderObj = order as any
    if (orderObj.items?.length) {
      orderObj.items = orderObj.items.map((item: any) => ({
        ...item,
        displayImageUrl: getOrderItemDisplayImageUrl(item.product, manifest, item.variants) || undefined,
      }))
    }

    // Recalc discount from coupon eligibility so ineligible replacement products don't show a discount (match client order page)
    if (orderObj.coupon) {
      const effectiveDiscount = await recalcOrderDiscountForEligibleItems(orderObj)
      const currentDiscount = Math.round(Number(orderObj.discount ?? 0) * 100) / 100
      if (Math.abs(effectiveDiscount - currentDiscount) > 0.001) {
        const subtotal = Math.round(Number(orderObj.subtotal ?? 0) * 100) / 100
        const shipping = Math.round(Number(orderObj.shipping ?? 0) * 100) / 100
        orderObj.discount = effectiveDiscount
        orderObj.total = Math.round((subtotal + shipping - effectiveDiscount) * 100) / 100
        await Order.updateOne(
          { _id: req.params.id },
          { $set: { discount: effectiveDiscount, total: orderObj.total } }
        )
      }
    }

    // Sync balance due on delivery with order total and net paid (fixes 16 AED display error)
    const storedBalance = Math.round(Number(orderObj.balanceDueOnDelivery ?? 0) * 100) / 100
    if (storedBalance > 0) {
      const netPaid = Math.round(Number(orderObj.totalPaidByCustomer ?? 0) * 100) / 100 - Math.round(Number(orderObj.totalRefundedToCustomer ?? 0) * 100) / 100
      const expectedBalance = Math.round((Number(orderObj.total ?? 0) - netPaid) * 100) / 100
      if (expectedBalance >= 0 && Math.abs(expectedBalance - storedBalance) > 0.001) {
        orderObj.balanceDueOnDelivery = expectedBalance > 0 ? expectedBalance : undefined
        await Order.updateOne(
          { _id: req.params.id },
          expectedBalance > 0 ? { $set: { balanceDueOnDelivery: expectedBalance } } : { $unset: { balanceDueOnDelivery: '' } }
        )
      }
    }

    res.json({
      success: true,
      data: orderObj,
    })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/admin/orders/:id
// @desc    Update order status and/or payment status (admin)
// @access  Private/Admin
router.put('/orders/:id', protect, checkPermission('orders:update'), async (req, res, next) => {
  try {
    const { status, paymentStatus, refundStatus } = req.body
    const order = await Order.findById(req.params.id)
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      })
    }
    if (status) {
      const wasCancelled = (order.status || '').toLowerCase() === 'cancelled'
      const nowCancelled = (status || '').toLowerCase() === 'cancelled'
      if (nowCancelled && !wasCancelled) {
        // Restock and reverse unitsSold so inventory stays correct (clamp unitsSold to >= 0)
        const items = order.items || []
        for (const item of items) {
          const productId = item.product && (typeof item.product === 'object' && item.product._id ? item.product._id : item.product)
          if (!productId) continue
          const returnableQty = item.quantity - (item.returnedQuantity ?? 0)
          if (returnableQty > 0) {
            await restockOrderItem(productId, item.variants, returnableQty)
          }
          if (item.quantity > 0) {
            await Product.updateOne(
              { _id: productId },
              [{ $set: { unitsSold: { $max: [0, { $add: ['$unitsSold', -item.quantity] }] } } }]
            )
          }
        }
      }
      order.status = status
      if (status === 'shipped' && !order.shippedAt) order.shippedAt = new Date()
      if (status === 'delivered' && !order.deliveredAt) order.deliveredAt = new Date()
      if (status === 'delivered') {
        ;(order as any).balanceDueOnDelivery = undefined
      }
      if (nowCancelled && !wasCancelled) {
        ;(order as any).pendingExchange = undefined
        ;(order as any).refundPending = undefined
        ;(order as any).balanceDueOnDelivery = undefined
        ;(order as any).refundBankDetails = undefined
        ;(order as any).refundStatus = undefined
      }
    }
    if (paymentStatus && ['pending', 'paid', 'failed', 'refunded'].includes(paymentStatus)) {
      order.paymentStatus = paymentStatus
    }
    const validRefundStatuses = ['pending', 'verified', 'processing', 'processed']
    if (refundStatus && validRefundStatuses.includes(refundStatus)) {
      ;(order as any).refundStatus = refundStatus
      if (refundStatus === 'processed') {
        const toRefund = Math.round(((order as any).refundPending ?? 0) * 100) / 100
        ;(order as any).refundPending = undefined
        if (toRefund > 0) {
          const prevRefunded = Math.round(((order as any).totalRefundedToCustomer ?? 0) * 100) / 100
          ;(order as any).totalRefundedToCustomer = Math.round((prevRefunded + toRefund) * 100) / 100
          const history = (order as any).refundHistory || []
          const now = new Date()
          history.forEach((entry: any) => {
            if (entry.status === 'pending') {
              entry.status = 'processed'
              entry.processedAt = now
            }
          })
          ;(order as any).refundHistory = history
        }
      }
    }
    await order.save()
    if (status === 'delivered') {
      await Order.updateOne({ _id: order._id }, { $unset: { balanceDueOnDelivery: '' } })
      delete (order as any).balanceDueOnDelivery
    }
    if (status && (status as string).toLowerCase() === 'cancelled') {
      await Order.updateOne(
        { _id: order._id },
        { $unset: { pendingExchange: '', refundPending: '', balanceDueOnDelivery: '', refundBankDetails: '', refundStatus: '' } }
      )
      delete (order as any).pendingExchange
      delete (order as any).refundPending
      delete (order as any).balanceDueOnDelivery
      delete (order as any).refundBankDetails
      delete (order as any).refundStatus
    }
    if (refundStatus === 'processed' && (order as any).refundPending == null) {
      delete (order as any).refundPending
    }

    emitOrderUpdate(order._id.toString(), order.status, order.user != null ? String(order.user) : undefined)

    res.json({
      success: true,
      data: order,
    })
  } catch (error) {
    next(error)
  }
})

// Helper: restock and reverse unitsSold for an order (used when cancelling or deleting); clamp unitsSold to >= 0
async function restockAndReverseUnitsSold(order: any) {
  const items = order.items || []
  for (const item of items) {
    const productId = item.product && (typeof item.product === 'object' && item.product._id ? item.product._id : item.product)
    if (!productId) continue
    const returnableQty = item.quantity - (item.returnedQuantity ?? 0)
    if (returnableQty > 0) {
      await restockOrderItem(productId, item.variants, returnableQty)
    }
    if (item.quantity > 0) {
      await Product.updateOne(
        { _id: productId },
        [{ $set: { unitsSold: { $max: [0, { $add: ['$unitsSold', -item.quantity] }] } } }]
      )
    }
  }
}

// @route   DELETE /api/v1/admin/orders/:id
// @desc    Delete a single order (restocks if not already cancelled)
// @access  Private/Admin
router.delete('/orders/:id', protect, checkPermission('orders:delete'), async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' })
    }
    const wasCancelled = (order.status || '').toLowerCase() === 'cancelled'
    if (!wasCancelled) {
      await restockAndReverseUnitsSold(order)
    }
    await Order.findByIdAndDelete(req.params.id)
    res.json({ success: true, message: 'Order deleted' })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/admin/orders/bulk-delete
// @desc    Delete multiple orders by ID (restocks each if not already cancelled)
// @access  Private/Admin
router.post('/orders/bulk-delete', protect, checkPermission('orders:delete'), async (req, res, next) => {
  try {
    const { orderIds } = req.body
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ success: false, error: 'orderIds must be a non-empty array' })
    }
    const deleted: string[] = []
    const notFound: string[] = []
    for (const id of orderIds) {
      const order = await Order.findById(id)
      if (!order) {
        notFound.push(String(id))
        continue
      }
      const wasCancelled = (order.status || '').toLowerCase() === 'cancelled'
      if (!wasCancelled) {
        await restockAndReverseUnitsSold(order)
      }
      await Order.findByIdAndDelete(id)
      deleted.push(String(id))
    }
    res.json({
      success: true,
      deleted: deleted.length,
      notFound: notFound.length,
      message: notFound.length > 0
        ? `Deleted ${deleted.length} order(s). ${notFound.length} not found.`
        : `Deleted ${deleted.length} order(s).`,
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/admin/orders/:id/return
// @desc    Record return or exchange for an order item — restocks product/variant and updates order
// @access  Private/Admin
router.post('/orders/:id/return', protect, checkPermission('orders:update'), async (req, res, next) => {
  try {
    const { itemIndex, quantity } = req.body
    const order = await Order.findById(req.params.id)
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' })
    }
    const idx = Number(itemIndex)
    if (Number.isNaN(idx) || idx < 0 || idx >= (order.items?.length ?? 0)) {
      return res.status(400).json({ success: false, error: 'Invalid item index' })
    }
    const qty = Math.floor(Number(quantity))
    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ success: false, error: 'Quantity must be a positive integer' })
    }
    const item = order.items[idx]
    const alreadyReturned = Number(item.returnedQuantity ?? 0)
    const maxReturnable = Math.max(0, item.quantity - alreadyReturned)
    if (qty > maxReturnable) {
      return res.status(400).json({
        success: false,
        error: `At most ${maxReturnable} unit(s) can be returned for this item (${alreadyReturned} already returned)`,
      })
    }
    await restockOrderItem(item.product, item.variants, qty)
    item.returnedQuantity = alreadyReturned + qty
    // Recalculate order subtotal and total from remaining items so totals reflect returns
    let newSubtotal = 0
    for (const i of order.items) {
      const kept = Math.max(0, (i.quantity ?? 0) - (i.returnedQuantity ?? 0))
      newSubtotal += (i.price ?? 0) * kept
    }
    newSubtotal = Math.round(newSubtotal * 100) / 100
    order.subtotal = newSubtotal
    order.tax = 0
    order.total = Math.round((newSubtotal + (order.shipping ?? 0) - (order.discount ?? 0)) * 100) / 100
    await order.save()
    emitOrderUpdate(order._id.toString(), order.status, order.user != null ? String(order.user) : undefined)
    res.json({
      success: true,
      data: order,
      message: `Restocked ${qty} unit(s) for "${item.name}"`,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/users
// @desc    Get all admin users
// @access  Private/Admin
router.get('/users', protect, checkPermission('permissions:manage'), async (req, res, next) => {
  try {
    const admins = await User.find({ isAdmin: true })
      .select('-password')
      .sort({ createdAt: -1 })

    res.json({
      success: true,
      data: admins,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/admin/users/:id
// @desc    Get single admin user
// @access  Private/Admin
router.get('/users/:id', protect, checkPermission('permissions:manage'), async (req, res, next) => {
  try {
    const admin = await User.findById(req.params.id).select('-password')

    if (!admin) {
      return res.status(404).json({
        success: false,
        error: 'Admin user not found',
      })
    }

    if (!admin.isAdmin) {
      return res.status(400).json({
        success: false,
        error: 'User is not an admin',
      })
    }

    res.json({
      success: true,
      data: admin,
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/admin/users
// @desc    Create new admin user
// @access  Private/Admin
router.post('/users', protect, checkPermission('permissions:manage'), async (req, res, next) => {
  try {
    const { name, email, password, permissions, isSuperAdmin } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide name, email, and password',
      })
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters',
      })
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists',
      })
    }

    if (isSuperAdmin === true && !(req as any).user?.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Only super admins can create another super admin',
      })
    }

    // Create admin user
    const admin = await User.create({
      name,
      email,
      password,
      isAdmin: true,
      permissions: permissions || [],
      isSuperAdmin: Boolean(isSuperAdmin) && !!(req as any).user?.isSuperAdmin,
    })

    res.status(201).json({
      success: true,
      data: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        isAdmin: admin.isAdmin,
        isSuperAdmin: admin.isSuperAdmin,
        permissions: admin.permissions,
        createdAt: admin.createdAt,
      },
    })
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists',
      })
    }
    next(error)
  }
})

// @route   PUT /api/v1/admin/users/:id
// @desc    Update admin user
// @access  Private/Admin
router.put('/users/:id', protect, checkPermission('permissions:manage'), async (req, res, next) => {
  try {
    const { name, email, password, permissions, isSuperAdmin } = req.body

    const admin = await User.findById(req.params.id)

    if (!admin) {
      return res.status(404).json({
        success: false,
        error: 'Admin user not found',
      })
    }

    if (!admin.isAdmin) {
      return res.status(400).json({
        success: false,
        error: 'User is not an admin',
      })
    }

    // Update fields
    if (name) admin.name = name
    if (email) {
      // Check if email is already taken by another user
      const existingUser = await User.findOne({ email, _id: { $ne: req.params.id } })
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'Email is already taken by another user',
        })
      }
      admin.email = email
    }
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 6 characters',
        })
      }
      admin.password = password
    }
    if (permissions !== undefined) {
      admin.permissions = permissions
    }
    if (isSuperAdmin !== undefined) {
      if (!(req as any).user?.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Only super admins can change super admin status',
        })
      }
      admin.isSuperAdmin = Boolean(isSuperAdmin)
    }

    await admin.save()

    res.json({
      success: true,
      data: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        isAdmin: admin.isAdmin,
        isSuperAdmin: admin.isSuperAdmin,
        permissions: admin.permissions,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt,
      },
    })
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Email is already taken',
      })
    }
    next(error)
  }
})

// @route   DELETE /api/v1/admin/users/:id
// @desc    Delete admin user
// @access  Private/Admin
router.delete('/users/:id', protect, checkPermission('permissions:manage'), async (req, res, next) => {
  try {
    const admin = await User.findById(req.params.id)

    if (!admin) {
      return res.status(404).json({
        success: false,
        error: 'Admin user not found',
      })
    }

    if (!admin.isAdmin) {
      return res.status(400).json({
        success: false,
        error: 'User is not an admin',
      })
    }

    // Prevent deleting yourself
    if (admin._id.toString() === (req as any).user._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'You cannot delete your own account',
      })
    }

    await User.findByIdAndDelete(req.params.id)

    res.json({
      success: true,
      message: 'Admin user deleted successfully',
    })
  } catch (error) {
    next(error)
  }
})

export default router
