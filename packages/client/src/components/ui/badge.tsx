import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'success' | 'warning' | 'destructive' | 'outline' | 'dm' | 'player';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

const variantClasses: Record<Variant, string> = {
  default: 'bg-zinc-700 text-zinc-200',
  success: 'bg-green-900 text-green-300',
  warning: 'bg-yellow-900 text-yellow-300',
  destructive: 'bg-red-900 text-red-300',
  outline: 'border border-zinc-600 text-zinc-300',
  dm: 'bg-violet-900 text-violet-200',
  player: 'bg-indigo-900 text-indigo-200',
};

export function Badge({ variant = 'default', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
