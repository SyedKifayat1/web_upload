import rateLimit from 'express-rate-limit'

const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 1000 : 100, // Higher limit in dev (video + API + reloads)
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for auth and static uploads (videos/images)
    if (req.path.startsWith('/api/v1/auth')) return true
    if (req.path.startsWith('/uploads')) return true // Hero videos, images – avoid 429 on page load
    return false
  },
})

// Auth-specific rate limiter (disabled - no limit)
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // Very high limit - effectively no restriction
  message: 'Too many login attempts, please try again later.',
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Too many login attempts. Please wait 15 minutes before trying again.',
    })
  },
})

export default rateLimiter
