import { forwardRef, type LabelHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn('text-sm font-medium text-zinc-300 select-none', className)}
    {...props}
  />
));
Label.displayName = 'Label';
