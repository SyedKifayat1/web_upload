import mongoose, { Document, Schema } from 'mongoose'

export interface ISizeGuideTableData {
  title: string
  subtitle?: string
  note?: string
  headers: string[]
  rows: string[][]
}

/** One section: either rich text or one size table. Order of sections = order on page. */
export interface ISizeGuideSection {
  type: 'text' | 'table'
  contentHtml?: string
  title?: string
  subtitle?: string
  note?: string
  headers?: string[]
  rows?: string[][]
}

export interface ISizeGuide extends Document {
  key: string
  title: string
  /** Ordered sections (text + table blocks). When present, this defines the full page. */
  sections: ISizeGuideSection[]
  /** Legacy: kept for backward compatibility. Ignored when sections.length > 0. */
  contentHtml: string
  contentAfterHtml: string
  tableHtml: string
  tables: ISizeGuideTableData[]
  updatedAt: Date
  createdAt: Date
}

const SizeGuideSectionSchema = new Schema<ISizeGuideSection>(
  {
    type: { type: String, required: true, enum: ['text', 'table'] },
    contentHtml: { type: String, default: '' },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    note: { type: String, default: '' },
    headers: { type: [String], default: [] },
    rows: { type: [[String]], default: [] },
  },
  { _id: false }
)

const SizeGuideTableSchema = new Schema<ISizeGuideTableData>(
  {
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    note: { type: String, default: '' },
    headers: { type: [String], default: [] },
    rows: { type: [[String]], default: [] },
  },
  { _id: false }
)

const SizeGuideSchema = new Schema<ISizeGuide>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    title: { type: String, required: true, default: 'Size Guide' },
    sections: { type: [SizeGuideSectionSchema], default: [] },
    contentHtml: { type: String, default: '' },
    contentAfterHtml: { type: String, default: '' },
    tableHtml: { type: String, default: '' },
    tables: { type: [SizeGuideTableSchema], default: [] },
  },
  { timestamps: true }
)

export default mongoose.models.SizeGuide ||
  mongoose.model<ISizeGuide>('SizeGuide', SizeGuideSchema)
