import { Request, Response, NextFunction } from 'express'

interface CustomError extends Error {
  statusCode?: number
  code?: number
}

const errorHandler = (
  err: CustomError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let error = { ...err }
  error.message = err.message

  // Log error
  console.error(err)

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found'
    error = { ...error, message, statusCode: 404 } as CustomError
  }

  // Mongoose duplicate key
  if ((err as any).code === 11000) {
    const message = 'Duplicate field value entered'
    error = { ...error, message, statusCode: 400 } as CustomError
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values((err as any).errors).map((val: any) => val.message).join(', ')
    error = { ...error, message, statusCode: 400 } as CustomError
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token'
    error = { ...error, message, statusCode: 401 } as CustomError
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired'
    error = { ...error, message, statusCode: 401 } as CustomError
  }

  res.status((error.statusCode as number) || 500).json({
    success: false,
    error: error.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
}

export default errorHandler
