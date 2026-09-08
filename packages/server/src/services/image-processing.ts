import { Worker } from 'node:worker_threads';
import type { ImageJob } from './image-worker.js';

const workers = new Set<Worker>();
const MAX_WORKERS = 2;

/** One worker per admitted image: no unbounded pool or waiting queue. */
export async function processImage(job: ImageJob, signal: AbortSignal): Promise<{ width: number; height: number }> {
  signal.throwIfAborted();
  if (workers.size >= MAX_WORKERS) throw Object.assign(new Error('Image processing is busy. Try again shortly.'), { status: 503 });
  const worker = new Worker(new URL(import.meta.url.endsWith('.ts') ? './image-worker.ts' : './image-worker.js', import.meta.url), { workerData: job });
  workers.add(worker);
  try {
    return await new Promise((resolve, reject) => {
      const aborted = () => reject(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      const timer = setTimeout(() => reject(new Error('Image processing timed out')), 30_000);
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); };
      worker.once('message', (message: { result?: { width: number; height: number }; error?: string }) => {
        cleanup();
        if (message.result) resolve(message.result);
        else reject(Object.assign(new Error(message.error ?? 'Invalid image'), { status: 400 }));
      });
      worker.once('error', (error) => { cleanup(); reject(error); });
      worker.once('exit', (code) => { cleanup(); reject(new Error(`Image worker exited (${code})`)); });
    });
  } finally {
    try { await worker.terminate(); } finally { workers.delete(worker); }
  }
}
