import { Request, Response, NextFunction } from 'express'

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const u = (req as Request & { user?: { isSuperAdmin?: boolean } }).user
  if (!u?.isSuperAdmin) {
    return res.status(403).json({
      success: false,
      error: 'Super admin access required',
    })
  }
  next()
}
