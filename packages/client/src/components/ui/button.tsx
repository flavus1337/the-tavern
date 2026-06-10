import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  default:
    'bg-indigo-600 text-white hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-zinc-700 disabled:text-zinc-400',
  secondary:
    'bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700 active:bg-zinc-600 disabled:opacity-50',
  ghost:
    'bg-transparent text-zinc-300 hover:bg-zinc-800 active:bg-zinc-700 disabled:opacity-50',
  destructive:
    'bg-red-700 text-white hover:bg-red-600 active:bg-red-800 disabled:bg-zinc-700 disabled:text-zinc-400',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs rounded',
  md: 'px-4 py-2 text-sm rounded-md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'md', loading = false, className, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled ?? loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-colors cursor-pointer',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 focus-visible:outline-offset-2',
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
