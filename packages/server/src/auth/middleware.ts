import type { Request, Response, NextFunction } from 'express';
import { resolveSessionFromCookieHeader } from './sessions.js';
import { findUserById } from './users.js';
import { getRole } from './memberships.js';
import { getCampaign } from '../campaign/registry.js';
import { param } from '../http/params.js';
import type { UserRecord } from './users.js';
import type { Role } from '@vtt/shared';

// Extend Express Request with auth context.
declare global {
  namespace Express {
    interface Request {
      user?: UserRecord;
      campaignRole?: Role;
    }
  }
}

function getCookieToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const pair of header.split(';')) {
    const [rawName, ...rest] = pair.split('=');
    if (!rawName) continue;
    if (rawName.trim() === 'vtt_session') return rest.join('=').trim();
  }
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = resolveSessionFromCookieHeader(req.headers.cookie);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }
  const user = findUserById(session.userId);
  if (!user) {
    res.status(401).json({ error: 'User not found', code: 'UNAUTHORIZED' });
    return;
  }
  req.user = user;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: 'Admin required', code: 'FORBIDDEN' });
      return;
    }
    next();
  });
}

export function requireMember(roleNeeded?: 'dm') {
  return (req: Request, res: Response, next: NextFunction): void => {
    requireAuth(req, res, () => {
      const campaignId = param(req.params['id']);
      if (!campaignId) {
        res.status(400).json({ error: 'Missing campaign id' });
        return;
      }

      const campaign = getCampaign(campaignId);
      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found', code: 'NOT_FOUND' });
        return;
      }

      const user = req.user!;
      const role = getRole(campaignId, user.id);

      if (!role) {
        // Return 404 — same shape as unknown campaign — so non-members cannot
        // distinguish an existing campaign from a non-existent one.
        res.status(404).json({ error: 'Campaign not found', code: 'NOT_FOUND' });
        return;
      }

      if (roleNeeded === 'dm' && role !== 'dm') {
        res.status(403).json({ error: 'DM role required', code: 'FORBIDDEN' });
        return;
      }

      req.campaignRole = role;
      next();
    });
  };
}
