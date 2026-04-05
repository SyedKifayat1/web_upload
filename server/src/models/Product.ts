import mongoose, { Document, Schema } from 'mongoose'

export interface IProduct extends Document {
  name: string
  slug: string
  description: string
  shortDescription?: string
  sku: string
  price: number
  compareAtPrice?: number
  stock: number
  lowStockThreshold: number
  images: Array<{
    url: string
    alt?: string
    order: number
    /** R2 object key when image comes from media library */
    key?: string
  }>
  /** e.g. "female-model-1/product-01" – images loaded from public/product_images/{imageFolder} */
  imageFolder?: string
  category: mongoose.Types.ObjectId
  /** Sub-category / design (e.g. "2-Tone Solid Color" under "Wrap Scarfs"). Optional. */
  design?: mongoose.Types.ObjectId
  tags: string[]
  variants: Array<{
    name: string
    options: Array<{
      name: string
      value: string
      price?: number
      /** Per-option quantity (e.g. per-color stock). Not shown on storefront. */
      stock?: number
      /** Per-option low-stock threshold (e.g. per-color). Not shown on storefront. */
      lowStockThreshold?: number
      /** Single image URL for this option (e.g. color thumbnail and hover preview). */
      image?: string
      /** R2 key for `image` when sourced from media library */
      imageKey?: string
      /** All images for this option when selected (e.g. gallery for this color). Backend controls which color has how many images. */
      images?: Array<{ url: string; alt?: string; key?: string }>
      /** Hex color code for swatches (e.g. #1e3a5f for navy). Optional. */
      colorCode?: string
      /** When this variant option (e.g. color) was added. Used for New Arrivals to show the newest color image as main. */
      addedAt?: Date
    }>
  }>
  seoTitle?: string
  seoDescription?: string
  published: boolean
  /** Date when product was/will be published. Defaults to createdAt if not set. */
  publishedAt?: Date
  featured: boolean
  /** When true, product appears in the "Best Sellers" section on the home page. */
  bestSelling: boolean
  /** Manually selected related products to show on product page. When set, these override category-based suggestions. */
  relatedProducts?: mongoose.Types.ObjectId[]
  /** Optional size chart: title (e.g. Shirt, Pant), unit (e.g. inches), size codes, and rows of measurement name + values per size. */
  sizeChart?: {
    title: string
    unit: string
    sizeCodes: string[]
    rows: Array<{ measurementName: string; values: number[] }>
  }
  rating?: number
  reviewCount?: number
  /** Total units sold (incremented when orders are placed). Used for best-selling order. */
  unitsSold: number
  createdAt: Date
  updatedAt: Date
}

const ProductSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: [true, 'Please add a product name'],
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
      required: [true, 'Please add a description'],
    },
    shortDescription: {
      type: String,
    },
    sku: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
    },
    price: {
      type: Number,
      required: [true, 'Please add a price'],
      min: 0,
    },
    compareAtPrice: {
      type: Number,
      min: 0,
    },
    stock: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    lowStockThreshold: {
      type: Number,
      default: 10,
    },
    images: [
      {
        url: String,
        alt: String,
        order: Number,
        key: { type: String, default: undefined },
      },
    ],
    imageFolder: { type: String, default: undefined },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    design: {
      type: Schema.Types.ObjectId,
      ref: 'CategoryDesign',
      default: undefined,
    },
    tags: [String],
    variants: [
      {
        name: String,
        options: [
          {
            name: String,
            value: String,
            price: Number,
            stock: Number,
            lowStockThreshold: Number,
            image: String,
            imageKey: { type: String, default: undefined },
            images: [{ url: String, alt: String, key: { type: String, default: undefined } }],
            colorCode: String,
            addedAt: { type: Date, default: undefined },
          },
        ],
      },
    ],
    seoTitle: String,
    seoDescription: String,
    published: {
      type: Boolean,
      default: false,
    },
    publishedAt: {
      type: Date,
      default: undefined,
    },
    featured: {
      type: Boolean,
      default: false,
    },
    bestSelling: {
      type: Boolean,
      default: false,
    },
    relatedProducts: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    sizeChart: {
      title: { type: String, default: '' },
      unit: { type: String, default: 'inches' },
      sizeCodes: [String],
      rows: [
        {
          measurementName: { type: String, default: '' },
          values: [Number],
        },
      ],
    },
    rating: {
      type: Number,
      min: 0,
      max: 5,
    },
    reviewCount: {
      type: Number,
      default: 0,
    },
    unitsSold: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
)

// Clamp unitsSold before validation runs (validation runs before pre('save'), so use pre('validate'))
ProductSchema.pre('validate', function (next) {
  if (typeof this.unitsSold === 'number' && this.unitsSold < 0) {
    this.unitsSold = 0
  }
  next()
})

// Indexes
// Note: slug index is automatically created by unique: true
ProductSchema.index({ category: 1 })
ProductSchema.index({ design: 1 })
ProductSchema.index({ published: 1, featured: 1 })
ProductSchema.index({ published: 1, bestSelling: 1 })
ProductSchema.index({ published: 1, unitsSold: -1 })
ProductSchema.index({ name: 'text', description: 'text' })

export default mongoose.model<IProduct>('Product', ProductSchema)
