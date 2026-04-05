import express from 'express'
import Category from '../models/Category'
import CategoryDesign from '../models/CategoryDesign'
import { protect, checkPermission } from '../middleware/auth'
import { syncAllCollectionDesignMediaUsage } from '../services/mediaTracking'

const router = express.Router()

// @route   GET /api/v1/categories
// @desc    Get all categories. Use ?active=true to return only active categories (e.g. for product form).
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    const query: Record<string, unknown> = {}
    if (req.query.active === 'true') {
      query.active = true
    }
    const categories = await Category.find(query).sort('order')

    res.json({
      success: true,
      data: categories,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/categories/slug/:slug
// @desc    Get category by slug (must be before /:id so "slug" is not treated as id)
// @access  Public
router.get('/slug/:slug', async (req, res, next) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug })

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found',
      })
    }

    res.json({
      success: true,
      data: category,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/categories/collections/designs
// @desc    Get designs to show in Our Collections (showInCollections true, max 8, with category slug)
// @access  Public
router.get('/collections/designs', async (req, res, next) => {
  try {
    const designs = await CategoryDesign.find({ showInCollections: true })
      .sort('order')
      .limit(8)
      .populate('category', 'slug')
      .lean()

    // Pass through collectionImage as stored. Do not map /uploads/collections/ → CDN unless the object
    // exists on R2; legacy rows often only have files on disk, which would 404 on *.r2.dev.
    const data = designs.map((d: any) => ({
      _id: d._id,
      name: d.name,
      slug: d.slug,
      collectionImage: (d.collectionImage || '').trim() || null,
      categorySlug: d.category?.slug || null,
    }))

    res.json({
      success: true,
      data,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/categories/nav
// @desc    Get active categories with designs (one response for navbar / SSR)
// @access  Public
router.get('/nav', async (req, res, next) => {
  try {
    const categories = await Category.find({ active: true }).sort('order').lean()
    const designDocs = await CategoryDesign.find({
      category: { $in: categories.map((c: any) => c._id) },
    })
      .sort('order')
      .lean()
    const designsByCategoryId: Record<string, Array<{ _id: string; name: string; slug: string }>> = {}
    for (const d of designDocs as any[]) {
      const cid = String(d.category)
      if (!designsByCategoryId[cid]) designsByCategoryId[cid] = []
      designsByCategoryId[cid].push({
        _id: d._id,
        name: d.name,
        slug: d.slug,
      })
    }
    const data = (categories as any[]).map((c) => ({
      _id: c._id,
      name: c.name,
      slug: c.slug,
      designs: designsByCategoryId[String(c._id)] || [],
    }))
    res.json({ success: true, data })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/categories/:categoryId/designs
// @desc    Get all designs (sub-categories) for a category
// @access  Public
router.get('/:categoryId/designs', async (req, res, next) => {
  try {
    const designs = await CategoryDesign.find({ category: req.params.categoryId }).sort('order')

    res.json({
      success: true,
      data: designs,
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/categories/:categoryId/designs
// @desc    Create a design (sub-category) under a category
// @access  Private/Admin
router.post('/:categoryId/designs', protect, checkPermission('products:create'), async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.categoryId)
    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' })
    }
    const design = await CategoryDesign.create({
      ...req.body,
      category: req.params.categoryId,
    })

    await syncAllCollectionDesignMediaUsage()

    res.status(201).json({
      success: true,
      data: design,
    })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/categories/:categoryId/designs/:designId
// @desc    Update a design
// @access  Private/Admin
router.put('/:categoryId/designs/:designId', protect, checkPermission('products:update'), async (req, res, next) => {
  try {
    const design = await CategoryDesign.findOneAndUpdate(
      { _id: req.params.designId, category: req.params.categoryId },
      req.body,
      { new: true, runValidators: true }
    )

    if (!design) {
      return res.status(404).json({
        success: false,
        error: 'Design not found',
      })
    }

    await syncAllCollectionDesignMediaUsage()

    res.json({
      success: true,
      data: design,
    })
  } catch (error) {
    next(error)
  }
})

// @route   DELETE /api/v1/categories/:categoryId/designs/:designId
// @desc    Delete a design
// @access  Private/Admin
router.delete('/:categoryId/designs/:designId', protect, checkPermission('products:delete'), async (req, res, next) => {
  try {
    const design = await CategoryDesign.findOneAndDelete({
      _id: req.params.designId,
      category: req.params.categoryId,
    })

    if (!design) {
      return res.status(404).json({
        success: false,
        error: 'Design not found',
      })
    }

    await syncAllCollectionDesignMediaUsage()

    res.json({
      success: true,
      data: {},
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/categories/:id
// @desc    Get category by id
// @access  Public
router.get('/:id', async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id)

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found',
      })
    }

    res.json({
      success: true,
      data: category,
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/categories
// @desc    Create category
// @access  Private/Admin
router.post('/', protect, checkPermission('products:create'), async (req, res, next) => {
  try {
    const category = await Category.create(req.body)

    res.status(201).json({
      success: true,
      data: category,
    })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/categories/:id
// @desc    Update category
// @access  Private/Admin
router.put('/:id', protect, checkPermission('products:update'), async (req, res, next) => {
  try {
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    })

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found',
      })
    }

    res.json({
      success: true,
      data: category,
    })
  } catch (error) {
    next(error)
  }
})

// @route   DELETE /api/v1/categories/:id
// @desc    Delete category
// @access  Private/Admin
router.delete('/:id', protect, checkPermission('products:delete'), async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id)

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found',
      })
    }

    await category.deleteOne()

    res.json({
      success: true,
      data: {},
    })
  } catch (error) {
    next(error)
  }
})

export default router
