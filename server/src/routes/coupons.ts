import express from 'express'
import Coupon from '../models/Coupon'
import { protect, checkPermission } from '../middleware/auth'

const router = express.Router()

// @route   GET /api/v1/coupons
// @desc    Get all coupons
// @access  Private/Admin
router.get('/', protect, checkPermission('coupons:view'), async (req, res, next) => {
  try {
    const coupons = await Coupon.find().sort('-createdAt')

    res.json({
      success: true,
      data: coupons,
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/coupons
// @desc    Create coupon
// @access  Private/Admin
router.post('/', protect, checkPermission('coupons:create'), async (req, res, next) => {
  try {
    const coupon = await Coupon.create(req.body)

    res.status(201).json({
      success: true,
      data: coupon,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/coupons/:id
// @desc    Get single coupon
// @access  Private/Admin
router.get('/:id', protect, checkPermission('coupons:view'), async (req, res, next) => {
  try {
    const coupon = await Coupon.findById(req.params.id)

    if (!coupon) {
      return res.status(404).json({
        success: false,
        error: 'Coupon not found',
      })
    }

    res.json({
      success: true,
      data: coupon,
    })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/coupons/:id
// @desc    Update coupon
// @access  Private/Admin
router.put('/:id', protect, checkPermission('coupons:update'), async (req, res, next) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    })

    if (!coupon) {
      return res.status(404).json({
        success: false,
        error: 'Coupon not found',
      })
    }

    res.json({
      success: true,
      data: coupon,
    })
  } catch (error) {
    next(error)
  }
})

// @route   DELETE /api/v1/coupons/:id
// @desc    Delete coupon
// @access  Private/Admin
router.delete('/:id', protect, checkPermission('coupons:delete'), async (req, res, next) => {
  try {
    const coupon = await Coupon.findById(req.params.id)

    if (!coupon) {
      return res.status(404).json({
        success: false,
        error: 'Coupon not found',
      })
    }

    await coupon.deleteOne()

    res.json({
      success: true,
      message: 'Coupon deleted successfully',
    })
  } catch (error) {
    next(error)
  }
})

export default router
