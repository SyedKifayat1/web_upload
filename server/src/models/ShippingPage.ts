import mongoose, { Document, Schema } from 'mongoose'

export interface IShippingPage extends Document {
  key: string
  title: string
  contentHtml: string
  updatedAt: Date
  createdAt: Date
}

const ShippingPageSchema = new Schema<IShippingPage>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    title: { type: String, required: true, default: 'Shipping & Delivery' },
    contentHtml: { type: String, default: '' },
  },
  { timestamps: true }
)

export default mongoose.models.ShippingPage ||
  mongoose.model<IShippingPage>('ShippingPage', ShippingPageSchema)
