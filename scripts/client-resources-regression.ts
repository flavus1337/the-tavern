import assert from 'node:assert/strict';
import { DiceScene } from '../packages/client/src/lib/dice3d';
import { renderPdfPage } from '../packages/client/src/lib/pdfPage';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from '../packages/client/node_modules/pdfjs-dist';
import { diceDelay, countDiceTotal, readDiceDisplay } from '../packages/client/src/lib/dicePlayback';
import { useStore } from '../packages/client/src/store';
import type { RollLogEntry } from '../packages/shared/src/index';

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function main() {
  const originals = { window: globalThis.window, document: globalThis.document,
    raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame,
    storage: globalThis.localStorage };
  const children = new Set<Canvas>();
  const allCanvases: Canvas[] = [];
  class Canvas {
    width = 300; height = 150; style = {}; className = '';
    setAttribute() {} getContext() { return new Proxy({}, { get: () => () => {} }); }
    remove() { children.delete(this); }
  }
  const host = { append: (canvas: Canvas) => children.add(canvas) } as unknown as HTMLElement;
  Object.assign(globalThis, {
    window: { devicePixelRatio: 2 },
    document: { createElement: () => { const canvas = new Canvas(); allCanvases.push(canvas); return canvas; } },
  });
  let cleanups = 0, errors = 0;
  const jobs: { canvas: Canvas; complete: ReturnType<typeof deferred>; cancelled: boolean }[] = [];
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    cleanup: () => { cleanups++; },
    render: ({ canvas }: { canvas: Canvas }) => {
      const complete = deferred();
      const job = { canvas, complete, cancelled: false };
      jobs.push(job);
      return { promise: complete.promise, cancel: () => { job.cancelled = true; complete.reject(new Error('cancelled')); } } as RenderTask;
    },
  } as unknown as PDFPageProxy;
  const pdf = { getPage: async () => page } as unknown as PDFDocumentProxy;
  const start = (width = 600) => renderPdfPage(pdf, 1, width, host, () => {}, () => { errors++; });
  const tick = () => Promise.resolve();
  try {
    // Resize starts a new canvas even before the old RenderTask rejection settles.
    const first = start(); await tick();
    const oldCanvas = jobs[0]!.canvas;
    first.cancel();
    const resized = start(400); await tick();
    assert.equal(jobs[0]!.cancelled, true);
    assert.notEqual(jobs[1]!.canvas, oldCanvas);
    assert.equal(oldCanvas.width * oldCanvas.height, 0);
    assert.equal(children.size, 1);
    jobs[1]!.complete.resolve(); await resized.finished; await first.finished;
    assert.equal(errors, 0, 'Cancelled PDF work does not report a page error');
    resized.cancel();
    assert.equal(children.size, 0);
    console.log('PASS PDF resize cancels old work, uses a fresh canvas and releases old backing pixels.');

    // Simulate visibility advancing through a 100-page document with a three-page window.
    const window: ReturnType<typeof start>[] = [];
    let peakPixels = 0;
    for (let index = 0; index < 100; index++) {
      const render = start(); window.push(render); await tick();
      jobs.at(-1)!.complete.resolve(); await render.finished;
      if (window.length > 3) window.shift()!.cancel();
      peakPixels = Math.max(peakPixels, allCanvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0));
      assert.equal(children.size, Math.min(index + 1, 3));
    }
    window.forEach((render) => render.cancel());
    assert.equal(peakPixels, 3 * 1200 * 1600);
    assert.equal(allCanvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0), 0);
    console.log('PASS 100 page lifecycle iterations retain only the three-page working set, then zero canvas pixels.');

    const waiting = deferred();
    const delayedPdf = { getPage: () => waiting.promise.then(() => page) } as unknown as PDFDocumentProxy;
    const countBefore = allCanvases.length;
    const delayed = renderPdfPage(delayedPdf, 9, 400, host, () => {}, () => { errors++; });
    delayed.cancel(); waiting.resolve(); await delayed.finished;
    assert.equal(allCanvases.length, countBefore);
    const failure = start(); await tick(); jobs.at(-1)!.complete.reject(new Error('render failed')); await failure.finished;
    assert.equal(errors, 1); assert.equal(children.size, 0); assert.ok(cleanups >= 100);
    console.log('PASS cancelled page fetch cannot allocate later; render failure releases the canvas and reports retry UI.');

    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } });
    assert.equal(readDiceDisplay(), 'compact');
    useStore.getState().setDiceDisplay('cinematic');
    assert.equal(readDiceDisplay(), 'cinematic');
    useStore.getState().resetTable();
    assert.equal(useStore.getState().diceDisplay, 'cinematic', 'Table reset preserves device preference');
    const roll = (id: string): RollLogEntry => ({ id, ts: '2026-09-08T12:00:00Z', userId: 'dm', username: 'DM', expression: '1d20', total: 12,
      visibility: 'public', parts: [{ kind: 'dice', count: 1, sides: 20, rolls: [12] }] });
    for (let i = 0; i < 10; i++) useStore.getState().addRollEntry(roll(String(i)));
    assert.equal(useStore.getState().rollLog.length, 10);
    assert.deepEqual(useStore.getState().rollQueue.map((entry) => entry.id), ['0']);
    assert.deepEqual(useStore.getState().rollToasts.map((entry) => entry.id), ['7', '8', '9']);
    useStore.getState().shiftRollQueue('old-completed-id');
    assert.equal(useStore.getState().rollQueue[0]?.id, '0');
    useStore.getState().shiftRollQueue('0');
    assert.equal(useStore.getState().rollQueue.length, 0);
    useStore.getState().showRollToast(roll('0'));
    assert.equal(useStore.getState().rollToasts.at(-1)?.id, '0', 'Failed cinematic result can return as a compact notification');
    useStore.getState().setDiceDisplay('instant');
    useStore.getState().addRollEntry(roll('instant'));
    assert.equal(useStore.getState().rollQueue.length, 0); assert.equal(useStore.getState().rollToasts.length, 0);
    assert.equal(useStore.getState().rollLog[0]?.id, 'instant');
    console.log('PASS persisted dice choices survive reset; ten rolls remain in log without a cinematic backlog; completion matches ID.');

    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    Object.assign(globalThis, { requestAnimationFrame: (fn: FrameRequestCallback) => { frames.set(++frameId, fn); return frameId; },
      cancelAnimationFrame: (id: number) => frames.delete(id) });
    const controller = new AbortController();
    const delay = diceDelay(60_000, controller.signal);
    const updates: number[] = [];
    const count = countDiceTotal(12, (value) => updates.push(value), controller.signal);
    controller.abort();
    const settled = await Promise.allSettled([delay, count]);
    assert.ok(settled.every((result) => result.status === 'rejected'));
    assert.equal(frames.size, 0); assert.deepEqual(updates, []);
    console.log('PASS dismissal aborts countdown and long waits immediately with no trailing frames.');

    // Exercise the real scene lifecycle with Three objects; only the GPU renderer is a stub.
    const threeUrl = new URL('../packages/client/node_modules/three/build/three.module.js', import.meta.url).href;
    const THREE = await import(threeUrl) as typeof import('../packages/client/node_modules/@types/three');
    let rendererDisposals = 0, contextLosses = 0, resourceDisposals = 0;
    const group = new THREE.Group();
    const scene = Object.create(DiceScene.prototype) as DiceScene;
    Object.assign(scene, { renderer: { render() {}, dispose() { rendererDisposals++; }, forceContextLoss() { contextLosses++; } },
      scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(32, 1, 0.1, 100), diceGroup: group, dice: [],
      raf: 0, disposed: false, finishSpin: null, finals: [], theme: 'bone' });
    const spinning = scene.roll({ sides: 20, theme: 'bone', finals: [12] });
    assert.ok(frames.size > 0);
    group.traverse((object) => {
      if (!('geometry' in object)) return;
      const mesh = object as InstanceType<typeof THREE.Mesh>;
      mesh.geometry.addEventListener('dispose', () => resourceDisposals++);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        material.addEventListener('dispose', () => resourceDisposals++);
        if ('map' in material && material.map) (material.map as InstanceType<typeof THREE.Texture>).addEventListener('dispose', () => resourceDisposals++);
      }
    });
    scene.dispose(); await spinning; scene.dispose();
    assert.equal(frames.size, 0); assert.equal(group.children.length, 0);
    assert.equal(rendererDisposals, 1); assert.equal(contextLosses, 1);
    assert.ok(resourceDisposals > 40, 'Dice faces, outlines, label geometry/materials/textures are explicitly disposed');
    console.log('PASS real Three scene disposal settles an active spin, cancels RAF and disposes GPU resources once.');
    const broken = Object.create(DiceScene.prototype) as DiceScene;
    Object.assign(broken, { renderer: { render() { throw new Error('GPU lost'); }, dispose() {}, forceContextLoss() {} },
      scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(32, 1, 0.1, 100), diceGroup: new THREE.Group(), dice: [],
      raf: 0, disposed: false, finishSpin: null, finals: [], theme: 'bone' });
    const failedSpin = broken.roll({ sides: 20, theme: 'bone', finals: [12] });
    const rejected = assert.rejects(failedSpin, /GPU lost/);
    for (const [id, frame] of frames) { frames.delete(id); frame(performance.now()); }
    await rejected; broken.dispose();
    assert.equal(frames.size, 0);
    console.log('PASS a GPU error inside the spin rejects promptly instead of leaving playback pending.');


  } finally {
    Object.assign(globalThis, { window: originals.window, document: originals.document,
      requestAnimationFrame: originals.raf, cancelAnimationFrame: originals.cancel });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originals.storage });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
