import mongoose, { Document, Schema } from 'mongoose'

export interface IBlogSettings extends Document {
  key: string
  /** Full URL of the blog page banner image (main listing page). */
  bannerImageUrl: string
  updatedAt: Date
}

const BLOG_SETTINGS_KEY = 'main'

const BlogSettingsSchema = new Schema<IBlogSettings>(
  {
    key: { type: String, required: true, unique: true, default: BLOG_SETTINGS_KEY },
    bannerImageUrl: { type: String, default: '' },
  },
  { timestamps: true }
)

export { BLOG_SETTINGS_KEY }

export default mongoose.model<IBlogSettings>('BlogSettings', BlogSettingsSchema)
