import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo root: packages/server/src -> packages/server -> packages -> root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function resolveDir(envVal: string | undefined, defaultRel: string): string {
  const raw = envVal ?? defaultRel;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

export const config = {
  PORT: parseInt(process.env['PORT'] ?? '8080', 10),
  DATA_DIR: resolveDir(process.env['DATA_DIR'], './data'),
  CAMPAIGNS_DIR: resolveDir(process.env['CAMPAIGNS_DIR'], './campaigns'),
  ADMIN_USER: process.env['ADMIN_USER'] ?? 'admin',
  ADMIN_PASSWORD: process.env['ADMIN_PASSWORD'] ?? null,
  COOKIE_SECURE: (process.env['COOKIE_SECURE'] ?? 'false') === 'true',
  PUBLIC_ORIGIN: process.env['PUBLIC_ORIGIN'] ?? 'http://localhost:8080',
  CLIENT_DIST: resolveDir(
    process.env['CLIENT_DIST'],
    path.join(REPO_ROOT, 'packages', 'client', 'dist'),
  ),
} as const;
