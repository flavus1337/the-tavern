import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { log } from '../log.js';

export type GenKind = 'background' | 'prop';

// A bundled reference image per kind, fed to the model so every generation
// matches the same house style. Loaded once; missing files degrade gracefully
// to prompt-only.
const refCache = new Map<GenKind, string | null>();
function styleRef(kind: GenKind): string | null {
  if (refCache.has(kind)) return refCache.get(kind)!;
  const file = kind === 'background' ? 'style-ref-bg.png' : 'style-ref-prop.png';
  let b64: string | null = null;
  try {
    b64 = readFileSync(path.join(config.SERVER_ASSETS_DIR, file)).toString('base64');
  } catch {
    log.warn(`style reference ${file} not found — generating with prompt only`);
  }
  refCache.set(kind, b64);
  return b64;
}

export interface GeneratedImage {
  /** base64-encoded image bytes (no data: prefix) */
  base64: string;
  mimeType: string;
}

/**
 * The platform owns the style & format — the user supplies only the subject.
 * This is the fixed "inked battlemap" house style, written concretely so every
 * generation lands in the same look (perspective, ink, palette).
 */
const HOUSE_STYLE = [
  'ART STYLE — keep it identical every time:',
  'hand-illustrated "inked battlemap" look; STRICT orthographic top-down (straight bird\'s-eye) view with no perspective, tilt, or horizon;',
  'bold dark hand-inked outlines (~2–3px, slightly wobbly), flat bright daylight colours, light scribble/hatch shading, a few small highlight dots, and soft offset ground shadows with the light coming from the upper-left;',
  'palette: grass greens (#8bb551), dirt/sand browns (#b09665), water teal-blue (#4f9fb0), wood (#7a5532), stone grey (#a59b8c), dark ink outlines (#26431a / #3a3833);',
  'clean and readable; NO text, labels, lettering, UI, watermark, characters, creatures, or tokens; not photorealistic, not 3D-rendered.',
].join(' ');

function stylePrompt(kind: GenKind, subject: string): string {
  if (kind === 'background') {
    return `A square top-down tabletop RPG battlemap that fills the whole frame. Draw NO grid, NO squares and NO grid lines on it — the surface is clean (the app overlays its own grid). Keep the scale generous and uncluttered so a single creature comfortably fits in about a 1/40th-of-the-width area (do NOT cram in tiny detail). ${HOUSE_STYLE} Depict this place: ${subject}.`;
  }
  return `A single tabletop RPG map prop/object, centered, on a FULLY TRANSPARENT background (PNG cut-out with alpha) — no ground, no scene, no grid. ${HOUSE_STYLE} The object: ${subject}.`;
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
  const ref = styleRef(kind);
  // N independent calls — the image model returns one image per call.
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => geminiGenerateOne(prompt, ref).catch((e: unknown) => {
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

async function geminiGenerateOne(prompt: string, ref: string | null): Promise<GeneratedImage> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${config.LLM_API_KEY}`;
  // With a reference, copy its art style (not its content); otherwise prompt-only.
  const parts = ref
    ? [
        { inlineData: { mimeType: 'image/png', data: ref } },
        { text: `Copy the ART STYLE of the reference image EXACTLY — the same ink linework, flat colours, top-down view and palette — but draw the NEW subject described below, not the reference's content. ${prompt}` },
      ]
    : [{ text: prompt }];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
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
