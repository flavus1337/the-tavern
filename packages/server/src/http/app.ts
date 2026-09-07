import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { validateId } from './validate.js';
import { log } from '../log.js';
import { requireAuth } from '../auth/middleware.js';
import { previewInvite, redeemInvite } from '../auth/invites.js';
import { param } from './params.js';
import authRouter from './auth.js';
import campaignsRouter from './campaigns.js';
import uploadRouter from './upload.js';
import generateRouter from './generate.js';
import type { RedeemInviteResponse } from '@vtt/shared';
import { asyncRoute } from './asyncRoute.js';

export function createApp(): express.Application {
  const app = express();
  app.param('token', validateId);

  app.set('trust proxy', 1);
  // Image generation routes carry base64 bodies and bring their own larger JSON
  // parser — mounted before the global 1 MB parser so the scoped limit applies.
  app.use('/api/campaigns', generateRouter);
  // Bound JSON bodies (uploads use multipart, not JSON, so 1 MB is generous).
  app.use(express.json({ limit: '1mb' }));

  // Health check.
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Auth routes.
  app.use('/api/auth', authRouter);

  // Public invite preview.
  app.get('/api/invites/:token', (req: Request, res: Response) => {
    const token = param(req.params['token']);
    const preview = previewInvite(token);
    if (!preview.valid) {
      res.status(410).json(preview);
      return;
    }
    res.json(preview);
  });

  // Invite redeem (auth required).
  app.post('/api/invites/:token/redeem', requireAuth, asyncRoute(async (req: Request, res: Response) => {
    const token = param(req.params['token']);
    const result = await redeemInvite(token, req.user!.id);
    if (!result.ok) {
      const status =
        result.reason === 'expired' || result.reason === 'exhausted' || result.reason === 'revoked'
          ? 410
          : 400;
      res.status(status).json({ error: `Invite ${result.reason}`, code: result.reason.toUpperCase() });
      return;
    }
    const body: RedeemInviteResponse = { joinedCampaignId: result.campaignId };
    res.json(body);
  }));

  // Campaigns (includes file serving and asset management).
  app.use('/api/campaigns', campaignsRouter);

  // Upload routes.
  app.use('/api/campaigns', uploadRouter);

  // 404 for unknown /api routes.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Client static files + SPA fallback.
  if (fs.existsSync(config.CLIENT_DIST)) {
    app.use(express.static(config.CLIENT_DIST));
    app.get(/^(?!\/api).*/, (_req: Request, res: Response) => {
      const indexPath = path.join(config.CLIENT_DIST, 'index.html');
      res.sendFile(indexPath);
    });
  }

  // Final error handler — turns thrown/rejected errors in routes into a 500
  // instead of an unhandled rejection (which would crash the single process).
  // (Express forwards errors from sync throws and from `next(err)`.)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) { _next(err); return; }
    // Map known client errors (oversized body, multer file-size) to their real
    // status; everything else is a 500. Either way the process keeps running.
    const code = (err as { type?: string; code?: string } | null)?.type ?? (err as { code?: string } | null)?.code;
    const tooLarge = code === 'entity.too.large' || code === 'LIMIT_FILE_SIZE';
    const malformedJson = code === 'entity.parse.failed';
    const status = (err as { status?: number } | null)?.status;
    const clientError = typeof status === 'number' && status >= 400 && status < 500;
    if (!tooLarge && !malformedJson && !clientError) {
      log.error(`Request failed: ${err instanceof Error ? err.stack : String(err)}`);
    }
    res
      .status(tooLarge ? 413 : malformedJson ? 400 : clientError ? status : 500)
      .json({ error: tooLarge ? 'Payload too large' : malformedJson ? 'Invalid JSON body' :
        clientError && err instanceof Error ? err.message : 'Internal server error',
        ...(clientError && typeof code === 'string' ? { code } : {}),
      });
  });

  return app;
}
