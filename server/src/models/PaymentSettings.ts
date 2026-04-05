import mongoose, { Document, Schema } from 'mongoose'

export interface IPaymentSettings extends Document {
  key: string
  /** Stripe publishable key (pk_...) — used by the storefront. */
  stripePublishableKey: string | null
  /** Stripe secret key (sk_...) — used by the server only; never exposed to client. */
  stripeSecretKey: string | null
  /** Whether Stripe (card) payment is shown at checkout. */
  stripeEnabled: boolean
  /** Whether Cash on Delivery is shown at checkout. */
  codEnabled: boolean
  /** Tabby public API key (storefront / eligibility; optional). */
  tabbyPublicKey: string | null
  /** Tabby secret API key — server only; used for checkout session and getPayment. */
  tabbySecretKey: string | null
  /** Whether Tabby (Pay Later / Installments) is shown at checkout. */
  tabbyEnabled: boolean
  /** Tabby merchant code from Tabby dashboard (required by Tabby API). */
  tabbyMerchantCode: string | null
  updatedAt: Date
}

export const PAYMENT_SETTINGS_KEY = 'global'

const PaymentSettingsSchema = new Schema<IPaymentSettings>(
  {
    key: { type: String, required: true, unique: true, default: PAYMENT_SETTINGS_KEY },
    stripePublishableKey: { type: String, default: null },
    stripeSecretKey: { type: String, default: null },
    stripeEnabled: { type: Boolean, default: true },
    codEnabled: { type: Boolean, default: true },
    tabbyPublicKey: { type: String, default: null },
    tabbySecretKey: { type: String, default: null },
    tabbyEnabled: { type: Boolean, default: false },
    tabbyMerchantCode: { type: String, default: null },
  },
  { timestamps: true }
)

export default mongoose.model<IPaymentSettings>('PaymentSettings', PaymentSettingsSchema)
