import mongoose, { Document, Schema } from 'mongoose'

export interface IRefundPolicy extends Document {
  key: string
  title: string
  contentHtml: string
  updatedAt: Date
  createdAt: Date
}

const RefundPolicySchema = new Schema<IRefundPolicy>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    title: { type: String, required: true, default: 'Refund Policy' },
    contentHtml: { type: String, default: '' },
  },
  { timestamps: true }
)

export default mongoose.models.RefundPolicy ||
  mongoose.model<IRefundPolicy>('RefundPolicy', RefundPolicySchema)
