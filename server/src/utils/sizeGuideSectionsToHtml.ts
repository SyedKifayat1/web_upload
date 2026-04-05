import type { ISizeGuideSection } from '../models/SizeGuide'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderTableToHtml(t: {
  title?: string
  subtitle?: string
  note?: string
  headers?: string[]
  rows?: string[][]
}): string {
  const title = (t.title || '').trim()
  const subtitle = (t.subtitle || '').trim()
  const headers = Array.isArray(t.headers) ? t.headers.map((h) => String(h ?? '').trim()) : []
  const rows = Array.isArray(t.rows) ? t.rows : []
  const parts: string[] = []
  if (title) parts.push(`<h2>${escapeHtml(title)}</h2>`)
  if (subtitle) parts.push(`<p><strong>${escapeHtml(subtitle)}</strong></p>`)
  if (headers.length > 0) {
    parts.push('<div class="size-guide-table-wrap">')
    parts.push('<table>')
    parts.push('<thead><tr>')
    for (const h of headers) parts.push(`<th>${escapeHtml(h)}</th>`)
    parts.push('</tr></thead><tbody>')
    for (const row of rows) {
      const cells = Array.isArray(row) ? row.map((c) => String(c ?? '').trim()) : []
      if (cells.length === 0) continue
      parts.push('<tr>')
      for (const c of cells) parts.push(`<td>${escapeHtml(c)}</td>`)
      parts.push('</tr>')
    }
    parts.push('</tbody></table></div>')
  }
  const note = (t.note || '').trim()
  if (note) parts.push(`<p class="size-guide-note">${escapeHtml(note)}</p>`)
  return parts.join('\n')
}

/** Build full page HTML from ordered sections (text + table blocks). */
export function sizeGuideSectionsToHtml(sections: ISizeGuideSection[]): string {
  if (!Array.isArray(sections) || sections.length === 0) return ''
  const parts: string[] = []
  for (const sec of sections) {
    if (sec.type === 'text') {
      const html = (sec.contentHtml || '').trim()
      if (html) parts.push(html)
    } else if (sec.type === 'table') {
      parts.push(renderTableToHtml(sec))
    }
  }
  return parts.join('\n\n').trim()
}
