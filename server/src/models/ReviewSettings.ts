import mongoose, { Document, Schema } from 'mongoose'

export interface IReviewSettings extends Document {
  key: string
  /** When true, review dates are shown on the storefront (product page and homepage testimonials). */
  showDateOnReviews: boolean
  updatedAt: Date
}

const REVIEW_SETTINGS_KEY = 'global'

const ReviewSettingsSchema = new Schema<IReviewSettings>(
  {
    key: { type: String, required: true, unique: true, default: REVIEW_SETTINGS_KEY },
    showDateOnReviews: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export { REVIEW_SETTINGS_KEY }

export default mongoose.model<IReviewSettings>('ReviewSettings', ReviewSettingsSchema)
