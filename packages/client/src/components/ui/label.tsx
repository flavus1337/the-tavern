import { forwardRef, type LabelHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn('text-[13px] font-semibold text-[var(--mid)] select-none block mb-[7px]', className)}
    {...props}
  />
));
Label.displayName = 'Label';
