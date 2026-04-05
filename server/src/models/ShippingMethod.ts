import mongoose, { Document, Schema } from 'mongoose'

export interface IShippingMethod extends Document {
  name: string
  price: number
  deliveryDescription: string
  /** Optional. Order subtotal >= this gets free shipping for this method. */
  freeShippingAbove: number | null
  /** When true, this method is pre-selected at checkout. Only one method should be default. */
  isDefault: boolean
  order: number
  createdAt: Date
  updatedAt: Date
}

const ShippingMethodSchema = new Schema<IShippingMethod>(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    deliveryDescription: { type: String, default: '' },
    freeShippingAbove: { type: Number, default: null },
    isDefault: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
)

export default mongoose.model<IShippingMethod>('ShippingMethod', ShippingMethodSchema)
