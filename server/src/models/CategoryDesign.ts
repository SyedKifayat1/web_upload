import mongoose, { Document, Schema } from 'mongoose'

export interface IDesignColor {
  name: string
  hex?: string
}

export interface ICategoryDesign extends Document {
  category: mongoose.Types.ObjectId
  name: string
  slug: string
  order: number
  colors: IDesignColor[]
  /** Image URL for Our Collections section on the homepage. */
  collectionImage?: string
  /** When true, this design is shown in the Our Collections section (max 8). */
  showInCollections?: boolean
  createdAt: Date
  updatedAt: Date
}

const DesignColorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    hex: { type: String, trim: true },
  },
  { _id: false }
)

const CategoryDesignSchema = new Schema(
  {
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'Please add a design name'],
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    colors: {
      type: [DesignColorSchema],
      default: [],
    },
    collectionImage: { type: String, default: '' },
    showInCollections: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
)

// Unique design slug per category
CategoryDesignSchema.index({ category: 1, slug: 1 }, { unique: true })
CategoryDesignSchema.index({ category: 1, order: 1 })

export default mongoose.model<ICategoryDesign>('CategoryDesign', CategoryDesignSchema)
