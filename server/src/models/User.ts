import mongoose, { Document, Schema } from 'mongoose'
import bcrypt from 'bcryptjs'

export interface IUser extends Document {
  name: string
  email: string
  password: string
  isAdmin: boolean
  /** When true, can edit R2/storage credentials and assign super admin to others */
  isSuperAdmin: boolean
  permissions: string[]
  phone?: string
  addresses: Array<{
    type: 'billing' | 'shipping'
    street: string
    city: string
    state: string
    zipCode: string
    country: string
    isDefault: boolean
  }>
  createdAt: Date
  updatedAt: Date
  matchPassword(enteredPassword: string): Promise<boolean>
}

const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, 'Please add a name'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please add an email'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please add a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Please add a password'],
      minlength: 6,
      select: false,
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    isSuperAdmin: {
      type: Boolean,
      default: false,
    },
    permissions: {
      type: [String],
      default: [],
    },
    phone: {
      type: String,
      trim: true,
    },
    addresses: [
      {
        type: {
          type: String,
          enum: ['billing', 'shipping'],
          required: true,
        },
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: String,
        isDefault: Boolean,
      },
    ],
  },
  {
    timestamps: true,
  }
)

// Encrypt password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    next()
    return
  }

  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
})

// Match password method
UserSchema.methods.matchPassword = async function (enteredPassword: string) {
  return await bcrypt.compare(enteredPassword, this.password)
}

export default mongoose.model<IUser>('User', UserSchema)
