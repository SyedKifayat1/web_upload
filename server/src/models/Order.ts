import mongoose, { Document, Schema } from 'mongoose'

export interface IOrder extends Document {
  orderNumber: string
  /** Short 5-digit invoice number for display on tax invoice (e.g. "12345"). */
  invoiceNumber?: string
  user?: mongoose.Types.ObjectId
  /** Customer email for order confirmation and contact (from checkout contact step). */
  customerEmail?: string
  items: Array<{
    product: mongoose.Types.ObjectId
    name: string
    quantity: number
    price: number
    variants?: any
    /** Number of units returned by customer; restocked when return is recorded. */
    returnedQuantity?: number
  }>
  shippingAddress: {
    name: string
    street: string
    city: string
    state: string
    /** Area / district (e.g. for courier); also stored in zipCode for backward compatibility. */
    area?: string
    zipCode: string
    country: string
    phone?: string
  }
  billingAddress: {
    name: string
    street: string
    city: string
    state: string
    area?: string
    zipCode: string
    country: string
  }
  paymentMethod: string
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded'
  paymentIntentId?: string
  /** Tabby payment id (from Tabby API) when paymentMethod is 'tabby'. */
  tabbyPaymentId?: string
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'
  subtotal: number
  tax: number
  shipping: number
  shippingMethodName?: string
  /** Estimated delivery at order time (e.g. "5-7 business days") */
  shippingMethodDelivery?: string
  discount: number
  total: number
  coupon?: mongoose.Types.ObjectId
  notes?: string
  trackingNumber?: string
  shippedAt?: Date
  deliveredAt?: Date
  /** Pending item exchange: replace one order item with one or more new products (within exchange window). */
  pendingExchange?: {
    itemIndex: number
    quantityToReplace?: number
    oldItemTotal: number
    /** Single-item form (backward compat). */
    newProductId?: mongoose.Types.ObjectId
    newName?: string
    newVariant?: Record<string, string>
    newQty?: number
    newUnitPrice?: number
    newLineTotal?: number
    /** When replacing with multiple products. */
    newItems?: Array<{
      newProductId: mongoose.Types.ObjectId
      newName: string
      newVariant?: Record<string, string>
      newQty: number
      newUnitPrice: number
      newLineTotal: number
    }>
    priceDifference: number
  }
  /** Refund amount due to customer (e.g. after exchange to cheaper item). Process in 3–4 working days. */
  refundPending?: number
  /** Bank details for refund transfer. */
  refundBankDetails?: {
    accountHolderName: string
    bankName: string
    iban: string
  }
  /** Refund process stage — visible to customer so they can track progress. */
  refundStatus?: 'pending' | 'verified' | 'processing' | 'processed'
  /** When customer paid by card but chose to pay exchange difference on delivery. */
  balanceDueOnDelivery?: number
  /** Total amount actually received from customer (order payment + any exchange top-ups). Only updated when payment is confirmed. */
  totalPaidByCustomer?: number
  /** Total amount refunded to customer. Only updated when refund is processed. */
  totalRefundedToCustomer?: number
  /** Log of refunds (pending and processed) for audit; only appended/updated, never derived from calculation. */
  refundHistory?: Array<{
    amount: number
    createdAt: Date
    status: 'pending' | 'processed'
    processedAt?: Date
    note?: string
  }>
  createdAt: Date
  updatedAt: Date
}

const OrderSchema = new Schema<IOrder>(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    invoiceNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    customerEmail: { type: String, default: null },
    items: [
      {
        product: {
          type: Schema.Types.ObjectId,
          ref: 'Product',
          required: true,
        },
        name: String,
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        price: {
          type: Number,
          required: true,
        },
        variants: Schema.Types.Mixed,
        returnedQuantity: { type: Number, default: 0, min: 0 },
      },
    ],
    shippingAddress: {
      name: String,
      street: String,
      city: String,
      state: String,
      area: String,
      zipCode: String,
      country: String,
      phone: String,
    },
    billingAddress: {
      name: String,
      street: String,
      city: String,
      state: String,
      area: String,
      zipCode: String,
      country: String,
    },
    paymentMethod: {
      type: String,
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    paymentIntentId: String,
    tabbyPaymentId: String,
    status: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
    },
    subtotal: {
      type: Number,
      required: true,
    },
    tax: {
      type: Number,
      default: 0,
    },
    shipping: {
      type: Number,
      default: 0,
    },
    shippingMethodName: String,
    shippingMethodDelivery: String,
    discount: {
      type: Number,
      default: 0,
    },
    total: {
      type: Number,
      required: true,
    },
    coupon: {
      type: Schema.Types.ObjectId,
      ref: 'Coupon',
    },
    notes: String,
    trackingNumber: String,
    shippedAt: Date,
    deliveredAt: Date,
    pendingExchange: Schema.Types.Mixed,
    refundPending: Number,
    refundBankDetails: Schema.Types.Mixed,
    refundStatus: { type: String, enum: ['pending', 'verified', 'processing', 'processed'], default: undefined },
    balanceDueOnDelivery: Number,
    totalPaidByCustomer: { type: Number, default: 0 },
    totalRefundedToCustomer: { type: Number, default: 0 },
    refundHistory: [
      {
        amount: Number,
        createdAt: { type: Date, default: Date.now },
        status: { type: String, enum: ['pending', 'processed'], default: 'pending' },
        processedAt: Date,
        note: String,
      },
    ],
  },
  {
    timestamps: true,
  }
)

// Indexes
// Note: orderNumber index is automatically created by unique: true
OrderSchema.index({ user: 1 })
OrderSchema.index({ status: 1, createdAt: -1 })

export default mongoose.model<IOrder>('Order', OrderSchema)
