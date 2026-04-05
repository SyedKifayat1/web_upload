import mongoose, { Document, Schema } from 'mongoose'

export interface ICoupon extends Document {
  code: string
  type: 'fixed' | 'percentage'
  value: number
  minimumAmount?: number
  maximumDiscount?: number
  usageLimit?: number
  usedCount: number
  validFrom: Date
  validUntil: Date
  applicableToProducts?: mongoose.Types.ObjectId[]
  applicableToCategories?: mongoose.Types.ObjectId[]
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const CouponSchema = new Schema<ICoupon>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['fixed', 'percentage'],
      required: true,
    },
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    minimumAmount: {
      type: Number,
      min: 0,
    },
    maximumDiscount: {
      type: Number,
      min: 0,
    },
    usageLimit: {
      type: Number,
      min: 1,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    validFrom: {
      type: Date,
      required: true,
    },
    validUntil: {
      type: Date,
      required: true,
    },
    applicableToProducts: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    applicableToCategories: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Category',
      },
    ],
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
)

// Indexes
// Note: code index is automatically created by unique: true
CouponSchema.index({ active: 1, validFrom: 1, validUntil: 1 })

export default mongoose.model<ICoupon>('Coupon', CouponSchema)
