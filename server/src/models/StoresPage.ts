import mongoose, { Document, Schema } from 'mongoose'

export interface IStoreLocation {
  name: string
  address: string
  city: string
  country: string
  phone: string
  email: string
  hours?: string
  mapUrl?: string
}

export interface IStoresPage extends Document {
  key: string
  title: string
  introHtml: string
  locations: IStoreLocation[]
  updatedAt: Date
  createdAt: Date
}

const StoreLocationSchema = new Schema<IStoreLocation>(
  {
    name: { type: String, required: true, default: '' },
    address: { type: String, default: '' },
    city: { type: String, default: '' },
    country: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    hours: { type: String, default: '' },
    mapUrl: { type: String, default: '' },
  },
  { _id: false }
)

const StoresPageSchema = new Schema<IStoresPage>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    title: { type: String, required: true, default: 'Store Locations' },
    introHtml: { type: String, default: '' },
    locations: { type: [StoreLocationSchema], default: [] },
  },
  { timestamps: true }
)

export default mongoose.models.StoresPage ||
  mongoose.model<IStoresPage>('StoresPage', StoresPageSchema)
