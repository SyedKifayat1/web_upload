import express, { Request, Response } from 'express'
import Stripe from 'stripe'
import Order from '../models/Order'
import PaymentSettings, { PAYMENT_SETTINGS_KEY } from '../models/PaymentSettings'
import { emitOrderUpdate } from '../config/socket'

const router = express.Router()

async function getStripeInstance(): Promise<Stripe | null> {
  const fromEnv = process.env.STRIPE_SECRET_KEY?.trim()
  if (fromEnv) return new Stripe(fromEnv)
  const doc = await PaymentSettings.findOne({ key: PAYMENT_SETTINGS_KEY }).lean()
  const sk = doc?.stripeSecretKey?.trim()
  return sk ? new Stripe(sk) : null
}

function getWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || null
}

/**
 * Stripe webhook handler.
 * Must be mounted with express.raw({ type: 'application/json' }) so the body is available for signature verification.
 * Handles: payment_intent.succeeded, payment_intent.payment_failed, charge.refunded
 */
router.post('/', async (req: Request, res: Response) => {
  // express.raw() puts the raw body in req.body (Buffer)
  const rawBody = req.body
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    return res.status(400).json({ error: 'Missing raw body for webhook signature verification' })
  }

  const sig = req.headers['stripe-signature']
  if (!sig || typeof sig !== 'string') {
    return res.status(400).json({ error: 'Missing stripe-signature header' })
  }

  const webhookSecret = getWebhookSecret()
  if (!webhookSecret) {
    console.warn('[Stripe webhook] STRIPE_WEBHOOK_SECRET not set; skipping signature verification')
    return res.status(503).json({ error: 'Webhook not configured' })
  }

  let event: Stripe.Event
  try {
    event = Stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (err: any) {
    console.error('[Stripe webhook] Signature verification failed:', err?.message)
    return res.status(400).json({ error: `Webhook signature verification failed: ${err?.message}` })
  }

  const stripe = await getStripeInstance()
  if (!stripe) {
    console.warn('[Stripe webhook] Stripe not configured; acknowledging event without processing')
    return res.status(200).json({ received: true })
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent
        const paymentIntentId = pi.id
        const order = await Order.findOne({ paymentIntentId })
        if (order && order.paymentStatus !== 'paid') {
          order.paymentStatus = 'paid'
          await order.save()
          emitOrderUpdate(order._id.toString(), order.status, order.user?.toString())
          if (process.env.NODE_ENV !== 'test') {
            console.log('[Stripe webhook] Order updated to paid:', order.orderNumber)
          }
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        const paymentIntentId = pi.id
        const order = await Order.findOne({ paymentIntentId })
        if (order && order.paymentStatus !== 'failed') {
          order.paymentStatus = 'failed'
          await order.save()
          emitOrderUpdate(order._id.toString(), order.status, order.user?.toString())
          if (process.env.NODE_ENV !== 'test') {
            console.log('[Stripe webhook] Order payment marked failed:', order.orderNumber)
          }
        }
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
        if (!paymentIntentId) break
        const order = await Order.findOne({ paymentIntentId })
        if (order && order.paymentStatus !== 'refunded') {
          order.paymentStatus = 'refunded'
          await order.save()
          emitOrderUpdate(order._id.toString(), order.status, order.user?.toString())
          if (process.env.NODE_ENV !== 'test') {
            console.log('[Stripe webhook] Order payment marked refunded:', order.orderNumber)
          }
        }
        break
      }

      default:
        if (process.env.NODE_ENV === 'development') {
          console.log('[Stripe webhook] Unhandled event type:', event.type)
        }
    }
  } catch (err: any) {
    console.error('[Stripe webhook] Error processing event:', err?.message || err)
    return res.status(500).json({ error: 'Webhook handler error' })
  }

  res.status(200).json({ received: true })
})

export default router
