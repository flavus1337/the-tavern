import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('overflow-y-auto scrollbar-thin', className)}
      style={{
        scrollbarWidth: 'thin',
        scrollbarColor: '#3f3f46 transparent',
      }}
      {...props}
    >
      {children}
    </div>
  ),
);
ScrollArea.displayName = 'ScrollArea';
