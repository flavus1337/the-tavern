import http from 'node:http';
import fs from 'node:fs/promises';
import { config } from './config.js';
import { log } from './log.js';
import { initUsersStore, seedAdmin } from './auth/users.js';
import { initSessionsStore } from './auth/sessions.js';
import { initMembershipsStore } from './auth/memberships.js';
import { initInvitesStore } from './auth/invites.js';
import { scanCampaigns, getAllCampaigns } from './campaign/registry.js';
import { createApp } from './http/app.js';
import { wss, handleUpgrade } from './ws/hub.js';

async function main(): Promise<void> {
  // Ensure data directory exists.
  await fs.mkdir(config.DATA_DIR, { recursive: true });

  // Initialize stores.
  await initUsersStore();
  await initSessionsStore();
  await initMembershipsStore();
  await initInvitesStore();

  // Seed admin user if needed.
  await seedAdmin();

  // Scan campaigns.
  await scanCampaigns();

  // Create express app.
  const app = createApp();
  const server = http.createServer(app);

  // Wire WS upgrade.
  server.on('upgrade', handleUpgrade);

  // Start listening.
  await new Promise<void>((resolve) => {
    server.listen(config.PORT, () => resolve());
  });

  const campaignCount = getAllCampaigns().size;

  log.info('');
  log.info('=== VTT Server Started ===');
  log.info(`Port:             ${config.PORT}`);
  log.info(`Public origin:    ${config.PUBLIC_ORIGIN}`);
  log.info(`Campaigns loaded: ${campaignCount}`);
  log.info(`Data dir:         ${config.DATA_DIR}`);
  log.info(`Campaigns dir:    ${config.CAMPAIGNS_DIR}`);
  log.info('=========================');
  log.info('');

  // Graceful shutdown.
  const shutdown = (): void => {
    log.info('Shutting down...');
    wss.close(() => {
      server.close(() => {
        log.info('Server closed');
        process.exit(0);
      });
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Single-process server: a stray rejection or throw must NOT take down everyone's
// session. Log and keep running. (Node would otherwise terminate on an
// unhandled rejection by default.)
process.on('unhandledRejection', (reason: unknown) => {
  log.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
});
process.on('uncaughtException', (err: unknown) => {
  log.error(`Uncaught exception: ${err instanceof Error ? err.stack : String(err)}`);
});

main().catch((err: unknown) => {
  log.error(`Fatal startup error: ${String(err)}`);
  process.exit(1);
});
