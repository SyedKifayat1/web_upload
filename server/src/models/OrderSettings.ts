import mongoose, { Document, Schema } from 'mongoose'

export interface IOrderSettings extends Document {
  key: string
  /** Time in minutes after order placement during which the customer can cancel. 0 = no cancellation. */
  cancellationWindowMinutes: number
  updatedAt: Date
}

export const ORDER_SETTINGS_KEY = 'global'

const OrderSettingsSchema = new Schema<IOrderSettings>(
  {
    key: { type: String, required: true, unique: true, default: ORDER_SETTINGS_KEY },
    cancellationWindowMinutes: { type: Number, default: 1440 }, // 24 hours
  },
  { timestamps: true }
)

export default mongoose.model<IOrderSettings>('OrderSettings', OrderSettingsSchema)
