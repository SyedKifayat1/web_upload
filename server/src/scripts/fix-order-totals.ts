/**
 * One-time script: fix order totals for tax-inclusive pricing.
 * Sets order.tax = 0 and order.total = subtotal + shipping - discount for all orders
 * so stored values match the rule (no separate tax added).
 *
 * Run from server directory: npm run fix-order-totals
 * Or: npx ts-node src/scripts/fix-order-totals.ts
 */
import dotenv from 'dotenv'
import connectDB from '../config/database'
import Order from '../models/Order'

dotenv.config()

async function fixOrderTotals() {
  await connectDB()

  const orders = await Order.find({}).lean()
  let updated = 0

  for (const o of orders) {
    const subtotal = Number(o.subtotal) || 0
    const shipping = Number(o.shipping) || 0
    const discount = Number(o.discount) || 0
    const correctTotal = Math.round((subtotal + shipping - discount) * 100) / 100
    const currentTotal = Number(o.total)
    const currentTax = Number(o.tax) || 0

    if (currentTotal !== correctTotal || currentTax !== 0) {
      await Order.updateOne(
        { _id: o._id },
        { $set: { tax: 0, total: correctTotal } }
      )
      updated++
      console.log(
        `Order ${(o as any).orderNumber}: total ${currentTotal} → ${correctTotal}, tax ${currentTax} → 0`
      )
    }
  }

  console.log(`Done. Updated ${updated} of ${orders.length} orders.`)
  process.exit(0)
}

fixOrderTotals().catch((err) => {
  console.error(err)
  process.exit(1)
})
