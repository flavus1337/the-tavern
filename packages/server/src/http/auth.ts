import { Router } from 'express';
import type { Request, Response } from 'express';
import { createUser, login, validateUsername, findUserById } from '../auth/users.js';
import { createSession, setCookieHeader, clearCookieHeader, resolveSessionFromCookieHeader, deleteSession } from '../auth/sessions.js';
import { previewInvite, redeemInvite } from '../auth/invites.js';
import { requireAuth } from '../auth/middleware.js';
import type { RegisterResponse, LoginResponse, MeResponse } from '@vtt/shared';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  const { username, password, inviteToken } = req.body as {
    username?: string;
    password?: string;
    inviteToken?: string;
  };

  if (!username || !password || !inviteToken) {
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

  let user;
  try {
    user = await createUser(username, password, false);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'username_taken') {
      res.status(409).json({ error: 'Username already taken', code: 'USERNAME_TAKEN' });
      return;
    }
    res.status(400).json({ error: message });
    return;
  }

  // Redeem invite → adds membership.
  const redeemResult = redeemInvite(inviteToken, user.id);
  if (!redeemResult.ok) {
    // User was created but invite redemption failed. Return a 500.
    res.status(500).json({ error: 'Failed to redeem invite', code: 'REDEEM_FAILED' });
    return;
  }

  const session = await createSession(user.id);
  setCookieHeader(res, session.token);

  const body: RegisterResponse = {
    user: { id: user.id, username: user.username, isAdmin: user.isAdmin },
    joinedCampaignId: redeemResult.campaignId,
  };
  res.status(201).json(body);
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { username, password, inviteToken } = req.body as {
    username?: string;
    password?: string;
    inviteToken?: string;
  };

  if (!username || !password) {
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

  let joinedCampaignId: string | undefined;

  // Optional invite redeem on login.
  if (inviteToken) {
    const redeemResult = redeemInvite(inviteToken, result.user.id);
    if (redeemResult.ok) {
      joinedCampaignId = redeemResult.campaignId;
    }
  }

  const session = await createSession(result.user.id);
  setCookieHeader(res, session.token);

  const body: LoginResponse = {
    user: { id: result.user.id, username: result.user.username, isAdmin: result.user.isAdmin },
    joinedCampaignId,
  };
  res.status(200).json(body);
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req: Request, res: Response) => {
  const session = resolveSessionFromCookieHeader(req.headers.cookie);
  if (session) {
    deleteSession(session.token);
  }
  clearCookieHeader(res);
  res.status(204).send();
});

// GET /api/auth/me
router.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  const body: MeResponse = {
    user: { id: user.id, username: user.username, isAdmin: user.isAdmin },
  };
  res.status(200).json(body);
});

export default router;
