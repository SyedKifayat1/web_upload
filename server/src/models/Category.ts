import mongoose, { Document, Schema } from 'mongoose'

export interface ICategory extends Document {
  name: string
  slug: string
  description?: string
  image?: string
  parent?: mongoose.Types.ObjectId
  seoTitle?: string
  seoDescription?: string
  order: number
  /** When false, category is hidden from storefront (e.g. nav, filters). Default true. */
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const CategorySchema = new Schema<ICategory>(
  {
    name: {
      type: String,
      required: [true, 'Please add a category name'],
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    description: {
      type: String,
    },
    image: {
      type: String,
    },
    parent: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    seoTitle: String,
    seoDescription: String,
    order: {
      type: Number,
      default: 0,
    },
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
// Note: slug index is automatically created by unique: true
CategorySchema.index({ parent: 1 })

export default mongoose.model<ICategory>('Category', CategorySchema)
