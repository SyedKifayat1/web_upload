import mongoose, { Document, Schema } from 'mongoose'

export interface ICart extends Document {
  user?: mongoose.Types.ObjectId
  sessionId?: string
  items: Array<{
    product: mongoose.Types.ObjectId
    quantity: number
    price: number
    variants?: any
  }>
  coupon?: mongoose.Types.ObjectId
  discount: number
  createdAt: Date
  updatedAt: Date
}

const CartSchema = new Schema<ICart>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    sessionId: {
      type: String,
    },
    items: [
      {
        product: {
          type: Schema.Types.ObjectId,
          ref: 'Product',
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        price: {
          type: Number,
          required: true,
        },
        variants: Schema.Types.Mixed,
      },
    ],
    coupon: {
      type: Schema.Types.ObjectId,
      ref: 'Coupon',
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
)

// Indexes
CartSchema.index({ user: 1 })
CartSchema.index({ sessionId: 1 })

export default mongoose.model<ICart>('Cart', CartSchema)
