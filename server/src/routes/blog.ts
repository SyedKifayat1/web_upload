import express from 'express'
import mongoose from 'mongoose'
import BlogPost from '../models/BlogPost'
import { protect, checkPermission } from '../middleware/auth'
import { syncBlogFolderMediaUsage } from '../services/mediaTracking'

const router = express.Router()

// @route   GET /api/v1/blog/posts
// @desc    Get all blog posts
// @access  Public
router.get('/posts', async (req, res, next) => {
  try {
    const { page = 1, limit = 10, category, published } = req.query

    const query: any = {}

    // Handle published filter
    // If published is explicitly 'false' or false, show unpublished posts
    // If published is 'true' or true, show only published posts
    // If not provided, default to true (published only) for public access
    if (published !== undefined) {
      // Convert string 'true'/'false' to boolean
      // Handle query parameter which can be string, array, or ParsedQs
      const publishedStr = Array.isArray(published) 
        ? published[0] 
        : typeof published === 'string' 
          ? published 
          : String(published)
      query.published = publishedStr === 'true'
    } else {
      // Default to published only for public access
      query.published = true
    }

    if (category) {
      query.category = category
    }

    const posts = await BlogPost.find(query)
      .populate('author', 'name')
      .populate('category', 'name slug')
      .sort('-publishedAt -createdAt')
      .limit(Number(limit) * 1)
      .skip((Number(page) - 1) * Number(limit))

    const total = await BlogPost.countDocuments(query)

    res.json({
      success: true,
      data: posts,
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

// @route   GET /api/v1/blog/posts/slug/:slug
// @desc    Get blog post by slug
// @access  Public
router.get('/posts/slug/:slug', async (req, res, next) => {
  try {
    const post = await BlogPost.findOne({ slug: req.params.slug, published: true })
      .populate('author', 'name')
      .populate('category', 'name slug')

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Blog post not found',
      })
    }

    res.json({
      success: true,
      data: post,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/blog/posts/:id
// @desc    Get blog post by ID
// @access  Private/Admin (for admin panel - returns all posts including unpublished)
router.get('/posts/:id', protect, checkPermission('blog:view'), async (req, res, next) => {
  try {
    const post = await BlogPost.findById(req.params.id)
      .populate('author', 'name')
      .populate('category', 'name slug')

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Blog post not found',
      })
    }

    res.json({
      success: true,
      data: post,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/blog/posts/:id/related
// @desc    Get related blog posts (uses post.relatedPosts when set, else same-category; max 6)
// @access  Public
router.get('/posts/:id/related', async (req, res, next) => {
  try {
    const post = await BlogPost.findById(req.params.id)
      .select('relatedPosts category')
      .lean()

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Blog post not found',
      })
    }

    const limit = 6
    let relatedPosts: any[]

    const rawIds = post.relatedPosts
    const hasSelected = Array.isArray(rawIds) && rawIds.length > 0

    if (hasSelected) {
      const objectIds = rawIds
        .slice(0, limit)
        .filter(Boolean)
        .map((id: any) => (id && typeof id === 'object' && id.toString ? id : new mongoose.Types.ObjectId(String(id))))
      const found = await BlogPost.find({
        _id: { $in: objectIds },
        published: true,
      })
        .populate('author', 'name')
        .populate('category', 'name slug')
        .lean()
      const idOrder = objectIds.map((id: any) => id.toString())
      relatedPosts = idOrder
        .map((idStr) => found.find((p) => (p as any)._id.toString() === idStr))
        .filter(Boolean)
    } else {
      relatedPosts = await BlogPost.find({
        _id: { $ne: post._id },
        category: req.query.categoryId || post.category,
        published: true,
      })
        .limit(limit)
        .populate('author', 'name')
        .populate('category', 'name slug')
    }

    res.json({
      success: true,
      data: relatedPosts,
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/blog/posts
// @desc    Create blog post
// @access  Private/Admin
router.post('/posts', protect, checkPermission('blog:create'), async (req: any, res, next) => {
  try {
    const publishedAt =
      req.body.publishedAt && !Number.isNaN(Date.parse(req.body.publishedAt))
        ? new Date(req.body.publishedAt)
        : req.body.published
          ? new Date()
          : undefined
    const post = await BlogPost.create({
      ...req.body,
      author: req.user._id,
      publishedAt,
    })

    await syncBlogFolderMediaUsage()

    res.status(201).json({
      success: true,
      data: post,
    })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/blog/posts/:id
// @desc    Update blog post
// @access  Private/Admin
router.put('/posts/:id', protect, checkPermission('blog:update'), async (req, res, next) => {
  try {
    const update: Record<string, unknown> = { ...req.body }
    if (Array.isArray(req.body.relatedPosts)) {
      update.relatedPosts = req.body.relatedPosts.map((id: string) =>
        typeof id === 'string' ? id : String(id)
      )
    }
    if (req.body.publishedAt !== undefined) {
      update.publishedAt =
        req.body.publishedAt && !Number.isNaN(Date.parse(req.body.publishedAt))
          ? new Date(req.body.publishedAt)
          : null
    }
    const post = await BlogPost.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    })

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Blog post not found',
      })
    }

    await syncBlogFolderMediaUsage()

    res.json({
      success: true,
      data: post,
    })
  } catch (error) {
    next(error)
  }
})

// @route   DELETE /api/v1/blog/posts/:id
// @desc    Delete blog post
// @access  Private/Admin
router.delete('/posts/:id', protect, checkPermission('blog:delete'), async (req, res, next) => {
  try {
    const post = await BlogPost.findById(req.params.id)

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Blog post not found',
      })
    }

    await post.deleteOne()

    await syncBlogFolderMediaUsage()

    res.json({
      success: true,
      data: {},
    })
  } catch (error) {
    next(error)
  }
})

export default router
