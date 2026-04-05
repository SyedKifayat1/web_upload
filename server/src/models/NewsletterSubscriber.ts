import mongoose, { Document, Schema } from 'mongoose'

export interface INewsletterSubscriber extends Document {
  email: string
  name?: string
  subscribedAt: Date
  unsubscribedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const NewsletterSubscriberSchema = new Schema<INewsletterSubscriber>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: '' },
    subscribedAt: { type: Date, default: Date.now },
    unsubscribedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

NewsletterSubscriberSchema.index({ email: 1 }, { unique: true })

export default mongoose.models.NewsletterSubscriber ||
  mongoose.model<INewsletterSubscriber>('NewsletterSubscriber', NewsletterSubscriberSchema)
