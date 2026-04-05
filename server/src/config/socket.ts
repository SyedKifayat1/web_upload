import { Server, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import { ExtendedSocket } from '../types/socket'
import SupportConversation from '../models/SupportConversation'

// Get JWT secret with proper typing
const JWT_SECRET: string = process.env.JWT_SECRET || 'your-secret-key'

let ioRef: Server | null = null

export const setupSocketIO = (io: Server) => {
  ioRef = io
  // Admin namespace
  const adminNamespace = io.of('/admin')

  // Authentication middleware for sockets
  adminNamespace.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token

      if (!token) {
        return next(new Error('Authentication error: No token provided'))
      }

      const decoded = jwt.verify(
        token,
        JWT_SECRET
      ) as any

      ;(socket as ExtendedSocket).userId = decoded.userId
      ;(socket as ExtendedSocket).isAdmin = decoded.isAdmin
      ;(socket as ExtendedSocket).permissions = decoded.permissions || []

      next()
    } catch (error) {
      next(new Error('Authentication error: Invalid token'))
    }
  })

  adminNamespace.on('connection', (socket: ExtendedSocket) => {
    console.log(`Admin connected: ${socket.userId}`)

    // Join admin room
    socket.join('admins')

    // Listen for order updates
    socket.on('order:status:update', (data) => {
      // Emit to all admins
      adminNamespace.to('admins').emit('order:status:changed', data)
    })

    // Listen for inventory updates
    socket.on('inventory:update', (data) => {
      adminNamespace.to('admins').emit('inventory:changed', data)
    })

    socket.on('disconnect', () => {
      console.log(`Admin disconnected: ${socket.userId}`)
    })
  })

  // Orders namespace (for order status updates)
  const ordersNamespace = io.of('/orders')

  ordersNamespace.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token

      if (token) {
        const decoded = jwt.verify(
          token,
          JWT_SECRET
        ) as any

        ;(socket as ExtendedSocket).userId = decoded.userId
      }

      next()
    } catch (error) {
      next()
    }
  })

  ordersNamespace.on('connection', (socket: ExtendedSocket) => {
    if (socket.userId) {
      socket.join(`user:${socket.userId}`)
    }

    socket.on('disconnect', () => {
      console.log('Client disconnected from orders namespace')
    })
  })

  // Default namespace: customer / admin join a support thread room
  io.on('connection', (socket) => {
    socket.on(
      'support:join',
      async (payload: {
        conversationId?: string
        visitorKey?: string
        customerToken?: string
        adminToken?: string
      }) => {
        const conversationId = payload?.conversationId
        if (!conversationId || typeof conversationId !== 'string') return
        try {
          const conv = await SupportConversation.findById(conversationId).lean()
          if (!conv) {
            socket.emit('support:error', { code: 'NOT_FOUND' })
            return
          }
          if (payload.adminToken) {
            try {
              const d = jwt.verify(payload.adminToken, JWT_SECRET) as { isAdmin?: boolean }
              if (!d.isAdmin) {
                socket.emit('support:error', { code: 'FORBIDDEN' })
                return
              }
            } catch {
              socket.emit('support:error', { code: 'FORBIDDEN' })
              return
            }
          } else if (conv.user) {
            try {
              if (!payload.customerToken) {
                socket.emit('support:error', { code: 'FORBIDDEN' })
                return
              }
              const d = jwt.verify(payload.customerToken, JWT_SECRET) as { userId?: string }
              if (String(conv.user) !== String(d.userId)) {
                socket.emit('support:error', { code: 'FORBIDDEN' })
                return
              }
            } catch {
              socket.emit('support:error', { code: 'FORBIDDEN' })
              return
            }
          } else {
            if (!payload.visitorKey || conv.visitorKey !== payload.visitorKey) {
              socket.emit('support:error', { code: 'FORBIDDEN' })
              return
            }
          }
          await socket.join(`support:${conversationId}`)
        } catch {
          socket.emit('support:error', { code: 'ERROR' })
        }
      }
    )

    socket.on('support:leave', (conversationId: unknown) => {
      if (typeof conversationId === 'string') void socket.leave(`support:${conversationId}`)
    })
  })

  // Store references for emit functions
  let adminNamespaceRef = adminNamespace
  let ordersNamespaceRef = ordersNamespace

  // Function to emit order created
  const emitOrderCreated = (orderId: string, orderNumber?: string, userId?: string) => {
    adminNamespaceRef.to('admins').emit('order:created', { orderId, orderNumber })
    if (userId) {
      ordersNamespaceRef.to(`user:${userId}`).emit('order:created', { orderId, orderNumber })
    }
  }

  // Function to emit order updates
  const emitOrderUpdate = (orderId: string, status: string, userId?: string) => {
    adminNamespaceRef.to('admins').emit('order:status:changed', { orderId, status })
    
    if (userId) {
      ordersNamespaceRef.to(`user:${userId}`).emit('order:status:changed', { orderId, status })
    }
  }

  // Function to emit inventory updates
  const emitInventoryUpdate = (productId: string, stock: number) => {
    adminNamespaceRef.to('admins').emit('inventory:changed', { productId, stock })
  }

  // Function to emit permission updates
  const emitPermissionUpdate = (payload: {
    userId: string
    permissions: string[]
    userName?: string
    userEmail?: string
  }) => {
    adminNamespaceRef.to('admins').emit('permission:changed', payload)
  }

  const emitSupportMessage = (conversationId: string, message: Record<string, unknown>) => {
    ioRef?.to(`support:${conversationId}`).emit('support:message', message)
  }

  const emitSupportInboxForAdmins = (meta: Record<string, unknown>) => {
    adminNamespaceRef.to('admins').emit('support:inbox', meta)
  }

  // Attach to global socket object for use in routes
  ;(global as any).socketEmitters = {
    emitOrderCreated,
    emitOrderUpdate,
    emitInventoryUpdate,
    emitPermissionUpdate,
    emitSupportMessage,
    emitSupportInboxForAdmins,
  }
}

// Export functions that will be set by setupSocketIO
export const emitOrderCreated = (orderId: string, orderNumber?: string, userId?: string) => {
  const emitters = (global as any).socketEmitters
  if (emitters?.emitOrderCreated) {
    emitters.emitOrderCreated(orderId, orderNumber, userId)
  }
}

export const emitOrderUpdate = (orderId: string, status: string, userId?: string) => {
  const emitters = (global as any).socketEmitters
  if (emitters?.emitOrderUpdate) {
    emitters.emitOrderUpdate(orderId, status, userId)
  }
}

export const emitInventoryUpdate = (productId: string, stock: number) => {
  const emitters = (global as any).socketEmitters
  if (emitters?.emitInventoryUpdate) {
    emitters.emitInventoryUpdate(productId, stock)
  }
}

export const emitPermissionUpdate = (payload: {
  userId: string
  permissions: string[]
  userName?: string
  userEmail?: string
  permissionsAdded: string[]
  permissionsRemoved: string[]
}) => {
  const emitters = (global as any).socketEmitters
  if (emitters?.emitPermissionUpdate) {
    emitters.emitPermissionUpdate(payload)
  }
}

export const emitSupportMessage = (conversationId: string, message: Record<string, unknown>) => {
  const emitters = (global as any).socketEmitters
  if (emitters?.emitSupportMessage) {
    emitters.emitSupportMessage(conversationId, message)
  }
}

export const emitSupportInboxForAdmins = (meta: Record<string, unknown>) => {
  const emitters = (global as any).socketEmitters
  if (emitters?.emitSupportInboxForAdmins) {
    emitters.emitSupportInboxForAdmins(meta)
  }
}
