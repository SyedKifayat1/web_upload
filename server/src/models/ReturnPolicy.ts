import mongoose, { Document, Schema } from 'mongoose'

export interface IReturnPolicy extends Document {
  key: string
  title: string
  mainText: string
  readMoreLabel: string
  readMoreUrl: string
  howToReturnSteps: string[]
  fullPolicyHtml?: string
  createdAt: Date
  updatedAt: Date
}

const defaultPolicy = {
  title: 'Easy and Hassle Free Returns',
  mainText: 'You can return this item for FREE within the allowed return period for any reason and without any shipping charges. The item must be returned in new and unused condition.',
  readMoreLabel: "Read more about the return period and our return policy.",
  readMoreUrl: '/policy/returns',
  howToReturnSteps: [
    'Go to "Orders" to start the return',
    'Select your refund method and pickup date',
    "Keep the item ready for pickup in its original packaging",
  ],
  fullPolicyHtml: '',
}

const ReturnPolicySchema = new Schema<IReturnPolicy>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    title: { type: String, required: true, default: defaultPolicy.title },
    mainText: { type: String, required: true, default: defaultPolicy.mainText },
    readMoreLabel: { type: String, default: defaultPolicy.readMoreLabel },
    readMoreUrl: { type: String, default: defaultPolicy.readMoreUrl },
    howToReturnSteps: {
      type: [String],
      default: defaultPolicy.howToReturnSteps,
    },
    fullPolicyHtml: { type: String, default: '' },
  },
  { timestamps: true }
)

export default mongoose.models.ReturnPolicy ||
  mongoose.model<IReturnPolicy>('ReturnPolicy', ReturnPolicySchema)
