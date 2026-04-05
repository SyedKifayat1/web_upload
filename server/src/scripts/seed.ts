import mongoose from 'mongoose'
import dotenv from 'dotenv'
import connectDB from '../config/database'
import Category from '../models/Category'
import Product from '../models/Product'
import User from '../models/User'
import BlogPost from '../models/BlogPost'
import HeroSection from '../models/HeroSection'

dotenv.config()

// Connect to database
connectDB()

const seedData = async () => {
  try {
    // Clear existing data
    await Category.deleteMany({})
    await Product.deleteMany({})
    await User.deleteMany({})
    await BlogPost.deleteMany({})

    console.log('🗑️  Cleared existing data...')

    // Create Categories (Women + Accessories only; Men removed)
    const categories = [
      {
        name: 'Women',
        slug: 'women',
        description: 'Elegant cashmere products for women',
        order: 1,
        seoTitle: 'Women\'s Cashmere Collection | Sky Cashmere',
        seoDescription: 'Explore our luxurious women\'s cashmere collection featuring sweaters, cardigans, and more.',
      },
      {
        name: 'Accessories',
        slug: 'accessories',
        description: 'Cashmere accessories and essentials',
        order: 2,
        seoTitle: 'Cashmere Accessories | Sky Cashmere',
        seoDescription: 'Complete your look with our premium cashmere accessories.',
      },
    ]

    const createdCategories = await Category.insertMany(categories)
    console.log(`✅ Created ${createdCategories.length} categories`)

    const womenCategory = createdCategories.find(c => c.slug === 'women')
    const accessoriesCategory = createdCategories.find(c => c.slug === 'accessories')

    // Create Products (Women + Accessories only; images from product_images folders only)
    const products = [
      // Women's Products
      {
        name: 'Elegant Women\'s Cashmere Cardigan',
        slug: 'elegant-womens-cashmere-cardigan',
        description: 'An elegant and sophisticated cashmere cardigan for women. Perfect for layering and versatile styling.',
        shortDescription: 'Elegant cashmere cardigan',
        sku: 'WCS-001',
        price: 319.99,
        compareAtPrice: 419.99,
        stock: 45,
        lowStockThreshold: 10,
        images: [],
        imageFolder: 'female-model-1/product-04',
        category: womenCategory!._id,
        tags: ['cardigan', 'cashmere', 'elegant', 'women'],
        variants: [
          {
            name: 'Size',
            options: [
              { name: 'Size', value: 'XS', price: 0 },
              { name: 'Size', value: 'S', price: 0 },
              { name: 'Size', value: 'M', price: 0 },
              { name: 'Size', value: 'L', price: 0 },
            ],
          },
          {
            name: 'Color',
            options: [
              { name: 'Color', value: 'Beige', price: 0 },
              { name: 'Color', value: 'Rose', price: 0 },
              { name: 'Color', value: 'Navy', price: 0 },
            ],
          },
        ],
        published: true,
        featured: true,
        rating: 4.6,
        reviewCount: 42,
      },
      {
        name: 'Cashmere Turtleneck Sweater',
        slug: 'cashmere-turtleneck-sweater',
        description: 'A cozy and stylish cashmere turtleneck sweater. Perfect for cold weather and chic styling.',
        shortDescription: 'Cozy turtleneck sweater',
        sku: 'WCS-002',
        price: 289.99,
        compareAtPrice: 379.99,
        stock: 38,
        lowStockThreshold: 10,
        images: [],
        imageFolder: 'female-model-1/product-05',
        category: womenCategory!._id,
        tags: ['sweater', 'cashmere', 'turtleneck', 'women'],
        variants: [
          {
            name: 'Size',
            options: [
              { name: 'Size', value: 'S', price: 0 },
              { name: 'Size', value: 'M', price: 0 },
              { name: 'Size', value: 'L', price: 0 },
            ],
          },
          {
            name: 'Color',
            options: [
              { name: 'Color', value: 'Cream', price: 0 },
              { name: 'Color', value: 'Pink', price: 0 },
              { name: 'Color', value: 'Grey', price: 0 },
            ],
          },
        ],
        published: true,
        featured: false,
        rating: 4.4,
        reviewCount: 27,
      },
      {
        name: 'Cashmere Wrap Dress',
        slug: 'cashmere-wrap-dress',
        description: 'A luxurious cashmere wrap dress that combines elegance with comfort. Perfect for any occasion.',
        shortDescription: 'Luxurious wrap dress',
        sku: 'WCS-003',
        price: 449.99,
        compareAtPrice: 549.99,
        stock: 22,
        lowStockThreshold: 10,
        images: [],
        imageFolder: 'female-model-1/product-06',
        category: womenCategory!._id,
        tags: ['dress', 'cashmere', 'elegant', 'women'],
        variants: [
          {
            name: 'Size',
            options: [
              { name: 'Size', value: 'S', price: 0 },
              { name: 'Size', value: 'M', price: 0 },
              { name: 'Size', value: 'L', price: 0 },
            ],
          },
        ],
        published: true,
        featured: true,
        rating: 4.8,
        reviewCount: 35,
      },
      // Accessories
      {
        name: 'Premium Cashmere Scarf',
        slug: 'premium-cashmere-scarf',
        description: 'A luxurious cashmere scarf to keep you warm and stylish. Available in multiple colors.',
        shortDescription: 'Luxurious cashmere scarf',
        sku: 'CAS-001',
        price: 149.99,
        compareAtPrice: 199.99,
        stock: 60,
        lowStockThreshold: 15,
        images: [],
        imageFolder: 'female-model-1/product-07',
        category: accessoriesCategory!._id,
        tags: ['scarf', 'cashmere', 'accessories'],
        variants: [
          {
            name: 'Color',
            options: [
              { name: 'Color', value: 'Navy', price: 0 },
              { name: 'Color', value: 'Grey', price: 0 },
              { name: 'Color', value: 'Beige', price: 0 },
              { name: 'Color', value: 'Red', price: 0 },
            ],
          },
        ],
        published: true,
        featured: true,
        rating: 4.6,
        reviewCount: 58,
      },
      {
        name: 'Cashmere Beanie',
        slug: 'cashmere-beanie',
        description: 'A cozy and stylish cashmere beanie for cold weather. Soft and warm.',
        shortDescription: 'Cozy cashmere beanie',
        sku: 'CAS-002',
        price: 79.99,
        compareAtPrice: 99.99,
        stock: 75,
        lowStockThreshold: 15,
        images: [],
        imageFolder: 'female-model-1/product-08',
        category: accessoriesCategory!._id,
        tags: ['beanie', 'cashmere', 'accessories', 'winter'],
        variants: [
          {
            name: 'Color',
            options: [
              { name: 'Color', value: 'Black', price: 0 },
              { name: 'Color', value: 'Grey', price: 0 },
              { name: 'Color', value: 'Cream', price: 0 },
            ],
          },
        ],
        published: true,
        featured: false,
        rating: 4.5,
        reviewCount: 43,
      },
      {
        name: 'Cashmere Gloves',
        slug: 'cashmere-gloves',
        description: 'Premium cashmere gloves to keep your hands warm and comfortable.',
        shortDescription: 'Premium cashmere gloves',
        sku: 'CAS-003',
        price: 89.99,
        compareAtPrice: 119.99,
        stock: 55,
        lowStockThreshold: 15,
        images: [],
        imageFolder: 'female-model-1/product-09',
        category: accessoriesCategory!._id,
        tags: ['gloves', 'cashmere', 'accessories', 'winter'],
        variants: [
          {
            name: 'Size',
            options: [
              { name: 'Size', value: 'S', price: 0 },
              { name: 'Size', value: 'M', price: 0 },
              { name: 'Size', value: 'L', price: 0 },
            ],
          },
        ],
        published: true,
        featured: false,
        rating: 4.4,
        reviewCount: 36,
      },
    ]

    const createdProducts = await Product.insertMany(products)
    console.log(`✅ Created ${createdProducts.length} products`)

    // Create Admin User
    const adminUser = await User.create({
      name: 'Admin User',
      email: 'admin@skycashmere.com',
      password: 'admin123',
      isAdmin: true,
      permissions: ['all'],
      phone: '+44 20 1234 5678',
    })

    console.log('✅ Created admin user (email: admin@skycashmere.com, password: admin123)')

    // Create Test Customer
    const testUser = await User.create({
      name: 'Test Customer',
      email: 'test@example.com',
      password: 'test123',
      isAdmin: false,
      permissions: [],
      phone: '+44 20 8765 4321',
      addresses: [
        {
          type: 'billing',
          street: '123 Test Street',
          city: 'London',
          state: 'England',
          zipCode: 'SW1A 1AA',
          country: 'United Kingdom',
          isDefault: true,
        },
        {
          type: 'shipping',
          street: '123 Test Street',
          city: 'London',
          state: 'England',
          zipCode: 'SW1A 1AA',
          country: 'United Kingdom',
          isDefault: true,
        },
      ],
    })

    console.log('✅ Created test customer (email: test@example.com, password: test123)')

    // Create Blog Posts
    const blogPosts = [
      {
        title: 'The Art of Cashmere: A Complete Guide to Luxury Fashion',
        slug: 'the-art-of-cashmere-a-complete-guide',
        excerpt: 'Discover the luxurious world of cashmere, from its rich history to how to care for your premium cashmere garments. Learn why cashmere remains the pinnacle of luxury fashion.',
        content: `
# The Art of Cashmere: A Complete Guide to Luxury Fashion

Cashmere has long been synonymous with luxury, elegance, and unparalleled comfort. This exquisite fiber, derived from the soft undercoat of cashmere goats, has been treasured for centuries. In this comprehensive guide, we'll explore everything you need to know about cashmere.

## The History of Cashmere

Cashmere's origins trace back to the Kashmir region, from which it derives its name. For centuries, cashmere has been prized by royalty and fashion connoisseurs alike for its exceptional softness and warmth.

## What Makes Cashmere Special?

Cashmere is incredibly fine, typically 14-19 microns in diameter (human hair is about 75 microns). This fineness, combined with its natural insulating properties, creates a fabric that is both lightweight and remarkably warm.

## Caring for Your Cashmere

To maintain the beauty and longevity of your cashmere garments:

- Hand wash in cold water with a gentle detergent
- Lay flat to dry to prevent stretching
- Store folded, never hung
- Use a cashmere comb to remove pills gently

## Investing in Quality

When purchasing cashmere, look for:

- 2-ply or higher construction for durability
- Tightly woven fabric that resists pilling
- Natural fiber content (100% cashmere or blends with silk/wool)

Investing in quality cashmere means investing in timeless style and comfort that will last for years to come.
        `.trim(),
        featuredImage: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1200',
        tags: ['cashmere', 'fashion', 'luxury', 'care-guide'],
        author: adminUser._id,
        published: true,
        publishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        seoTitle: 'The Art of Cashmere: Complete Guide to Luxury Fashion | Sky Cashmere',
        seoDescription: 'Discover the luxurious world of cashmere. Learn about its history, care tips, and why it remains the pinnacle of luxury fashion.',
      },
      {
        title: 'Sustainable Fashion: How Cashmere Contributes to Eco-Friendly Wardrobe',
        slug: 'sustainable-fashion-cashmere-eco-friendly',
        excerpt: 'Exploring eco-friendly practices in fashion and how premium cashmere aligns with sustainable living. Learn how to build a conscious wardrobe.',
        content: `
# Sustainable Fashion: How Cashmere Contributes to Eco-Friendly Wardrobe

In an era where sustainability is more important than ever, understanding the environmental impact of our fashion choices is crucial. Cashmere, when sourced responsibly, can be a sustainable choice for the conscious consumer.

## The Sustainability of Cashmere

Cashmere is a natural, biodegradable fiber that, when properly cared for, can last for decades. Unlike synthetic materials, cashmere doesn't contribute to microplastic pollution and breaks down naturally at the end of its lifecycle.

## Ethical Sourcing Matters

At Sky Cashmere, we're committed to:

- Working with suppliers who practice ethical animal husbandry
- Supporting communities that rely on cashmere production
- Ensuring fair trade practices throughout our supply chain

## Building a Timeless Wardrobe

The key to sustainable fashion is investing in quality pieces that last. Cashmere garments, when cared for properly, remain beautiful and functional for many years, reducing the need for frequent replacements.

## Care and Longevity

Proper care extends the life of your cashmere:

- Store properly to prevent damage
- Repair rather than replace when possible
- Choose classic styles that won't go out of fashion

By choosing high-quality cashmere and caring for it well, you're making a sustainable fashion choice that benefits both you and the planet.
        `.trim(),
        featuredImage: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200',
        tags: ['sustainability', 'eco-friendly', 'cashmere', 'fashion'],
        author: adminUser._id,
        published: true,
        publishedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // 14 days ago
        seoTitle: 'Sustainable Fashion with Cashmere | Sky Cashmere Blog',
        seoDescription: 'Learn how cashmere contributes to sustainable fashion and how to build an eco-friendly wardrobe with premium quality pieces.',
      },
      {
        title: 'Styling Cashmere: Outfit Ideas for Every Season',
        slug: 'styling-cashmere-outfit-ideas-every-season',
        excerpt: 'Discover versatile ways to style cashmere throughout the year. From winter layering to summer evening looks, cashmere adapts to every season.',
        content: `
# Styling Cashmere: Outfit Ideas for Every Season

Cashmere isn't just for winter! With the right styling, cashmere can be a year-round wardrobe staple. Here are our favorite ways to wear cashmere in every season.

## Winter: Cozy Layering

Winter is cashmere's time to shine:

- **Layer over button-down shirts** for a polished office look
- **Pair with tailored coats** for sophisticated outerwear
- **Combine with jeans and boots** for casual weekend comfort

## Spring: Lightweight Layers

As temperatures rise, cashmere can still work:

- **Thin cashmere cardigans** over dresses or blouses
- **Lightweight cashmere wraps** as evening accessories
- **Pastel cashmere sweaters** for fresh spring color

## Summer: Evening Elegance

Yes, cashmere works in summer too:

- **Cashmere wraps** for air-conditioned spaces
- **Light cashmere shawls** for evening events
- **Thin cashmere tanks** for cooler summer nights

## Fall: Transitional Styling

Fall is perfect for cashmere experimentation:

- **Cashmere turtlenecks** under blazers
- **Cardigans** as light outer layers
- **Vests** for a stylish, layered look

## Accessories for Every Season

Don't forget cashmere accessories:

- **Scarves** for warmth and style
- **Beanies** for casual comfort
- **Gloves** for winter essentials

Remember: Quality cashmere is an investment. Choose classic pieces that can be styled multiple ways and will last for seasons to come.
        `.trim(),
        featuredImage: 'https://images.unsplash.com/photo-1506629905646-eb18e4a9e9c8?w=1200',
        tags: ['styling', 'fashion-tips', 'cashmere', 'wardrobe'],
        author: adminUser._id,
        published: true,
        publishedAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000), // 21 days ago
        seoTitle: 'Styling Cashmere: Outfit Ideas for Every Season | Sky Cashmere',
        seoDescription: 'Learn how to style cashmere throughout the year with our seasonal outfit ideas and fashion tips.',
      },
      {
        title: 'Understanding Cashmere Quality: What to Look For When Shopping',
        slug: 'understanding-cashmere-quality-shopping-guide',
        excerpt: 'Learn how to identify high-quality cashmere and make informed purchasing decisions. Understand plys, microns, and construction quality.',
        content: `
# Understanding Cashmere Quality: What to Look For When Shopping

Not all cashmere is created equal. Understanding quality indicators will help you make informed decisions and ensure you're investing in garments that will last.

## Understanding Cashmere Grades

Cashmere quality is typically graded by:

### Grade A (Highest Quality)
- 14-15.5 microns in diameter
- Longest fibers (34-36mm)
- Luxuriously soft and durable

### Grade B (Good Quality)
- 15.5-17 microns
- Medium-length fibers (30-32mm)
- Good balance of softness and durability

### Grade C (Standard Quality)
- 17-19 microns
- Shorter fibers (28-30mm)
- More affordable, less durable

## Plys and Construction

**2-ply cashmere** is made from two threads twisted together, making it:
- More durable
- Less prone to pilling
- Better value for investment pieces

**Single-ply cashmere** is softer but may pill more easily over time.

## What to Check When Shopping

1. **Fiber Thickness**: Look for products specifying micron count
2. **Ply Count**: 2-ply is generally more durable
3. **Origin**: Scottish and Italian cashmere are renowned for quality
4. **Weight**: Heavier doesn't always mean better - balance is key
5. **Price**: Exceptionally low prices often indicate inferior quality

## Red Flags to Avoid

- Cashmere that feels rough or scratchy
- Excessive shedding on first wear
- Unusually low prices (likely blends, not 100% cashmere)
- Vague labeling without quality specifications

## Making the Investment

Quality cashmere is an investment that pays off in:
- Longevity (decades with proper care)
- Comfort (luxurious feel)
- Versatility (works for many occasions)
- Sustainability (fewer replacements needed)

When in doubt, invest in fewer high-quality pieces rather than many lower-quality items.
        `.trim(),
        featuredImage: 'https://images.unsplash.com/photo-1539533018447-63fcce2678e3?w=1200',
        tags: ['quality', 'shopping-guide', 'cashmere', 'fashion'],
        author: adminUser._id,
        published: true,
        publishedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        seoTitle: 'Understanding Cashmere Quality: Shopping Guide | Sky Cashmere',
        seoDescription: 'Learn how to identify high-quality cashmere and make informed purchasing decisions. Understand plys, microns, and construction.',
      },
      {
        title: 'The Perfect Gift: Why Cashmere Makes an Exceptional Present',
        slug: 'perfect-gift-cashmere-exceptional-present',
        excerpt: 'Discover why cashmere is the perfect gift for any occasion. From luxurious comfort to timeless elegance, cashmere gifts are always appreciated.',
        content: `
# The Perfect Gift: Why Cashmere Makes an Exceptional Present

Struggling to find the perfect gift? Cashmere is always a winning choice. Here's why cashmere makes an exceptional present for any occasion.

## Why Cashmere is the Perfect Gift

### Universal Appeal
Cashmere appeals to:
- Fashion-conscious individuals
- Comfort seekers
- Quality enthusiasts
- Anyone who appreciates luxury

### Timeless Elegance
Unlike trendy items, cashmere:
- Never goes out of style
- Remains relevant year after year
- Becomes more cherished over time

### Versatile Options
Cashmere gifts come in many forms:
- Sweaters and cardigans
- Scarves and wraps
- Accessories (gloves, beanies)
- Home items (throws, blankets)

## Choosing the Right Cashmere Gift

### Consider the Recipient

**For the Professional:**
- Classic crew neck sweaters
- V-neck pullovers
- Cashmere-blend blazers

**For the Fashion-Forward:**
- Statement cardigans
- Unique colors and patterns
- Trendy accessories

**For Comfort Lovers:**
- Oversized cardigans
- Cozy wraps
- Luxurious scarves

## Gift-Giving Occasions

Cashmere works for:
- **Birthdays**: A personal luxury item
- **Anniversaries**: Symbol of lasting quality
- **Holidays**: Thoughtful, practical gift
- **Graduations**: Investment piece for the future
- **Thank You Gifts**: Shows appreciation

## The Gift That Keeps Giving

Cashmere gifts are cherished because they:
- Provide lasting comfort
- Improve with age (when cared for)
- Create lasting memories
- Show thoughtfulness and care

## Gift Presentation Tips

Make your cashmere gift even more special:
- Include care instructions
- Add a handwritten note
- Choose quality packaging
- Consider gift sets (scarf + gloves)

Remember: The best gifts are those that show you've put thought into choosing something special. Cashmere demonstrates both thoughtfulness and an appreciation for quality.
        `.trim(),
        featuredImage: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1200',
        tags: ['gifts', 'cashmere', 'luxury', 'lifestyle'],
        author: adminUser._id,
        published: true,
        publishedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
        seoTitle: 'Perfect Gift Ideas: Why Cashmere Makes an Exceptional Present | Sky Cashmere',
        seoDescription: 'Discover why cashmere is the perfect gift for any occasion. Learn how to choose the ideal cashmere gift for your loved ones.',
      },
    ]

    const createdBlogPosts = await BlogPost.insertMany(blogPosts)
    console.log(`✅ Created ${createdBlogPosts.length} blog posts`)

    console.log('\n🎉 Seed data created successfully!')
    console.log('\n📊 Summary:')
    console.log(`   - Categories: ${createdCategories.length}`)
    console.log(`   - Products: ${createdProducts.length}`)
    console.log(`   - Users: 2 (1 admin, 1 customer)`)
    console.log(`   - Blog Posts: ${createdBlogPosts.length}`)
    // Seed hero section (upsert - don't overwrite if already customized)
    await HeroSection.findOneAndUpdate(
      { key: 'home' },
      {
        key: 'home',
        badgeText: '✨ Premium Luxury Since 2020',
        headline: 'Elegance Meets',
        headlineHighlight: 'Luxury Cashmere',
        subheadline:
          'Discover our exquisite collection of premium cashmere, crafted for the modern connoisseur who values quality and timeless elegance.',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1920',
        ctaPrimary: { label: 'Shop Collection', href: '/shop' },
        ctaSecondary: { label: "Explore Men's", href: '/category/men' },
        ctaTertiary: { label: "Explore Women's", href: '/category/women' },
        trustBadges: [
          { icon: 'shipping', label: 'Free Shipping UAE' },
          { icon: 'returns', label: '30-Day Returns' },
          { icon: 'secure', label: 'Secure Checkout' },
        ],
        active: true,
      },
      { upsert: true, new: true }
    )
    console.log('🏠 Hero section seeded')

    console.log('\n✨ Database is now populated with dummy data!')

    process.exit(0)
  } catch (error) {
    console.error('❌ Error seeding data:', error)
    process.exit(1)
  }
}

// Run seed
seedData()
