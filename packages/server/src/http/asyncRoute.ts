import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Express 4 does not forward rejected route promises itself. */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve().then(() => handler(req, res, next)).catch(next);
  };
}
