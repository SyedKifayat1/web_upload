import express from 'express'
import User from '../models/User'
import { protect, checkPermission } from '../middleware/auth'
import { emitPermissionUpdate } from '../config/socket'

const router = express.Router()

// @route   GET /api/v1/permissions
// @desc    Get all users with permissions
// @access  Private/Admin
router.get('/', protect, checkPermission('permissions:view'), async (req, res, next) => {
  try {
    const users = await User.find({ isAdmin: true })
      .select('name email permissions')
      .sort('-createdAt')

    res.json({
      success: true,
      data: users,
    })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/permissions/:userId
// @desc    Update user permissions
// @access  Private/Admin
router.put('/:userId', protect, checkPermission('permissions:manage'), async (req, res, next) => {
  try {
    const { permissions } = req.body

    const before = await User.findById(req.params.userId).select('permissions name email')

    if (!before) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      })
    }

    const prev = (before.permissions || []).map((p: unknown) => String(p))
    const nextPerms = Array.isArray(permissions) ? permissions.map((p: unknown) => String(p)) : []
    const prevSet = new Set(prev)
    const nextSet = new Set(nextPerms)
    const permissionsAdded = nextPerms.filter((p) => !prevSet.has(p))
    const permissionsRemoved = prev.filter((p) => !nextSet.has(p))

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { permissions: nextPerms },
      { new: true, runValidators: true }
    ).select('-password')

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      })
    }

    emitPermissionUpdate({
      userId: user._id.toString(),
      permissions: user.permissions || [],
      userName: user.name,
      userEmail: user.email,
      permissionsAdded,
      permissionsRemoved,
    })

    res.json({
      success: true,
      data: user,
    })
  } catch (error) {
    next(error)
  }
})

export default router
