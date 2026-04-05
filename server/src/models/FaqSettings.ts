import mongoose, { Document, Schema } from 'mongoose'

export interface IFaqItem {
  question: string
  answerHtml: string
}

export interface IFaqSettings extends Document {
  key: string
  title: string
  items: IFaqItem[]
  updatedAt: Date
  createdAt: Date
}

const FaqItemSchema = new Schema<IFaqItem>(
  {
    question: { type: String, required: true, default: '' },
    answerHtml: { type: String, default: '' },
  },
  { _id: false }
)

const FaqSettingsSchema = new Schema<IFaqSettings>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    title: { type: String, required: true, default: 'Frequently Asked Questions' },
    items: {
      type: [FaqItemSchema],
      default: [],
    },
  },
  { timestamps: true }
)

export default mongoose.models.FaqSettings ||
  mongoose.model<IFaqSettings>('FaqSettings', FaqSettingsSchema)
