import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-foreground hover:brightness-110',
        destructive: 'bg-late text-white hover:brightness-110',
        outline: 'border border-line bg-card text-ink hover:bg-hover',
        secondary: 'bg-side text-ink hover:bg-hover',
        ghost: 'text-soft hover:bg-hover hover:text-ink',
        link: 'text-accent underline-offset-2 hover:underline h-auto px-0',
      },
      size: {
        default: 'h-9 px-3.5 text-base',
        sm: 'h-7 rounded-sm px-2.5 text-sm',
        lg: 'h-10 px-5 text-base',
        icon: 'h-8 w-8 rounded-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean; }

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, type, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} type={asChild ? undefined : (type ?? 'button')} {...props} />;
});
Button.displayName = 'Button';
export { buttonVariants };
