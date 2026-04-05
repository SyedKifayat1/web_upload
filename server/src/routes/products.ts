import express from 'express'
import mongoose from 'mongoose'
import Product from '../models/Product'
import Review from '../models/Review'
import Order from '../models/Order'
import User from '../models/User'
import { protect, checkPermission, optionalProtect } from '../middleware/auth'
import {
  collectMediaKeysFromProduct,
  markMediaUnusedForKeys,
  syncMediaUsageForProduct,
} from '../services/mediaTracking'
import {
  rewriteProductsForPublicResponse,
  rewriteSingleProductForPublicResponse,
} from '../utils/mediaUrlRewrite'

const router = express.Router()

// @route   GET /api/v1/products/category/:categoryId
// @desc    Get products by category
// @access  Public
/** Aggregation $addFields stage: effectiveStock (matches client getProductEffectiveStock logic). */
/** Only treat variant as having per-option stock when at least one option has numeric stock; else use product.stock. */
/** Coerce to number so $match effectiveStock > 0 works even if stock is stored as string. */
const effectiveStockAddFields = {
  effectiveStock: {
    $convert: {
      input: {
        $let: {
          vars: {
            firstVariantWithOptionStock: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: { $ifNull: ['$variants', []] },
                    as: 'v',
                    cond: {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: { $ifNull: ['$$v.options', []] },
                              as: 'opt',
                              cond: {
                                $and: [
                                  { $in: [{ $type: '$$opt.stock' }, ['int', 'double', 'long']] },
                                  { $gte: ['$$opt.stock', 0] },
                                ],
                              },
                            },
                          },
                        },
                        0,
                      ],
                    },
                  },
                },
                0,
              ],
            },
          },
          in: {
            $cond: [
              { $or: [{ $eq: ['$$firstVariantWithOptionStock', null] }, { $eq: [{ $type: '$$firstVariantWithOptionStock' }, 'missing'] }] },
              { $ifNull: ['$stock', 0] },
              {
                $reduce: {
                  input: { $ifNull: ['$$firstVariantWithOptionStock.options', []] },
                  initialValue: 0,
                  in: { $add: ['$$value', { $cond: [{ $in: [{ $type: '$$this.stock' }, ['int', 'double', 'long']] }, { $max: [0, '$$this.stock'] }, 0] }] },
                },
              },
            ],
          },
        },
      },
      to: 'double',
      onError: 0,
      onNull: 0,
    },
  },
}

router.get('/category/:categoryId', async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort = '-createdAt',
      minPrice,
      maxPrice,
      size,
      color,
      sale,
      availability,
    } = req.query

    const query: any = {
      category: req.params.categoryId,
      published: true,
    }

    if (minPrice || maxPrice) {
      query.price = {}
      if (minPrice) query.price.$gte = Number(minPrice)
      if (maxPrice) query.price.$lte = Number(maxPrice)
    }

    if (sale === 'true') {
      query.compareAtPrice = { $exists: true, $gt: 0 }
      query.$expr = { $lt: ['$price', '$compareAtPrice'] }
    }

    // Filter products that have specific size in variants
    if (size) {
      query['variants.options.value'] = { $in: [size] }
    }

    // Filter products that have specific color in variants
    if (color) {
      if (!query.$or) query.$or = []
      query.$or.push(
        { 'variants.options.value': { $regex: color, $options: 'i' } },
        { tags: { $regex: color, $options: 'i' } }
      )
    }

    // Filter by fabric/material tag
    if (req.query.fabric) {
      const fabricTag = { $regex: req.query.fabric as string, $options: 'i' }
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { tags: fabricTag }]
        delete query.$or
      } else {
        query.tags = fabricTag
      }
    }

    if (availability === 'true') {
      const skip = (Number(page) - 1) * Number(limit)
      const sortStr = (sort as string) || '-createdAt'
      const sortField = sortStr.replace(/^-/, '')
      const sortOrder = sortStr.startsWith('-') ? -1 : 1
      const sortStage = { [sortField]: sortOrder }
      const matchQuery = { ...query }
      if (matchQuery.category && mongoose.Types.ObjectId.isValid(matchQuery.category as string)) {
        matchQuery.category = new mongoose.Types.ObjectId(matchQuery.category as string)
      }
      const pipeline: any[] = [
        { $match: matchQuery },
        { $addFields: effectiveStockAddFields },
        { $match: { effectiveStock: { $gt: 0 } } },
        { $sort: sortStage },
        { $skip: skip },
        { $limit: Number(limit) },
      ]
      const [countResult, dataResult] = await Promise.all([
        Product.aggregate([{ $match: matchQuery }, { $addFields: effectiveStockAddFields }, { $match: { effectiveStock: { $gt: 0 } } }, { $count: 'total' }]),
        Product.aggregate(pipeline),
      ])
      const total = countResult[0]?.total ?? 0
      const ids = (dataResult || []).map((d: any) => d._id)
      const products = ids.length
        ? await Product.find({ _id: { $in: ids } })
            .populate('category', 'name slug')
            .populate('design', 'name slug colors')
            .then((docs) => {
              const byId = new Map(docs.map((d: any) => [d._id.toString(), d]))
              return ids.map((id: any) => byId.get(id.toString())).filter(Boolean)
            })
        : []
      const data = await rewriteProductsForPublicResponse(products)
      return res.json({
        success: true,
        data,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      })
    }

    const products = await Product.find(query)
      .populate('category', 'name slug')
      .populate('design', 'name slug colors')
      .sort(sort as string)
      .limit(Number(limit) * 1)
      .skip((Number(page) - 1) * Number(limit))

    const total = await Product.countDocuments(query)

    res.json({
      success: true,
      data: await rewriteProductsForPublicResponse(products),
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

// @route   GET /api/v1/products
// @desc    Get all products with filters
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort = '-createdAt',
      category,
      design,
      featured,
      bestSelling,
      published = true,
      search,
      minPrice,
      maxPrice,
      color,
      fabric,
      sale,
      availability,
    } = req.query

    const query: any = { published }

    if (category) {
      query.category = category
    }
    if (design) {
      query.design = design
    }

    if (featured !== undefined) {
      query.featured = featured === 'true'
    }

    if (bestSelling !== undefined) {
      query.bestSelling = bestSelling === 'true'
    }

    if (search) {
      query.$text = { $search: search as string }
    }

    // Price range filter
    if (minPrice || maxPrice) {
      query.price = {}
      if (minPrice) query.price.$gte = Number(minPrice)
      if (maxPrice) query.price.$lte = Number(maxPrice)
    }

    // Sale/Clearance: has compareAtPrice and price < compareAtPrice
    if (sale === 'true') {
      query.compareAtPrice = { $exists: true, $gt: 0 }
      query.$expr = { $lt: ['$price', '$compareAtPrice'] }
    }

    // Filter products that have specific color in variants
    if (color) {
      query.$or = [
        { 'variants.options.value': { $regex: color, $options: 'i' } },
        { tags: { $regex: color, $options: 'i' } },
      ]
    }

    // Filter by fabric/material tag
    if (fabric) {
      query.tags = { $regex: fabric, $options: 'i' }
    }

    if (availability === 'true') {
      const skip = (Number(page) - 1) * Number(limit)
      const sortStr = (sort as string) || '-createdAt'
      const sortField = sortStr.replace(/^-/, '')
      const sortOrder = sortStr.startsWith('-') ? -1 : 1
      const sortStage = { [sortField]: sortOrder }
      const matchQuery = { ...query }
      if (matchQuery.category && mongoose.Types.ObjectId.isValid(matchQuery.category as string)) {
        matchQuery.category = new mongoose.Types.ObjectId(matchQuery.category as string)
      }
      if (matchQuery.design && mongoose.Types.ObjectId.isValid(matchQuery.design as string)) {
        matchQuery.design = new mongoose.Types.ObjectId(matchQuery.design as string)
      }
      const pipeline: any[] = [
        { $match: matchQuery },
        { $addFields: effectiveStockAddFields },
        { $match: { effectiveStock: { $gt: 0 } } },
        { $sort: sortStage },
        { $skip: skip },
        { $limit: Number(limit) },
      ]
      const [countResult, dataResult] = await Promise.all([
        Product.aggregate([{ $match: matchQuery }, { $addFields: effectiveStockAddFields }, { $match: { effectiveStock: { $gt: 0 } } }, { $count: 'total' }]),
        Product.aggregate(pipeline),
      ])
      const total = countResult[0]?.total ?? 0
      const ids = (dataResult || []).map((d: any) => d._id)
      const products = ids.length
        ? await Product.find({ _id: { $in: ids } })
            .populate('category', 'name slug')
            .populate('design', 'name slug colors')
            .then((docs: any[]) => {
              const byId = new Map(docs.map((d: any) => [d._id.toString(), d]))
              return ids.map((id: any) => byId.get(id.toString())).filter(Boolean)
            })
        : []
      return res.json({
        success: true,
        data: await rewriteProductsForPublicResponse(products),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      })
    }

    const products = await Product.find(query)
      .populate('category', 'name slug')
      .populate('design', 'name slug colors')
      .sort(sort as string)
      .limit(Number(limit) * 1)
      .skip((Number(page) - 1) * Number(limit))

    const total = await Product.countDocuments(query)

    res.json({
      success: true,
      data: await rewriteProductsForPublicResponse(products),
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

// @route   GET /api/v1/products/filter-options
// @desc    Get dynamic filter options (colours from products, min/max price). Optional ?category=&design= to scope.
// @access  Public
router.get('/filter-options', async (req, res, next) => {
  try {
    const baseMatch: Record<string, unknown> = { published: true }
    if (req.query.category && mongoose.Types.ObjectId.isValid(req.query.category as string)) {
      baseMatch.category = new mongoose.Types.ObjectId(req.query.category as string)
    }
    if (req.query.design && mongoose.Types.ObjectId.isValid(req.query.design as string)) {
      baseMatch.design = new mongoose.Types.ObjectId(req.query.design as string)
    }

    // Distinct colours from products: variant option values where variant or option name is Colour/Color
    const colourAgg = await Product.aggregate([
      { $match: baseMatch },
      { $unwind: '$variants' },
      { $unwind: '$variants.options' },
      {
        $match: {
          $or: [
            { 'variants.name': { $regex: /colou?r/i } },
            { 'variants.options.name': { $regex: /colou?r/i } },
          ],
        },
      },
      { $group: { _id: { $toLower: { $trim: { input: '$variants.options.value' } } } } },
      { $sort: { _id: 1 } },
      { $project: { value: '$_id', _id: 0 } },
    ])
    let coloursFromVariants = colourAgg.map((r: any) => (r.value && typeof r.value === 'string' ? r.value.trim() : '')).filter(Boolean)

    // Fallback: if no colours from variant name match, take all option values from first variant (often Colour)
    if (coloursFromVariants.length === 0) {
      const anyOptionAgg = await Product.aggregate([
        { $match: baseMatch as any },
        { $unwind: '$variants' },
        { $unwind: '$variants.options' },
        { $group: { _id: { $toLower: { $trim: { input: '$variants.options.value' } } } } },
        { $sort: { _id: 1 } },
        { $limit: 50 },
      ])
      coloursFromVariants = anyOptionAgg.map((r: any) => (r._id && typeof r._id === 'string' ? r._id.trim() : '')).filter(Boolean)
    }

    // Colour-like tags (expand keyword list to avoid missing product colours)
    const tagAgg = await Product.aggregate([
      { $match: baseMatch },
      { $unwind: '$tags' },
      { $project: { tag: { $toLower: { $trim: { input: '$tags' } } } } },
      { $group: { _id: '$tag' } },
      { $sort: { _id: 1 } },
      { $limit: 200 },
    ])
    const allTags = tagAgg.map((r: any) => r._id).filter(Boolean)
    const colourKeywords = /^(black|white|grey|gray|navy|beige|brown|red|green|blue|pink|cream|ivory|charcoal|multi|burgundy|mustard|olive|tan|camel|mauve|lavender|yellow|orange|purple|mint|teal|gold|silver|bronze|maroon|coral)$/i
    const coloursFromTags = allTags.filter((t: string) => colourKeywords.test(t))
    // Merge and dedupe: no repeated colours, sorted
    const colours = [...new Set([...coloursFromVariants, ...coloursFromTags])]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

    // Min/max price from published products
    const priceAgg = await Product.aggregate([
      { $match: baseMatch as any },
      { $group: { _id: null, minPrice: { $min: '$price' }, maxPrice: { $max: '$price' } } },
    ])
    const minPrice = priceAgg[0]?.minPrice ?? 0
    const maxPrice = priceAgg[0]?.maxPrice ?? 0

    res.json({
      success: true,
      data: {
        colours,
        minPrice: Number(minPrice),
        maxPrice: Number(maxPrice),
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/products/slug/:slug
// @desc    Get product by slug
// @access  Public
router.get('/slug/:slug', async (req, res, next) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, published: true })
      .populate('category', 'name slug')
      .populate('design', 'name slug colors')

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
      })
    }

    res.json({
      success: true,
      data: await rewriteSingleProductForPublicResponse(product),
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/products/reviews/latest
// @desc    Get latest approved reviews across all products (for homepage)
// @access  Public
router.get('/reviews/latest', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 24)
    const reviews = await Review.aggregate([
      { $match: { approved: true } },
      { $addFields: { effectiveDate: { $ifNull: ['$reviewDate', '$createdAt'] } } },
      { $sort: { effectiveDate: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'productDoc',
          pipeline: [{ $project: { name: 1, slug: 1 } }],
        },
      },
      { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          reviewerName: 1,
          rating: 1,
          comment: 1,
          reviewDate: 1,
          createdAt: 1,
          verified: 1,
          productName: '$productDoc.name',
          productSlug: '$productDoc.slug',
        },
      },
    ])

    res.json({
      success: true,
      data: reviews,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/products/:id
// @desc    Get single product
// @access  Public
router.get('/:id', async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).populate('category', 'name slug')
      .populate('design', 'name slug colors')

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
      })
    }

    res.json({
      success: true,
      data: await rewriteSingleProductForPublicResponse(product),
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/products/:id/related
// @desc    Get related products (uses product.relatedProducts when set, else same-category)
// @access  Public
router.get('/:id/related', async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
      })
    }

    let relatedProducts: any[]

    if (
      product.relatedProducts &&
      Array.isArray(product.relatedProducts) &&
      product.relatedProducts.length > 0
    ) {
      relatedProducts = await Product.find({
        _id: { $in: product.relatedProducts },
        published: true,
      }).populate('category', 'name slug')
      .populate('design', 'name slug colors')
      relatedProducts = product.relatedProducts
        .map((id) => relatedProducts.find((p) => p._id.toString() === id.toString()))
        .filter(Boolean)
    } else {
      // No related products explicitly set — return empty so the section is hidden
      relatedProducts = []
    }

    res.json({
      success: true,
      data: await rewriteProductsForPublicResponse(relatedProducts),
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/products/:id/review-stats
// @desc    Get review count and avg rating (live, for product header)
// @access  Public
router.get('/:id/review-stats', async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }
    const stats = await Review.aggregate([
      { $match: { product: product._id, approved: true } },
      { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ])
    res.json({
      success: true,
      data: {
        count: stats[0]?.count ?? 0,
        avgRating: stats[0]?.avgRating ? Math.round(stats[0].avgRating * 10) / 10 : 0,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/products/:id/reviews
// @desc    Get reviews for a product
// @access  Public
router.get('/:id/reviews', async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }

    const { page = 1, limit = 10 } = req.query
    const skip = (Number(page) - 1) * Number(limit)
    const [reviews, total] = await Promise.all([
      Review.aggregate([
        { $match: { product: new mongoose.Types.ObjectId(req.params.id), approved: true } },
        { $addFields: { effectiveDate: { $ifNull: ['$reviewDate', '$createdAt'] } } },
        { $sort: { effectiveDate: -1 } },
        { $skip: skip },
        { $limit: Number(limit) },
      ]),
      Review.countDocuments({ product: req.params.id, approved: true }),
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

// @route   POST /api/v1/products/:id/reviews
// @desc    Create a review (logged-in or guest); verified if reviewer purchased this product
// @access  Public
router.post('/:id/reviews', optionalProtect, async (req: any, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }
    if (!product.published) {
      return res.status(400).json({ success: false, error: 'Product is not available' })
    }

    const { rating, comment, reviewerName: bodyName, reviewerEmail: bodyEmail } = req.body

    // Validate rating and comment
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5' })
    }
    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Comment is required' })
    }

    let reviewerName: string
    let reviewerEmail: string | undefined
    let userId: any
    let verified = false

    const productId = product._id

    if (req.user) {
      // Logged-in user: use user.name and user.email
      reviewerName = req.user.name?.trim?.() || ''
      reviewerEmail = req.user.email?.trim?.()?.toLowerCase?.()
      userId = req.user._id
      if (!reviewerName) {
        return res.status(400).json({ success: false, error: 'Name is required' })
      }
      // Check: has this user purchased THIS product? (same product ID)
      const hasPurchased = await Order.exists({
        user: req.user._id,
        paymentStatus: 'paid',
        'items.product': productId,
      })
      verified = !!hasPurchased
    } else {
      // Guest: require name and email
      reviewerName = typeof bodyName === 'string' ? bodyName.trim() : ''
      reviewerEmail = typeof bodyEmail === 'string' ? bodyEmail.trim().toLowerCase() : ''
      const emailRegex = /^\S+@\S+\.\S+$/
      if (!reviewerName || reviewerName.length === 0) {
        return res.status(400).json({ success: false, error: 'Name is required' })
      }
      if (!reviewerEmail || !emailRegex.test(reviewerEmail)) {
        return res.status(400).json({ success: false, error: 'Valid email is required' })
      }
      // Check: does a user with this email exist and have a paid order with THIS product?
      const userByEmail = await User.findOne({ email: reviewerEmail }).select('_id').lean()
      if (userByEmail) {
        const hasPurchased = await Order.exists({
          user: userByEmail._id,
          paymentStatus: 'paid',
          'items.product': productId,
        })
        verified = !!hasPurchased
      }
    }

    const review = await Review.create({
      product: req.params.id,
      user: userId,
      reviewerName,
      reviewerEmail: reviewerEmail || undefined,
      rating: Number(rating),
      comment: comment.trim(),
      verified,
      approved: false, // Pending admin approval before showing on product page
    })

    // Update product aggregate rating (only approved reviews count)
    const stats = await Review.aggregate([
      { $match: { product: product._id, approved: true } },
      { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ])
    const avgRating = stats[0]?.avgRating ?? rating
    const reviewCount = stats[0]?.count ?? 1
    await Product.findByIdAndUpdate(req.params.id, {
      rating: Math.round(avgRating * 10) / 10,
      reviewCount,
    })

    res.status(201).json({ success: true, data: review })
  } catch (error) {
    next(error)
  }
})

// Generate URL slug from name
function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
}

// @route   POST /api/v1/products
// @desc    Create product
// @access  Private/Admin
router.post('/', protect, checkPermission('products:create'), async (req, res, next) => {
  try {
    const body = { ...req.body }
    if (!body.slug && body.name) {
      body.slug = slugify(body.name)
    }
    if (body.sku && typeof body.sku === 'string') {
      body.sku = body.sku.toUpperCase().trim()
    }
    const product = await Product.create(body)
    await syncMediaUsageForProduct(null, product.toObject() as unknown as Record<string, unknown>)

    res.status(201).json({
      success: true,
      data: product,
    })
  } catch (error) {
    next(error)
  }
})

// @route   PATCH /api/v1/products/:id/variant-stock
// @desc    Update stock for a single variant option (e.g. per-color stock)
// @access  Private/Admin
router.patch('/:id/variant-stock', protect, checkPermission('products:update'), async (req, res, next) => {
  try {
    const { variantIndex, optionIndex, stock, lowStockThreshold } = req.body
    if (
      typeof variantIndex !== 'number' ||
      typeof optionIndex !== 'number' ||
      (stock !== undefined && (typeof stock !== 'number' || stock < 0))
    ) {
      return res.status(400).json({
        success: false,
        error: 'variantIndex and optionIndex (numbers) are required; stock must be a non-negative number if provided',
      })
    }
    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' })
    }
    const v = product.variants?.[variantIndex]
    const option = v?.options?.[optionIndex]
    if (!option) {
      return res.status(400).json({ success: false, error: 'Variant or option index out of range' })
    }
    if (stock !== undefined) option.stock = stock
    if (lowStockThreshold !== undefined && typeof lowStockThreshold === 'number' && lowStockThreshold >= 0) {
      option.lowStockThreshold = lowStockThreshold
    }
    await product.save()
    res.json({ success: true, data: product })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/products/:id
// @desc    Update product
// @access  Private/Admin
router.put('/:id', protect, checkPermission('products:update'), async (req, res, next) => {
  try {
    const body = { ...req.body }
    delete body.unitsSold // updated only when orders are placed; do not allow manual overwrite

    // Preserve or set addedAt on variant options (for New Arrivals: newest color image as main)
    const existing = await Product.findById(req.params.id).lean() as Record<string, unknown> | null
    if (existing?.variants && Array.isArray(body.variants)) {
      const existingAddedAt = new Map<string, Date>()
      for (const v of existing.variants as any[]) {
        const vName = (v?.name || '').toString().trim()
        for (const o of v?.options || []) {
          const oVal = (o?.value ?? '').toString().trim()
          if (oVal && o.addedAt) existingAddedAt.set(`${vName}|${oVal}`, o.addedAt)
        }
      }
      const now = new Date()
      for (const v of body.variants) {
        const vName = (v?.name || '').toString().trim()
        for (const opt of v?.options || []) {
          const oVal = (opt?.value ?? '').toString().trim()
          if (!oVal) continue
          const key = `${vName}|${oVal}`
          if (existingAddedAt.has(key)) opt.addedAt = existingAddedAt.get(key)
          else opt.addedAt = now
        }
      }
    }

    const product = await Product.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true,
    })

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
      })
    }

    await syncMediaUsageForProduct(existing, product.toObject() as unknown as Record<string, unknown>)

    res.json({
      success: true,
      data: product,
    })
  } catch (error) {
    next(error)
  }
})

// @route   DELETE /api/v1/products/:id
// @desc    Delete product
// @access  Private/Admin
router.delete('/:id', protect, checkPermission('products:delete'), async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
      })
    }

    await markMediaUnusedForKeys(collectMediaKeysFromProduct(product.toObject() as unknown as Record<string, unknown>))
    await product.deleteOne()

    res.json({
      success: true,
      data: {},
    })
  } catch (error) {
    next(error)
  }
})

export default router
