import mongoose, { Document, Schema } from 'mongoose'

export interface IFavourite extends Document {
  user: mongoose.Types.ObjectId
  product: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const FavouriteSchema = new Schema<IFavourite>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
)

// One favourite record per user per product
FavouriteSchema.index({ user: 1, product: 1 }, { unique: true })

export default mongoose.model<IFavourite>('Favourite', FavouriteSchema)
