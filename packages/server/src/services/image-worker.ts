import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';

export interface ImageJob {
  sourcePath?: string;
  base64?: string;
  outputPath: string;
  transparent: boolean;
  quality: number;
}

async function processImage(job: ImageJob): Promise<{ width: number; height: number }> {
  const input = job.sourcePath ?? Buffer.from(job.base64!, 'base64');
  // Bound decoded input, then resize BEFORE allocating raw pixels or flood-fill
  // workspaces. Two workers cap concurrent decode/CPU work for this process.
  let image = sharp(input, { limitInputPixels: 40_000_000 }).resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true });
  if (job.transparent) {
    const { data: pixels, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const corners = [0, (w - 1) * 4, (h - 1) * w * 4, (h * w - 1) * 4];
    let red = 0, green = 0, blue = 0;
    for (const i of corners) { red += pixels[i]!; green += pixels[i + 1]!; blue += pixels[i + 2]!; }
    red /= 4; green /= 4; blue /= 4;
    const visited = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let size = 0;
    const add = (p: number): void => {
      if (visited[p]) return;
      visited[p] = 1;
      const i = p * 4;
      if (Math.abs(pixels[i]! - red) + Math.abs(pixels[i + 1]! - green) + Math.abs(pixels[i + 2]! - blue) > 100) return;
      pixels[i + 3] = 0;
      stack[size++] = p;
    };
    for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { add(y * w); add(y * w + w - 1); }
    while (size) {
      const p = stack[--size]!;
      const x = p % w, y = Math.floor(p / w);
      if (x > 0) add(p - 1);
      if (x < w - 1) add(p + 1);
      if (y > 0) add(p - w);
      if (y < h - 1) add(p + w);
    }
    image = sharp(pixels, { raw: { width: w, height: h, channels: 4 } });
  }
  const info = await image.webp({ quality: job.quality, alphaQuality: 90 }).toFile(job.outputPath);
  return { width: info.width, height: info.height };
}

void processImage(workerData as ImageJob).then(
  (result) => parentPort!.postMessage({ result }),
  (error: unknown) => parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }),
);
