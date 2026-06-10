import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('overflow-y-auto', className)}
      style={{
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--border) transparent',
      }}
      {...props}
    >
      {children}
    </div>
  ),
);
ScrollArea.displayName = 'ScrollArea';
