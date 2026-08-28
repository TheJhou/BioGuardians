import type { Request, Response, NextFunction } from 'express';

// Validates that :id param is a positive integer.
export function validateId(req: Request, res: Response, next: NextFunction): void {
  const raw = req.params.id;
  const id = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid id parameter: must be a positive integer' });
    return;
  }
  req.params.id = String(id);
  next();
}
