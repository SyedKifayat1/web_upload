import mongoose, { Document, Schema } from 'mongoose'

export interface IPrivacyPolicy extends Document {
  key: string
  title: string
  contentHtml: string
  updatedAt: Date
  createdAt: Date
}

const PrivacyPolicySchema = new Schema<IPrivacyPolicy>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    title: { type: String, required: true, default: 'Privacy Policy' },
    contentHtml: { type: String, default: '' },
  },
  { timestamps: true }
)

export default mongoose.models.PrivacyPolicy ||
  mongoose.model<IPrivacyPolicy>('PrivacyPolicy', PrivacyPolicySchema)
