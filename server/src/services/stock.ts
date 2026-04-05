import mongoose from 'mongoose'
import Product from '../models/Product'

/** Parse stored variant value (e.g. "Gray|2" => value "Gray", optionIndex 2). */
export function parseVariantStored(stored: string): { value: string; optionIndex: number | null } {
  if (!stored || typeof stored !== 'string') return { value: '', optionIndex: null }
  const pipe = stored.indexOf('|')
  if (pipe >= 0) {
    const index = parseInt(stored.slice(pipe + 1), 10)
    return { value: stored.slice(0, pipe).trim(), optionIndex: Number.isNaN(index) ? null : index }
  }
  return { value: stored.trim(), optionIndex: null }
}

/** Get stored value for a variant from order item, matching by variant name or common aliases (Color/Colour, any case). */
function getVariantValue(
  itemVariants: Record<string, string>,
  variantName: string
): string | null {
  let val = variantName ? itemVariants[variantName] : null
  if (val != null && String(val).trim() !== '') return String(val).trim()
  // Match "Color" / "Colour" so order and product stay in sync even if spelling/casing differs
  if (/^colou?r$/i.test(variantName)) {
    const keys = ['Color', 'Colour', 'color', 'colour', 'COLOR', 'COLOUR']
    for (const k of keys) {
      val = itemVariants[k]
      if (val != null && String(val).trim() !== '') return String(val).trim()
    }
    for (const k of Object.keys(itemVariants)) {
      if (/^colou?r$/i.test(k)) {
        val = itemVariants[k]
        if (val != null && String(val).trim() !== '') return String(val).trim()
      }
    }
  }
  return null
}

/**
 * Find which stock to update: product-level or a specific variant option.
 * Returns { variantIndex, optionIndex } if variant option has stock defined, else null.
 */
function resolveVariantOptionForStock(
  product: any,
  itemVariants: Record<string, string> | undefined | null
): { variantIndex: number; optionIndex: number } | null {
  if (!itemVariants || typeof itemVariants !== 'object' || !product?.variants?.length) return null
  for (let vIdx = 0; vIdx < product.variants.length; vIdx++) {
    const v = product.variants[vIdx]
    const selectedStored = v.name ? getVariantValue(itemVariants as Record<string, string>, v.name) : null
    if (selectedStored == null || !v.options?.length) continue
    const { value: optionValue, optionIndex } = parseVariantStored(selectedStored)
    const valueLower = (optionValue || '').toLowerCase()
    const option =
      optionIndex != null && optionIndex >= 0 && optionIndex < v.options.length
        ? v.options[optionIndex]
        : v.options.find(
            (o: any) => {
              const oVal = (o.value || '').trim()
              return (
                oVal === optionValue ||
                oVal === selectedStored ||
                oVal.toLowerCase() === valueLower
              )
            }
          )
    if (option && option.stock !== undefined && option.stock !== null) {
      const oIdx = v.options.indexOf(option)
      if (oIdx >= 0) return { variantIndex: vIdx, optionIndex: oIdx }
    }
  }
  return null
}

/**
 * Decrement product stock (or variant option stock when item has per-option stock).
 */
export async function decrementStockForOrderItem(
  productId: mongoose.Types.ObjectId,
  itemVariants: Record<string, string> | undefined | null,
  quantity: number
): Promise<void> {
  const product = await Product.findById(productId)
  if (!product) return
  const qty = Math.max(0, Math.floor(quantity))
  if (qty === 0) return

  const resolved = resolveVariantOptionForStock(product, itemVariants)
  if (resolved) {
    const v = product.variants[resolved.variantIndex]
    const option = v?.options?.[resolved.optionIndex]
    if (option && option.stock !== undefined && option.stock !== null) {
      const current = Number(option.stock)
      option.stock = Math.max(0, current - qty)
      if (typeof (product as any).unitsSold === 'number' && (product as any).unitsSold < 0) (product as any).unitsSold = 0
      await product.save()
      return
    }
  }
  const current = Number(product.stock ?? 0)
  product.stock = Math.max(0, current - qty)
  if (typeof (product as any).unitsSold === 'number' && (product as any).unitsSold < 0) (product as any).unitsSold = 0
  await product.save()
}

/**
 * Restock product (or variant option) when customer returns or exchanges — add quantity back.
 */
export async function restockOrderItem(
  productId: mongoose.Types.ObjectId,
  itemVariants: Record<string, string> | undefined | null,
  quantity: number
): Promise<void> {
  const product = await Product.findById(productId)
  if (!product) return
  const qty = Math.max(0, Math.floor(quantity))
  if (qty === 0) return

  const resolved = resolveVariantOptionForStock(product, itemVariants)
  if (resolved) {
    const v = product.variants[resolved.variantIndex]
    const option = v?.options?.[resolved.optionIndex]
    if (option && option.stock !== undefined && option.stock !== null) {
      option.stock = Number(option.stock) + qty
      if (typeof (product as any).unitsSold === 'number' && (product as any).unitsSold < 0) (product as any).unitsSold = 0
      await product.save()
      return
    }
  }
  product.stock = Number(product.stock ?? 0) + qty
  if (typeof (product as any).unitsSold === 'number' && (product as any).unitsSold < 0) (product as any).unitsSold = 0
  await product.save()
}
