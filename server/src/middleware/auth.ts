import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User'

interface AuthRequest extends Request {
  user?: any
}

// Get JWT secret with proper typing
const JWT_SECRET: string = process.env.JWT_SECRET || 'your-secret-key'

/** Sets req.user when token is valid; does not fail when no token (for optional auth). */
export const optionalProtect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let token

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1]
  } else if (req.cookies.token) {
    token = req.cookies.token
  }

  if (!token) {
    next()
    return
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    req.user = await User.findById(decoded.userId).select('-password')
  } catch {
    // Invalid token - treat as guest
  }
  next()
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let token

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1]
  } else if (req.cookies.token) {
    token = req.cookies.token
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route',
    })
  }

  try {
    const decoded = jwt.verify(
      token,
      JWT_SECRET
    ) as any

    req.user = await User.findById(decoded.userId).select('-password')

    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
      })
    }

    next()
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route',
    })
  }
}

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized',
      })
    }

    if (!roles.includes(req.user.role) && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'User role is not authorized to access this route',
      })
    }

    next()
  }
}

export const checkPermission = (permission: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized',
      })
    }

    // Admins have all permissions
    if (req.user.isAdmin) {
      return next()
    }

    // Check if user has the required permission
    const hasPermission = req.user.permissions?.includes(permission)

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      })
    }

    next()
  }
}
