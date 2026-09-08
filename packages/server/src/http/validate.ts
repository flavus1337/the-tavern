import type { Request, Response, NextFunction } from 'express';
import { isSafeId } from '@vtt/shared';
import type { Validator } from '@vtt/shared';

export function validateBody(value: unknown, check: Validator): void {
  if (!check(value)) throw Object.assign(new Error('Invalid request fields'), { status: 400, code: 'BAD_MESSAGE' });
}

export function validateId(_req: Request, _res: Response, next: NextFunction, value: string): void {
  next(isSafeId(value) ? undefined : Object.assign(new Error('Invalid identifier'), { status: 400, code: 'BAD_MESSAGE' }));
}
