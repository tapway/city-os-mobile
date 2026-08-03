import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './utils';

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('glass-panel p-4', className)}
      {...props}
    />
  )
);
Card.displayName = 'Card';