import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Canvas-based PDF renderer (pdf.js) — works in every browser context,
 * including embedded webviews without a native PDF plugin. Pages render
 * lazily as they scroll into view.
 */
export function PdfView({ url, title }: { url: string; title: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setPdf(null);
    setError(null);

    const task = getDocument({ url, withCredentials: true });
    task.promise
      .then((d) => {
        if (!cancelled) setPdf(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      // Destroying the loading task also destroys the document and worker channel.
      void task.destroy().catch(() => undefined);
    };
  }, [url]);

  // Track container width so pages fit it (re-render on resize).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 overflow-y-auto"
      style={{ background: 'var(--bg)' }}
    >
      {error && (
        <div className="flex flex-col items-center justify-center gap-2 py-16">
          <p className="text-sm" style={{ color: 'var(--garnet)' }}>Could not load PDF: {error}</p>
          <a
            href={url}
            className="text-sm hover:underline"
            style={{ color: 'var(--ember)' }}
            download
          >
            Download {title}
          </a>
        </div>
      )}
      {!error && !pdf && (
        <p className="text-sm text-center py-16 animate-pulse" style={{ color: 'var(--faint)' }}>Loading PDF…</p>
      )}
      {pdf && width > 0 && (
        <div className="flex flex-col items-center gap-3 p-3">
          {Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfPage key={i + 1} pdf={pdf} pageNumber={i + 1} width={Math.min(width - 24, 1100)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PdfPage({ pdf, pageNumber, width }: { pdf: PDFDocumentProxy; pageNumber: number; width: number }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 2); // first pages render eagerly
  const [aspect, setAspect] = useState(11 / 8.5); // letter portrait until measured

  useEffect(() => {
    if (visible) return;
    const el = wrapperRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '800px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        setAspect(base.height / base.width);
        const scale = width / base.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * dpr });

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      } catch {
        // Page render errors are non-fatal; the placeholder stays.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, pdf, pageNumber, width]);

  return (
    <div
      ref={wrapperRef}
      className="bg-white rounded shadow-lg"
      style={{ width, minHeight: visible ? undefined : width * aspect }}
    >
      <canvas ref={canvasRef} className="block rounded" aria-label={`Page ${pageNumber}`} />
    </div>
  );
}
