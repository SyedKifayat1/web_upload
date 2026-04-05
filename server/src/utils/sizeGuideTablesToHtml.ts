import type { ISizeGuideTableData } from '../models/SizeGuide'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Convert structured size tables to HTML for the public size guide page. */
export function sizeGuideTablesToHtml(tables: ISizeGuideTableData[]): string {
  if (!Array.isArray(tables) || tables.length === 0) return ''
  const parts: string[] = []
  for (const t of tables) {
    const title = (t.title || '').trim()
    const subtitle = (t.subtitle || '').trim()
    const headers = Array.isArray(t.headers) ? t.headers.map((h: string) => String(h ?? '').trim()) : []
    const rows = Array.isArray(t.rows) ? t.rows : []
    if (!title && headers.length === 0) continue
    if (title) parts.push(`<h2>${escapeHtml(title)}</h2>`)
    if (subtitle) parts.push(`<p><strong>${escapeHtml(subtitle)}</strong></p>`)
    if (headers.length > 0) {
      parts.push('<div class="size-guide-table-wrap">')
      parts.push('<table>')
      parts.push('<thead><tr>')
      for (const h of headers) parts.push(`<th>${escapeHtml(h)}</th>`)
      parts.push('</tr></thead>')
      parts.push('<tbody>')
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
  }
  return parts.join('\n')
}
