import mongoose, { Document, Schema } from 'mongoose'

export interface ITrustBadge {
  icon?: string
  label: string
}

export interface ICTAButton {
  label: string
  href: string
}

export interface IHeroSection extends Document {
  key: string
  badgeText: string
  headline: string
  headlineHighlight: string
  subheadline: string
  backgroundImageUrl: string
  backgroundImageUrls: string[]
  backgroundVideoUrlMobile: string
  backgroundVideoUrlDesktop: string
  ctaPrimary: ICTAButton
  ctaSecondary: ICTAButton
  ctaTertiary: ICTAButton
  ctaPrimaryVisible: boolean
  ctaSecondaryVisible: boolean
  ctaTertiaryVisible: boolean
  trustBadges: ITrustBadge[]
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const TrustBadgeSchema = new Schema(
  { icon: String, label: { type: String, required: true } },
  { _id: false }
)

const CTAButtonSchema = new Schema(
  { label: { type: String, required: true }, href: { type: String, required: true } },
  { _id: false }
)

const HeroSectionSchema = new Schema<IHeroSection>(
  {
    key: { type: String, required: true, unique: true, default: 'home' },
    badgeText: { type: String, default: '' },
    headline: { type: String, default: 'Elegance Meets' },
    headlineHighlight: { type: String, default: 'Luxury Cashmere' },
    subheadline: { type: String, default: '' },
    backgroundImageUrl: { type: String, default: '' },
    backgroundImageUrls: { type: [String], default: [] },
    backgroundVideoUrlMobile: { type: String, default: '/uploads/hero/Mobile_Screen.mp4' },
    backgroundVideoUrlDesktop: { type: String, default: '/uploads/hero/PC_Screen.mp4' },
    ctaPrimary: {
      type: CTAButtonSchema,
      default: () => ({ label: 'Shop Collection', href: '/shop' }),
    },
    ctaSecondary: {
      type: CTAButtonSchema,
      default: () => ({ label: "Explore Men's", href: '/category/men' }),
    },
    ctaTertiary: {
      type: CTAButtonSchema,
      default: () => ({ label: "Explore Women's", href: '/category/women' }),
    },
    ctaPrimaryVisible: { type: Boolean, default: true },
    ctaSecondaryVisible: { type: Boolean, default: true },
    ctaTertiaryVisible: { type: Boolean, default: true },
    trustBadges: {
      type: [TrustBadgeSchema],
      default: () => [
        { icon: 'shipping', label: 'Free Shipping UAE' },
        { icon: 'returns', label: '30-Day Returns' },
        { icon: 'secure', label: 'Secure Checkout' },
      ],
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export default mongoose.models.HeroSection || mongoose.model<IHeroSection>('HeroSection', HeroSectionSchema)
