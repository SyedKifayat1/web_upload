import mongoose, { Document, Schema } from 'mongoose'

const ABOUT_SETTINGS_KEY = 'main'

export interface IAboutCraftsmanshipItem {
  title: string
  description: string
}

export interface IAboutCtaButton {
  label: string
  href: string
}

export interface IAboutSettings extends Document {
  key: string
  hero: {
    enabled: boolean
    /** Banner title (e.g. "About") shown on the banner image */
    bannerTitle: string
    /** Banner tagline shown under the title on the banner */
    bannerTagline: string
    imageUrl: string
    /** Intro block below banner */
    headline: string
    subheading: string
    paragraph: string
  }
  brandStory: {
    enabled: boolean
    /** Pill tag above headline (e.g. "Our Story") */
    tagLabel: string
    /** Main headline (e.g. "Crafted with Passion,") */
    headline: string
    /** Second line in accent color (e.g. "Worn with Pride") */
    headlineHighlight: string
    heading: string
    paragraph1: string
    paragraph2: string
    paragraph3: string
    imageUrl: string
    /** CTA buttons below text (e.g. Learn More, Read Blog) */
    buttons: IAboutCtaButton[]
  }
  craftsmanship: {
    enabled: boolean
    introTitle: string
    introSubtitle: string
    items: IAboutCraftsmanshipItem[]
  }
  philosophy: {
    enabled: boolean
    heading: string
    subheading: string
    bullets: string[]
  }
  whyChoose: {
    enabled: boolean
    heading: string
    subheading: string
    items: string[]
  }
  sustainability: {
    enabled: boolean
    heading: string
    intro: string
    bullets: string[]
  }
  missionVision: {
    enabled: boolean
    mission: string
    vision: string
  }
  customerPromise: {
    enabled: boolean
    text: string
  }
  cta: {
    enabled: boolean
    heading: string
    subtext: string
    buttons: IAboutCtaButton[]
  }
  updatedAt: Date
}

const CraftsmanshipItemSchema = new Schema(
  { title: { type: String, default: '' }, description: { type: String, default: '' } },
  { _id: false }
)
const CtaButtonSchema = new Schema(
  { label: { type: String, default: '' }, href: { type: String, default: '' } },
  { _id: false }
)

const AboutSettingsSchema = new Schema<IAboutSettings>(
  {
    key: { type: String, required: true, unique: true, default: ABOUT_SETTINGS_KEY },
    hero: {
      enabled: { type: Boolean, default: true },
      bannerTitle: { type: String, default: 'About' },
      bannerTagline: { type: String, default: 'Our story, craft, and commitment to quality' },
      imageUrl: { type: String, default: 'https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=1600&q=90' },
      headline: { type: String, default: 'The Art of Timeless Cashmere' },
      subheading: { type: String, default: 'Elevating everyday luxury with responsibly crafted cashmere essentials.' },
      paragraph: { type: String, default: 'SkyCashmere is a premium fashion house redefining modern elegance through craftsmanship, purity, and comfort. Cashmere brand UAE · luxury knitwear · premium cashmere fashion.' },
    },
    brandStory: {
      enabled: { type: Boolean, default: true },
      tagLabel: { type: String, default: 'Our Story' },
      headline: { type: String, default: 'Crafted with Passion,' },
      headlineHighlight: { type: String, default: 'Worn with Pride' },
      heading: { type: String, default: 'Our Story' },
      paragraph1: { type: String, default: 'At Sky Cashmere, we believe luxury is not just about what you wear, but how it makes you feel. Each piece in our collection is carefully crafted from the finest cashmere, ensuring unmatched quality and timeless elegance.' },
      paragraph2: { type: String, default: "Founded in 2020, we've built our reputation on delivering exceptional quality, sustainable practices, and a commitment to customer satisfaction. Every garment tells a story of craftsmanship, tradition, and modern sophistication." },
      paragraph3: { type: String, default: "Our vision is to be the Middle East's most trusted name in premium cashmere — where every piece feels exceptional from the first touch and lasts for years." },
      imageUrl: { type: String, default: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&q=85' },
      buttons: {
        type: [CtaButtonSchema],
        default: [
          { label: 'Learn More About Us', href: '/about' },
          { label: 'Read Our Blog', href: '/blog' },
        ],
      },
    },
    craftsmanship: {
      enabled: { type: Boolean, default: true },
      introTitle: { type: String, default: 'Our Craftsmanship' },
      introSubtitle: { type: String, default: 'Quality & materials that justify the premium.' },
      items: {
        type: [CraftsmanshipItemSchema],
        default: [
          { title: 'Premium grade cashmere', description: 'We source only the finest long-fiber cashmere to ensure softness, durability, and superior insulation.' },
          { title: 'Ethical sourcing', description: 'Responsibly sourced fibres and sustainable production practices from trusted partners.' },
          { title: 'Precision crafting', description: 'Each garment is meticulously constructed for a flawless finish and lasting comfort.' },
          { title: 'Long-lasting durability', description: 'Designed and made to last for years — timeless over trend.' },
        ],
      },
    },
    philosophy: {
      enabled: { type: Boolean, default: true },
      heading: { type: String, default: 'Our Philosophy' },
      subheading: { type: String, default: 'What we stand for.' },
      bullets: {
        type: [String],
        default: ['Timeless over trend', 'Quality over quantity', 'Comfort without compromise', 'Sustainability matters'],
      },
    },
    whyChoose: {
      enabled: { type: Boolean, default: true },
      heading: { type: String, default: 'Why choose SkyCashmere' },
      subheading: { type: String, default: 'Trust and reassurance.' },
      items: {
        type: [String],
        default: ['Premium long-fiber cashmere', 'Designed for longevity', 'UAE-based luxury brand', 'Worldwide shipping', 'Easy returns'],
      },
    },
    sustainability: {
      enabled: { type: Boolean, default: true },
      heading: { type: String, default: 'Sustainability & responsibility' },
      intro: { type: String, default: 'We believe luxury and responsibility can coexist. From ethical sourcing and slow fashion principles to low-waste production and thoughtful packaging, we are committed to reducing our footprint while delivering pieces you can wear with pride.' },
      bullets: {
        type: [String],
        default: [
          'Ethical sourcing and fair trade practices',
          'Slow fashion — made to last, not to replace',
          'Low-waste production and responsible packaging',
          'Transparency in our supply chain',
        ],
      },
    },
    missionVision: {
      enabled: { type: Boolean, default: true },
      mission: { type: String, default: 'To redefine modern luxury through timeless cashmere essentials crafted with integrity.' },
      vision: { type: String, default: "To become the Middle East's most trusted premium cashmere brand." },
    },
    customerPromise: {
      enabled: { type: Boolean, default: true },
      text: { type: String, default: 'Every SkyCashmere piece is designed to feel exceptional — today and years from now.' },
    },
    cta: {
      enabled: { type: Boolean, default: true },
      heading: { type: String, default: 'Explore the collection' },
      subtext: { type: String, default: 'Discover scarves, shawls, and knitwear crafted for comfort and style.' },
      buttons: {
        type: [CtaButtonSchema],
        default: [
          { label: 'Shop collection', href: '/shop' },
          { label: 'Explore best sellers', href: '/shop?sort=bestsellers' },
          { label: 'Discover new arrivals', href: '/shop?new=1' },
        ],
      },
    },
  },
  { timestamps: true }
)

export { ABOUT_SETTINGS_KEY }
export default mongoose.model<IAboutSettings>('AboutSettings', AboutSettingsSchema)
