import express from 'express'
import Favourite from '../models/Favourite'
import Product from '../models/Product'
import { protect } from '../middleware/auth'

const router = express.Router()

// All routes require authentication
router.use(protect)

// @route   GET /api/v1/favourites
// @desc    Get current user's favourite product IDs
// @access  Private
router.get('/', async (req: any, res, next) => {
  try {
    const docs = await Favourite.find({ user: req.user._id })
      .select('product')
      .lean()
    const productIds = docs.map((d: any) => d.product.toString())
    res.json({
      success: true,
      data: productIds,
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/favourites
// @desc    Add a product to favourites
// @access  Private
router.post('/', async (req: any, res, next) => {
  try {
    const { productId } = req.body
    if (!productId) {
      return res.status(400).json({
        success: false,
        error: 'productId is required',
      })
    }
    const product = await Product.findById(productId)
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
      })
    }
    const existing = await Favourite.findOne({
      user: req.user._id,
      product: productId,
    })
    if (existing) {
      return res.json({
        success: true,
        data: { productId },
        message: 'Already in favourites',
      })
    }
    await Favourite.create({
      user: req.user._id,
      product: productId,
    })
    res.status(201).json({
      success: true,
      data: { productId },
    })
  } catch (error) {
    next(error)
  }
})

// @route   DELETE /api/v1/favourites/:productId
// @desc    Remove a product from favourites
// @access  Private
router.delete('/:productId', async (req: any, res, next) => {
  try {
    const { productId } = req.params
    const result = await Favourite.findOneAndDelete({
      user: req.user._id,
      product: productId,
    })
    res.json({
      success: true,
      data: { removed: !!result },
    })
  } catch (error) {
    next(error)
  }
})

export default router
