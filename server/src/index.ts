import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import morgan from 'morgan'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import { createServer } from 'http'
import { Server } from 'socket.io'
import connectDB from './config/database'
import { setupSocketIO } from './config/socket'
import errorHandler from './middleware/errorHandler'
import rateLimiter from './middleware/rateLimiter'

// Routes
import authRoutes from './routes/auth'
import productRoutes from './routes/products'
import categoryRoutes from './routes/categories'
import orderRoutes from './routes/orders'
import cartRoutes from './routes/cart'
import customerRoutes from './routes/customers'
import blogRoutes from './routes/blog'
import couponRoutes from './routes/coupons'
import permissionRoutes from './routes/permissions'
import adminRoutes from './routes/admin'
import uploadRoutes from './routes/upload'
import mediaRoutes from './routes/media'
import heroRoutes from './routes/hero'
import trustIndicatorRoutes from './routes/trust-indicators'
import returnPolicyRoutes from './routes/return-policy'
import privacyPolicyRoutes from './routes/privacy-policy'
import faqRoutes from './routes/faq'
import termsRoutes from './routes/terms'
import refundPolicyPageRoutes from './routes/refund-policy'
import shippingPageRoutes from './routes/shipping-page'
import sizeGuideRoutes from './routes/size-guide'
import storesPageRoutes from './routes/stores-page'
import newsletterRoutes from './routes/newsletter'
import supportRoutes from './routes/support'
import favouritesRoutes from './routes/favourites'
import reviewSettingsRoutes from './routes/review-settings'
import blogSettingsRoutes from './routes/blog-settings'
import aboutSettingsRoutes from './routes/about-settings'
import shippingSettingsRoutes from './routes/shipping-settings'
import orderSettingsRoutes from './routes/order-settings'
import siteSettingsRoutes from './routes/site-settings'
import configRoutes from './routes/config'
import stripeWebhookRoutes from './routes/stripe-webhook'
import tabbyWebhookRoutes from './routes/tabby-webhook'
import path from 'path'
import { syncAllContentAreaMediaUsage } from './services/mediaTracking'

dotenv.config()

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
  },
})

const PORT = process.env.PORT || 5000

// Connect to MongoDB; after connect, align collection image ↔ MediaAsset.used
connectDB().then(() => {
  syncAllContentAreaMediaUsage().catch((err: unknown) => console.error('Media usage sync:', err))
})

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
}))
app.use(compression())
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}))

// Stripe webhook must receive raw body for signature verification (before express.json)
app.use('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRoutes)

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'))
}

// Rate limiting
app.use(rateLimiter)

// Serve static files from uploads directory (before API routes to avoid conflicts)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), {
  setHeaders: (res, filePath) => {
    // Set CORS headers for images and video
    res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_URL || 'http://localhost:3000')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    // Avoid net::ERR_CACHE_OPERATION_NOT_SUPPORTED when loading video from different origin (e.g. Next.js on :3000, API on :5000)
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
  }
}))

// API Routes
app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/products', productRoutes)
app.use('/api/v1/categories', categoryRoutes)
app.use('/api/v1/orders', orderRoutes)
app.use('/api/v1/cart', cartRoutes)
app.use('/api/v1/customers', customerRoutes)
app.use('/api/v1/blog', blogRoutes)
app.use('/api/v1/coupons', couponRoutes)
app.use('/api/v1/permissions', permissionRoutes)
app.use('/api/v1/admin', adminRoutes)
app.use('/api/v1/upload', uploadRoutes)
app.use('/api/v1/media', mediaRoutes)
app.use('/api/v1/hero', heroRoutes)
app.use('/api/v1/trust-indicators', trustIndicatorRoutes)
app.use('/api/v1/return-policy', returnPolicyRoutes)
app.use('/api/v1/privacy-policy', privacyPolicyRoutes)
app.use('/api/v1/faq', faqRoutes)
app.use('/api/v1/terms', termsRoutes)
app.use('/api/v1/refund-policy', refundPolicyPageRoutes)
app.use('/api/v1/shipping-page', shippingPageRoutes)
app.use('/api/v1/size-guide', sizeGuideRoutes)
app.use('/api/v1/stores-page', storesPageRoutes)
app.use('/api/v1/newsletter', newsletterRoutes)
app.use('/api/v1/support', supportRoutes)
app.use('/api/v1/favourites', favouritesRoutes)
app.use('/api/v1/review-settings', reviewSettingsRoutes)
app.use('/api/v1/blog-settings', blogSettingsRoutes)
app.use('/api/v1/about-settings', aboutSettingsRoutes)
app.use('/api/v1/shipping-settings', shippingSettingsRoutes)
app.use('/api/v1/order-settings', orderSettingsRoutes)
app.use('/api/v1/site-settings', siteSettingsRoutes)
app.use('/api/v1/config', configRoutes)
app.use('/api/v1/webhooks/tabby', tabbyWebhookRoutes)

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Setup Socket.IO
setupSocketIO(io)

// Error handler (must be last)
app.use(errorHandler)

// Start server
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
})

export { io }
