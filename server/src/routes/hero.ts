import express from 'express'
import HeroSection from '../models/HeroSection'
import { protect, checkPermission } from '../middleware/auth'
import { syncHeroSectionMediaUsage } from '../services/mediaTracking'

const router = express.Router()

const defaultHero = {
  key: 'home',
  badgeText: '✨ Premium Luxury Since 2020',
  headline: 'Elegance Meets',
  headlineHighlight: 'Luxury Cashmere',
  subheadline:
    'Discover our exquisite collection of premium cashmere, crafted for the modern connoisseur who values quality and timeless elegance.',
  backgroundImageUrl: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1920',
  backgroundImageUrls: [],
  backgroundVideoUrlMobile: '/uploads/hero/Mobile_Screen.mp4',
  backgroundVideoUrlDesktop: '/uploads/hero/PC_Screen.mp4',
  ctaPrimary: { label: 'Shop Collection', href: '/shop' },
  ctaSecondary: { label: "Explore Men's", href: '/category/men' },
  ctaTertiary: { label: "Explore Women's", href: '/category/women' },
  ctaPrimaryVisible: true,
  ctaSecondaryVisible: true,
  ctaTertiaryVisible: true,
  trustBadges: [
    { icon: 'shipping', label: 'Free Shipping UAE' },
    { icon: 'returns', label: '30-Day Returns' },
    { icon: 'secure', label: 'Secure Checkout' },
  ],
  active: true,
}

// @route   GET /api/v1/hero
// @desc    Get hero section (public). Returns null when hero is disabled (active: false).
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    let hero = await HeroSection.findOne({ key: 'home' })
    if (!hero) {
      hero = await HeroSection.create(defaultHero)
    }
    // When admin has disabled the hero, return null so the frontend hides it
    if (!hero.active) {
      return res.json({ success: true, data: null })
    }
    res.json({
      success: true,
      data: hero,
    })
  } catch (error) {
    next(error)
  }
})

// @route   GET /api/v1/hero/admin
// @desc    Get hero section for admin (includes inactive)
// @access  Private/Admin
router.get('/admin', protect, checkPermission('settings:view'), async (req, res, next) => {
  try {
    let hero = await HeroSection.findOne({ key: 'home' })
    if (!hero) {
      hero = await HeroSection.create(defaultHero)
    }
    res.json({
      success: true,
      data: hero,
    })
  } catch (error) {
    next(error)
  }
})

// @route   PUT /api/v1/hero
// @desc    Update hero section
// @access  Private/Admin
router.put('/', protect, checkPermission('settings:update'), async (req, res, next) => {
  try {
    let hero = await HeroSection.findOne({ key: 'home' })
    if (!hero) {
      hero = await HeroSection.create({ ...defaultHero, ...req.body })
    } else {
      hero = await HeroSection.findOneAndUpdate(
        { key: 'home' },
        { $set: req.body },
        { new: true, runValidators: true }
      )
    }
    await syncHeroSectionMediaUsage()
    res.json({
      success: true,
      data: hero,
    })
  } catch (error) {
    next(error)
  }
})

export default router
