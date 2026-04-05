import crypto from 'crypto'
import express from 'express'
import fs from 'fs'
import path from 'path'
import mongoose from 'mongoose'
import Stripe from 'stripe'
import Order from '../models/Order'
import Cart from '../models/Cart'
import Coupon from '../models/Coupon'
import Product from '../models/Product'
import User from '../models/User'
import ShippingSettings, { SHIPPING_SETTINGS_KEY } from '../models/ShippingSettings'
import ShippingMethod from '../models/ShippingMethod'
import OrderSettings, { ORDER_SETTINGS_KEY } from '../models/OrderSettings'
import PaymentSettings, { PAYMENT_SETTINGS_KEY } from '../models/PaymentSettings'
import EmailSettings, { EMAIL_SETTINGS_KEY } from '../models/EmailSettings'
import SiteSettings, { SITE_SETTINGS_KEY } from '../models/SiteSettings'
import { protect, optionalProtect } from '../middleware/auth'
import { emitOrderCreated, emitOrderUpdate } from '../config/socket'

const router = express.Router()

// Stripe instance from env (legacy) or null; use getStripe() to prefer DB payment settings
const stripeFromEnv = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

async function getStripe(): Promise<Stripe | null> {
  if (stripeFromEnv) return stripeFromEnv
  const doc = await PaymentSettings.findOne({ key: PAYMENT_SETTINGS_KEY }).lean()
  const secret = doc?.stripeSecretKey?.trim()
  return secret ? new Stripe(secret) : null
}

async function getTabbyConfig(): Promise<TabbyConfig | null> {
  const doc = await PaymentSettings.findOne({ key: PAYMENT_SETTINGS_KEY }).lean()
  const secret = doc?.tabbySecretKey?.trim()
  const code = doc?.tabbyMerchantCode?.trim()
  if (!secret || !code) return null
  return { secretKey: secret, merchantCode: code }
}

// Product images manifest for resolving imageFolder / color option images (same as cart & admin)
let productImagesManifest: Record<string, string[]> | null = null
function getProductImagesManifest(): Record<string, string[]> | null {
  if (productImagesManifest !== null) return productImagesManifest
  const candidates = [
    path.join(process.cwd(), 'client', 'public', 'product_images', 'manifest.json'),
    path.join(process.cwd(), '..', 'client', 'public', 'product_images', 'manifest.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8')
        productImagesManifest = JSON.parse(raw) as Record<string, string[]>
        return productImagesManifest
      }
    } catch {
      continue
    }
  }
  return null
}

function getOrderItemDisplayImageUrl(
  product: any,
  manifest: Record<string, string[]> | null,
  itemVariants?: Record<string, string> | null
): string | null {
  if (!product) return null
  const colorKey = product.variants?.length && itemVariants
    ? (Object.keys(itemVariants).find((k) => /^colou?r$/i.test(k)) ?? null)
    : null
  const colorValue = colorKey ? itemVariants?.[colorKey] : null
  if (colorValue && product.variants) {
    for (const v of product.variants) {
      if (!/^colou?r$/i.test(v.name)) continue
      const option = v.options?.find((o: any) =>
        (o.value || '').toString().trim().toLowerCase() === String(colorValue).trim().toLowerCase()
      )
      if (option) {
        const optImg =
          option.image ||
          (option.images?.[0] ? (typeof option.images[0] === 'string' ? option.images[0] : option.images[0]?.url) : null)
        if (optImg) return optImg
        break
      }
    }
  }
  const fromApi = product.images?.[0]
    ? (typeof product.images[0] === 'string' ? product.images[0] : product.images[0]?.url)
    : null
  if (fromApi) return fromApi
  const folder = product.imageFolder
  if (folder && manifest?.[folder]?.[0]) {
    return `/product_images/${folder}/${manifest[folder][0]}`
  }
  return null
}

// 5-digit random number (10000–99999); use crypto for better uniqueness
const random5Digit = () => {
  if (typeof crypto.randomInt === 'function') {
    return String(crypto.randomInt(10000, 100000))
  }
  return String(Math.floor(10000 + Math.random() * 90000))
}

/** Generate unique 5-digit order number; checks DB and retries on collision. */
async function generateUniqueOrderNumber(): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const num = random5Digit()
    const exists = await Order.exists({ orderNumber: num })
    if (!exists) return num
  }
  return random5Digit() + Date.now().toString(36).slice(-2)
}

/** Generate unique 5-digit invoice number; checks DB and retries on collision. */
async function generateUniqueInvoiceNumber(): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const num = random5Digit()
    const exists = await Order.exists({ invoiceNumber: num })
    if (!exists) return num
  }
  return random5Digit() + Date.now().toString(36).slice(-2)
}

/** MongoDB duplicate key error code - retry order create with new numbers when this occurs. */
const MONGO_DUPLICATE_KEY = 11000

import { decrementStockForOrderItem, restockOrderItem } from '../services/stock'
import { sendOrderConfirmationEmail } from '../services/email'
import {
  createTabbyCheckoutSession,
  getTabbyPayment,
  isTabbyPaymentSuccessful,
  isTabbyPaymentFailed,
  type TabbyConfig,
} from '../services/tabby'

// Card data must never be sent to our server; reject if present (defense in depth)
const CARD_DATA_KEYS = ['number', 'cvc', 'cvv', 'exp', 'expiry', 'cardNumber', 'card_number']
function rejectIfCardDataInBody(body: Record<string, unknown>): void {
  const lower = (s: string) => s.toLowerCase()
  for (const key of Object.keys(body)) {
    if (CARD_DATA_KEYS.some((k) => lower(key).includes(lower(k)))) {
      throw new Error('Card details must not be sent to the server. Payment is handled securely by Stripe.')
    }
  }
}

// @route   POST /api/v1/orders
// @desc    Create order. For card payments we only accept paymentIntentId (from Stripe);
//          card details are never sent to or stored on this server.
// @access  Private/Guest (optional auth: if logged in, order is linked to user for customer order history)
router.post('/', optionalProtect, async (req: any, res, next) => {
  try {
    rejectIfCardDataInBody(req.body || {})
    const {
      shippingAddress,
      billingAddress,
      paymentMethod,
      paymentIntentId,
      shippingMethodId,
      shippingMethodName,
      shippingAmount,
      email: customerEmail,
    } = req.body

    const sessionId = req.cookies?.sessionId || req.headers['x-session-id']
    const userId = req.user?._id

    const cart = await Cart.findOne({
      $or: [{ user: userId }, { sessionId }],
    }).populate('items.product')

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Cart is empty',
      })
    }

    // Use cart's coupon so every order has its own coupon from current cart, not from client/previous order
    const orderCoupon = cart.coupon ?? undefined

    // Tabby orders are created via POST /create-tabby-session and confirmed after redirect/webhook
    if (paymentMethod === 'tabby') {
      return res.status(400).json({
        success: false,
        error: 'Use create-tabby-session for Tabby payments, then redirect to Tabby.',
      })
    }

    // Calculate totals
    let subtotal = 0
    const items = cart.items.map((item: any) => {
      const itemTotal = item.price * item.quantity
      subtotal += itemTotal

      return {
        product: item.product._id,
        name: item.product.name,
        quantity: item.quantity,
        price: item.price,
        variants: item.variants,
      }
    })

    // Prices are tax-inclusive; no separate tax charge
    const tax = 0

    const shippingSettings = await ShippingSettings.findOne({ key: SHIPPING_SETTINGS_KEY }).lean()
    const freeAbove = shippingSettings?.freeShippingAbove ?? null
    const flatRate = (shippingSettings?.flatRate ?? 0) || 0

    let shipping: number
    let orderShippingMethodName: string | undefined
    let orderShippingMethodDelivery: string | null = null

    if (shippingMethodId != null && (typeof shippingAmount === 'number' || typeof shippingAmount === 'string')) {
      const method = await ShippingMethod.findById(shippingMethodId).lean()
      const amount = typeof shippingAmount === 'number' ? shippingAmount : parseFloat(shippingAmount)
      if (method && !Number.isNaN(amount) && amount >= 0) {
        orderShippingMethodName = shippingMethodName || method.name
        orderShippingMethodDelivery = method.deliveryDescription || null
        const methodFreeAbove = method.freeShippingAbove ?? null
        shipping = methodFreeAbove != null && methodFreeAbove > 0 && subtotal >= methodFreeAbove ? 0 : amount
      } else {
        orderShippingMethodName = undefined
        orderShippingMethodDelivery = null
        shipping = freeAbove != null && freeAbove > 0 && subtotal >= freeAbove ? 0 : flatRate
      }
    } else {
      shipping = freeAbove != null && freeAbove > 0 && subtotal >= freeAbove ? 0 : flatRate
    }

    const discount = Number(cart.discount) || 0
    const total = Math.round((subtotal + shipping - discount) * 100) / 100

    // When paying by card, require a Stripe PaymentIntent and verify it
    if (paymentMethod === 'card') {
      if (!paymentIntentId || typeof paymentIntentId !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Card payment requires a completed Stripe payment. Please complete the payment form.',
        })
      }
      const stripe = await getStripe()
      if (stripe) {
        try {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
          if (pi.status !== 'succeeded') {
            return res.status(400).json({
              success: false,
              error: 'Payment has not been completed. Please try again.',
            })
          }
          const amountInFils = Math.round(total * 100)
          if (pi.amount !== amountInFils) {
            return res.status(400).json({
              success: false,
              error: 'Payment amount does not match order total. Please refresh and try again.',
            })
          }
        } catch (err) {
          return res.status(400).json({
            success: false,
            error: 'Invalid or expired payment. Please try again.',
          })
        }
      }
    }

    // Ensure area is set for courier/export (backward compat: use zipCode if area not sent)
    const shippingWithArea = shippingAddress
      ? { ...shippingAddress, area: shippingAddress.area ?? shippingAddress.zipCode }
      : shippingAddress
    const billingWithArea = billingAddress
      ? { ...billingAddress, area: billingAddress.area ?? billingAddress.zipCode }
      : billingAddress

    const validEmail = (e: string | null | undefined): string | null =>
      typeof e === 'string' && /^\S+@\S+\.\S+$/.test(e.trim()) ? e.trim() : null
    let toEmail: string | null = validEmail(customerEmail) || null
    if (!toEmail && userId) {
      const u = await User.findById(userId).select('email').lean()
      toEmail = validEmail(u?.email) || null
    }

    const emailSettings = await EmailSettings.findOne({ key: EMAIL_SETTINGS_KEY }).lean()
    const restrictOrderToValidEmail = emailSettings?.restrictOrderToValidEmail === true

    let order: any
    let confirmationEmailSent = false

    if (restrictOrderToValidEmail) {
      if (!toEmail) {
        return res.status(400).json({
          success: false,
          error: 'Please provide a valid email address to place your order. We send order confirmation by email.',
        })
      }
      let orderNumber = await generateUniqueOrderNumber()
      let invoiceNumber = await generateUniqueInvoiceNumber()
      const emailPayload = {
        orderNumber,
        total,
        subtotal,
        tax,
        shipping,
        discount,
        items: items.map((i: any) => ({ name: i.name, quantity: i.quantity, price: i.price })),
        shippingAddress: shippingWithArea,
        billingAddress: billingWithArea,
        paymentMethod,
        shippingMethodName: orderShippingMethodName || undefined,
        shippingMethodDelivery: orderShippingMethodDelivery || undefined,
        createdAt: new Date(),
      }
      try {
        await sendOrderConfirmationEmail(toEmail, emailPayload)
        confirmationEmailSent = true
        if (process.env.NODE_ENV !== 'test') console.log('[Order confirmation email] Sent to', toEmail)
      } catch (err: any) {
        console.error('[Order confirmation email] Failed (restrict mode):', err?.message || err)
        return res.status(400).json({
          success: false,
          error: 'We could not send a confirmation email to this address. Please check your email and try again.',
        })
      }
      try {
        order = await Order.create({
          orderNumber,
          invoiceNumber,
          user: userId,
          customerEmail: toEmail,
          items,
          shippingAddress: shippingWithArea,
          billingAddress: billingWithArea,
          paymentMethod,
          paymentIntentId,
          paymentStatus: paymentIntentId ? 'paid' : 'pending',
          status: 'pending',
          subtotal,
          tax,
          shipping,
          ...(orderShippingMethodName != null && orderShippingMethodName !== '' && { shippingMethodName: orderShippingMethodName }),
          ...(orderShippingMethodDelivery != null && orderShippingMethodDelivery !== '' && { shippingMethodDelivery: orderShippingMethodDelivery }),
          discount,
          total,
          coupon: orderCoupon,
          totalPaidByCustomer: paymentIntentId ? total : 0,
        })
      } catch (createErr: any) {
        if (createErr?.code === MONGO_DUPLICATE_KEY) {
          orderNumber = await generateUniqueOrderNumber()
          invoiceNumber = await generateUniqueInvoiceNumber()
          order = await Order.create({
            orderNumber,
            invoiceNumber,
            user: userId,
            customerEmail: toEmail,
            items,
            shippingAddress: shippingWithArea,
            billingAddress: billingWithArea,
            paymentMethod,
            paymentIntentId,
            paymentStatus: paymentIntentId ? 'paid' : 'pending',
            status: 'pending',
            subtotal,
            tax,
            shipping,
            ...(orderShippingMethodName != null && orderShippingMethodName !== '' && { shippingMethodName: orderShippingMethodName }),
            ...(orderShippingMethodDelivery != null && orderShippingMethodDelivery !== '' && { shippingMethodDelivery: orderShippingMethodDelivery }),
            discount,
            total,
            coupon: orderCoupon,
            totalPaidByCustomer: paymentIntentId ? total : 0,
          })
        } else throw createErr
      }
    } else {
      let orderNumber = await generateUniqueOrderNumber()
      let invoiceNumber = await generateUniqueInvoiceNumber()
      try {
        order = await Order.create({
          orderNumber,
          invoiceNumber,
          user: userId,
          customerEmail: toEmail || undefined,
          items,
          shippingAddress: shippingWithArea,
          billingAddress: billingWithArea,
          paymentMethod,
          paymentIntentId,
          paymentStatus: paymentIntentId ? 'paid' : 'pending',
          status: 'pending',
          subtotal,
          tax,
          shipping,
          ...(orderShippingMethodName != null && orderShippingMethodName !== '' && { shippingMethodName: orderShippingMethodName }),
          ...(orderShippingMethodDelivery != null && orderShippingMethodDelivery !== '' && { shippingMethodDelivery: orderShippingMethodDelivery }),
          discount,
          total,
          coupon: orderCoupon,
          totalPaidByCustomer: paymentIntentId ? total : 0,
        })
      } catch (createErr: any) {
        if (createErr?.code === MONGO_DUPLICATE_KEY) {
          orderNumber = await generateUniqueOrderNumber()
          invoiceNumber = await generateUniqueInvoiceNumber()
          order = await Order.create({
            orderNumber,
            invoiceNumber,
            user: userId,
            customerEmail: toEmail || undefined,
            items,
            shippingAddress: shippingWithArea,
            billingAddress: billingWithArea,
            paymentMethod,
            paymentIntentId,
            paymentStatus: paymentIntentId ? 'paid' : 'pending',
            status: 'pending',
            subtotal,
            tax,
            shipping,
            ...(orderShippingMethodName != null && orderShippingMethodName !== '' && { shippingMethodName: orderShippingMethodName }),
            ...(orderShippingMethodDelivery != null && orderShippingMethodDelivery !== '' && { shippingMethodDelivery: orderShippingMethodDelivery }),
            discount,
            total,
            coupon: orderCoupon,
            totalPaidByCustomer: paymentIntentId ? total : 0,
          })
        } else throw createErr
      }
      if (toEmail) {
        try {
          await sendOrderConfirmationEmail(toEmail, {
            orderNumber: order.orderNumber,
            total: order.total,
            subtotal: order.subtotal,
            tax: order.tax,
            shipping: order.shipping,
            discount: order.discount,
            items: order.items.map((i: any) => ({ name: i.name, quantity: i.quantity, price: i.price })),
            shippingAddress: order.shippingAddress,
            billingAddress: order.billingAddress,
            paymentMethod: order.paymentMethod,
            shippingMethodName: order.shippingMethodName,
            shippingMethodDelivery: order.shippingMethodDelivery || undefined,
            createdAt: order.createdAt,
          })
          confirmationEmailSent = true
          if (process.env.NODE_ENV !== 'test') console.log('[Order confirmation email] Sent to', toEmail)
        } catch (err: any) {
          console.error('[Order confirmation email] Failed:', err?.message || err)
        }
      } else if (process.env.NODE_ENV !== 'test') {
        console.warn('[Order confirmation email] Skipped: no recipient email (order:', order.orderNumber, ')')
      }
    }

    // Increment unitsSold and decrement stock for each product (stock updated for correct check and balance)
    for (const item of items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { unitsSold: item.quantity },
      })
      await decrementStockForOrderItem(item.product, item.variants, item.quantity)
    }

    emitOrderCreated(order._id.toString(), order.orderNumber, userId?.toString())
    // Do not emit order:status:changed for initial "pending" — that duplicates order:created for admins.
    cart.items = []
    cart.coupon = undefined
    cart.discount = 0
    await cart.save()

    const orderObj = order.toObject ? order.toObject() : order
    res.status(201).json({
      success: true,
      data: { ...orderObj, confirmationEmailSent },
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/orders/create-payment-intent
// @desc    Create a Stripe PaymentIntent for the current cart total (card payments).
//          Returns only clientSecret; card data is never sent to this server — it is
//          entered in Stripe.js on the client and sent directly to Stripe.
// @access  Private/Guest
router.post('/create-payment-intent', optionalProtect, async (req: any, res, next) => {
  try {
    const stripe = await getStripe()
    if (!stripe) {
      return res.status(503).json({
        success: false,
        error: 'Stripe is not configured. Set payment keys in Admin → Settings → Payment.',
      })
    }
    rejectIfCardDataInBody(req.body || {})

    const { shippingMethodId, shippingMethodName, shippingAmount } = req.body
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id']
    const userId = req.user?._id

    const cart = await Cart.findOne({
      $or: [{ user: userId }, { sessionId }],
    }).populate('items.product')

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Cart is empty',
      })
    }

    let subtotal = 0
    for (const item of cart.items) {
      subtotal += item.price * item.quantity
    }

    // Prices are tax-inclusive; no separate tax charge
    const tax = 0

    const shippingSettings = await ShippingSettings.findOne({ key: SHIPPING_SETTINGS_KEY }).lean()
    const freeAbove = shippingSettings?.freeShippingAbove ?? null
    const flatRate = (shippingSettings?.flatRate ?? 0) || 0

    let shipping: number
    if (shippingMethodId != null && (typeof shippingAmount === 'number' || typeof shippingAmount === 'string')) {
      const method = await ShippingMethod.findById(shippingMethodId).lean()
      const amount = typeof shippingAmount === 'number' ? shippingAmount : parseFloat(shippingAmount)
      if (method && !Number.isNaN(amount) && amount >= 0) {
        const methodFreeAbove = method.freeShippingAbove ?? null
        shipping = methodFreeAbove != null && methodFreeAbove > 0 && subtotal >= methodFreeAbove ? 0 : amount
      } else {
        shipping = freeAbove != null && freeAbove > 0 && subtotal >= freeAbove ? 0 : flatRate
      }
    } else {
      shipping = freeAbove != null && freeAbove > 0 && subtotal >= freeAbove ? 0 : flatRate
    }

    const discount = Number(cart.discount) || 0
    const total = Math.round((subtotal + shipping - discount) * 100) / 100
    if (total <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Order total must be greater than zero',
      })
    }

    // Stripe amounts are in smallest currency unit (fils for AED: 1 AED = 100 fils)
    const amountInFils = Math.round(total * 100)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInFils,
      currency: 'aed',
      automatic_payment_methods: { enabled: true },
    })

    res.status(200).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      amount: total,
    })
  } catch (error) {
    next(error)
  }
})

// Base URL for this API (for Tabby redirect URLs). Tabby redirects the customer here; we verify and redirect to frontend.
const getOrdersBaseUrl = () =>
  process.env.API_URL || process.env.SERVER_URL || process.env.CLIENT_URL || 'http://localhost:5000'

/** Map Tabby rejection_reason to a short user-facing message. */
function getUserFriendlyTabbyRejectionMessage(reason: string): string | null {
  const r = (reason || '').toLowerCase().trim()
  if (r.includes('order_amount_too_low') || r.includes('too_low')) {
    return 'This order is below the minimum amount for Tabby. Add more items or use another payment method.'
  }
  if (r.includes('order_amount_too_high') || r.includes('too_high')) {
    return 'This order exceeds the limit for Tabby. Pay with card or another method.'
  }
  if (r.includes('not_available') || r.includes('rejected')) {
    return 'Tabby is not available for this purchase. Please use another payment method.'
  }
  return null
}

// @route   POST /api/v1/orders/create-tabby-session
// @desc    Create order (pending) and Tabby checkout session; return web_url for redirect. Order is confirmed on return or webhook.
// @access  Private/Guest
router.post('/create-tabby-session', optionalProtect, async (req: any, res, next) => {
  try {
    rejectIfCardDataInBody(req.body || {})
    const {
      shippingAddress,
      billingAddress,
      shippingMethodId,
      shippingMethodName,
      shippingAmount,
      email: customerEmail,
    } = req.body

    const tabbyConfig = await getTabbyConfig()
    if (!tabbyConfig) {
      return res.status(503).json({
        success: false,
        error: 'Tabby is not configured. Set Tabby keys and merchant code in Admin → Settings → Payment.',
      })
    }

    const sessionId = req.cookies?.sessionId || req.headers['x-session-id']
    const userId = req.user?._id

    const cart = await Cart.findOne({
      $or: [{ user: userId }, { sessionId }],
    }).populate('items.product')

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, error: 'Cart is empty' })
    }

    let subtotal = 0
    const items = cart.items.map((item: any) => {
      const itemTotal = item.price * item.quantity
      subtotal += itemTotal
      return {
        product: item.product._id,
        name: item.product.name,
        quantity: item.quantity,
        price: item.price,
        variants: item.variants,
      }
    })

    // Prices are tax-inclusive; no separate tax charge
    const tax = 0

    const shippingSettings = await ShippingSettings.findOne({ key: SHIPPING_SETTINGS_KEY }).lean()
    const freeAbove = shippingSettings?.freeShippingAbove ?? null
    const flatRate = (shippingSettings?.flatRate ?? 0) || 0

    let shipping: number
    let orderShippingMethodName: string | undefined
    let orderShippingMethodDelivery: string | null = null

    if (shippingMethodId != null && (typeof shippingAmount === 'number' || typeof shippingAmount === 'string')) {
      const method = await ShippingMethod.findById(shippingMethodId).lean()
      const amount = typeof shippingAmount === 'number' ? shippingAmount : parseFloat(shippingAmount)
      if (method && !Number.isNaN(amount) && amount >= 0) {
        orderShippingMethodName = shippingMethodName || method.name
        orderShippingMethodDelivery = method.deliveryDescription || null
        const methodFreeAbove = method.freeShippingAbove ?? null
        shipping = methodFreeAbove != null && methodFreeAbove > 0 && subtotal >= methodFreeAbove ? 0 : amount
      } else {
        orderShippingMethodName = undefined
        orderShippingMethodDelivery = null
        shipping = freeAbove != null && freeAbove > 0 && subtotal >= freeAbove ? 0 : flatRate
      }
    } else {
      shipping = freeAbove != null && freeAbove > 0 && subtotal >= freeAbove ? 0 : flatRate
    }

    const discount = Number(cart.discount) || 0
    const total = Math.round((subtotal + shipping - discount) * 100) / 100
    if (total <= 0) {
      return res.status(400).json({ success: false, error: 'Order total must be greater than zero' })
    }

    const validEmail = (e: string | null | undefined): string | null =>
      typeof e === 'string' && /^\S+@\S+\.\S+$/.test(e.trim()) ? e.trim() : null
    const toEmail = validEmail(customerEmail) || (userId ? (await User.findById(userId).select('email').lean())?.email : null)
    const emailStr = validEmail(toEmail as string) || ''
    if (!emailStr) {
      return res.status(400).json({
        success: false,
        error: 'A valid email is required for Tabby checkout.',
      })
    }

    const shippingWithArea = shippingAddress
      ? { ...shippingAddress, area: shippingAddress.area ?? shippingAddress.zipCode }
      : shippingAddress
    const billingWithArea = billingAddress
      ? { ...billingAddress, area: billingAddress.area ?? billingAddress.zipCode }
      : billingAddress

    let orderNumber = await generateUniqueOrderNumber()
    let invoiceNumber = await generateUniqueInvoiceNumber()
    let order: InstanceType<typeof Order>
    const tabbyOrderCoupon = cart.coupon ?? undefined
    try {
      order = await Order.create({
        orderNumber,
        invoiceNumber,
        user: userId,
        customerEmail: emailStr,
        items,
        shippingAddress: shippingWithArea,
        billingAddress: billingWithArea,
        paymentMethod: 'tabby',
        paymentStatus: 'pending',
        status: 'pending',
        subtotal,
        tax,
        shipping,
        ...(orderShippingMethodName != null && orderShippingMethodName !== '' && { shippingMethodName: orderShippingMethodName }),
        ...(orderShippingMethodDelivery != null && orderShippingMethodDelivery !== '' && { shippingMethodDelivery: orderShippingMethodDelivery }),
        discount,
        total,
        coupon: tabbyOrderCoupon,
      })
    } catch (createErr: any) {
      if (createErr?.code === MONGO_DUPLICATE_KEY) {
        orderNumber = await generateUniqueOrderNumber()
        invoiceNumber = await generateUniqueInvoiceNumber()
        order = await Order.create({
          orderNumber,
          invoiceNumber,
          user: userId,
          customerEmail: emailStr,
          items,
          shippingAddress: shippingWithArea,
          billingAddress: billingWithArea,
          paymentMethod: 'tabby',
          paymentStatus: 'pending',
          status: 'pending',
          subtotal,
          tax,
          shipping,
          ...(orderShippingMethodName != null && orderShippingMethodName !== '' && { shippingMethodName: orderShippingMethodName }),
          ...(orderShippingMethodDelivery != null && orderShippingMethodDelivery !== '' && { shippingMethodDelivery: orderShippingMethodDelivery }),
          discount,
          total,
          coupon: tabbyOrderCoupon,
        })
      } else throw createErr
    }

    const baseUrl = getOrdersBaseUrl().replace(/\/$/, '')
    const clientUrl = (process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '')

    const sessionResult = await createTabbyCheckoutSession(tabbyConfig, {
      orderReference: orderNumber,
      amount: total,
      currency: 'AED',
      buyer: {
        email: emailStr,
        phone: (shippingAddress?.phone || '').trim() || '0000000000',
        name: (shippingAddress?.name || '').trim() || undefined,
      },
      shippingAddress: {
        name: shippingWithArea?.name,
        address: [shippingWithArea?.street, shippingWithArea?.city, shippingWithArea?.state].filter(Boolean).join(', '),
        city: shippingWithArea?.city,
        state: shippingWithArea?.state,
        zip: shippingWithArea?.zipCode || shippingWithArea?.area,
        country: shippingWithArea?.country,
        phone: shippingWithArea?.phone,
      },
      merchantUrls: {
        success: `${baseUrl}/api/v1/orders/tabby/return?order_id=${order._id}`,
        cancel: `${clientUrl}/checkout?tabby=cancel`,
        failure: `${clientUrl}/checkout?tabby=failure`,
      },
      description: `Order ${orderNumber}`,
      orderItems: items.map((i: any) => ({ title: i.name, quantity: i.quantity, unit_price: i.price.toFixed(2) })),
    })

    if (sessionResult.status !== 'created' || !sessionResult.webUrl || !sessionResult.paymentId) {
      await Order.findByIdAndDelete(order._id)
      const reason = sessionResult.rejectionReason || ''
      const userMessage = getUserFriendlyTabbyRejectionMessage(reason) || reason || 'Tabby could not create this session. Try another payment method or contact support.'
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[Tabby] Session not created:', { orderNumber: order.orderNumber, status: sessionResult.status, rejectionReason: reason })
      }
      return res.status(400).json({
        success: false,
        error: userMessage,
      })
    }

    order.tabbyPaymentId = sessionResult.paymentId
    await order.save()

    res.status(200).json({
      success: true,
      web_url: sessionResult.webUrl,
      orderNumber: order.orderNumber,
      orderId: order._id.toString(),
    })
  } catch (error: any) {
    next(error)
  }
})

// @route   GET /api/v1/orders/tabby/return
// @desc    Tabby redirects here after payment (success). Verify payment, update order, redirect to order-success.
// @access  Public
router.get('/tabby/return', async (req, res, next) => {
  try {
    const paymentId = (req.query.payment_id as string)?.trim()
    const orderId = (req.query.order_id as string)?.trim()
    const clientUrl = (process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '')

    if (!paymentId) {
      return res.redirect(302, `${clientUrl}/checkout?tabby=missing`)
    }

    const tabbyConfig = await getTabbyConfig()
    if (!tabbyConfig) {
      return res.redirect(302, `${clientUrl}/checkout?tabby=error`)
    }

    const order = await Order.findOne(
      orderId ? { _id: orderId, tabbyPaymentId: paymentId } : { tabbyPaymentId: paymentId }
    )
    if (!order) {
      return res.redirect(302, `${clientUrl}/checkout?tabby=notfound`)
    }

    if (order.paymentStatus === 'paid') {
      const params = new URLSearchParams({ orderNumber: order.orderNumber, emailSent: '0' })
      return res.redirect(302, `${clientUrl}/order-success?${params.toString()}`)
    }

    const payment = await getTabbyPayment(tabbyConfig, paymentId)
    if (!payment) {
      return res.redirect(302, `${clientUrl}/checkout?tabby=verify_failed`)
    }

    if (isTabbyPaymentFailed(payment.status)) {
      order.paymentStatus = 'failed'
      await order.save()
      emitOrderUpdate(order._id.toString(), order.status, order.user?.toString())
      return res.redirect(302, `${clientUrl}/checkout?tabby=rejected`)
    }

    if (isTabbyPaymentSuccessful(payment.status)) {
      order.paymentStatus = 'paid'
      if (typeof (order as any).totalPaidByCustomer !== 'number' || (order as any).totalPaidByCustomer < (order.total ?? 0)) {
        (order as any).totalPaidByCustomer = Math.round((order.total ?? 0) * 100) / 100
      }
      await order.save()
      emitOrderUpdate(order._id.toString(), order.status, order.user?.toString())

      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product, { $inc: { unitsSold: item.quantity } })
        await decrementStockForOrderItem(item.product, item.variants, item.quantity)
      }
      const cart = await Cart.findOne({ $or: [{ user: order.user }, { sessionId: req.cookies?.sessionId || req.headers['x-session-id'] }] })
      if (cart) {
        cart.items = []
        cart.coupon = undefined
        cart.discount = 0
        await cart.save()
      }
      const emailSettings = await EmailSettings.findOne({ key: EMAIL_SETTINGS_KEY }).lean()
      const toEmail = order.customerEmail
      if (toEmail) {
        try {
          await sendOrderConfirmationEmail(toEmail, {
            orderNumber: order.orderNumber,
            total: order.total,
            subtotal: order.subtotal,
            tax: order.tax,
            shipping: order.shipping,
            discount: order.discount,
            items: order.items.map((i: any) => ({ name: i.name, quantity: i.quantity, price: i.price })),
            shippingAddress: order.shippingAddress,
            billingAddress: order.billingAddress,
            paymentMethod: 'Tabby (Pay later)',
            shippingMethodName: order.shippingMethodName,
            shippingMethodDelivery: order.shippingMethodDelivery || undefined,
            createdAt: order.createdAt,
          })
        } catch (err: any) {
          if (process.env.NODE_ENV !== 'test') console.error('[Tabby order confirmation email]', err?.message)
        }
      }
      const params = new URLSearchParams({ orderNumber: order.orderNumber, emailSent: toEmail ? '1' : '0' })
      return res.redirect(302, `${clientUrl}/order-success?${params.toString()}`)
    }

    return res.redirect(302, `${clientUrl}/checkout?tabby=pending`)
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/orders/track
// @desc    Look up order by order number (public, no login required)
// @access  Public
router.get('/track', async (req, res, next) => {
  try {
    const orderNumber = (req.query.orderNumber as string)?.trim()
    if (!orderNumber) {
      return res.status(400).json({
        success: false,
        error: 'Order number is required',
      })
    }
    const order = await Order.findOne({ orderNumber })
      .populate('items.product', 'name images imageFolder variants slug')
      .lean()

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found. Please check your order number.',
      })
    }

    const manifest = getProductImagesManifest()
    const items = (order.items || []).map((it: any) => ({
      product: it.product,
      name: it.name,
      quantity: it.quantity,
      price: it.price,
      variants: it.variants,
      displayImageUrl: getOrderItemDisplayImageUrl(it.product, manifest, it.variants) || undefined,
    }))

    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        trackingNumber: order.trackingNumber,
        createdAt: order.createdAt,
        shippedAt: order.shippedAt,
        deliveredAt: order.deliveredAt,
        shippingMethodName: order.shippingMethodName,
        shippingMethodDelivery: order.shippingMethodDelivery,
        items,
        subtotal: order.subtotal,
        shipping: order.shipping,
        tax: order.tax,
        discount: order.discount,
        total: order.total,
        shippingAddress: order.shippingAddress
          ? {
              name: order.shippingAddress.name,
              city: order.shippingAddress.city,
              state: order.shippingAddress.state,
              country: order.shippingAddress.country,
            }
          : undefined,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/orders
// @desc    Get user orders
// @access  Private
router.get('/', protect, async (req: any, res, next) => {
  try {
    const userId = req.user?._id
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authorized' })
    }
    const orders = await Order.find({ user: userId })
      .sort('-createdAt')
      .populate('items.product', 'name images imageFolder variants slug')

    const manifest = getProductImagesManifest()
    const data = orders.map((order) => {
      const plain = order.toObject()
      plain.items = (plain.items || []).map((it: any) => ({
        ...it,
        displayImageUrl: getOrderItemDisplayImageUrl(it.product, manifest, it.variants) || undefined,
      }))
      return plain
    })

    res.json({
      success: true,
      data,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/orders/:id
// @desc    Get single order
// @access  Private
router.get('/:id', protect, async (req: any, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name images imageFolder variants slug')
      .populate('user', 'name email')

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      })
    }

    const manifest = getProductImagesManifest()
    const plainOrder = order.toObject()
    plainOrder.items = (plainOrder.items || []).map((it: any) => ({
      ...it,
      displayImageUrl: getOrderItemDisplayImageUrl(it.product, manifest, it.variants) || undefined,
    }))

    // Check if user owns the order or is admin (order.user is populated above so it's { _id, name, email }, not ObjectId)
    const orderUser = order.user as any
    const orderUserId =
      orderUser == null
        ? null
        : orderUser._id != null
          ? String(orderUser._id)
          : String(orderUser)
    const reqUserId = req.user?._id != null ? String(req.user._id) : null
    if (orderUserId !== reqUserId && !req.user?.isAdmin) {
      return res.status(403).json({
        success: false,
        error: orderUserId == null
          ? 'This order was placed as a guest and cannot be viewed here. Sign in when placing an order to see it in My Orders.'
          : 'Not authorized to access this order',
      })
    }

    // Recompute pending exchange refund so it always uses amount paid and coupon eligibility (fixes stale 140 vs 125.50)
    if (plainOrder.pendingExchange) {
      await recalcPendingExchangePriceDifference(plainOrder)
    }

    // Recalc discount from coupon eligibility so ineligible replacement products don't show a discount (fix display and persist)
    if (plainOrder.coupon) {
      const effectiveDiscount = await recalcOrderDiscountForEligibleItems(plainOrder)
      const currentDiscount = Math.round(Number(plainOrder.discount ?? 0) * 100) / 100
      if (Math.abs(effectiveDiscount - currentDiscount) > 0.001) {
        const subtotal = Math.round(Number(plainOrder.subtotal ?? 0) * 100) / 100
        const shipping = Math.round(Number(plainOrder.shipping ?? 0) * 100) / 100
        plainOrder.discount = effectiveDiscount
        plainOrder.total = Math.round((subtotal + shipping - effectiveDiscount) * 100) / 100
        await Order.updateOne(
          { _id: order._id },
          { $set: { discount: effectiveDiscount, total: plainOrder.total } }
        )
      }
    }

    // Sync balance due on delivery with order total and net paid (fixes 16 AED error when discount/totals were recalc'd after exchange)
    const storedBalance = Math.round(Number((plainOrder as any).balanceDueOnDelivery ?? 0) * 100) / 100
    if (storedBalance > 0) {
      const netPaid = Math.round(((plainOrder as any).totalPaidByCustomer ?? 0) * 100) / 100 - Math.round(((plainOrder as any).totalRefundedToCustomer ?? 0) * 100) / 100
      const expectedBalance = Math.round((Number(plainOrder.total ?? 0) - netPaid) * 100) / 100
      if (expectedBalance >= 0 && Math.abs(expectedBalance - storedBalance) > 0.001) {
        (plainOrder as any).balanceDueOnDelivery = expectedBalance > 0 ? expectedBalance : undefined
        await Order.updateOne(
          { _id: order._id },
          expectedBalance > 0 ? { $set: { balanceDueOnDelivery: expectedBalance } } : { $unset: { balanceDueOnDelivery: '' } }
        )
      }
    }

    res.json({
      success: true,
      data: plainOrder,
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/orders/:id/cancel
// @desc    Cancel order (customer only, within admin-configured time window)
// @access  Private
router.post('/:id/cancel', protect, async (req: any, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' })
    }
    const orderUserId = order.user != null ? String(order.user) : null
    const reqUserId = req.user?._id != null ? String(req.user._id) : null
    if (orderUserId !== reqUserId || req.user?.isAdmin) {
      // Only the owning customer can cancel (not admin via this endpoint)
      return res.status(403).json({ success: false, error: 'Not authorized to cancel this order' })
    }
    if (order.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Only pending orders can be cancelled',
      })
    }
    const settings = await OrderSettings.findOne({ key: ORDER_SETTINGS_KEY }).lean()
    const windowMs = (settings?.cancellationWindowMinutes ?? 1440) * 60 * 1000
    const created = new Date(order.createdAt).getTime()
    if (Date.now() > created + windowMs) {
      return res.status(400).json({
        success: false,
        error: 'Cancellation window has expired',
      })
    }
    // Restock and reverse unitsSold for each item so inventory stays correct (clamp unitsSold to >= 0)
    const items = order.items || []
    for (const item of items) {
      const productId = item.product && (typeof item.product === 'object' && (item.product as any)._id ? (item.product as any)._id : item.product)
      if (!productId) continue
      const returnableQty = item.quantity - (item.returnedQuantity ?? 0)
      if (returnableQty > 0) {
        await restockOrderItem(productId, item.variants, returnableQty)
      }
      if (item.quantity > 0) {
        await Product.updateOne(
          { _id: productId },
          [{ $set: { unitsSold: { $max: [0, { $add: ['$unitsSold', -item.quantity] }] } } }]
        )
      }
    }
    order.status = 'cancelled'
    // Set full refund due so admin and client both show the same amount (return all money on cancel)
    const isCod = ((order as any).paymentMethod || '').toString().toLowerCase() === 'cod'
    if (!isCod) {
      const amountPaid = Math.round(Number((order as any).totalPaidByCustomer ?? order.total ?? 0) * 100) / 100
      if (amountPaid > 0) {
        (order as any).refundPending = amountPaid
        if (typeof (order as any).totalPaidByCustomer !== 'number' || (order as any).totalPaidByCustomer < amountPaid) {
          (order as any).totalPaidByCustomer = amountPaid
        }
      }
    }
    await order.save()
    emitOrderUpdate(
      order._id.toString(),
      'cancelled',
      order.user != null ? String(order.user) : reqUserId ?? undefined
    )
    const populated = await Order.findById(order._id)
      .populate('items.product', 'name images imageFolder variants slug')
      .populate('user', 'name email')
      .lean()
    const manifest = getProductImagesManifest()
    const plainOrder = populated ? { ...populated, items: (populated.items || []).map((it: any) => ({
      ...it,
      displayImageUrl: getOrderItemDisplayImageUrl(it.product, manifest, it.variants) || undefined,
    })) } : order.toObject()
    res.json({ success: true, data: plainOrder })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/orders/:id/submit-refund-details
// @desc    Submit bank details for refund (cancelled or partial return). Customer-only.
// @access  Private
router.post('/:id/submit-refund-details', protect, async (req: any, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' })
    }
    const orderUserId = order.user != null ? String(order.user) : null
    const reqUserId = req.user?._id != null ? String(req.user._id) : null
    if (orderUserId !== reqUserId || req.user?.isAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this order' })
    }
    const refundPending = Math.round(Number((order as any).refundPending ?? 0) * 100) / 100
    if (refundPending <= 0) {
      return res.status(400).json({ success: false, error: 'No refund pending for this order' })
    }
    if ((order.paymentMethod || '').toString().toLowerCase() === 'cod') {
      return res.status(400).json({ success: false, error: 'No refund by bank for COD orders' })
    }
    const { accountHolderName, bankName, iban } = req.body || {}
    if (!accountHolderName || !bankName || !iban) {
      return res.status(400).json({
        success: false,
        error: 'Account holder name, bank name, and IBAN / account number are required',
      })
    }
    ;(order as any).refundBankDetails = {
      accountHolderName: String(accountHolderName).trim(),
      bankName: String(bankName).trim(),
      iban: String(iban).trim(),
    }
    await order.save()
    emitOrderUpdate(
      order._id.toString(),
      order.status,
      order.user != null ? String(order.user) : undefined
    )
    const populated = await Order.findById(order._id)
      .populate('items.product', 'name images imageFolder variants slug')
      .populate('user', 'name email')
      .lean()
    const manifest = getProductImagesManifest()
    const plainOrder = populated ? { ...populated, items: (populated.items || []).map((it: any) => ({
      ...it,
      displayImageUrl: getOrderItemDisplayImageUrl(it.product, manifest, it.variants) || undefined,
    })) } : order.toObject()
    res.json({ success: true, data: plainOrder, message: 'Bank details received. We will process your refund within 3–4 working days.' })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/orders/:id/return-item
// @desc    Return or exchange one item (customer only, within cancel/exchange window). Restocks and updates returnedQuantity.
// @access  Private
router.post('/:id/return-item', protect, async (req: any, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' })
    }
    const orderUserId = order.user != null ? String(order.user) : null
    const reqUserId = req.user?._id != null ? String(req.user._id) : null
    if (orderUserId !== reqUserId || req.user?.isAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized to return items for this order' })
    }
    if (order.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Returns and exchanges are only available for pending orders',
      })
    }
    const settings = await OrderSettings.findOne({ key: ORDER_SETTINGS_KEY }).lean()
    const windowMs = (settings?.cancellationWindowMinutes ?? 1440) * 60 * 1000
    const created = new Date(order.createdAt).getTime()
    if (Date.now() > created + windowMs) {
      return res.status(400).json({
        success: false,
        error: 'Return and exchange window has expired',
      })
    }
    const { itemIndex, quantity } = req.body
    const idx = Number(itemIndex)
    if (Number.isNaN(idx) || idx < 0 || idx >= (order.items?.length ?? 0)) {
      return res.status(400).json({ success: false, error: 'Invalid item' })
    }
    const qty = Math.floor(Number(quantity))
    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ success: false, error: 'Quantity must be at least 1' })
    }
    const item = order.items[idx]
    const alreadyReturned = Number(item.returnedQuantity ?? 0)
    const maxReturnable = Math.max(0, item.quantity - alreadyReturned)
    if (qty > maxReturnable) {
      return res.status(400).json({
        success: false,
        error: `You can return at most ${maxReturnable} of this item`,
      })
    }
    await restockOrderItem(item.product, item.variants, qty)
    item.returnedQuantity = alreadyReturned + qty
    // For paid (non-COD) orders, add returned amount to existing refund pending so it accumulates
    const paymentMethod = (order as any).paymentMethod || ''
    if (paymentMethod.toLowerCase() !== 'cod') {
      const returnAmount = Math.round(item.price * qty * 100) / 100
      const existingRefund = Math.round(((order as any).refundPending || 0) * 100) / 100
      ;(order as any).refundPending = Math.round((existingRefund + returnAmount) * 100) / 100
      if ((order as any).refundStatus !== 'processed') (order as any).refundStatus = 'pending'
      const history = (order as any).refundHistory || []
      history.push({ amount: returnAmount, createdAt: new Date(), status: 'pending', note: `Return: ${qty}× ${item.name || 'item'}` })
      ;(order as any).refundHistory = history
    }
    // Recalculate order subtotal and total from remaining items (quantity - returnedQuantity) so totals reflect returns
    let newSubtotal = 0
    for (const i of order.items) {
      const kept = Math.max(0, (i.quantity ?? 0) - (i.returnedQuantity ?? 0))
      newSubtotal += (i.price ?? 0) * kept
    }
    newSubtotal = Math.round(newSubtotal * 100) / 100
    order.subtotal = newSubtotal
    order.tax = 0
    order.total = Math.round((newSubtotal + (order.shipping ?? 0) - (order.discount ?? 0)) * 100) / 100
    await order.save()
    const populated = await Order.findById(order._id)
      .populate('items.product', 'name images imageFolder variants slug')
      .populate('user', 'name email')
      .lean()
    const manifest = getProductImagesManifest()
    const plainOrder = populated ? {
      ...populated,
      items: (populated.items || []).map((it: any) => ({
        ...it,
        displayImageUrl: getOrderItemDisplayImageUrl(it.product, manifest, it.variants) || undefined,
      })),
    } : order.toObject()
    res.json({
      success: true,
      data: plainOrder,
      message: qty === 1 ? 'Item returned. You can place a new order for a replacement.' : `${qty} items returned. You can place a new order for replacements.`,
    })
  } catch (error) {
    next(error)
  }
})

// Helper: effective stock for a product (option stock when variant has it, else product.stock)
function getEffectiveStock(product: any, variants?: Record<string, string> | null): number {
  if (!variants || typeof variants !== 'object' || !product?.variants?.length) return Number(product?.stock ?? 0)
  for (const v of product.variants) {
    const selected = v.name && (variants as Record<string, string>)[v.name]
    if (selected == null) continue
    const option = v.options?.find((o: any) => (o.value || '').toString().trim() === String(selected).trim())
    if (option && option.stock !== undefined && option.stock !== null) return Number(option.stock)
  }
  return Number(product?.stock ?? 0)
}

/** Amount the customer actually paid for the removed item (after order-level coupon). Shown in UI for transparency. */
function getEffectiveOldItemPaidTotal(order: any, oldItemTotalList: number): number {
  const subtotal = Number(order?.subtotal ?? 0)
  const discount = Number(order?.discount ?? 0)
  if (subtotal <= 0 || discount <= 0) return oldItemTotalList
  const paidForItem = (oldItemTotalList / subtotal) * (subtotal - discount)
  return Math.round(paidForItem * 100) / 100
}

/** New item total with same order discount rate applied (e.g. 5% off 149.99 → 142.49). Only use when new product is eligible for the order's coupon. */
function getNewItemDiscountedTotal(order: any, newLineTotalList: number): number {
  const subtotal = Number(order?.subtotal ?? 0)
  const discount = Number(order?.discount ?? 0)
  if (subtotal <= 0 || discount <= 0) return newLineTotalList
  const discounted = (newLineTotalList / subtotal) * (subtotal - discount)
  return Math.round(discounted * 100) / 100
}

/** Always compute new item discounted total from the order's coupon in DB (dynamic: no reliance on order.discount/order.subtotal, so it stays correct on 2nd/3rd+ product change). Use only when the new product is eligible. */
async function getNewItemDiscountedTotalWithCoupon(order: any, newLineTotalList: number): Promise<number> {
  const orderId = order?._id ?? order?.id
  let couponId = ''
  if (orderId) {
    const orderDoc = await Order.findById(orderId).select('coupon').lean()
    const ref = orderDoc?.coupon
    couponId = ref != null ? toIdString((ref as any)?._id ?? ref) : ''
  } else {
    const couponRef = order?.coupon
    couponId = couponRef != null ? toIdString((couponRef as any)?._id ?? couponRef) : ''
  }
  if (!couponId) return newLineTotalList
  const coupon = await Coupon.findById(couponId).select('type value maximumDiscount').lean()
  if (!coupon || !(coupon as any).type) return newLineTotalList
  const type = (coupon as any).type
  const value = Number((coupon as any).value ?? 0)
  const maximumDiscount = Number((coupon as any).maximumDiscount ?? 0)
  let discounted = newLineTotalList
  if (type === 'percentage') {
    discounted = Math.round(newLineTotalList * (1 - value / 100) * 100) / 100
    if (maximumDiscount > 0) {
      const discountAmount = Math.round((newLineTotalList - discounted) * 100) / 100
      if (discountAmount > maximumDiscount) discounted = Math.round((newLineTotalList - maximumDiscount) * 100) / 100
    }
  } else {
    const off = Math.min(value, newLineTotalList)
    discounted = Math.round((newLineTotalList - off) * 100) / 100
  }
  return discounted
}

/** Normalize an ID (ObjectId, string, or { _id } ref) to a string for comparison. Matches cart coupon logic. */
function toIdString(id: any): string {
  if (id == null) return ''
  if (typeof id === 'string') return id.trim()
  if (typeof id === 'object') {
    if (id instanceof mongoose.Types.ObjectId || id?.constructor?.name === 'ObjectId') return String(id.toString())
    if (id._id != null && id._id !== id) return toIdString(id._id)
    if (typeof id.toString === 'function') return String(id.toString())
  }
  return String(id)
}

/** Recompute order.discount from coupon eligibility: only apply discount to items that are eligible for the order's coupon. Used after exchange so ineligible replacement products don't get the discount. */
async function recalcOrderDiscountForEligibleItems(order: any): Promise<number> {
  const couponRef = order?.coupon
  const couponId = couponRef != null ? toIdString((couponRef as any)?._id ?? couponRef) : ''
  if (!couponId) return 0
  const coupon = await Coupon.findById(couponId).lean()
  if (!coupon || !coupon.type) return 0
  let eligibleSubtotal = 0
  for (const item of order.items || []) {
    const kept = Math.max(0, (item.quantity ?? 0) - (item.returnedQuantity ?? 0))
    if (kept <= 0) continue
    const lineTotal = Math.round((Number(item.price ?? 0) * kept) * 100) / 100
    const productId = item.product?._id ?? item.product
    if (!productId) continue
    const product = await Product.findById(productId).select('category').lean()
    const categoryId = product?.category ?? null
    const eligible = await isNewProductEligibleForOrderCoupon(order, productId, categoryId)
    if (eligible) eligibleSubtotal += lineTotal
  }
  eligibleSubtotal = Math.round(eligibleSubtotal * 100) / 100
  if (eligibleSubtotal <= 0) return 0
  const type = (coupon as any).type
  const value = Number((coupon as any).value ?? 0)
  const maximumDiscount = Number((coupon as any).maximumDiscount ?? 0)
  let discount = 0
  if (type === 'percentage') {
    discount = Math.round(eligibleSubtotal * (value / 100) * 100) / 100
    if (maximumDiscount > 0 && discount > maximumDiscount) discount = maximumDiscount
  } else {
    discount = Math.min(value, eligibleSubtotal)
    discount = Math.round(discount * 100) / 100
  }
  return discount
}

/** True if the order has a coupon and the new product is eligible for that same coupon (by product ID or category). Uses coupon ref only — discount can be 0 when all current items are ineligible, but a new eligible product should still get the discount. */
async function isNewProductEligibleForOrderCoupon(
  order: any,
  productId: any,
  productCategoryId: any
): Promise<boolean> {
  const orderId = order?._id ?? order?.id
  let couponId = ''
  if (orderId) {
    const orderDoc = await Order.findById(orderId).select('coupon').lean()
    const ref = orderDoc?.coupon
    couponId = ref != null ? toIdString((ref as any)?._id ?? ref) : ''
  } else {
    const couponRef = order?.coupon
    couponId = couponRef != null ? toIdString((couponRef as any)?._id ?? couponRef) : ''
  }
  if (!couponId) return false
  const coupon = await Coupon.findById(couponId)
    .select('applicableToProducts applicableToCategories')
    .lean()
  if (!coupon) return false
  const toProducts = (coupon.applicableToProducts || [])
    .map((id: any) => toIdString(id))
    .filter((s) => s.length > 0)
  const toCategories = (coupon.applicableToCategories || [])
    .map((id: any) => toIdString(id))
    .filter((s) => s.length > 0)
  if (toProducts.length === 0 && toCategories.length === 0) return true
  const pid = toIdString(productId)
  const cid = toIdString(productCategoryId)
  if (toProducts.length > 0 && pid && toProducts.some((p) => p === pid)) return true
  if (toCategories.length > 0 && cid && toCategories.some((c) => c === cid)) return true
  return false
}

/** Amount paid for the removed item: use the order's proportional discount (what the customer actually paid on their receipt). Order-level coupons reduce the total paid, so this line's share is always proportional. Returns amount and whether order had a discount (for UI). */
function getOldItemPaidTotalWithEligibility(
  order: any,
  oldItemTotal: number,
  _oldProductId?: any
): { oldItemPaidTotal: number; oldItemEligibleForCoupon: boolean } {
  const amount = getEffectiveOldItemPaidTotal(order, oldItemTotal)
  const hadOrderDiscount = Number(order?.discount ?? 0) > 0 && amount < oldItemTotal - 0.001
  return { oldItemPaidTotal: amount, oldItemEligibleForCoupon: hadOrderDiscount }
}

/** Recompute pendingExchange.priceDifference (and value-used) so GET order always returns correct refund. Handles stale data from before coupon-eligibility fix. */
async function recalcPendingExchangePriceDifference(order: any): Promise<void> {
  const pending = (order as any).pendingExchange
  if (!pending || pending.itemIndex == null) return
  const oldItemTotal = Number(pending.oldItemTotal ?? 0)
  // Use proportional discounted value for the removing item (order total for that line). When balance due on delivery, the item may still be coupon-eligible so value = 303.99 not list 319.99.
  const { oldItemPaidTotal, oldItemEligibleForCoupon } = getOldItemPaidTotalWithEligibility(order, oldItemTotal)
  pending.oldItemPaidTotal = oldItemPaidTotal
  pending.oldItemEligibleForCoupon = oldItemEligibleForCoupon
  const newItemsList = pending.newItems
  if (newItemsList && Array.isArray(newItemsList) && newItemsList.length > 0) {
    let newItemValueSum = 0
    for (const n of newItemsList) {
      const productDoc = await Product.findById(n.newProductId).select('category').lean()
      const categoryId = productDoc?.category ?? null
      const isEligible = await isNewProductEligibleForOrderCoupon(order, n.newProductId, categoryId)
      const lineTotal = Number(n.newLineTotal ?? 0)
      newItemValueSum += isEligible ? await getNewItemDiscountedTotalWithCoupon(order, lineTotal) : lineTotal
    }
    newItemValueSum = Math.round(newItemValueSum * 100) / 100
    pending.priceDifference = Math.round((newItemValueSum - oldItemPaidTotal) * 100) / 100
    pending.newItemsValueUsed = newItemValueSum
  } else {
    const newProductId = pending.newProductId
    const newLineTotal = Number(pending.newLineTotal ?? 0)
    if (!newProductId) return
    const productDoc = await Product.findById(newProductId).select('category').lean()
    const categoryId = productDoc?.category ?? null
    const isEligible = await isNewProductEligibleForOrderCoupon(order, newProductId, categoryId)
    const newItemDiscounted = await getNewItemDiscountedTotalWithCoupon(order, newLineTotal)
    // One formula for both upgrade and downgrade: priceDifference = newItemValue - oldItemPaidTotal (refund = amount paid − value of new).
    const newItemValue = isEligible ? newItemDiscounted : newLineTotal
    pending.priceDifference = Math.round((newItemValue - oldItemPaidTotal) * 100) / 100
    pending.newItemValueUsed = newItemValue
    // Only apply “credit” when customer pays (upgrade); when they get a refund (downgrade) do not use refundToApply.
    pending.refundToApply = 0
  }
}

// @route   POST /api/v1/orders/:id/request-exchange
// @desc    Request to replace one order item with a new product (within exchange window). Stores pending exchange; customer then pays difference or submits bank details for refund.
// @access  Private
router.post('/:id/request-exchange', protect, async (req: any, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' })
    const orderUserId = order.user != null ? String(order.user) : null
    const reqUserId = req.user?._id != null ? String(req.user._id) : null
    if (orderUserId !== reqUserId || req.user?.isAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized' })
    }
    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Exchange is only available for pending orders' })
    }
    const settings = await OrderSettings.findOne({ key: ORDER_SETTINGS_KEY }).lean()
    const windowMs = (settings?.cancellationWindowMinutes ?? 1440) * 60 * 1000
    if (Date.now() > new Date(order.createdAt).getTime() + windowMs) {
      return res.status(400).json({ success: false, error: 'Exchange window has expired' })
    }
    const { itemIndex, productId, variants, quantity, quantityToReplace: qtyToReplaceBody, items: itemsBody } = req.body
    const idx = Number(itemIndex)
    if (Number.isNaN(idx) || idx < 0 || idx >= (order.items?.length ?? 0)) {
      return res.status(400).json({ success: false, error: 'Invalid item' })
    }
    const oldItem = order.items[idx]
    const alreadyReturned = Number(oldItem.returnedQuantity ?? 0)
    const maxReplaceable = Math.max(0, oldItem.quantity - alreadyReturned)
    let qtyToReplace = Math.floor(Number(qtyToReplaceBody))
    if (!Number.isInteger(qtyToReplace) || qtyToReplace < 1) {
      qtyToReplace = oldItem.quantity
    }
    if (qtyToReplace > maxReplaceable) {
      return res.status(400).json({ success: false, error: `You can replace at most ${maxReplaceable} of this item` })
    }
    const oldItemTotal = Math.round(oldItem.price * qtyToReplace * 100) / 100
    // Use proportional discounted value for removing item (so coupon-eligible item with balance due shows 303.99 not list 319.99).
    const { oldItemPaidTotal, oldItemEligibleForCoupon } = getOldItemPaidTotalWithEligibility(order, oldItemTotal)

    const itemsArray = Array.isArray(itemsBody) && itemsBody.length > 0 ? itemsBody : null
    if (itemsArray) {
      // Multiple products: build newItems and set pending
      const newItems: Array<{ newProductId: any; newName: string; newVariant?: Record<string, string>; newQty: number; newUnitPrice: number; newLineTotal: number }> = []
      let newLineTotalSum = 0
      for (const it of itemsArray) {
        const pid = it.productId
        const qty = Math.floor(Number(it.quantity)) || 1
        const product = await Product.findById(pid)
        if (!product) return res.status(404).json({ success: false, error: `Product not found: ${pid}` })
        const variantObj = it.variants && typeof it.variants === 'object' ? it.variants : undefined
        const stock = getEffectiveStock(product, variantObj)
        if (stock < qty) return res.status(400).json({ success: false, error: `Insufficient stock for ${product.name}` })
        const unitPrice = Number(product.price ?? 0)
        const lineTotal = Math.round(unitPrice * qty * 100) / 100
        newLineTotalSum += lineTotal
        newItems.push({
          newProductId: product._id,
          newName: product.name,
          newVariant: variantObj,
          newQty: qty,
          newUnitPrice: unitPrice,
          newLineTotal: lineTotal,
        })
      }
      newLineTotalSum = Math.round(newLineTotalSum * 100) / 100
      let newItemValueSum = 0
      for (const n of newItems) {
        const productDoc = await Product.findById(n.newProductId).select('category').lean()
        const categoryId = productDoc?.category ?? null
        const isEligible = await isNewProductEligibleForOrderCoupon(order, n.newProductId, categoryId)
        newItemValueSum += isEligible ? await getNewItemDiscountedTotalWithCoupon(order, n.newLineTotal) : n.newLineTotal
      }
      newItemValueSum = Math.round(newItemValueSum * 100) / 100
      const priceDifference = Math.round((newItemValueSum - oldItemPaidTotal) * 100) / 100
      const pending = {
        itemIndex: idx,
        quantityToReplace: qtyToReplace,
        oldItemTotal,
        newItems,
        priceDifference,
        newItemsValueUsed: newItemValueSum,
      }
      ;(order as any).pendingExchange = pending
      await order.save()
      return res.json({
        success: true,
        data: {
          priceDifference,
          quantityToReplace: qtyToReplace,
          oldItem: { name: oldItem.name, quantity: oldItem.quantity, quantityToReplace: qtyToReplace, price: oldItem.price, total: oldItemTotal, amountPaid: oldItemPaidTotal, eligibleForCoupon: oldItemEligibleForCoupon },
          newItems: newItems.map((n) => ({ name: n.newName, quantity: n.newQty, price: n.newUnitPrice, total: n.newLineTotal })),
          newItemsTotalAfterDiscount: newItemValueSum,
        },
      })
    }

    // Single product (existing behaviour)
    const qty = Math.floor(Number(quantity))
    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ success: false, error: 'Quantity must be at least 1' })
    }
    const product = await Product.findById(productId)
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' })
    const variantObj = variants && typeof variants === 'object' ? variants : undefined
    const stock = getEffectiveStock(product, variantObj)
    if (stock < qty) {
      return res.status(400).json({ success: false, error: 'Insufficient stock for the selected product' })
    }
    const unitPrice = Number(product.price ?? 0)
    const newLineTotal = Math.round(unitPrice * qty * 100) / 100
    const newProductEligible = await isNewProductEligibleForOrderCoupon(order, product._id, product.category)
    const newItemDiscounted = await getNewItemDiscountedTotalWithCoupon(order, newLineTotal)
    const newItemValue = newProductEligible ? newItemDiscounted : newLineTotal
    let priceDifference: number
    let refundToApply: number
    if (newProductEligible) {
      priceDifference = Math.round((newItemDiscounted - oldItemPaidTotal) * 100) / 100
      refundToApply = 0
    } else {
      // New product not eligible for coupon: customer pays full price difference (new − amount paid for old item). No extra “refund to apply”.
      priceDifference = Math.round((newItemValue - oldItemPaidTotal) * 100) / 100
      refundToApply = 0
    }
    const newItemValueUsed = newItemValue
    const pending = {
      itemIndex: idx,
      quantityToReplace: qtyToReplace,
      oldItemTotal,
      newProductId: product._id,
      newName: product.name,
      newVariant: variantObj,
      newQty: qty,
      newUnitPrice: unitPrice,
      newLineTotal,
      priceDifference,
      newItemValueUsed,
      refundToApply,
    }
    ;(order as any).pendingExchange = pending
    await order.save()
    res.json({
      success: true,
      data: {
        priceDifference,
        quantityToReplace: qtyToReplace,
        refundToApply: refundToApply !== undefined ? refundToApply : undefined,
        oldItem: { name: oldItem.name, quantity: oldItem.quantity, quantityToReplace: qtyToReplace, price: oldItem.price, total: oldItemTotal, amountPaid: oldItemPaidTotal, eligibleForCoupon: oldItemEligibleForCoupon },
        newItem: {
          name: product.name,
          quantity: qty,
          price: unitPrice,
          total: newLineTotal,
          totalAfterDiscount: newProductEligible ? newItemDiscounted : undefined,
          eligibleForCoupon: newProductEligible,
        },
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/orders/:id/add-exchange-item
// @desc    Add one product to the pending exchange (multi-product replacement). Creates pending if none.
// @access  Private
router.post('/:id/add-exchange-item', protect, async (req: any, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' })
    const orderUserId = order.user != null ? String(order.user) : null
    const reqUserId = req.user?._id != null ? String(req.user._id) : null
    if (orderUserId !== reqUserId && !req.user?.isAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized' })
    }
    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Exchange is only available for pending orders' })
    }
    const settings = await OrderSettings.findOne({ key: ORDER_SETTINGS_KEY }).lean()
    const windowMs = (settings?.cancellationWindowMinutes ?? 1440) * 60 * 1000
    if (Date.now() > new Date(order.createdAt).getTime() + windowMs) {
      return res.status(400).json({ success: false, error: 'Exchange window has expired' })
    }
    const { itemIndex, productId, variants, quantity, quantityToReplace: qtyToReplaceBody } = req.body
    const idx = Number(itemIndex)
    if (Number.isNaN(idx) || idx < 0 || idx >= (order.items?.length ?? 0)) {
      return res.status(400).json({ success: false, error: 'Invalid item' })
    }
    const oldItem = order.items[idx]
    const alreadyReturned = Number(oldItem.returnedQuantity ?? 0)
    const maxReplaceable = Math.max(0, oldItem.quantity - alreadyReturned)
    let qtyToReplace = Math.floor(Number(qtyToReplaceBody))
    if (!Number.isInteger(qtyToReplace) || qtyToReplace < 1) {
      qtyToReplace = oldItem.quantity
    }
    if (qtyToReplace > maxReplaceable) {
      return res.status(400).json({ success: false, error: `You can replace at most ${maxReplaceable} of this item` })
    }
    const oldItemTotal = Math.round(oldItem.price * qtyToReplace * 100) / 100
    const { oldItemPaidTotal } = getOldItemPaidTotalWithEligibility(order, oldItemTotal)
    const qty = Math.floor(Number(quantity)) || 1
    const product = await Product.findById(productId)
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' })
    const variantObj = variants && typeof variants === 'object' ? variants : undefined
    const stock = getEffectiveStock(product, variantObj)
    if (stock < qty) return res.status(400).json({ success: false, error: 'Insufficient stock for the selected product' })
    const unitPrice = Number(product.price ?? 0)
    const newLineTotal = Math.round(unitPrice * qty * 100) / 100
    const newEntry = {
      newProductId: product._id,
      newName: product.name,
      newVariant: variantObj,
      newQty: qty,
      newUnitPrice: unitPrice,
      newLineTotal,
    }
    let pending = (order as any).pendingExchange
    const newItemsList = !pending || pending.itemIndex !== idx ? [newEntry] : [...(pending.newItems || []), newEntry]
    let newItemValueSum = 0
    for (const n of newItemsList) {
      const productDoc = await Product.findById(n.newProductId).select('category').lean()
      const categoryId = productDoc?.category ?? null
      const isEligible = await isNewProductEligibleForOrderCoupon(order, n.newProductId, categoryId)
      newItemValueSum += isEligible ? await getNewItemDiscountedTotalWithCoupon(order, n.newLineTotal) : n.newLineTotal
    }
    newItemValueSum = Math.round(newItemValueSum * 100) / 100
    const priceDifference = Math.round((newItemValueSum - oldItemPaidTotal) * 100) / 100
    if (!pending || pending.itemIndex !== idx) {
      pending = {
        itemIndex: idx,
        quantityToReplace: qtyToReplace,
        oldItemTotal,
        newItems: [newEntry],
        priceDifference,
        newItemsValueUsed: newItemValueSum,
      }
    } else {
      pending = {
        ...pending,
        newItems: newItemsList,
        priceDifference,
        newItemsValueUsed: newItemValueSum,
      }
    }
    ;(order as any).pendingExchange = pending
    await order.save()
    const newLineTotalSum = (pending.newItems as any[]).reduce((s: number, n: any) => s + (n.newLineTotal || 0), 0)
    res.json({
      success: true,
      data: {
        priceDifference: pending.priceDifference,
        quantityToReplace: qtyToReplace,
        newItems: (pending.newItems as any[]).map((n: any) => ({ name: n.newName, quantity: n.newQty, price: n.newUnitPrice, total: n.newLineTotal })),
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/orders/:id/create-exchange-payment-intent
// @desc    Create Stripe PaymentIntent for the net amount (price difference minus any refund due). Customer pays only the remainder.
// @access  Private
router.post('/:id/create-exchange-payment-intent', protect, async (req: any, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' })
    const orderUserId = order.user != null ? String(order.user) : null
    const reqUserId = req.user?._id != null ? String(req.user._id) : null
    if (orderUserId !== reqUserId) return res.status(403).json({ success: false, error: 'Not authorized' })
    const pending = (order as any).pendingExchange
    if (!pending || pending.priceDifference <= 0) {
      return res.status(400).json({ success: false, error: 'No payment needed for this exchange' })
    }
    const refundToUse = Math.round(((pending.refundToApply ?? (order as any).refundPending) ?? 0) * 100) / 100
    const amountToPay = Math.round(Math.max(0, pending.priceDifference - refundToUse) * 100) / 100
    if (amountToPay < 0.01) {
      return res.json({ success: true, clientSecret: null, amountToPay: 0 })
    }
    const stripe = await getStripe()
    if (!stripe) return res.status(503).json({ success: false, error: 'Card payment is not configured' })
    const amountInFils = Math.round(amountToPay * 100)
    if (amountInFils < 1) return res.status(400).json({ success: false, error: 'Invalid amount' })
    const pi = await stripe.paymentIntents.create({
      amount: amountInFils,
      currency: 'aed',
      automatic_payment_methods: { enabled: true },
    })
    res.json({ success: true, clientSecret: pi.client_secret, amountToPay })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/orders/:id/create-exchange-tabby-session
// @desc    Create Tabby checkout session for the exchange price difference; returns web_url for redirect.
// @access  Private
router.post('/:id/create-exchange-tabby-session', protect, async (req: any, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' })
    const orderUserId = order.user != null ? String(order.user) : null
    const reqUserId = req.user?._id != null ? String(req.user._id) : null
    if (orderUserId !== reqUserId) return res.status(403).json({ success: false, error: 'Not authorized' })
    const pending = (order as any).pendingExchange
    if (!pending || pending.priceDifference <= 0) {
      return res.status(400).json({ success: false, error: 'No payment needed for this exchange' })
    }
    const tabbyConfig = await getTabbyConfig()
    if (!tabbyConfig) {
      return res.status(503).json({ success: false, error: 'Tabby is not configured. Set Tabby keys in Admin → Settings → Payment.' })
    }
    const baseUrl = getOrdersBaseUrl().replace(/\/$/, '')
    const clientUrl = (process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '')
    const orderId = order._id.toString()
    const shippingWithArea = order.shippingAddress
      ? { ...order.shippingAddress, area: (order.shippingAddress as any).area ?? (order.shippingAddress as any).zipCode }
      : { name: '', address: '', city: '', state: '', zip: '', country: '', phone: '' }
    let emailStr = order.customerEmail?.trim() || ''
    if (!emailStr && order.user) {
      const userDoc = await User.findById(order.user).select('email').lean()
      emailStr = (userDoc as any)?.email?.trim() || ''
    }
    if (!emailStr) emailStr = 'noreply@example.com'
    const refundToUseTabby = Math.round(((pending.refundToApply ?? (order as any).refundPending) ?? 0) * 100) / 100
    const amountToPay = Math.round(Math.max(0, pending.priceDifference - refundToUseTabby) * 100) / 100
    if (amountToPay < 0.01) {
      return res.status(400).json({ success: false, error: 'No payment needed; your refund covers this exchange. Use "Confirm exchange (refund applied)" instead.' })
    }
    const sessionResult = await createTabbyCheckoutSession(tabbyConfig, {
      orderReference: `${order.orderNumber}-ex`,
      amount: amountToPay,
      currency: 'AED',
      buyer: {
        email: emailStr,
        phone: (order.shippingAddress as any)?.phone?.trim() || '0000000000',
        name: (order.shippingAddress as any)?.name?.trim() || undefined,
      },
      shippingAddress: {
        name: (order.shippingAddress as any)?.name,
        address: [(order.shippingAddress as any)?.street, (order.shippingAddress as any)?.city, (order.shippingAddress as any)?.state].filter(Boolean).join(', '),
        city: (order.shippingAddress as any)?.city,
        state: (order.shippingAddress as any)?.state,
        zip: (order.shippingAddress as any)?.zipCode || (order.shippingAddress as any)?.area,
        country: (order.shippingAddress as any)?.country,
        phone: (order.shippingAddress as any)?.phone,
      },
      merchantUrls: {
        success: `${baseUrl}/api/v1/orders/${orderId}/tabby-exchange-return`,
        cancel: `${clientUrl}/account/orders/${orderId}/exchange?tabby=cancel`,
        failure: `${clientUrl}/account/orders/${orderId}/exchange?tabby=failure`,
      },
      description: `Exchange difference for order ${order.orderNumber}`,
      orderItems: [{ title: 'Exchange difference (after refund applied)', quantity: 1, unit_price: amountToPay.toFixed(2) }],
    })
    if (sessionResult.status !== 'created' || !sessionResult.webUrl) {
      const reason = sessionResult.rejectionReason || 'Tabby could not create this session.'
      return res.status(400).json({
        success: false,
        error: reason,
      })
    }
    res.json({ success: true, web_url: sessionResult.webUrl })
  } catch (error: any) {
    next(error)
  }
})

// @route   GET /api/v1/orders/:id/tabby-exchange-return
// @desc    Tabby redirects here after customer pays the exchange difference. Verify payment and complete exchange.
// @access  Public (redirect from Tabby)
router.get('/:id/tabby-exchange-return', async (req, res, next) => {
  try {
    const orderId = req.params.id
    const paymentId = (req.query.payment_id as string)?.trim()
    const clientUrl = (process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '')
    if (!paymentId) {
      return res.redirect(302, `${clientUrl}/account/orders/${orderId}?tabby=missing`)
    }
    const tabbyConfig = await getTabbyConfig()
    if (!tabbyConfig) {
      return res.redirect(302, `${clientUrl}/account/orders/${orderId}?tabby=error`)
    }
    const order = await Order.findById(orderId)
    if (!order) {
      return res.redirect(302, `${clientUrl}/account/orders?tabby=notfound`)
    }
    const pending = (order as any).pendingExchange
    if (!pending || pending.priceDifference <= 0) {
      return res.redirect(302, `${clientUrl}/account/orders/${orderId}?tabby=no_pending`)
    }
    const payment = await getTabbyPayment(tabbyConfig, paymentId)
    if (!payment) {
      return res.redirect(302, `${clientUrl}/account/orders/${orderId}?tabby=verify_failed`)
    }
    if (isTabbyPaymentFailed(payment.status)) {
      return res.redirect(302, `${clientUrl}/account/orders/${orderId}/exchange?tabby=failed`)
    }
    if (!isTabbyPaymentSuccessful(payment.status)) {
      return res.redirect(302, `${clientUrl}/account/orders/${orderId}/exchange?tabby=pending`)
    }
    const idx = pending.itemIndex
    const oldItem = order.items[idx]
    const qtyToReplace = pending.quantityToReplace ?? oldItem.quantity
    const newItemsListTabby = (pending as any).newItems as Array<{ newProductId: any; newName: string; newVariant?: Record<string, string>; newQty: number; newUnitPrice: number; newLineTotal: number }> | undefined
    const isMultiTabby = newItemsListTabby && newItemsListTabby.length > 0
    let addedNewLineTotalTabby = 0
    await restockOrderItem(oldItem.product, oldItem.variants, qtyToReplace)
    if (isMultiTabby) {
      for (const it of newItemsListTabby) {
        await decrementStockForOrderItem(it.newProductId, it.newVariant || null, it.newQty)
        addedNewLineTotalTabby += it.newLineTotal
      }
      if (qtyToReplace >= oldItem.quantity) {
        order.items[idx] = {
          product: newItemsListTabby[0].newProductId,
          name: newItemsListTabby[0].newName,
          quantity: newItemsListTabby[0].newQty,
          price: newItemsListTabby[0].newUnitPrice,
          variants: newItemsListTabby[0].newVariant,
          returnedQuantity: 0,
        } as any
        for (let i = 1; i < newItemsListTabby.length; i++) {
          order.items.push({
            product: newItemsListTabby[i].newProductId,
            name: newItemsListTabby[i].newName,
            quantity: newItemsListTabby[i].newQty,
            price: newItemsListTabby[i].newUnitPrice,
            variants: newItemsListTabby[i].newVariant,
            returnedQuantity: 0,
          } as any)
        }
      } else {
        order.items[idx].quantity = oldItem.quantity - qtyToReplace
        for (const it of newItemsListTabby) {
          order.items.push({
            product: it.newProductId,
            name: it.newName,
            quantity: it.newQty,
            price: it.newUnitPrice,
            variants: it.newVariant,
            returnedQuantity: 0,
          } as any)
        }
      }
    } else {
      await decrementStockForOrderItem(
        pending.newProductId,
        pending.newVariant || null,
        pending.newQty
      )
      addedNewLineTotalTabby = pending.newLineTotal ?? 0
      if (qtyToReplace >= oldItem.quantity) {
        order.items[idx] = {
          product: pending.newProductId,
          name: pending.newName,
          quantity: pending.newQty,
          price: pending.newUnitPrice,
          variants: pending.newVariant,
          returnedQuantity: 0,
        } as any
      } else {
        order.items[idx].quantity = oldItem.quantity - qtyToReplace
        order.items.push({
          product: pending.newProductId,
          name: pending.newName,
          quantity: pending.newQty,
          price: pending.newUnitPrice,
          variants: pending.newVariant,
          returnedQuantity: 0,
        } as any)
      }
    }
    let newSubtotal = order.subtotal - pending.oldItemTotal + addedNewLineTotalTabby
    newSubtotal = Math.round(newSubtotal * 100) / 100
    order.subtotal = newSubtotal
    order.tax = 0
    order.discount = await recalcOrderDiscountForEligibleItems(order)
    order.total = Math.round((newSubtotal + order.shipping - order.discount) * 100) / 100
    const refundToUseBefore = Math.round(((pending.refundToApply ?? (order as any).refundPending) ?? 0) * 100) / 100
    const amountPaidTabby = Math.round(Math.max(0, pending.priceDifference - refundToUseBefore) * 100) / 100
    const paidSoFar = Math.round(((order as any).totalPaidByCustomer ?? 0) * 100) / 100
    ;(order as any).totalPaidByCustomer = Math.round((paidSoFar + amountPaidTabby) * 100) / 100
    ;(order as any).pendingExchange = undefined
    ;(order as any).refundPending = undefined
    ;(order as any).refundBankDetails = undefined
    ;(order as any).refundStatus = undefined
    ;(order as any).balanceDueOnDelivery = undefined
    await order.save()
    await Order.updateOne(
      { _id: order._id },
      { $unset: { pendingExchange: '', refundPending: '', refundBankDetails: '', refundStatus: '', balanceDueOnDelivery: '' } }
    )
    return res.redirect(302, `${clientUrl}/account/orders/${orderId}?exchange=success`)
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/orders/:id/confirm-exchange
// @desc    Complete the pending exchange: replace item, recalc totals. Either pay (paymentIntentId) or refund (bankDetails).
// @access  Private
router.post('/:id/confirm-exchange', protect, async (req: any, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' })
    const orderUserId = order.user != null ? String(order.user) : null
    const reqUserId = req.user?._id != null ? String(req.user._id) : null
    if (orderUserId !== reqUserId) return res.status(403).json({ success: false, error: 'Not authorized' })
    const pending = (order as any).pendingExchange
    if (!pending) return res.status(400).json({ success: false, error: 'No pending exchange' })

    // Recompute refund/pay amount from amount paid + coupon eligibility (fixes stale 140 vs 125.50)
    await recalcPendingExchangePriceDifference(order)

    const body = req.body || {}
    let type = typeof body.type === 'string' ? body.type.trim().toLowerCase() : undefined
    const { paymentIntentId, bankDetails } = body
    const idx = pending.itemIndex
    const oldItem = order.items[idx]

    // When refund scenario and order has balance due, treat missing type as apply_to_balance (client may send empty body)
    const balanceForFallback = Math.round(((order as any).balanceDueOnDelivery ?? 0) * 100) / 100
    if (pending.priceDifference < 0 && balanceForFallback > 0 && (type === undefined || type === '')) {
      type = 'apply_to_balance'
    }

    if (type === 'apply_to_balance' && pending.priceDifference < 0) {
      // Customer has balance due on delivery; apply this exchange refund to reduce it. Any excess is added to refundPending.
      const balance = Math.round(((order as any).balanceDueOnDelivery ?? 0) * 100) / 100
      const refundAmount = Math.round(Math.abs(pending.priceDifference) * 100) / 100
      const amountApplied = Math.min(balance, refundAmount)
      const newBalance = Math.round((balance - amountApplied) * 100) / 100
      const excessRefund = Math.round((refundAmount - amountApplied) * 100) / 100
      ;(order as any).balanceDueOnDelivery = newBalance > 0 ? newBalance : undefined
      if (excessRefund > 0) {
        if (!bankDetails || typeof bankDetails !== 'object') {
          return res.status(400).json({ success: false, error: 'Bank details are required for the excess refund amount' })
        }
        const { accountHolderName, bankName, iban } = bankDetails
        if (!accountHolderName || !bankName || !iban) {
          return res.status(400).json({ success: false, error: 'Account holder name, bank name, and IBAN are required for the excess refund' })
        }
        ;(order as any).refundBankDetails = {
          accountHolderName: String(accountHolderName).trim(),
          bankName: String(bankName).trim(),
          iban: String(iban).trim(),
        }
        const existingRefund = Math.round(((order as any).refundPending || 0) * 100) / 100
        ;(order as any).refundPending = Math.round((existingRefund + excessRefund) * 100) / 100
        ;(order as any).refundStatus = 'pending'
        const history = (order as any).refundHistory || []
        history.push({ amount: excessRefund, createdAt: new Date(), status: 'pending', note: 'Exchange to cheaper item (excess after applying to balance)' })
        ;(order as any).refundHistory = history
      }
    } else if (type === 'refund') {
      if (pending.priceDifference >= 0) {
        return res.status(400).json({ success: false, error: 'No refund for this exchange; new product costs same or more' })
      }
      if (!bankDetails || typeof bankDetails !== 'object') {
        return res.status(400).json({ success: false, error: 'Bank details are required for refund' })
      }
      const { accountHolderName, bankName, iban } = bankDetails
      if (!accountHolderName || !bankName || !iban) {
        return res.status(400).json({ success: false, error: 'Account holder name, bank name, and IBAN are required' })
      }
      ;(order as any).refundBankDetails = {
        accountHolderName: String(accountHolderName).trim(),
        bankName: String(bankName).trim(),
        iban: String(iban).trim(),
      }
      // Add this exchange's refund to any existing pending refund (e.g. from a previous exchange)
      const existingRefund = Math.round(((order as any).refundPending || 0) * 100) / 100
      const thisRefund = Math.round(Math.abs(pending.priceDifference) * 100) / 100
      ;(order as any).refundPending = Math.round((existingRefund + thisRefund) * 100) / 100
      ;(order as any).refundStatus = 'pending'
      const history = (order as any).refundHistory || []
      history.push({ amount: thisRefund, createdAt: new Date(), status: 'pending', note: 'Exchange to cheaper item' })
      ;(order as any).refundHistory = history
    } else if (type === 'pay' && pending.priceDifference > 0) {
      if (!paymentIntentId) return res.status(400).json({ success: false, error: 'Payment is required' })
      const stripe = await getStripe()
      if (!stripe) return res.status(503).json({ success: false, error: 'Payment not configured' })
      const refundToUse = Math.round(((pending.refundToApply ?? (order as any).refundPending) ?? 0) * 100) / 100
      const amountToPay = Math.round(Math.max(0, pending.priceDifference - refundToUse) * 100) / 100
      const amountInFils = Math.round(amountToPay * 100)
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
      if (pi.status !== 'succeeded') {
        return res.status(400).json({ success: false, error: 'Payment has not been completed' })
      }
      if (pi.amount !== amountInFils) {
        return res.status(400).json({ success: false, error: 'Payment amount does not match' })
      }
      ;(order as any).refundPending = undefined
      ;(order as any).refundBankDetails = undefined
      ;(order as any).refundStatus = undefined
      ;(order as any).balanceDueOnDelivery = undefined
      const paidSoFar = Math.round(((order as any).totalPaidByCustomer ?? 0) * 100) / 100
      ;(order as any).totalPaidByCustomer = Math.round((paidSoFar + amountToPay) * 100) / 100
    } else if (type === 'apply_refund' && pending.priceDifference > 0) {
      const refundPending = Math.round(((order as any).refundPending || 0) * 100) / 100
      if (refundPending < pending.priceDifference) {
        return res.status(400).json({ success: false, error: 'Refund does not cover this exchange; pay the remaining amount instead.' })
      }
      ;(order as any).refundPending = undefined
      ;(order as any).refundBankDetails = undefined
      ;(order as any).refundStatus = undefined
      ;(order as any).balanceDueOnDelivery = undefined
    } else if (type === 'pay_cod' && pending.priceDifference > 0) {
      // COD order: customer will pay difference on delivery (no payment now)
      if ((order as any).paymentMethod !== 'cod') {
        return res.status(400).json({ success: false, error: 'Pay on delivery is only for COD orders' })
      }
    } else if (type === 'pay_on_delivery' && pending.priceDifference > 0) {
      // Card (or other) order: customer chose to pay the exchange difference on delivery (net of any refund).
      // Accumulate with any existing balance from a previous exchange (e.g. first exchange +89.93 COD, second +289.99 COD → total 379.92).
      const refundToUse = Math.round(((pending.refundToApply ?? (order as any).refundPending) ?? 0) * 100) / 100
      const amountToPay = Math.round(Math.max(0, pending.priceDifference - refundToUse) * 100) / 100
      const existingBalance = Math.round(((order as any).balanceDueOnDelivery || 0) * 100) / 100
      ;(order as any).balanceDueOnDelivery = Math.round((existingBalance + amountToPay) * 100) / 100
      if (amountToPay < pending.priceDifference) {
        ;(order as any).refundPending = undefined
        ;(order as any).refundBankDetails = undefined
        ;(order as any).refundStatus = undefined
      }
    } else if (type === 'no_change' && pending.priceDifference === 0) {
      // Same price: no payment or refund
    } else if (type === 'cod_cheaper' && pending.priceDifference < 0) {
      // COD order: replacement is cheaper; no refund (customer has not paid yet). They pay the new total on delivery.
      if ((order as any).paymentMethod !== 'cod') {
        return res.status(400).json({ success: false, error: 'This option is only for Cash on Delivery orders' })
      }
    } else if (pending.priceDifference > 0 && type !== 'apply_refund') {
      const want = "one of: pay (with paymentIntentId), apply_refund, pay_on_delivery (pay remaining on delivery), or pay_cod (COD orders only)"
      return res.status(400).json({
        success: false,
        error: type
          ? `Invalid type "${type}" for this exchange. Use ${want}.`
          : `Missing type. Send ${want}.`,
      })
    } else if (pending.priceDifference < 0 && type !== 'refund' && type !== 'cod_cheaper' && type !== 'apply_to_balance') {
      const hasBalance = Math.round(((order as any).balanceDueOnDelivery ?? 0) * 100) / 100 > 0
      return res.status(400).json({
        success: false,
        error: hasBalance
          ? 'Confirm using "Apply refund to balance" — no bank details needed. Your refund will reduce your balance due on delivery.'
          : 'Bank details are required for refund.',
      })
    }

    const qtyToReplace = pending.quantityToReplace ?? oldItem.quantity
    const newItemsList = (pending as any).newItems as Array<{ newProductId: any; newName: string; newVariant?: Record<string, string>; newQty: number; newUnitPrice: number; newLineTotal: number }> | undefined
    const isMulti = newItemsList && newItemsList.length > 0
    let addedNewLineTotal = 0

    await restockOrderItem(oldItem.product, oldItem.variants, qtyToReplace)
    if (isMulti) {
      for (const it of newItemsList) {
        await decrementStockForOrderItem(it.newProductId, it.newVariant || null, it.newQty)
        addedNewLineTotal += it.newLineTotal
      }
      if (qtyToReplace >= oldItem.quantity) {
        order.items[idx] = {
          product: newItemsList[0].newProductId,
          name: newItemsList[0].newName,
          quantity: newItemsList[0].newQty,
          price: newItemsList[0].newUnitPrice,
          variants: newItemsList[0].newVariant,
          returnedQuantity: 0,
        } as any
        for (let i = 1; i < newItemsList.length; i++) {
          order.items.push({
            product: newItemsList[i].newProductId,
            name: newItemsList[i].newName,
            quantity: newItemsList[i].newQty,
            price: newItemsList[i].newUnitPrice,
            variants: newItemsList[i].newVariant,
            returnedQuantity: 0,
          } as any)
        }
      } else {
        order.items[idx].quantity = oldItem.quantity - qtyToReplace
        for (const it of newItemsList) {
          order.items.push({
            product: it.newProductId,
            name: it.newName,
            quantity: it.newQty,
            price: it.newUnitPrice,
            variants: it.newVariant,
            returnedQuantity: 0,
          } as any)
        }
      }
    } else {
      await decrementStockForOrderItem(
        pending.newProductId,
        pending.newVariant || null,
        pending.newQty
      )
      addedNewLineTotal = pending.newLineTotal ?? 0
      if (qtyToReplace >= oldItem.quantity) {
        order.items[idx] = {
          product: pending.newProductId,
          name: pending.newName,
          quantity: pending.newQty,
          price: pending.newUnitPrice,
          variants: pending.newVariant,
          returnedQuantity: 0,
        } as any
      } else {
        order.items[idx].quantity = oldItem.quantity - qtyToReplace
        order.items.push({
          product: pending.newProductId,
          name: pending.newName,
          quantity: pending.newQty,
          price: pending.newUnitPrice,
          variants: pending.newVariant,
          returnedQuantity: 0,
        } as any)
      }
    }
    // Recalculate totals: subtotal from items; discount only for items eligible for order coupon (ineligible replacement products get no discount).
    let newSubtotal = order.subtotal - pending.oldItemTotal + addedNewLineTotal
    newSubtotal = Math.round(newSubtotal * 100) / 100
    order.subtotal = newSubtotal
    order.tax = 0
    order.discount = await recalcOrderDiscountForEligibleItems(order)
    order.total = Math.round((newSubtotal + order.shipping - order.discount) * 100) / 100
    // Recompute balance due from final order total and net paid so it is never overwritten by a stale/discounted value (fixes 16 AED error when COD/exchange mix).
    if (type === 'pay_on_delivery' || type === 'apply_to_balance' || type === 'cod_cheaper') {
      const netPaid = Math.round(((order as any).totalPaidByCustomer ?? 0) * 100) / 100 - Math.round(((order as any).totalRefundedToCustomer ?? 0) * 100) / 100
      const balance = Math.round((Number(order.total ?? 0) - netPaid) * 100) / 100
      ;(order as any).balanceDueOnDelivery = balance > 0 ? balance : undefined
    }
    ;(order as any).pendingExchange = undefined
    await order.save()
    const unset: Record<string, string> = { pendingExchange: '' }
    if ((order as any).refundPending === undefined) unset.refundPending = ''
    if ((order as any).refundBankDetails === undefined) unset.refundBankDetails = ''
    if ((order as any).refundStatus === undefined) unset.refundStatus = ''
    if ((order as any).balanceDueOnDelivery === undefined) unset.balanceDueOnDelivery = ''
    if (Object.keys(unset).length > 1) {
      await Order.updateOne({ _id: order._id }, { $unset: unset })
    } else {
      await Order.updateOne({ _id: order._id }, { $unset: { pendingExchange: '' } })
    }

    emitOrderUpdate(
      order._id.toString(),
      order.status,
      order.user != null ? String(order.user) : undefined
    )

    const populated = await Order.findById(order._id)
      .populate('items.product', 'name images imageFolder variants slug')
      .populate('user', 'name email')
      .lean()
    const manifest = getProductImagesManifest()
    const plainOrder = populated ? {
      ...populated,
      items: (populated.items || []).map((it: any) => ({
        ...it,
        displayImageUrl: getOrderItemDisplayImageUrl(it.product, manifest, it.variants) || undefined,
      })),
    } : order.toObject()
    const message =
      type === 'refund'
        ? 'Exchange confirmed. Your refund will be processed to your bank account within 3–4 working days.'
        : type === 'apply_to_balance'
          ? 'Exchange confirmed. Your refund has been applied to your balance due on delivery.'
          : type === 'cod_cheaper'
            ? 'Exchange confirmed. You will pay the updated order total on delivery.'
            : type === 'pay_cod' || type === 'pay_on_delivery'
              ? 'Exchange confirmed. You will pay the remaining amount on delivery.'
              : type === 'apply_refund'
                ? 'Exchange confirmed. Your refund has been applied; no further payment needed.'
                : 'Exchange confirmed.'
    res.json({
      success: true,
      data: plainOrder,
      message,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/orders/:id/invoice
// @desc    Generate invoice for order
// @access  Private
router.get('/:id/invoice', protect, async (req: any, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name sku')
      .populate('user', 'name email')
      .populate('coupon')

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      })
    }

    // Check if user owns the order or is admin
    if (order.user?.toString() !== req.user._id.toString() && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to access this invoice',
      })
    }

    // Generate invoice data
    // After populate, user and coupon are objects, but TypeScript needs type assertions
    const user = order.user as any
    const coupon = order.coupon as any
    
    const invoiceData = {
      invoiceNumber: order.invoiceNumber || order.orderNumber,
      orderNumber: order.orderNumber,
      date: order.createdAt.toISOString(),
      customer: {
        name: user?.name || 'Guest',
        email: user?.email || (order.shippingAddress as any)?.email || '',
      },
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      items: order.items.map((item: any) => ({
        name: item.product?.name || item.name,
        sku: item.product?.sku || 'N/A',
        quantity: item.quantity,
        price: item.price,
        total: item.price * item.quantity,
      })),
      subtotal: order.subtotal,
      tax: order.tax,
      shipping: order.shipping,
      discount: order.discount,
      total: order.total,
      coupon: coupon ? {
        code: coupon.code || 'N/A',
        type: coupon.type || 'N/A',
        value: coupon.value || 0,
      } : null,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
    }

    // Return invoice data (client can generate PDF on frontend or use a service like Puppeteer on backend)
    res.json({
      success: true,
      data: invoiceData,
    })
  } catch (error) {
    next(error)
  }
})

export { recalcOrderDiscountForEligibleItems }
export default router
