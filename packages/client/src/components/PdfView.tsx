import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useFrameState } from '../lib/frame';
import { renderPdfPage } from '../lib/pdfPage';

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
  const [width, widthFrame] = useFrameState(0);

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
    widthFrame.set(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) widthFrame.set(Math.floor(w));
    });
    ro.observe(el);
    return () => { ro.disconnect(); widthFrame.cancel(); };
  }, [widthFrame]);

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
            <PdfPage key={i + 1} pdf={pdf} pageNumber={i + 1} width={Math.max(1, Math.min(width - 24, 1100))} />
          ))}
        </div>
      )}
    </div>
  );
}

function PdfPage({ pdf, pageNumber, width }: { pdf: PDFDocumentProxy; pageNumber: number; width: number }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [aspect, setAspect] = useState(11 / 8.5);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    // Use the viewport and its ancestor clipping: DocumentViewer owns scrolling,
    // while PdfView's own overflow element can grow to the full document height.
    const io = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '500px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !canvasHostRef.current) return;
    setFailed(false);
    const render = renderPdfPage(pdf, pageNumber, width, canvasHostRef.current, setAspect, () => setFailed(true));
    return () => render.cancel();
  }, [visible, pdf, pageNumber, width]);

  return (
    <div ref={wrapperRef} className="bg-white rounded shadow-lg relative shrink-0"
      style={{ width, height: width * aspect }}>
      <div ref={canvasHostRef} />
      {failed && <p role="status" className="absolute inset-0 flex items-center justify-center p-4 text-sm text-stone-700">
        Page {pageNumber} could not be rendered. Scroll away and back to retry, or download the PDF.
      </p>}
    </div>
  );
}
