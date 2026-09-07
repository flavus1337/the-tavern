import fs from 'node:fs/promises';
import path from 'node:path';
import { commitValue, recoverCampaign, updateCampaignMemory, withCampaignFiles, writeCampaignFile } from '../campaign/commit.js';

export class JsonFileStore<T> {
  private filePath: string;
  private data: T;

  private constructor(filePath: string, data: T) {
    this.filePath = filePath;
    this.data = data;
  }

  static async create<T>(filePath: string, initialValue: T): Promise<JsonFileStore<T>> {
    // Ensure parent directory exists.
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    return withCampaignFiles(path.dirname(filePath), async () => {
      await recoverCampaign(path.dirname(filePath));
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
    });
  }

  get(): T {
    return commitValue(this, { data: this.data }).data;
  }

  mutate(fn: (current: T) => T): Promise<void> {
    const dir = path.dirname(this.filePath);
    return withCampaignFiles(dir, async () => {
      // The callback runs after preceding commits; its candidate cannot mutate
      // confirmed data if either the callback or persistence fails.
      const draft = commitValue(this, { data: this.data });
      const candidate = fn(structuredClone(draft.data));
      await writeCampaignFile(dir, this.filePath, JSON.stringify(candidate, null, 2));
      draft.data = candidate;
      updateCampaignMemory(() => { this.data = candidate; });
    });
  }

  /** Wait for all pending writes to flush. */
  async flush(): Promise<void> {
    await withCampaignFiles(path.dirname(this.filePath), async () => {});
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
