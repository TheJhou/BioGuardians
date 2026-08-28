import type { Request, Response, NextFunction } from 'express';
import { logger } from '../telemetry/logger.js';
import { errorCounter } from '../telemetry/metrics.js';

interface AppError extends Error {
  status?: number;
  code?: string;
}

// Centralized error handler. Catches PG errors, validation errors,
// and generic errors, returning a consistent JSON response.
export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.status || 500;
  const errorType = err.code || 'unknown';

  // Log and count every error.
  logger.error('unhandled_error', {
    method: req.method,
    path: req.path,
    status: statusCode,
    type: errorType,
    message: err.message,
  });

  errorCounter.add(1, { type: errorType, status: String(statusCode) });

  // PostgreSQL error codes
  if (err.code === '23505') {
    res.status(409).json({ error: 'Duplicate entry', detail: err.message });
    return;
  }
  if (err.code === '23503') {
    res.status(409).json({ error: 'Foreign key violation', detail: err.message });
    return;
  }
  if (err.code === '23514') {
    res.status(400).json({ error: 'Check constraint violation', detail: err.message });
    return;
  }
  if (err.code === '42P01' || err.code === '42703') {
    res.status(500).json({ error: 'Database schema error', detail: err.message });
    return;
  }

  res.status(statusCode).json({
    error: err.message || 'Internal server error',
  });
}
