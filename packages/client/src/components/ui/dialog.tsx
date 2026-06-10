import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

interface DialogContextValue {
  open: boolean;
  onClose: () => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('Dialog components must be used inside <Dialog>');
  return ctx;
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ open, onClose, children }: DialogProps) {
  return (
    <DialogContext.Provider value={{ open, onClose }}>
      {children}
    </DialogContext.Provider>
  );
}

interface DialogContentProps {
  className?: string;
  children: ReactNode;
  title?: string;
}

export function DialogContent({ className, children, title }: DialogContentProps) {
  const { open, onClose } = useDialogContext();
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Trap focus
  useEffect(() => {
    if (!open) return;
    const el = contentRef.current;
    if (!el) return;

    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        if (focusable.length === 0) { e.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Lock body scroll
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />

      {/* Panel */}
      <div
        ref={contentRef}
        className={cn(
          'relative z-10 w-full max-w-md bg-zinc-900 border border-zinc-800',
          'rounded-xl shadow-2xl p-6',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

interface DialogHeaderProps {
  title: string;
  onClose?: () => void;
}

export function DialogHeader({ title, onClose }: DialogHeaderProps) {
  const { onClose: ctxClose } = useDialogContext();
  const close = onClose ?? ctxClose;
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
      <button
        type="button"
        onClick={close}
        className="text-zinc-500 hover:text-zinc-200 transition-colors p-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
        aria-label="Close dialog"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
          <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

// Unused handleKeyDown re-export for completeness, but the real one is inside
// the effect. This is just a type hint.
export type { DialogContentProps };
