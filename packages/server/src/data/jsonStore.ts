import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../log.js';

export class JsonFileStore<T> {
  private filePath: string;
  private data: T;
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(filePath: string, data: T) {
    this.filePath = filePath;
    this.data = data;
  }

  static async create<T>(filePath: string, initialValue: T): Promise<JsonFileStore<T>> {
    // Ensure parent directory exists.
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    let data: T;
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      data = JSON.parse(raw) as T;
    } catch (err: unknown) {
      if (isNotFound(err)) {
        data = initialValue;
      } else {
        throw err;
      }
    }

    return new JsonFileStore<T>(filePath, data);
  }

  get(): T {
    return this.data;
  }

  mutate(fn: (current: T) => T): void {
    this.data = fn(this.data);
    this.enqueueWrite();
  }

  private enqueueWrite(): void {
    this.writeQueue = this.writeQueue.then(() => this.atomicWrite()).catch((err: unknown) => {
      log.error(`JsonFileStore write error for ${this.filePath}: ${String(err)}`);
    });
  }

  private async atomicWrite(): Promise<void> {
    const tmpPath = this.filePath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.rename(tmpPath, this.filePath);
  }

  /** Wait for all pending writes to flush. */
  async flush(): Promise<void> {
    await this.writeQueue;
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
