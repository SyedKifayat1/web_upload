import express from 'express'
import User from '../models/User'
import Order from '../models/Order'
import { protect, checkPermission } from '../middleware/auth'

const router = express.Router()

// @route   GET /api/v1/customers
// @desc    Get all customers
// @access  Private/Admin
router.get('/', protect, checkPermission('customers:view'), async (req, res, next) => {
  try {
    const customers = await User.find({ isAdmin: false })
      .select('-password')
      .sort('-createdAt')

    res.json({
      success: true,
      data: customers,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/customers/:id
// @desc    Get single customer
// @access  Private/Admin
router.get('/:id', protect, checkPermission('customers:view'), async (req, res, next) => {
  try {
    const customer = await User.findById(req.params.id).select('-password')

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found',
      })
    }

    const orders = await Order.find({ user: customer._id }).sort('-createdAt')

    res.json({
      success: true,
      data: {
        customer,
        orders,
      },
    })
  } catch (error) {
    next(error)
  }
})

export default router
