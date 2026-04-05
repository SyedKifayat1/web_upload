import mongoose, { Document, Schema } from 'mongoose'

export interface IShippingSettings extends Document {
  key: string
  /** Flat shipping rate in store currency (e.g. AED). Applied when no free-shipping threshold is met. */
  flatRate: number
  /** Optional. Order subtotal >= this value gets free shipping. Null/0 means no free shipping threshold. */
  freeShippingAbove: number | null
  updatedAt: Date
}

export const SHIPPING_SETTINGS_KEY = 'global'

const ShippingSettingsSchema = new Schema<IShippingSettings>(
  {
    key: { type: String, required: true, unique: true, default: SHIPPING_SETTINGS_KEY },
    flatRate: { type: Number, default: 0 },
    freeShippingAbove: { type: Number, default: null },
  },
  { timestamps: true }
)

export default mongoose.model<IShippingSettings>('ShippingSettings', ShippingSettingsSchema)
