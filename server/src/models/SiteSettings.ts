import mongoose, { Document, Schema } from 'mongoose'

export interface ISiteSettings extends Document {
  key: string
  storeName: string
  /** Header logo image URL (e.g. /uploads/site/logo-xxx.webp). When set, header shows logo instead of store name. */
  logoUrl: string | null
  /** Display width of the logo in the header (px). */
  logoWidth: number
  /** Display height of the logo in the header (px). */
  logoHeight: number
  currency: string
  timezone: string
  /** Multiple currencies (first = default). When empty, [currency] is used. */
  currencies?: string[]
  /** Multiple timezones (first = default). When empty, [timezone] is used. */
  timezones?: string[]
  /** VAT/tax percentage applied at checkout (e.g. 5 for 5%). From admin Settings → Tax. */
  vatPercentage?: number
  /** Legal company name for tax invoice (e.g. "Captival General Trading LLC"). */
  legalName?: string
  /** Company address for tax invoice (e.g. "Bur Dubai Old Souq, Dubai, UAE"). */
  companyAddress?: string
  /** Tax Registration Number for invoice (e.g. "100064050600003"). */
  trn?: string
  updatedAt: Date
}

export const SITE_SETTINGS_KEY = 'global'
const DEFAULT_LOGO_WIDTH = 180
const DEFAULT_LOGO_HEIGHT = 40

const SiteSettingsSchema = new Schema<ISiteSettings>(
  {
    key: { type: String, required: true, unique: true, default: SITE_SETTINGS_KEY },
    storeName: { type: String, default: 'Sky Cashmere' },
    logoUrl: { type: String, default: null },
    logoWidth: { type: Number, default: DEFAULT_LOGO_WIDTH },
    logoHeight: { type: Number, default: DEFAULT_LOGO_HEIGHT },
    currency: { type: String, default: 'AED' },
    timezone: { type: String, default: 'Asia/Dubai' },
    currencies: { type: [String], default: undefined },
    timezones: { type: [String], default: undefined },
    vatPercentage: { type: Number, default: 5 },
    legalName: { type: String, default: '' },
    companyAddress: { type: String, default: '' },
    trn: { type: String, default: '' },
  },
  { timestamps: true }
)

export default mongoose.model<ISiteSettings>('SiteSettings', SiteSettingsSchema)
