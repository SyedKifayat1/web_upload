import mongoose, { Document, Schema } from 'mongoose'

export const STORAGE_SETTINGS_KEY = 'global'

export interface IStorageSettings extends Document {
  key: string
  r2Endpoint: string
  r2Bucket: string
  cdnUrl: string
  r2AccessKeyEnc: string
  r2SecretKeyEnc: string
  createdAt: Date
  updatedAt: Date
}

const StorageSettingsSchema = new Schema<IStorageSettings>(
  {
    key: {
      type: String,
      default: STORAGE_SETTINGS_KEY,
      unique: true,
    },
    r2Endpoint: { type: String, default: '' },
    r2Bucket: { type: String, default: '' },
    cdnUrl: { type: String, default: '' },
    r2AccessKeyEnc: { type: String, default: '' },
    r2SecretKeyEnc: { type: String, default: '' },
  },
  { timestamps: true }
)

export default mongoose.model<IStorageSettings>('StorageSettings', StorageSettingsSchema)
