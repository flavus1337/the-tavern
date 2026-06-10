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
        'w-full rounded-[9px] bg-[#100c0a] border px-[13px] py-[11px] text-sm text-[var(--hi)]',
        'placeholder:text-[var(--faint)] transition-[border-color,box-shadow]',
        'focus:outline-none focus:border-[var(--ember)] focus:shadow-[0_0_0_3px_rgba(224,138,75,0.13)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        error ? 'border-[var(--garnet)]' : 'border-[var(--border)]',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
