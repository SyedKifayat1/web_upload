import mongoose, { Document, Schema } from 'mongoose'

export interface IEmailSettings extends Document {
  key: string
  /** From address used when sending emails to customers (e.g. orders@skycashmere.com). */
  fromEmail: string | null
  /** Display name for the sender (e.g. "Sky Cashmere"). */
  fromName: string | null
  /** SMTP host (e.g. smtp.gmail.com). */
  smtpHost: string | null
  /** SMTP port (e.g. 587 for TLS, 465 for SSL). */
  smtpPort: number | null
  /** Use TLS (typically true for port 587). */
  smtpSecure: boolean
  /** SMTP username. */
  smtpUser: string | null
  /** SMTP password (stored encrypted or plain; never returned in API, only masked). */
  smtpPass: string | null
  /** Send order confirmation email to customer when order is placed. */
  orderConfirmationEnabled: boolean
  /** When true, order is only placed if a valid email is provided and confirmation email is sent; otherwise reject. */
  restrictOrderToValidEmail: boolean
  /** Custom HTML for order confirmation email. Placeholders: {{storeName}}, {{orderNumber}}, etc. Null = use default template. */
  orderConfirmationTemplateHtml: string | null
  updatedAt: Date
}

export const EMAIL_SETTINGS_KEY = 'global'

const EmailSettingsSchema = new Schema<IEmailSettings>(
  {
    key: { type: String, required: true, unique: true, default: EMAIL_SETTINGS_KEY },
    fromEmail: { type: String, default: null },
    fromName: { type: String, default: null },
    smtpHost: { type: String, default: null },
    smtpPort: { type: Number, default: 587 },
    smtpSecure: { type: Boolean, default: false },
    smtpUser: { type: String, default: null },
    smtpPass: { type: String, default: null },
    orderConfirmationEnabled: { type: Boolean, default: false },
    restrictOrderToValidEmail: { type: Boolean, default: false },
    orderConfirmationTemplateHtml: { type: String, default: null },
  },
  { timestamps: true }
)

export default mongoose.model<IEmailSettings>('EmailSettings', EmailSettingsSchema)
