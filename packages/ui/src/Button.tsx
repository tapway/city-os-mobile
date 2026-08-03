import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from './utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--cyan)] text-[var(--bg-deep)] hover:opacity-90 font-bold shadow-[0_0_12px_var(--cyan-glow)]',
        secondary: 'bg-[var(--glass)] text-[var(--ink)] hover:opacity-80 border border-[var(--border)]',
        outline: 'border border-[var(--border)] bg-transparent hover:bg-[var(--glass-weak)] text-[var(--ink)]',
        ghost: 'bg-transparent hover:bg-[var(--glass-weak)] text-[var(--ink-dim)]',
        danger: 'bg-transparent text-[var(--danger)] border border-[rgba(239,68,68,0.4)] hover:bg-[rgba(239,68,68,0.1)]',
      },
      size: {
        sm: 'h-9 px-3 text-xs tracking-wider uppercase font-mono',
        md: 'h-11 px-4 text-sm tracking-wider uppercase font-mono',
        lg: 'h-14 px-6 text-base tracking-wider uppercase font-mono',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';