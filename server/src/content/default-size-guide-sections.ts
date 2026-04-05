import type { ISizeGuideSection } from '../models/SizeGuide'

/** Default size guide as ordered sections. Fetched by admin "Load default" and used when no content exists. */
export const DEFAULT_SIZE_GUIDE_SECTIONS: ISizeGuideSection[] = [
  {
    type: 'text',
    contentHtml: `<p>At Sky Cashmere, we design our collections to offer comfort, elegance, and a flattering fit. Please review the size guide below to help you choose the best size before placing your order.</p>
<p>If you need assistance selecting the right size, our customer support team will be happy to help.</p>`,
  },
  {
    type: 'table',
    title: "Women's Clothing Size Guide",
    subtitle: 'Body Measurements (in inches)',
    headers: ['Size', 'Bust', 'Waist', 'Hips'],
    rows: [
      ['XS', '32 – 34', '26 – 28', '34 – 36'],
      ['S', '34 – 36', '28 – 30', '36 – 38'],
      ['M', '36 – 38', '30 – 32', '38 – 40'],
      ['L', '38 – 40', '32 – 34', '40 – 42'],
      ['XL', '40 – 42', '34 – 36', '42 – 44'],
    ],
  },
  {
    type: 'table',
    title: 'Abaya Size Guide (Height Based)',
    subtitle: 'Abayas are generally sized according to height to ensure proper length.',
    note: 'Please note that abaya styles may vary slightly depending on design.',
    headers: ['Abaya Size', 'Recommended Height'],
    rows: [
      ['50', "5'0\" – 5'2\""],
      ['52', "5'2\" – 5'4\""],
      ['54', "5'4\" – 5'6\""],
      ['56', "5'6\" – 5'8\""],
      ['58', "5'8\" – 5'10\""],
      ['60', "5'10\" – 6'0\""],
    ],
  },
  {
    type: 'table',
    title: 'Scarf & Shawl Sizes',
    subtitle: 'Sky Cashmere scarves and shawls come in different sizes depending on the style.',
    note: 'Exact measurements may vary slightly depending on the product.',
    headers: ['Type', 'Approximate Size'],
    rows: [
      ['Standard Hijab', '70 x 180 cm'],
      ['Premium Shawl', '70 x 200 cm'],
      ['Large Wrap / Pashmina', '90 x 200 cm'],
    ],
  },
  {
    type: 'text',
    contentHtml: `<h2>How to Measure Yourself</h2>
<p>For the best fit, measure your body using a flexible measuring tape.</p>
<p><strong>Bust</strong><br/>Measure around the fullest part of your bust while keeping the tape level.</p>
<p><strong>Waist</strong><br/>Measure around the narrowest part of your waist.</p>
<p><strong>Hips</strong><br/>Measure around the fullest part of your hips.</p>
<p><strong>Height (for Abayas)</strong><br/>Measure your height from the top of your head to the floor while standing straight.</p>

<h2>Important Notes</h2>
<ul>
<li>Measurements may vary slightly depending on the fabric and design.</li>
<li>If you are between two sizes, we generally recommend choosing the larger size for comfort.</li>
<li>Colors and fabric textures may appear slightly different depending on screen settings.</li>
</ul>

<h2>Need Help?</h2>
<p>If you're unsure about your size, please contact us before ordering.</p>

<p><strong>Sky Cashmere Pakistan</strong><br/>Email: skycashmerepakistan@gmail.com<br/>Phone: 03477780008</p>

<p><strong>Sky Cashmere UAE</strong><br/>Email: care@skycashmere.ae<br/>Phone: +971 52 773 0905</p>

<p><strong>Sky Cashmere UK</strong><br/>Email: info@skycashmere.uk<br/>Phone: +16037990957</p>`,
  },
]
