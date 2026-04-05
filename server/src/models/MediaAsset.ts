import mongoose, { Document, Schema } from 'mongoose'

export type MediaAssetType = 'image' | 'video'

export interface IMediaAsset extends Document {
  url: string
  key: string
  type: MediaAssetType
  used: boolean
  size: number
  originalName: string
  folder: string
  createdAt: Date
  updatedAt: Date
}

const MediaAssetSchema = new Schema<IMediaAsset>(
  {
    url: { type: String, required: true },
    key: { type: String, required: true, unique: true },
    type: { type: String, enum: ['image', 'video'], required: true },
    used: { type: Boolean, default: false },
    size: { type: Number, default: 0 },
    originalName: { type: String, default: '' },
    folder: { type: String, default: '' },
  },
  { timestamps: true }
)

MediaAssetSchema.index({ type: 1, used: 1 })
MediaAssetSchema.index({ folder: 1 })
MediaAssetSchema.index({ createdAt: -1 })

export default mongoose.model<IMediaAsset>('MediaAsset', MediaAssetSchema)
