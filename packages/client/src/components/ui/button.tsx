import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'secondary' | 'ghost' | 'destructive' | 'teal';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  // Solid ember — primary CTA
  default:
    'bg-[var(--ember)] text-[var(--ink)] hover:bg-[var(--ember-h)] active:scale-[0.98] disabled:bg-[var(--raised)] disabled:text-[var(--faint)] hover:shadow-[0_0_22px_-6px_rgba(224,138,75,0.67)]',
  // Secondary ghost-ish
  secondary:
    'bg-[var(--surface2)] text-[var(--mid)] border border-[var(--border)] hover:border-[#473b34] hover:bg-[#ffffff06] active:scale-[0.98] disabled:opacity-50',
  // Fully transparent
  ghost:
    'bg-transparent text-[var(--low)] hover:text-[var(--hi)] active:scale-[0.98] disabled:opacity-50',
  // Danger
  destructive:
    'bg-[var(--garnet)] text-[var(--hi)] hover:opacity-90 active:scale-[0.98] disabled:bg-[var(--raised)] disabled:text-[var(--faint)]',
  // Teal for share actions
  teal:
    'bg-[#69b7a615] text-[var(--teal)] border border-[#69b7a63a] hover:bg-[#69b7a626] active:scale-[0.98] disabled:opacity-50',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-[9px]',
  md: 'px-4 py-2.5 text-sm rounded-[9px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'md', loading = false, className, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled ?? loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold transition-all cursor-pointer whitespace-nowrap',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ember)] focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed select-none',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
