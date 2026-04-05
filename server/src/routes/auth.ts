import express from 'express'
import jwt from 'jsonwebtoken'
import { protect } from '../middleware/auth'
import User from '../models/User'

const router = express.Router()

// Get JWT secrets with proper typing
const JWT_SECRET = (process.env.JWT_SECRET || 'your-secret-key') as string
const JWT_REFRESH_SECRET = (process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key') as string
const JWT_EXPIRE = process.env.JWT_EXPIRE || '30d'
const JWT_REFRESH_EXPIRE = process.env.JWT_REFRESH_EXPIRE || '90d'

// Generate JWT Token
const generateToken = (
  userId: string,
  isAdmin: boolean,
  permissions: string[],
  isSuperAdmin?: boolean
): string => {
  const payload = { userId, isAdmin, permissions, isSuperAdmin: !!isSuperAdmin }
  const options: jwt.SignOptions = {
    expiresIn: JWT_EXPIRE as any,
  }
  return jwt.sign(payload, JWT_SECRET, options)
}

// Generate Refresh Token
const generateRefreshToken = (userId: string): string => {
  const payload = { userId }
  const options: jwt.SignOptions = {
    expiresIn: JWT_REFRESH_EXPIRE as any,
  }
  return jwt.sign(payload, JWT_REFRESH_SECRET, options)
}

// @route   POST /api/v1/auth/register
// @desc    Register user
// @access  Public
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body

    // Create user
    const user = await User.create({
      name,
      email,
      password,
    })

    const token = generateToken(user._id.toString(), user.isAdmin, user.permissions, user.isSuperAdmin)
    const refreshToken = generateRefreshToken(user._id.toString())

    res.status(201).json({
      success: true,
      accessToken: token,
      refreshToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        isSuperAdmin: user.isSuperAdmin,
        permissions: user.permissions,
      },
    })
  } catch (error: any) {
    next(error)
  }
})

// @route   POST /api/v1/auth/login
// @desc    Login user
// @access  Public
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body

    // Validate email & password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an email and password',
      })
    }

    // Check for user
    const user = await User.findOne({ email }).select('+password')

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      })
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password)

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      })
    }

    const token = generateToken(user._id.toString(), user.isAdmin, user.permissions, user.isSuperAdmin)
    const refreshToken = generateRefreshToken(user._id.toString())

    res.json({
      success: true,
      accessToken: token,
      refreshToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        isSuperAdmin: user.isSuperAdmin,
        permissions: user.permissions,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/auth/refresh
// @desc    Refresh access token
// @access  Public
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'No refresh token provided',
      })
    }

    const decoded = jwt.verify(
      refreshToken,
      JWT_REFRESH_SECRET
    ) as any

    const user = await User.findById(decoded.userId)

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
      })
    }

    const token = generateToken(user._id.toString(), user.isAdmin, user.permissions, user.isSuperAdmin)

    res.json({
      success: true,
      accessToken: token,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/auth/me
// @desc    Get current logged in user
// @access  Private
router.get('/me', protect, async (req: any, res) => {
  res.json({
    success: true,
    data: req.user,
  })
})

// @route   PUT /api/v1/auth/me
// @desc    Update current user profile
// @access  Private
router.put('/me', protect, async (req: any, res, next) => {
  try {
    const { name, email, phone } = req.body

    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (email !== undefined) updateData.email = email
    if (phone !== undefined) updateData.phone = phone

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password')

    res.json({
      success: true,
      data: user,
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/auth/me/addresses
// @desc    Add address for current user
// @access  Private
router.post('/me/addresses', protect, async (req: any, res, next) => {
  try {
    const { type, street, city, state, zipCode, country, isDefault } = req.body

    if (!type || !street || !city || !zipCode || !country) {
      return res.status(400).json({
        success: false,
        error: 'Please provide type, street, city, zipCode, and country',
      })
    }

    const validTypes = ['billing', 'shipping']
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Type must be "billing" or "shipping"',
      })
    }

    const user = await User.findById(req.user._id)
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }

    const newAddress = {
      type: type as 'billing' | 'shipping',
      street: String(street).trim(),
      city: String(city).trim(),
      state: state ? String(state).trim() : '',
      zipCode: String(zipCode).trim(),
      country: String(country).trim(),
      isDefault: Boolean(isDefault),
    }

    if (newAddress.isDefault) {
      user.addresses.forEach((addr: any) => {
        addr.isDefault = false
      })
    }
    user.addresses.push(newAddress as any)
    await user.save()

    const updated = await User.findById(req.user._id).select('-password')
    res.status(201).json({
      success: true,
      data: updated,
    })
  } catch (error) {
    next(error)
  }
})

// @route   DELETE /api/v1/auth/me/addresses/:addressId
// @desc    Remove an address for current user
// @access  Private
router.delete('/me/addresses/:addressId', protect, async (req: any, res, next) => {
  try {
    const { addressId } = req.params

    const user = await User.findById(req.user._id)
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }

    const initialLength = user.addresses.length
    user.addresses = user.addresses.filter(
      (addr: any) => String(addr._id) !== String(addressId)
    )
    if (user.addresses.length === initialLength) {
      return res.status(404).json({
        success: false,
        error: 'Address not found',
      })
    }
    await user.save()

    const updated = await User.findById(req.user._id).select('-password')
    res.json({
      success: true,
      data: updated,
    })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/auth/change-password
// @desc    Change user password
// @access  Private
router.put('/change-password', protect, async (req: any, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Please provide current password and new password',
      })
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters',
      })
    }

    const user = await User.findById(req.user._id).select('+password')

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      })
    }

    // Check current password
    const isMatch = await user.matchPassword(currentPassword)

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect',
      })
    }

    // Update password
    user.password = newPassword
    await user.save()

    res.json({
      success: true,
      message: 'Password changed successfully',
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout', protect, async (req, res) => {
  // In a stateless JWT system, logout is handled client-side
  // Optionally, you could maintain a blacklist of tokens
  res.json({
    success: true,
    message: 'Logged out successfully',
  })
})

export default router
