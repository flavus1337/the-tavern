import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'success' | 'warning' | 'destructive' | 'outline' | 'dm' | 'player' | 'teal' | 'private';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

const variantClasses: Record<Variant, string> = {
  default: 'bg-[var(--raised)] text-[var(--mid)]',
  success: 'bg-[#69b7a622] text-[var(--teal)]',
  warning: 'bg-[#e8b76522] text-[var(--gold)]',
  destructive: 'bg-[#b6485a22] text-[var(--garnet)]',
  outline: 'border border-[var(--border)] text-[var(--low)]',
  // DM role — garnet on transparent garnet tint
  dm: 'bg-[#b6485a1f] text-[var(--garnet)] font-mono uppercase tracking-[0.12em]',
  // Player role — ember on transparent ember tint
  player: 'bg-[#e08a4b1a] text-[var(--ember)] font-mono uppercase tracking-[0.12em]',
  // Teal shared tag
  teal: 'bg-[#69b7a61a] text-[var(--teal)] font-mono tracking-[0.08em]',
  // Private roll chip
  private: 'border border-[var(--border)] text-[var(--faint)] font-mono',
};

export function Badge({ variant = 'default', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-[5px] text-[10px] font-semibold whitespace-nowrap',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
