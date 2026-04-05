import mongoose, { Document, Schema } from 'mongoose'

export interface IReview extends Document {
  product: mongoose.Types.ObjectId
  user?: mongoose.Types.ObjectId
  reviewerName: string
  /** Guest email for verification; logged-in users use User.email */
  reviewerEmail?: string
  rating: number
  comment: string
  /** true when reviewer has purchased this product (same product ID) */
  verified: boolean
  /** true when admin has approved; only approved reviews show on product page */
  approved: boolean
  /** Custom date for admin-created reviews; otherwise use createdAt */
  reviewDate?: Date
  createdAt: Date
  updatedAt: Date
}

const ReviewSchema = new Schema<IReview>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewerName: {
      type: String,
      required: [true, 'Please add your name'],
      trim: true,
    },
    reviewerEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    approved: {
      type: Boolean,
      default: false,
    },
    reviewDate: {
      type: Date,
    },
    rating: {
      type: Number,
      required: [true, 'Please add a rating'],
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      required: [true, 'Please add a comment'],
      trim: true,
    },
  },
  { timestamps: true }
)

ReviewSchema.index({ product: 1, createdAt: -1 })
ReviewSchema.index({ approved: 1 })

export default mongoose.model<IReview>('Review', ReviewSchema)
