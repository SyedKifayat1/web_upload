/**
 * Tabby webhook handler.
 * Receives payment status updates (authorized, captured, closed, rejected, expired, refunded).
 * Register this URL in Tabby dashboard and optionally set a custom auth header for verification.
 */
import express, { Request, Response } from 'express'
import Order from '../models/Order'
import Cart from '../models/Cart'
import Product from '../models/Product'
import { emitOrderUpdate } from '../config/socket'
import { isTabbyPaymentSuccessful, isTabbyPaymentFailed } from '../services/tabby'
import { decrementStockForOrderItem } from '../services/stock'
import { sendOrderConfirmationEmail } from '../services/email'

const router = express.Router()

/** Optional: set TABBY_WEBHOOK_SECRET in env and register the same value as custom header in Tabby dashboard. */
function getWebhookSecret(): string | null {
  return process.env.TABBY_WEBHOOK_SECRET?.trim() || null
}

router.post('/', async (req: Request, res: Response) => {
  const secret = getWebhookSecret()
  if (secret) {
    const authHeader = req.headers['x-tabby-signature'] || req.headers['x-webhook-signature'] || req.headers['authorization']
    const provided = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '').trim() : ''
    if (provided !== secret) {
      return res.status(401).json({ error: 'Webhook signature mismatch' })
    }
  }

  const body = req.body as {
    id?: string
    payment_id?: string
    status?: string
    order?: { reference_id?: string }
  }
  const paymentId = body?.id || body?.payment_id
  if (!paymentId || typeof paymentId !== 'string') {
    return res.status(400).json({ error: 'Missing payment id' })
  }

  const status = (body.status ?? '').toString().toUpperCase()

  try {
    const order = await Order.findOne({ tabbyPaymentId: paymentId })
    if (!order) {
      return res.status(200).json({ received: true })
    }

    if (order.paymentStatus === 'paid' && (status === 'AUTHORIZED' || status === 'CLOSED' || status === 'CAPTURED')) {
      return res.status(200).json({ received: true })
    }

    if (isTabbyPaymentFailed(status)) {
      if (order.paymentStatus !== 'failed') {
        order.paymentStatus = 'failed'
        await order.save()
        emitOrderUpdate(order._id.toString(), order.status, order.user?.toString())
        if (process.env.NODE_ENV !== 'test') {
          console.log('[Tabby webhook] Order payment marked failed:', order.orderNumber)
        }
      }
      return res.status(200).json({ received: true })
    }

    if (status === 'REFUNDED' || status === 'REFUND') {
      if (order.paymentStatus !== 'refunded') {
        order.paymentStatus = 'refunded'
        await order.save()
        emitOrderUpdate(order._id.toString(), order.status, order.user?.toString())
      }
      return res.status(200).json({ received: true })
    }

    if (isTabbyPaymentSuccessful(status)) {
      if (order.paymentStatus !== 'paid') {
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
        const cart = await Cart.findOne({ user: order.user })
        if (cart) {
          cart.items = []
          await cart.save()
        }
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
            if (process.env.NODE_ENV !== 'test') console.error('[Tabby webhook confirmation email]', err?.message)
          }
        }
        if (process.env.NODE_ENV !== 'test') {
          console.log('[Tabby webhook] Order marked paid:', order.orderNumber)
        }
      }
    }
  } catch (err: any) {
    console.error('[Tabby webhook] Error:', err?.message || err)
    return res.status(500).json({ error: 'Webhook handler error' })
  }

  res.status(200).json({ received: true })
})

export default router
