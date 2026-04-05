import mongoose, { Document, Schema } from 'mongoose'

export interface IBlogPost extends Document {
  title: string
  slug: string
  excerpt?: string
  content: string
  featuredImage?: string
  category?: mongoose.Types.ObjectId
  tags: string[]
  author: mongoose.Types.ObjectId
  /** Manually selected related posts to show on the post page. When set, these are shown instead of category-based suggestions. Max 6. */
  relatedPosts?: mongoose.Types.ObjectId[]
  seoTitle?: string
  seoDescription?: string
  published: boolean
  publishedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const BlogPostSchema = new Schema<IBlogPost>(
  {
    title: {
      type: String,
      required: [true, 'Please add a title'],
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    excerpt: {
      type: String,
      maxlength: 500,
    },
    content: {
      type: String,
      required: [true, 'Please add content'],
    },
    featuredImage: {
      type: String,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'BlogCategory',
    },
    tags: [String],
    relatedPosts: [{ type: Schema.Types.ObjectId, ref: 'BlogPost' }],
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    seoTitle: String,
    seoDescription: String,
    published: {
      type: Boolean,
      default: false,
    },
    publishedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
)

// Helper function to generate slug from title
const generateSlug = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
}

// Pre-save hook to auto-generate slug if not provided or empty
BlogPostSchema.pre('save', async function (next) {
  // Generate slug if:
  // 1. Slug is not provided (empty/undefined)
  // 2. Slug is only whitespace
  // 3. Title changed but slug wasn't manually modified
  const slugIsEmpty = !this.slug || !this.slug.trim()
  const titleChangedButSlugNotModified = this.isModified('title') && !this.isModified('slug')

  if (slugIsEmpty || titleChangedButSlugNotModified) {
    let baseSlug = generateSlug(this.title)
    
    // If slug is empty after generation, use a fallback
    if (!baseSlug) {
      baseSlug = `post-${Date.now()}`
    }

    let slug = baseSlug
    let counter = 1

    // Ensure slug is unique by appending a number if needed
    // Use mongoose.model() to get the model for checking uniqueness
    const BlogPost = mongoose.models.BlogPost || mongoose.model('BlogPost', BlogPostSchema)
    while (await BlogPost.findOne({ slug, _id: { $ne: this._id } })) {
      slug = `${baseSlug}-${counter}`
      counter++
    }

    this.slug = slug
  }
  next()
})

// Indexes
// Note: slug index is automatically created by unique: true
BlogPostSchema.index({ published: 1, publishedAt: -1 })
BlogPostSchema.index({ title: 'text', content: 'text' })

export default mongoose.model<IBlogPost>('BlogPost', BlogPostSchema)
