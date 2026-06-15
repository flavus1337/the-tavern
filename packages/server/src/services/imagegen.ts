import { config } from '../config.js';
import { log } from '../log.js';

export type GenKind = 'background' | 'prop';

export interface GeneratedImage {
  /** base64-encoded image bytes (no data: prefix) */
  base64: string;
  mimeType: string;
}

/**
 * The platform owns the style & format — the user supplies only the subject.
 * These system prompts encode the inked battlemap house look.
 */
function stylePrompt(kind: GenKind, subject: string): string {
  if (kind === 'background') {
    return [
      'Top-down tabletop RPG battlemap, viewed straight from above.',
      'Hand-inked illustrated style: bold dark ink outlines, flat-ish bright daylight colours, light scribble/hatch shading, soft cast shadows.',
      'Grid-ready and readable for play. No text, no labels, no UI, no characters, tokens, or creatures.',
      `The place: ${subject}.`,
    ].join(' ');
  }
  return [
    'A single top-down tabletop RPG map prop/object, viewed straight from above, centered.',
    'Hand-inked illustrated style: bold dark ink outline, flat bright colours, light shading.',
    'Fully TRANSPARENT background (PNG cut-out with alpha) — no scene, no ground, no grid, no text.',
    `The object: ${subject}.`,
  ].join(' ');
}

/**
 * Generate `n` candidate images for a subject via Gemini. Throws on misconfig
 * or provider error — callers map to HTTP 4xx/5xx.
 */
export async function generateImages(kind: GenKind, subject: string, n: number): Promise<GeneratedImage[]> {
  if (!config.LLM_API_KEY) {
    throw Object.assign(new Error('Image generation is not configured (LLM_API_KEY unset)'), { code: 'GEN_DISABLED' });
  }
  const prompt = stylePrompt(kind, subject.slice(0, 600));
  // N independent calls — the image model returns one image per call.
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => geminiGenerateOne(prompt).catch((e: unknown) => {
      log.warn(`imagegen take ${i} failed: ${String(e)}`);
      return null;
    })),
  );
  const ok = results.filter((r): r is GeneratedImage => r !== null);
  if (ok.length === 0) {
    throw Object.assign(new Error('The image provider returned no images'), { code: 'GEN_EMPTY' });
  }
  return ok;
}

// Google Gemini (Generative Language API) — image-capable model returns inline
// image data in candidates[].content.parts[].inlineData.
const GEMINI_MODEL = process.env['LLM_IMAGE_MODEL'] ?? 'gemini-2.5-flash-image';

async function geminiGenerateOne(prompt: string): Promise<GeneratedImage> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${config.LLM_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  };
  for (const cand of data.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return { base64: part.inlineData.data, mimeType: part.inlineData.mimeType ?? 'image/png' };
      }
    }
  }
  throw new Error('Gemini response contained no image');
}
