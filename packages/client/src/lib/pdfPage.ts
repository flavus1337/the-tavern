import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

/** Every render owns its canvas, so cancelling a resize cannot race the next render. */
export function renderPdfPage(
  pdf: PDFDocumentProxy, pageNumber: number, width: number, host: HTMLElement,
  onAspect: (aspect: number) => void, onError: () => void,
) {
  let cancelled = false;
  let page: PDFPageProxy | undefined;
  let task: RenderTask | undefined;
  let canvas: HTMLCanvasElement | undefined;
  const releaseCanvas = () => {
    if (!canvas) return;
    canvas.remove();
    canvas.width = canvas.height = 0;
  };
  const finished = (async () => {
    try {
      page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      onAspect(base.height / base.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: width / base.width * dpr });
      canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${width * base.height / base.width}px`;
      canvas.className = 'block rounded';
      canvas.setAttribute('aria-label', `Page ${pageNumber}`);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      host.append(canvas);
      task = page.render({ canvas, canvasContext: context, viewport });
      await task.promise;
    } catch {
      if (!cancelled) { releaseCanvas(); onError(); }
    } finally {
      // pdf.js defers cleanup if another render of this page is still active.
      page?.cleanup();
      if (cancelled) releaseCanvas();
    }
  })();
  return {
    finished,
    cancel() { cancelled = true; task?.cancel(); releaseCanvas(); },
  };
}
