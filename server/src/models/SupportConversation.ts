import mongoose, { Document, Schema } from 'mongoose'

export interface ISupportConversation extends Document {
  user: mongoose.Types.ObjectId | null
  visitorKey: string
  guestName?: string
  guestEmail?: string
  status: 'open' | 'closed'
  lastMessageAt: Date
  lastMessagePreview: string
  unreadByAdmin: number
  unreadByCustomer: number
  createdAt: Date
  updatedAt: Date
}

const supportConversationSchema = new Schema<ISupportConversation>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    visitorKey: { type: String, required: true, index: true },
    guestName: { type: String, trim: true, maxlength: 120 },
    guestEmail: { type: String, trim: true, maxlength: 254 },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { type: String, default: '' },
    unreadByAdmin: { type: Number, default: 0, min: 0 },
    unreadByCustomer: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
)

supportConversationSchema.index({ status: 1, lastMessageAt: -1 })

export default mongoose.model<ISupportConversation>('SupportConversation', supportConversationSchema)
