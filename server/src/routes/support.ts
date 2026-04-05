import express from 'express'
import SupportConversation from '../models/SupportConversation'
import SupportMessage from '../models/SupportMessage'
import { optionalProtect, protect, checkPermission } from '../middleware/auth'
import { emitSupportInboxForAdmins, emitSupportMessage } from '../config/socket'

const router = express.Router()

const MAX_BODY = 4000

function preview(text: string, len = 120) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= len ? t : `${t.slice(0, len)}…`
}

async function findOrCreateConversation(
  visitorKey: string,
  user: { _id: unknown } | undefined,
  guestName?: string,
  guestEmail?: string
) {
  if (user?._id) {
    let conv = await SupportConversation.findOne({ user: user._id, status: 'open' })
    if (!conv) {
      conv = await SupportConversation.create({
        user: user._id,
        visitorKey,
        guestName,
        guestEmail,
        status: 'open',
        lastMessageAt: new Date(),
        lastMessagePreview: '',
      })
    } else if (guestName || guestEmail) {
      if (guestName) conv.guestName = guestName
      if (guestEmail) conv.guestEmail = guestEmail
      await conv.save()
    }
    return conv
  }

  let conv = await SupportConversation.findOne({
    visitorKey,
    user: null,
    status: 'open',
  })
  if (!conv) {
    conv = await SupportConversation.create({
      user: null,
      visitorKey,
      guestName,
      guestEmail,
      status: 'open',
      lastMessageAt: new Date(),
      lastMessagePreview: '',
    })
  } else if (guestName || guestEmail) {
    if (guestName) conv.guestName = guestName
    if (guestEmail) conv.guestEmail = guestEmail
    await conv.save()
  }
  return conv
}

async function assertCustomerAccess(
  conv: { _id: unknown; user: unknown; visitorKey: string },
  visitorKey: string | undefined,
  user: { _id: unknown } | undefined
) {
  if (conv.user) {
    if (!user?._id || String(conv.user) !== String(user._id)) {
      return false
    }
    return true
  }
  return Boolean(visitorKey && conv.visitorKey === visitorKey)
}

// @route   POST /api/v1/support/session
// @desc    Start or resume open support chat (guest or logged-in customer)
// @access  Public (optional auth)
router.post('/session', optionalProtect, async (req: any, res, next) => {
  try {
    const { visitorKey, guestName, guestEmail } = req.body || {}
    if (!visitorKey || typeof visitorKey !== 'string' || visitorKey.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'visitorKey is required (min 8 characters)',
      })
    }

    const conv = await findOrCreateConversation(
      visitorKey.trim(),
      req.user,
      typeof guestName === 'string' ? guestName.trim().slice(0, 120) : undefined,
      typeof guestEmail === 'string' ? guestEmail.trim().slice(0, 254) : undefined
    )

    const messages = await SupportMessage.find({ conversation: conv._id })
      .sort({ createdAt: -1 })
      .limit(80)
      .lean()

    res.json({
      success: true,
      data: {
        conversationId: conv._id.toString(),
        visitorKey: conv.visitorKey,
        status: conv.status,
        guestName: conv.guestName,
        guestEmail: conv.guestEmail,
        unreadByCustomer: conv.unreadByCustomer,
        messages: messages.reverse().map((m) => ({
          id: m._id.toString(),
          senderRole: m.senderRole,
          body: m.body,
          createdAt: m.createdAt,
        })),
      },
    })
  } catch (e) {
    next(e)
  }
})

// @route   GET /api/v1/support/conversations/:id/messages
// @access  Public + ownership (visitorKey or customer JWT)
router.get('/conversations/:id/messages', optionalProtect, async (req: any, res, next) => {
  try {
    const conv = await SupportConversation.findById(req.params.id)
    if (!conv) {
      return res.status(404).json({ success: false, error: 'Conversation not found' })
    }

    const visitorKey = typeof req.query.visitorKey === 'string' ? req.query.visitorKey : undefined
    const ok = await assertCustomerAccess(conv, visitorKey, req.user)
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Access denied' })
    }

    const messages = await SupportMessage.find({ conversation: conv._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()

    res.json({
      success: true,
      data: messages.reverse().map((m) => ({
        id: m._id.toString(),
        senderRole: m.senderRole,
        body: m.body,
        createdAt: m.createdAt,
      })),
    })
  } catch (e) {
    next(e)
  }
})

// @route   POST /api/v1/support/conversations/:id/messages
// @access  Customer / guest
router.post('/conversations/:id/messages', optionalProtect, async (req: any, res, next) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    if (!text || text.length > MAX_BODY) {
      return res.status(400).json({
        success: false,
        error: `Message required (max ${MAX_BODY} characters)`,
      })
    }

    const conv = await SupportConversation.findById(req.params.id)
    if (!conv || conv.status !== 'open') {
      return res.status(404).json({ success: false, error: 'Conversation not found or closed' })
    }

    const visitorKey = typeof req.body?.visitorKey === 'string' ? req.body.visitorKey : undefined
    const ok = await assertCustomerAccess(conv, visitorKey, req.user)
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Access denied' })
    }

    const msg = await SupportMessage.create({
      conversation: conv._id,
      senderRole: 'customer',
      senderUser: null,
      body: text,
    })

    conv.lastMessageAt = new Date()
    conv.lastMessagePreview = preview(text)
    conv.unreadByAdmin = (conv.unreadByAdmin || 0) + 1
    await conv.save()

    const payload = {
      id: msg._id.toString(),
      conversationId: conv._id.toString(),
      senderRole: 'customer' as const,
      body: msg.body,
      createdAt: msg.createdAt,
    }

    emitSupportMessage(conv._id.toString(), payload as unknown as Record<string, unknown>)
    emitSupportInboxForAdmins({
      eventKind: 'customer_message',
      conversationId: conv._id.toString(),
      lastMessagePreview: conv.lastMessagePreview,
      lastMessageAt: conv.lastMessageAt,
      unreadByAdmin: conv.unreadByAdmin,
      guestName: conv.guestName,
      guestEmail: conv.guestEmail,
      userId: conv.user?.toString() ?? null,
    })

    res.status(201).json({ success: true, data: payload })
  } catch (e) {
    next(e)
  }
})

// @route   POST /api/v1/support/conversations/:id/read-customer
// @desc    Mark messages as read for customer (clears unread badge server-side)
router.post('/conversations/:id/read-customer', optionalProtect, async (req: any, res, next) => {
  try {
    const conv = await SupportConversation.findById(req.params.id)
    if (!conv) {
      return res.status(404).json({ success: false, error: 'Not found' })
    }
    const visitorKey = typeof req.body?.visitorKey === 'string' ? req.body.visitorKey : undefined
    const ok = await assertCustomerAccess(conv, visitorKey, req.user)
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Access denied' })
    }
    conv.unreadByCustomer = 0
    await conv.save()
    res.json({ success: true })
  } catch (e) {
    next(e)
  }
})

// --- Admin ---

// @route   GET /api/v1/support/admin/conversations
router.get(
  '/admin/conversations',
  protect,
  checkPermission('support:view'),
  async (req, res, next) => {
    try {
      const status = req.query.status === 'closed' ? 'closed' : req.query.status === 'all' ? 'all' : 'open'
      const q: Record<string, unknown> = {}
      if (status !== 'all') q.status = status

      const list = await SupportConversation.find(q)
        .populate('user', 'name email')
        .sort({ lastMessageAt: -1 })
        .limit(200)
        .lean()

      res.json({
        success: true,
        data: list.map((c) => ({
          id: c._id.toString(),
          status: c.status,
          guestName: c.guestName,
          guestEmail: c.guestEmail,
          visitorKey: c.visitorKey,
          user: c.user,
          lastMessageAt: c.lastMessageAt,
          lastMessagePreview: c.lastMessagePreview,
          unreadByAdmin: c.unreadByAdmin,
          unreadByCustomer: c.unreadByCustomer,
        })),
      })
    } catch (e) {
      next(e)
    }
  }
)

// @route   GET /api/v1/support/admin/conversations/:id/messages
router.get(
  '/admin/conversations/:id/messages',
  protect,
  checkPermission('support:view'),
  async (req, res, next) => {
    try {
      const conv = await SupportConversation.findById(req.params.id)
      if (!conv) {
        return res.status(404).json({ success: false, error: 'Not found' })
      }

      const messages = await SupportMessage.find({ conversation: conv._id })
        .sort({ createdAt: -1 })
        .limit(200)
        .populate('senderUser', 'name email')
        .lean()

      res.json({
        success: true,
        data: messages.reverse().map((m) => ({
          id: m._id.toString(),
          senderRole: m.senderRole,
          body: m.body,
          createdAt: m.createdAt,
          senderUser: m.senderUser,
        })),
      })
    } catch (e) {
      next(e)
    }
  }
)

// @route   POST /api/v1/support/admin/conversations/:id/messages
router.post(
  '/admin/conversations/:id/messages',
  protect,
  checkPermission('support:view'),
  async (req: any, res, next) => {
    try {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
      if (!text || text.length > MAX_BODY) {
        return res.status(400).json({
          success: false,
          error: `Message required (max ${MAX_BODY} characters)`,
        })
      }

      const conv = await SupportConversation.findById(req.params.id)
      if (!conv) {
        return res.status(404).json({ success: false, error: 'Not found' })
      }

      const msg = await SupportMessage.create({
        conversation: conv._id,
        senderRole: 'admin',
        senderUser: req.user._id,
        body: text,
      })

      conv.lastMessageAt = new Date()
      conv.lastMessagePreview = preview(text)
      conv.unreadByCustomer = (conv.unreadByCustomer || 0) + 1
      await conv.save()

      const payload = {
        id: msg._id.toString(),
        conversationId: conv._id.toString(),
        senderRole: 'admin' as const,
        body: msg.body,
        createdAt: msg.createdAt,
        senderUser: { _id: req.user?._id, name: req.user?.name, email: req.user?.email },
      }

      emitSupportMessage(conv._id.toString(), payload as unknown as Record<string, unknown>)
      emitSupportInboxForAdmins({
        eventKind: 'admin_reply',
        conversationId: conv._id.toString(),
        lastMessagePreview: conv.lastMessagePreview,
        lastMessageAt: conv.lastMessageAt,
        unreadByAdmin: conv.unreadByAdmin,
        unreadByCustomer: conv.unreadByCustomer,
      })

      res.status(201).json({ success: true, data: payload })
    } catch (e) {
      next(e)
    }
  }
)

// @route   PATCH /api/v1/support/admin/conversations/:id
router.patch(
  '/admin/conversations/:id',
  protect,
  checkPermission('support:view'),
  async (req, res, next) => {
    try {
      const conv = await SupportConversation.findById(req.params.id)
      if (!conv) {
        return res.status(404).json({ success: false, error: 'Not found' })
      }

      if (req.body?.status === 'closed' || req.body?.status === 'open') {
        conv.status = req.body.status
      }
      if (req.body?.markAdminRead === true) {
        conv.unreadByAdmin = 0
      }
      if (req.body?.markCustomerRead === true) {
        conv.unreadByCustomer = 0
      }
      await conv.save()

      emitSupportInboxForAdmins({
        eventKind: 'update',
        conversationId: conv._id.toString(),
        lastMessagePreview: conv.lastMessagePreview,
        lastMessageAt: conv.lastMessageAt,
        unreadByAdmin: conv.unreadByAdmin,
        unreadByCustomer: conv.unreadByCustomer,
        status: conv.status,
      })

      res.json({
        success: true,
        data: {
          id: conv._id.toString(),
          status: conv.status,
          unreadByAdmin: conv.unreadByAdmin,
          unreadByCustomer: conv.unreadByCustomer,
        },
      })
    } catch (e) {
      next(e)
    }
  }
)

export default router
