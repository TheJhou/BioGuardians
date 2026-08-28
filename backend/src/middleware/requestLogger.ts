import type { NextFunction, Request, Response } from 'express';
import { logger } from '../telemetry/logger.js';

// Logs every /api request on response finish.
// Captures req.path BEFORE next() — Express restores req.path after mount
// once next() is called again, which a response-sending route never does.
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const path = req.path;
  if (path.startsWith('/api')) {
    const startTime = Date.now();
    res.on('finish', () => {
      const duration_ms = Date.now() - startTime;
      const meta = { method: req.method, path, status: res.statusCode, duration_ms };

      if (res.statusCode >= 500) {
        logger.error('http_request', meta);
      } else if (res.statusCode >= 400) {
        logger.warn('http_request', meta);
      } else {
        logger.info('http_request', meta);
      }
    });
  }
  next();
}
