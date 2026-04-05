import mongoose, { Document, Schema } from 'mongoose'

export interface ITrustIndicatorItem {
  icon: string // 'shipping' | 'returns' | 'secure' | 'support'
  title: string
  description: string
  color: string // e.g. 'text-green-600'
}

export interface ITrustIndicatorSection extends Document {
  key: string
  indicators: ITrustIndicatorItem[]
  createdAt: Date
  updatedAt: Date
}

const TrustIndicatorItemSchema = new Schema(
  {
    icon: { type: String, default: 'shipping' },
    title: { type: String, required: true, default: '' },
    description: { type: String, default: '' },
    color: { type: String, default: 'text-green-600' },
  },
  { _id: false }
)

const defaultIndicators: ITrustIndicatorItem[] = [
  { icon: 'shipping', title: 'Free Shipping', description: 'On orders over AED 500', color: 'text-green-600' },
  { icon: 'returns', title: 'Easy Returns', description: '30-day hassle-free return policy', color: 'text-blue-600' },
  { icon: 'secure', title: 'Secure Payment', description: 'SSL encrypted secure checkout', color: 'text-purple-600' },
  { icon: 'support', title: '24/7 Support', description: 'Dedicated customer service team', color: 'text-orange-600' },
]

const TrustIndicatorSectionSchema = new Schema<ITrustIndicatorSection>(
  {
    key: { type: String, required: true, unique: true, default: 'home' },
    indicators: {
      type: [TrustIndicatorItemSchema],
      default: defaultIndicators,
    },
  },
  { timestamps: true }
)

export default mongoose.models.TrustIndicatorSection ||
  mongoose.model<ITrustIndicatorSection>('TrustIndicatorSection', TrustIndicatorSectionSchema)
