import { Socket } from 'socket.io'

export interface ExtendedSocket extends Socket {
  userId?: string
  isAdmin?: boolean
  permissions?: string[]
}
