import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-mono uppercase tracking-wider',
  {
    variants: {
      variant: {
        default: 'bg-[var(--glass-strong)] text-[var(--ink-dim)] border border-[var(--border)]',
        success: 'bg-[rgba(16,185,129,0.15)] text-[var(--safe)] border border-[rgba(16,185,129,0.3)]',
        warning: 'bg-[rgba(234,179,8,0.15)] text-[var(--warn)] border border-[rgba(234,179,8,0.3)]',
        danger: 'bg-[rgba(239,68,68,0.15)] text-[var(--danger)] border border-[rgba(239,68,68,0.3)]',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  )
);
Badge.displayName = 'Badge';