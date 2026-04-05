import nodemailer from 'nodemailer'
import EmailSettings, { EMAIL_SETTINGS_KEY } from '../models/EmailSettings'
import SiteSettings, { SITE_SETTINGS_KEY } from '../models/SiteSettings'

export interface OrderForEmail {
  orderNumber: string
  total: number
  subtotal?: number
  tax?: number
  shipping?: number
  discount?: number
  items: Array<{ name: string; quantity: number; price: number; imageUrl?: string }>
  shippingAddress?: { name: string; street?: string; city?: string; state?: string; zipCode?: string; area?: string; country?: string; phone?: string }
  billingAddress?: { name: string; street?: string; city?: string; state?: string; zipCode?: string; area?: string; country?: string }
  paymentMethod?: string
  shippingMethodName?: string
  shippingMethodDelivery?: string
  createdAt: string | Date
}

interface OrderEmailData {
  storeName: string
  orderNumber: string
  orderDate: string
  trackUrl: string
  baseUrl: string
  contactEmail: string
  items: Array<{ name: string; quantity: number; price: number; imageUrl?: string }>
  subtotal: number
  shippingAmount: number
  taxAmount: number
  discountAmount: number
  total: number
  currency: string
  shippingAddress: string
  billingAddress: string
  paymentMethod: string
  shippingMethod: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Placeholder-based default template. Admin can override with custom HTML using same placeholders. */
const DEFAULT_ORDER_CONFIRMATION_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Order {{orderNumber}} confirmed</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen-Sans,Ubuntu,sans-serif;background-color:#f9fafb;color:#374151;line-height:1.5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;">
    <tr><td style="padding:24px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="padding:32px 24px 24px;">
          <h1 style="margin:0 0 4px;font-size:24px;font-weight:700;color:#111827;">{{storeName}}</h1>
          <p style="margin:0;font-size:20px;font-weight:700;color:#111827;">Thank you for your purchase!</p>
          <p style="margin:16px 0 0;font-size:15px;color:#6b7280;">We're getting your order ready to be shipped. We will notify you when it has been sent.</p>
          <p style="margin:20px 0 0;font-size:14px;color:#6b7280;"><strong style="color:#111827;">Order number</strong> <span style="font-family:ui-monospace,monospace;font-size:16px;font-weight:600;color:#0d9488;">#{{orderNumber}}</span></p>
          <p style="margin:4px 0 0;font-size:14px;color:#6b7280;">Placed on {{orderDate}}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr><td><a href="{{trackUrl}}" style="display:inline-block;padding:14px 28px;background:#0d9488;color:#ffffff!important;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;">View your order</a></td></tr>
            <tr><td style="padding-top:12px;"><a href="{{baseUrl}}" style="color:#0d9488;text-decoration:none;font-size:14px;">or Visit our store</a></td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 24px 24px;">
          <h2 style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111827;text-transform:uppercase;letter-spacing:0.05em;">Order summary</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">{{itemsTable}}</table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;">{{totalsTable}}</table>
        </td></tr>
        <tr><td style="padding:0 24px 24px;">
          <h2 style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111827;text-transform:uppercase;letter-spacing:0.05em;">Customer information</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#4b5563;">{{customerInfoTable}}</table>
        </td></tr>
        <tr><td style="padding:24px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:14px;color:#6b7280;">If you have any questions, reply to this email or contact us at <a href="mailto:{{contactEmail}}" style="color:#0d9488;text-decoration:none;">{{contactEmail}}</a>.</p>
          <p style="margin:12px 0 0;font-size:14px;color:#6b7280;">— {{storeName}}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

/** Returns the default order confirmation HTML template (with placeholders). Used by admin "Reset to default". */
export function getDefaultOrderConfirmationTemplate(): string {
  return DEFAULT_ORDER_CONFIRMATION_TEMPLATE
}

/** Build replacement map for template placeholders. Values are HTML-escaped where needed. */
function buildTemplateReplacementMap(d: OrderEmailData): Record<string, string> {
  const fmt = (n: number) => n.toFixed(2)
  const itemRows = d.items
    .map(
      (i) =>
        `<tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb;vertical-align:top;"><strong style="color:#111827;">${escapeHtml(i.name)}</strong><br><span style="color:#6b7280;font-size:14px;">× ${i.quantity}</span></td><td style="padding:12px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:#111827;">${d.currency} ${fmt(i.price * i.quantity)}</td></tr>`
    )
    .join('')
  const totalsTable = `
    <tr><td style="padding:8px 0;color:#6b7280;">Subtotal</td><td style="padding:8px 0;text-align:right;">${d.currency} ${fmt(d.subtotal)}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;">Shipping</td><td style="padding:8px 0;text-align:right;">${d.currency} ${fmt(d.shippingAmount)}</td></tr>
    ${d.taxAmount > 0 ? `<tr><td style="padding:8px 0;color:#6b7280;">Taxes</td><td style="padding:8px 0;text-align:right;">${d.currency} ${fmt(d.taxAmount)}</td></tr>` : ''}
    ${d.discountAmount > 0 ? `<tr><td style="padding:8px 0;color:#6b7280;">Discount</td><td style="padding:8px 0;text-align:right;">-${d.currency} ${fmt(d.discountAmount)}</td></tr>` : ''}
    <tr><td style="padding:12px 0 0;font-weight:600;color:#111827;">Total</td><td style="padding:12px 0 0;text-align:right;font-size:18px;font-weight:700;color:#111827;">${d.currency} ${fmt(d.total)}</td></tr>`
  const customerInfoTable = [
    d.shippingAddress ? `<tr><td style="padding:0 0 8px;color:#6b7280;font-weight:600;">Shipping address</td></tr><tr><td style="padding:0 0 16px;white-space:pre-line;">${escapeHtml(d.shippingAddress)}</td></tr>` : '',
    d.billingAddress ? `<tr><td style="padding:0 0 8px;color:#6b7280;font-weight:600;">Billing address</td></tr><tr><td style="padding:0 0 16px;white-space:pre-line;">${escapeHtml(d.billingAddress)}</td></tr>` : '',
    d.paymentMethod ? `<tr><td style="padding:0 0 8px;color:#6b7280;font-weight:600;">Payment</td></tr><tr><td style="padding:0 0 16px;">${escapeHtml(d.paymentMethod)}</td></tr>` : '',
    d.shippingMethod ? `<tr><td style="padding:0 0 8px;color:#6b7280;font-weight:600;">Shipping method</td></tr><tr><td style="padding:0 0 16px;">${escapeHtml(d.shippingMethod)}</td></tr>` : '',
  ].join('')
  return {
    storeName: escapeHtml(d.storeName),
    orderNumber: escapeHtml(d.orderNumber),
    orderDate: escapeHtml(d.orderDate),
    trackUrl: d.trackUrl,
    baseUrl: d.baseUrl,
    contactEmail: escapeHtml(d.contactEmail),
    currency: d.currency,
    itemsTable: itemRows,
    totalsTable,
    customerInfoTable,
    subtotal: fmt(d.subtotal),
    shippingAmount: fmt(d.shippingAmount),
    taxAmount: fmt(d.taxAmount),
    discountAmount: fmt(d.discountAmount),
    total: fmt(d.total),
    shippingAddress: escapeHtml(d.shippingAddress),
    billingAddress: escapeHtml(d.billingAddress),
    paymentMethod: escapeHtml(d.paymentMethod),
    shippingMethod: escapeHtml(d.shippingMethod),
  }
}

function replacePlaceholders(html: string, map: Record<string, string>): string {
  let out = html
  for (const [key, value] of Object.entries(map)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }
  return out
}

/** Build nodemailer transporter from stored email settings. Returns null if not configured. */
export async function getEmailTransporter(): Promise<nodemailer.Transporter | null> {
  const doc = await EmailSettings.findOne({ key: EMAIL_SETTINGS_KEY }).lean()
  if (!doc?.smtpHost?.trim() || !doc?.fromEmail?.trim()) return null
  const port = Number(doc.smtpPort ?? 587)
  // Port 465 = implicit SSL (secure from start). Port 587/25 = STARTTLS (plain first, then upgrade).
  // Using secure:true on 587 causes "wrong version number" SSL error; so derive from port.
  const secure = port === 465
  const auth =
    doc.smtpUser?.trim() && doc.smtpPass
      ? { user: doc.smtpUser.trim(), pass: doc.smtpPass }
      : undefined
  const transporter = nodemailer.createTransport({
    host: doc.smtpHost.trim(),
    port,
    secure,
    auth,
  })
  return transporter
}

/** Send order confirmation email to the customer. Resolves when sent or skips; rejects on error. */
export async function sendOrderConfirmationEmail(
  toEmail: string,
  order: OrderForEmail,
  storeNameOverride?: string
): Promise<void> {
  const doc = await EmailSettings.findOne({ key: EMAIL_SETTINGS_KEY }).lean()
  if (!doc?.orderConfirmationEnabled || !doc?.fromEmail?.trim() || !doc?.smtpHost?.trim()) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[Order confirmation email] Skipped: not configured (enable in Admin → Settings → Email and set From address + SMTP)')
    }
    return
  }
  const transporter = await getEmailTransporter()
  if (!transporter) {
    if (process.env.NODE_ENV !== 'test') console.warn('[Order confirmation email] Skipped: could not create SMTP transporter')
    return
  }

  let storeName = storeNameOverride || 'Sky Cashmere'
  if (!storeNameOverride) {
    const site = await SiteSettings.findOne({ key: SITE_SETTINGS_KEY }).select('storeName').lean()
    if (site?.storeName?.trim()) storeName = site.storeName.trim()
  }
  const fromName = doc.fromName?.trim() || storeName
  const from = `${fromName} <${doc.fromEmail.trim()}>`
  const baseUrl = (process.env.CLIENT_URL || 'https://example.com').replace(/\/$/, '')
  const trackUrl = `${baseUrl}/track-order?orderNumber=${encodeURIComponent(order.orderNumber)}`
  const orderDate =
    typeof order.createdAt === 'string'
      ? new Date(order.createdAt).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
      : order.createdAt.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })

  const fmt = (n: number) => n.toFixed(2)
  const currency = 'AED'

  const formatAddress = (addr: { name?: string; street?: string; city?: string; state?: string; zipCode?: string; area?: string; country?: string } | undefined) =>
    !addr
      ? ''
      : [
          addr.name,
          addr.street,
          [addr.city, addr.state, addr.zipCode || addr.area].filter(Boolean).join(', '),
          addr.country,
        ]
          .filter(Boolean)
          .join('\n')

  const shippingAddr = formatAddress(order.shippingAddress)
  const billingAddr = formatAddress(order.billingAddress)
  const paymentLabel = order.paymentMethod ? String(order.paymentMethod).replace(/\b\w/g, (c) => c.toUpperCase()) : ''
  const shippingLabel = [order.shippingMethodName, order.shippingMethodDelivery].filter(Boolean).join(' — ') || ''

  const subtotal = order.subtotal ?? order.items?.reduce((s: number, i: any) => s + i.price * i.quantity, 0) ?? 0
  const shippingAmount = order.shipping ?? 0
  const taxAmount = order.tax ?? 0
  const discountAmount = order.discount ?? 0

  const emailData: OrderEmailData = {
    storeName,
    orderNumber: order.orderNumber,
    orderDate,
    trackUrl,
    baseUrl,
    contactEmail: doc.fromEmail.trim(),
    items: order.items || [],
    subtotal,
    shippingAmount,
    taxAmount,
    discountAmount,
    total: order.total,
    currency,
    shippingAddress: shippingAddr,
    billingAddress: billingAddr,
    paymentMethod: paymentLabel,
    shippingMethod: shippingLabel,
  }
  const templateHtml =
    (doc.orderConfirmationTemplateHtml && doc.orderConfirmationTemplateHtml.trim()) || DEFAULT_ORDER_CONFIRMATION_TEMPLATE
  const html = replacePlaceholders(templateHtml, buildTemplateReplacementMap(emailData))

  const itemsList = (order.items || [])
    .map((i) => `  • ${i.name} × ${i.quantity} — ${currency} ${fmt(i.price * i.quantity)}`)
    .join('\n')
  const text = `
${storeName}
Thank you for your purchase!

We're getting your order ready to be shipped. We will notify you when it has been sent.

Order number: ${order.orderNumber}
Placed on ${orderDate}

View your order: ${trackUrl}
Visit our store: ${baseUrl}

ORDER SUMMARY
${(order.items || []).map((i: any) => `  ${i.name} × ${i.quantity} — ${currency} ${fmt(i.price * i.quantity)}`).join('\n')}

Subtotal: ${currency} ${fmt(subtotal)}
Shipping: ${currency} ${fmt(shippingAmount)}
${taxAmount > 0 ? `Taxes: ${currency} ${fmt(taxAmount)}` : ''}
${discountAmount > 0 ? `Discount: -${currency} ${fmt(discountAmount)}` : ''}
Total: ${currency} ${fmt(order.total)}

CUSTOMER INFORMATION
${shippingAddr ? `Shipping address:\n${shippingAddr}` : ''}
${billingAddr ? `\nBilling address:\n${billingAddr}` : ''}
${paymentLabel ? `\nPayment: ${paymentLabel}` : ''}
${shippingLabel ? `\nShipping method: ${shippingLabel}` : ''}

If you have any questions, reply to this email or contact us at ${doc.fromEmail.trim()}.

— ${storeName}
  `.trim()

  await transporter.sendMail({
    from,
    to: toEmail.trim(),
    subject: `Order #${order.orderNumber} confirmed`,
    text,
    html,
  })
  // Success is logged by the caller
}
