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
  ADMIN_USER: process.env['ADMIN_USER'] ?? 'DM',
  ADMIN_PASSWORD: process.env['ADMIN_PASSWORD'] ?? null,
  COOKIE_SECURE: (process.env['COOKIE_SECURE'] ?? 'false') === 'true',
  PUBLIC_ORIGIN: process.env['PUBLIC_ORIGIN'] ?? 'http://localhost:8080',
  // Image generation (Map Creation, Gemini). When LLM_API_KEY is unset,
  // generation is disabled and the UI falls back to upload-only.
  LLM_API_KEY: process.env['LLM_API_KEY'] ?? null,
  // Bundled style-reference images for image generation.
  SERVER_ASSETS_DIR: path.join(REPO_ROOT, 'packages', 'server', 'assets'),
  CLIENT_DIST: resolveDir(
    process.env['CLIENT_DIST'],
    path.join(REPO_ROOT, 'packages', 'client', 'dist'),
  ),
} as const;
