import mongoose, { Document, Schema } from 'mongoose'

export interface ITermsOfService extends Document {
  key: string
  title: string
  contentHtml: string
  updatedAt: Date
  createdAt: Date
}

const TermsOfServiceSchema = new Schema<ITermsOfService>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    title: { type: String, required: true, default: 'Terms of Service' },
    contentHtml: { type: String, default: '' },
  },
  { timestamps: true }
)

export default mongoose.models.TermsOfService ||
  mongoose.model<ITermsOfService>('TermsOfService', TermsOfServiceSchema)
