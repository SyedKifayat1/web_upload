/**
 * Tabby Pay Later / Installments API integration.
 * API base: https://api.tabby.ai (test vs live determined by API keys).
 * @see https://docs.tabby.ai/api-reference/checkout/create-a-session
 * @see https://docs.tabby.ai/api-reference/payments/retrieve-a-payment
 */

const TABBY_API_BASE = 'https://api.tabby.ai'

export interface TabbyConfig {
  secretKey: string
  merchantCode: string
}

export interface TabbyCreateSessionParams {
  orderReference: string
  amount: number
  currency: string
  buyer: {
    email: string
    phone: string
    name?: string
  }
  shippingAddress: {
    name?: string
    address?: string
    city?: string
    state?: string
    zip?: string
    country?: string
    phone?: string
  }
  merchantUrls: {
    success: string
    cancel: string
    failure: string
  }
  description?: string
  /** Order line items for better scoring (optional). */
  orderItems?: Array<{ title: string; quantity: number; unit_price: string }>
}

export interface TabbyCreateSessionResult {
  status: 'created' | 'rejected'
  webUrl?: string
  paymentId?: string
  rejectionReason?: string
}

export interface TabbyPayment {
  id: string
  status: string
  order?: { reference?: string }
}

/**
 * Create a Tabby checkout session. Returns web_url for redirect and payment.id to store on the order.
 */
export async function createTabbyCheckoutSession(
  config: TabbyConfig,
  params: TabbyCreateSessionParams
): Promise<TabbyCreateSessionResult> {
  const amountStr = params.amount.toFixed(2)
  const body = {
    payment: {
      amount: amountStr,
      currency: params.currency,
      description: params.description || `Order ${params.orderReference}`,
      buyer: {
        email: params.buyer.email,
        phone: params.buyer.phone,
        ...(params.buyer.name && { name: params.buyer.name }),
      },
      shipping_address: {
        ...(params.shippingAddress.name && { name: params.shippingAddress.name }),
        ...(params.shippingAddress.address && { address: params.shippingAddress.address }),
        ...(params.shippingAddress.city && { city: params.shippingAddress.city }),
        ...(params.shippingAddress.state && { state: params.shippingAddress.state }),
        ...(params.shippingAddress.zip && { zip: params.shippingAddress.zip }),
        ...(params.shippingAddress.country && { country: params.shippingAddress.country }),
        ...(params.shippingAddress.phone && { phone: params.shippingAddress.phone }),
      },
      ...(params.orderItems && params.orderItems.length > 0 && { order: { items: params.orderItems } }),
      reference_id: params.orderReference,
    },
    lang: 'en',
    merchant_code: config.merchantCode,
    merchant_urls: {
      success: params.merchantUrls.success,
      cancel: params.merchantUrls.cancel,
      failure: params.merchantUrls.failure,
    },
  }

  const res = await fetch(`${TABBY_API_BASE}/api/v2/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.secretKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    let errMsg: string
    try {
      const json = JSON.parse(text) as { message?: string; error?: string }
      errMsg = json.message || json.error || text || res.statusText
    } catch {
      errMsg = text || res.statusText
    }
    throw new Error(`Tabby API error (${res.status}): ${errMsg}`)
  }

  const resBody = (await res.json()) as Record<string, unknown>
  // Tabby may wrap the payload in a top-level "data" or return at root
  const data = (typeof (resBody as any).data === 'object' && (resBody as any).data !== null ? (resBody as any).data : resBody) as Record<string, unknown>

  const status = (data.status === 'created' || data.status === 'rejected' ? data.status : 'rejected') as 'created' | 'rejected'
  const configuration = data.configuration as Record<string, unknown> | undefined
  const availableProducts = configuration?.available_products as Array<Record<string, unknown>> | undefined
  const installments = availableProducts?.[0]?.installments as Array<Record<string, unknown>> | undefined
  const rejectionReason =
    (installments?.[0]?.rejection_reason as string) ?? (data.rejection_reason as string) ?? undefined

  // Tabby may return web_url and payment id at top level or nested; try all known paths
  const paymentObj = data.payment as Record<string, unknown> | undefined
  const sessionObj = data.session as Record<string, unknown> | undefined
  const webUrlRaw =
    data.web_url ??
    sessionObj?.web_url ??
    sessionObj?.url ??
    data.checkout_url ??
    data.redirect_url ??
    (configuration as Record<string, unknown>)?.web_url
  // Tabby may put redirect URL inside configuration.available_products.installments (object or array)
  const ap = configuration?.available_products as Record<string, unknown> | undefined
  const inst = ap?.installments
  const installmentsArr = Array.isArray(inst) ? inst : undefined
  const installmentsObj = inst && typeof inst === 'object' && !Array.isArray(inst) ? (inst as Record<string, unknown>) : undefined
  const firstInstallment = installmentsArr?.[0] as Record<string, unknown> | undefined
  const webUrlFromConfig =
    (firstInstallment?.web_url ?? firstInstallment?.url ?? firstInstallment?.checkout_url) as string | undefined
  const webUrlFromInstObj = (installmentsObj?.web_url ?? installmentsObj?.url ?? installmentsObj?.checkout_url) as string | undefined

  const paymentIdRaw =
    paymentObj?.id ??
    (paymentObj?.data as Record<string, unknown>)?.id ??
    data.payment_id ??
    data.paymentId ??
    (data as any).payment?.id
  const webUrl =
    (typeof webUrlRaw === 'string' ? webUrlRaw : undefined) ??
    (typeof webUrlFromConfig === 'string' ? webUrlFromConfig : undefined) ??
    (typeof webUrlFromInstObj === 'string' ? webUrlFromInstObj : undefined)
  const paymentId = paymentIdRaw != null ? String(paymentIdRaw) : undefined

  if (process.env.NODE_ENV === 'development' && status === 'created' && (!webUrl || !paymentId)) {
    console.log('[Tabby] Response top-level keys:', Object.keys(resBody))
    console.log('[Tabby] Data keys:', Object.keys(data))
    if (configuration) console.log('[Tabby] configuration.available_products:', JSON.stringify((configuration as any).available_products)?.slice(0, 500))
    console.log('[Tabby] Full response (first 2000 chars):', JSON.stringify(resBody, null, 2).slice(0, 2000))
  }

  return {
    status,
    webUrl,
    paymentId,
    rejectionReason,
  }
}

/**
 * Retrieve payment status from Tabby. Use to verify after redirect or in webhooks.
 * Status values: AUTHORIZED, CLOSED (success), REJECTED, EXPIRED (cancel/failure).
 */
export async function getTabbyPayment(config: TabbyConfig, paymentId: string): Promise<TabbyPayment | null> {
  const res = await fetch(`${TABBY_API_BASE}/api/v2/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
    },
  })

  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text()
    let errMsg: string
    try {
      const json = JSON.parse(text) as { message?: string; error?: string }
      errMsg = json.message || json.error || text || res.statusText
    } catch {
      errMsg = text || res.statusText
    }
    throw new Error(`Tabby getPayment error (${res.status}): ${errMsg}`)
  }

  const data = (await res.json()) as { id?: string; status?: string; order?: { reference?: string } }
  return {
    id: data.id ?? paymentId,
    status: (data.status ?? '').toUpperCase(),
    order: data.order,
  }
}

export function isTabbyPaymentSuccessful(status: string): boolean {
  const s = (status || '').toUpperCase()
  return s === 'AUTHORIZED' || s === 'CLOSED' || s === 'CAPTURED'
}

export function isTabbyPaymentFailed(status: string): boolean {
  const s = (status || '').toUpperCase()
  return s === 'REJECTED' || s === 'EXPIRED' || s === 'CANCELLED'
}
