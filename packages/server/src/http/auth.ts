import { Router } from 'express';
import type { Request, Response } from 'express';
import { createUserWithPasswordHash, login, validateUsername } from '../auth/users.js';
import { createSession, setCookieHeader, clearCookieHeader, resolveSessionFromCookieHeader, deleteSession } from '../auth/sessions.js';
import { previewInvite, redeemInvite } from '../auth/invites.js';
import { requireAuth } from '../auth/middleware.js';
import type { RegisterResponse, LoginResponse, MeResponse } from '@vtt/shared';
import { asyncRoute } from './asyncRoute.js';
import { hashPassword } from '../auth/passwords.js';
import { withCampaignFiles } from '../campaign/commit.js';
import { config } from '../config.js';

const router = Router();

// POST /api/auth/register
router.post('/register', asyncRoute(async (req: Request, res: Response) => {
  const { username, password, inviteToken } = (req.body ?? {}) as {
    username?: unknown;
    password?: unknown;
    inviteToken?: unknown;
  };

  if (typeof username !== 'string' || !username || username.length > 128 ||
      typeof password !== 'string' || !password || password.length > 1024 ||
      typeof inviteToken !== 'string' || !inviteToken || inviteToken.length > 256) {
    res.status(400).json({ error: 'username, password, and inviteToken are required' });
    return;
  }

  // Validate invite first.
  const preview = previewInvite(inviteToken);
  if (!preview.valid) {
    const status =
      preview.reason === 'expired' || preview.reason === 'exhausted' || preview.reason === 'revoked'
        ? 410
        : 400;
    res.status(status).json({ error: `Invite ${preview.reason}`, code: preview.reason.toUpperCase() });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters', code: 'PASSWORD_TOO_SHORT' });
    return;
  }

  const usernameValidation = validateUsername(username);
  if (!usernameValidation.ok) {
    res.status(400).json({ error: usernameValidation.reason, code: 'INVALID_USERNAME' });
    return;
  }

  // Hash before entering the file queue so other authentication work can proceed.
  const passwordHash = await hashPassword(password);
  let registration;
  try {
    registration = await withCampaignFiles(config.DATA_DIR, async () => {
      const user = await createUserWithPasswordHash(username, passwordHash, false);
      const redemption = await redeemInvite(inviteToken, user.id);
      if (!redemption.ok) {
        throw Object.assign(new Error(`Invite ${redemption.reason}`), {
          status: ['expired', 'exhausted', 'revoked'].includes(redemption.reason) ? 410 : 400,
          code: redemption.reason.toUpperCase(),
        });
      }
      const session = await createSession(user.id);
      return { user, session, campaignId: redemption.campaignId };
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'username_taken') {
      res.status(409).json({ error: 'Username already taken', code: 'USERNAME_TAKEN' });
      return;
    }
    throw err;
  }

  const { user, session, campaignId } = registration;
  setCookieHeader(res, session.token);

  const body: RegisterResponse = {
    user: { id: user.id, username: user.username, isAdmin: user.isAdmin },
    joinedCampaignId: campaignId,
  };
  res.status(201).json(body);
}));

// POST /api/auth/login
router.post('/login', asyncRoute(async (req: Request, res: Response) => {
  const { username, password, inviteToken } = (req.body ?? {}) as {
    username?: unknown;
    password?: unknown;
    inviteToken?: unknown;
  };

  if (typeof username !== 'string' || !username || username.length > 128 ||
      typeof password !== 'string' || !password || password.length > 1024 ||
      (inviteToken != null && (typeof inviteToken !== 'string' || inviteToken.length > 256))) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const result = await login(username, password);

  if (!result.ok) {
    if (result.reason === 'locked') {
      res.status(429).json({
        error: 'Account temporarily locked due to too many failed attempts',
        code: 'LOCKED',
        lockedForSeconds: result.lockedForSeconds,
      });
      return;
    }
    res.status(401).json({ error: 'Invalid username or password', code: 'INVALID_CREDENTIALS' });
    return;
  }

  const { joinedCampaignId, session } = await withCampaignFiles(config.DATA_DIR, async () => {
    let joinedCampaignId: string | undefined;
    // Optional invite redemption and the session commit together.
    if (inviteToken) {
      const redeemResult = await redeemInvite(inviteToken, result.user.id);
      if (redeemResult.ok) joinedCampaignId = redeemResult.campaignId;
    }
    return { joinedCampaignId, session: await createSession(result.user.id) };
  });
  setCookieHeader(res, session.token);

  const body: LoginResponse = {
    user: { id: result.user.id, username: result.user.username, isAdmin: result.user.isAdmin },
    joinedCampaignId,
  };
  res.status(200).json(body);
}));

// POST /api/auth/logout
router.post('/logout', requireAuth, asyncRoute(async (req: Request, res: Response) => {
  const session = resolveSessionFromCookieHeader(req.headers.cookie);
  if (session) {
    await deleteSession(session.token);
  }
  clearCookieHeader(res);
  res.status(204).send();
}));

// GET /api/auth/me
router.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  const body: MeResponse = {
    user: { id: user.id, username: user.username, isAdmin: user.isAdmin },
  };
  res.status(200).json(body);
});

export default router;
