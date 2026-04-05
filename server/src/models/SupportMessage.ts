import mongoose, { Document, Schema } from 'mongoose'

export interface ISupportMessage extends Document {
  conversation: mongoose.Types.ObjectId
  senderRole: 'customer' | 'admin'
  senderUser: mongoose.Types.ObjectId | null
  body: string
  createdAt: Date
}

const supportMessageSchema = new Schema<ISupportMessage>(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'SupportConversation', required: true, index: true },
    senderRole: { type: String, enum: ['customer', 'admin'], required: true },
    senderUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    body: { type: String, required: true, maxlength: 4000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

supportMessageSchema.index({ conversation: 1, createdAt: 1 })

export default mongoose.model<ISupportMessage>('SupportMessage', supportMessageSchema)
