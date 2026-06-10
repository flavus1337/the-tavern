import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  error?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-md bg-zinc-900 border px-3 py-2 text-sm text-zinc-100',
        'placeholder:text-zinc-500 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        error ? 'border-red-500' : 'border-zinc-700',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
