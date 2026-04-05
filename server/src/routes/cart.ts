import express from 'express'
import fs from 'fs'
import path from 'path'
import Cart from '../models/Cart'
import Product from '../models/Product'
import Coupon from '../models/Coupon'
import { protect } from '../middleware/auth'

const router = express.Router()

// Product images manifest (folder -> filenames). Tries client public path from server cwd.
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

/** Normalize variants to a canonical string so { Color: "Blue", Size: "S" } matches { Size: "S", Color: "Blue" }. Case-insensitive variant keys. */
function variantsKey(variants: Record<string, string> | null | undefined): string {
  const raw = variants && typeof variants === 'object'
    ? (variants.toObject ? (variants as any).toObject() : { ...variants })
    : {}
  const keys = Object.keys(raw)
    .filter((k) => raw[k] != null && String(raw[k]).trim() !== '')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  const obj: Record<string, string> = {}
  keys.forEach((k) => { obj[k.toLowerCase()] = String(raw[k]).trim() })
  return JSON.stringify(obj)
}

/** Get first image URL for product; when itemVariants has a color, prefer that option's image. */
function getDisplayImageUrl(
  product: any,
  manifest: Record<string, string[]> | null,
  itemVariants?: Record<string, string> | null
): string | null {
  if (!product) return null
  // If item has a color (or Colour) variant, use that option's image when available
  const colorKey = product.variants?.length && itemVariants
    ? (Object.keys(itemVariants).find((k) => /^colou?r$/i.test(k)) ?? null)
    : null
  const colorValue = colorKey ? itemVariants?.[colorKey] : null
  if (colorValue && product.variants) {
    for (const v of product.variants) {
      if (!/^colou?r$/i.test(v.name)) continue
      const option = v.options?.find((o: any) => (o.value || '').toString().trim().toLowerCase() === String(colorValue).trim().toLowerCase())
      if (option) {
        const optImg = option.image || (option.images?.[0] ? (typeof option.images[0] === 'string' ? option.images[0] : option.images[0]?.url) : null)
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

// Get or create cart
const getOrCreateCart = async (userId?: string, sessionId?: string) => {
  let cart = await Cart.findOne({
    $or: [{ user: userId }, { sessionId }],
  }).populate('items.product')

  if (!cart) {
    cart = await Cart.create({
      user: userId,
      sessionId: sessionId || undefined,
    })
  }

  return cart
}

// @route   GET /api/v1/cart
// @desc    Get cart
// @access  Private/Guest
router.get('/', async (req: any, res, next) => {
  try {
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id']
    const userId = req.user?._id

    let cart = await getOrCreateCart(userId, sessionId)

    // Merge duplicate line items (same product + same variants) so one line shows combined quantity
    const items = cart.items || []
    const seen = new Map<string, number>() // key -> index of kept item
    let changed = false
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const productId = item.product?._id?.toString() ?? item.product?.toString?.() ?? ''
      const key = `${productId}::${variantsKey(item.variants)}`
      const keptIndex = seen.get(key)
      if (keptIndex !== undefined) {
        items[keptIndex].quantity += item.quantity
        items.splice(i, 1)
        i--
        changed = true
      } else {
        seen.set(key, i)
      }
    }
    if (changed) {
      cart.markModified('items')
      await cart.save()
      cart = await getOrCreateCart(userId, sessionId)
    }

    const manifest = getProductImagesManifest()
    const outItems = (cart.items || []).map((item: any) => {
      const obj = item.toObject ? item.toObject() : { ...item }
      const product = obj.product
      obj.displayImageUrl = getDisplayImageUrl(product, manifest, obj.variants) || undefined
      return obj
    })

    let appliedCoupon: { code: string; type: string; value: number } | undefined
    if (cart.coupon) {
      const populated = await Cart.findById(cart._id).populate('coupon', 'code type value')
      const c = (populated as any)?.coupon
      if (c) {
        appliedCoupon = { code: c.code, type: c.type, value: c.value }
      }
    }

    res.json({
      success: true,
      data: {
        items: outItems,
        discount: cart.discount || 0,
        appliedCoupon: appliedCoupon || undefined,
      },
    })
  } catch (error) {
    next(error)
  }
})

// Normalize variant key so "Color" and "Colour" match (frontend may send either)
function getVariantValue(variants: Record<string, string>, variantName: string): string | undefined {
  if (variants[variantName] != null && String(variants[variantName]).trim() !== '') {
    return String(variants[variantName]).trim()
  }
  if (/^colou?r$/i.test(variantName)) {
    const other = variantName.toLowerCase() === 'colour' ? 'Color' : 'Colour'
    if (variants[other] != null && String(variants[other]).trim() !== '') {
      return String(variants[other]).trim()
    }
  }
  return undefined
}

// Resolve effective stock: use selected variant option stock when present (e.g. per-color), else product.stock
function getEffectiveStock(product: any, variants?: Record<string, string>): number {
  if (!variants || !product.variants?.length) {
    const top = product.stock
    if (top != null && !Number.isNaN(Number(top))) return Math.max(0, Number(top))
    return 0
  }
  for (const v of product.variants) {
    const selectedValue = v.name ? getVariantValue(variants, v.name) : undefined
    if (selectedValue == null) continue
    const selectedNorm = selectedValue.toLowerCase()
    const option = v.options?.find((o: any) => {
      const ov = (o.value != null ? String(o.value) : '').trim().toLowerCase()
      return ov === selectedNorm
    })
    if (option && option.stock !== undefined && option.stock !== null) {
      const n = Number(option.stock)
      return Number.isNaN(n) ? 0 : Math.max(0, n)
    }
  }
  const top = product.stock
  if (top != null && !Number.isNaN(Number(top))) return Math.max(0, Number(top))
  return 0
}

// @route   POST /api/v1/cart/add
// @desc    Add item to cart
// @access  Private/Guest
router.post('/add', async (req: any, res, next) => {
  try {
    const { productId, quantity, variants } = req.body
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id']
    const userId = req.user?._id

    const product = await Product.findById(productId)

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
      })
    }

    const effectiveStock = getEffectiveStock(product, variants)
    if (effectiveStock < quantity) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient stock',
      })
    }

    const cart = await getOrCreateCart(userId, sessionId)
    const incomingKey = variantsKey(variants)

    const existingItemIndex = cart.items.findIndex(
      (item: any) =>
        item.product.toString() === productId &&
        variantsKey(item.variants) === incomingKey
    )

    if (existingItemIndex > -1) {
      cart.items[existingItemIndex].quantity += quantity
    } else {
      // Store variants in normalized form (sorted keys) for consistent matching
      const normalizedVariants =
        variants && typeof variants === 'object'
          ? (() => {
              const o: Record<string, string> = {}
              Object.keys(variants)
                .filter((k) => variants[k] != null && String(variants[k]).trim() !== '')
                .sort()
                .forEach((k) => { o[k] = String(variants[k]).trim() })
              return Object.keys(o).length ? o : undefined
            })()
          : undefined
      cart.items.push({
        product: productId,
        quantity,
        price: product.price,
        variants: normalizedVariants,
      })
    }

    await cart.save()
    
    // Populate product details before sending response
    await cart.populate('items.product')

    res.json({
      success: true,
      data: cart,
    })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/cart/items/:itemId
// @desc    Update cart item
// @access  Private/Guest
router.put('/items/:itemId', async (req: any, res, next) => {
  try {
    const { quantity } = req.body
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id']
    const userId = req.user?._id

    const cart = await Cart.findOne({
      $or: [{ user: userId }, { sessionId }],
    })

    if (!cart) {
      return res.status(404).json({
        success: false,
        error: 'Cart not found',
      })
    }

    const item = cart.items.find((item: any) => item._id.toString() === req.params.itemId)

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Item not found',
      })
    }

    item.quantity = quantity

    await cart.save()

    res.json({
      success: true,
      data: cart,
    })
  } catch (error) {
    next(error)
  }
})

// @route   DELETE /api/v1/cart/items/:itemId
// @desc    Remove cart item
// @access  Private/Guest
router.delete('/items/:itemId', async (req: any, res, next) => {
  try {
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id']
    const userId = req.user?._id

    const cart = await Cart.findOne({
      $or: [{ user: userId }, { sessionId }],
    })

    if (!cart) {
      return res.status(404).json({
        success: false,
        error: 'Cart not found',
      })
    }

    cart.items = cart.items.filter((item: any) => item._id.toString() !== req.params.itemId)

    await cart.save()

    res.json({
      success: true,
      data: cart,
    })
  } catch (error) {
    next(error)
  }
})

// @route   POST /api/v1/cart/coupon
// @desc    Apply coupon to cart
// @access  Private/Guest
router.post('/coupon', async (req: any, res, next) => {
  try {
    const { code } = req.body
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id']
    const userId = req.user?._id

    const cart = await getOrCreateCart(userId, sessionId)
    await cart.populate('items.product')

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Cart is empty',
      })
    }

    // Find coupon
    const coupon = await Coupon.findOne({
      code: code.toUpperCase(),
      active: true,
      validFrom: { $lte: new Date() },
      validUntil: { $gte: new Date() },
    })

    if (!coupon) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired coupon code',
      })
    }

    // Check usage limit
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({
        success: false,
        error: 'Coupon usage limit exceeded',
      })
    }

    const productIds = (coupon.applicableToProducts || []).map((id: any) => id?.toString?.() ?? id)
    const categoryIds = (coupon.applicableToCategories || []).map((id: any) => id?.toString?.() ?? id)
    const hasProductOrCategoryFilter = productIds.length > 0 || categoryIds.length > 0

    // Eligible subtotal: full cart or only items matching products/categories
    let subtotal = 0
    let eligibleSubtotal = 0
    cart.items.forEach((item: any) => {
      const lineTotal = item.price * item.quantity
      subtotal += lineTotal
      if (!hasProductOrCategoryFilter) {
        eligibleSubtotal += lineTotal
      } else {
        const pid = item.product?._id?.toString?.() ?? item.product?.toString?.()
        const catId = item.product?.category?.toString?.() ?? item.product?.category
        const matchProduct = productIds.length > 0 && pid && productIds.includes(pid)
        const matchCategory = categoryIds.length > 0 && catId && categoryIds.includes(catId)
        if (matchProduct || matchCategory) {
          eligibleSubtotal += lineTotal
        }
      }
    })

    if (hasProductOrCategoryFilter && eligibleSubtotal === 0) {
      return res.status(400).json({
        success: false,
        error: 'This coupon does not apply to any products in your cart',
      })
    }

    const amountForMinAndDiscount = hasProductOrCategoryFilter ? eligibleSubtotal : subtotal

    // Check minimum amount (on eligible total)
    if (coupon.minimumAmount && amountForMinAndDiscount < coupon.minimumAmount) {
      return res.status(400).json({
        success: false,
        error: `Minimum order amount of ${coupon.minimumAmount} AED required for this coupon`,
      })
    }

    // Calculate discount on eligible amount
    let discount = 0
    if (coupon.type === 'percentage') {
      discount = (amountForMinAndDiscount * coupon.value) / 100
      if (coupon.maximumDiscount && discount > coupon.maximumDiscount) {
        discount = coupon.maximumDiscount
      }
    } else {
      discount = coupon.value
      if (discount > amountForMinAndDiscount) {
        discount = amountForMinAndDiscount
      }
    }

    // Apply coupon to cart
    cart.coupon = coupon._id
    cart.discount = discount
    await cart.save()

    res.json({
      success: true,
      data: {
        coupon: {
          code: coupon.code,
          type: coupon.type,
          value: coupon.value,
        },
        discount,
        subtotal,
        eligibleSubtotal: amountForMinAndDiscount,
        total: subtotal - discount,
      },
    })
  } catch (error) {
    next(error)
  }
})

// @route   DELETE /api/v1/cart/coupon
// @desc    Remove coupon from cart
// @access  Private/Guest
router.delete('/coupon', async (req: any, res, next) => {
  try {
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id']
    const userId = req.user?._id

    const cart = await getOrCreateCart(userId, sessionId)
    cart.coupon = undefined
    cart.discount = 0
    await cart.save()

    res.json({
      success: true,
      data: cart,
    })
  } catch (error) {
    next(error)
  }
})

export default router
