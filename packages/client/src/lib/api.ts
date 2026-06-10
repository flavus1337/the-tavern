import type { ApiError } from '@vtt/shared';
import { useStore } from '../store';

export class ApiRequestError extends Error {
  status: number;
  code: string | undefined;
  lockedForSeconds: number | undefined;

  constructor(status: number, message: string, code?: string, lockedForSeconds?: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.lockedForSeconds = lockedForSeconds;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    // Signal unauthenticated globally
    useStore.getState().setUnauthenticated();
    const body = await res.json().catch(() => ({})) as Partial<ApiError>;
    throw new ApiRequestError(401, body.error ?? 'Unauthorized', body.code, body.lockedForSeconds);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Partial<ApiError>;
    throw new ApiRequestError(
      res.status,
      body.error ?? `HTTP ${res.status}`,
      body.code,
      body.lockedForSeconds,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

const api = {
  async get<T>(path: string): Promise<T> {
    const res = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse<T>(res);
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  async del<T>(path: string): Promise<T> {
    const res = await fetch(path, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    return handleResponse<T>(res);
  },
};

export async function apiUpload<T>(
  path: string,
  file: File,
  fields?: Record<string, string>,
): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value);
    }
  }
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    body: form,
  });
  return handleResponse<T>(res);
}

export { api };
