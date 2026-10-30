import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      'flex h-9 w-full rounded-md border border-line bg-card px-2.5 text-base text-ink placeholder:text-wait',
      'focus:border-accent focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-soft)]',
      'disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm',
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = 'Input';
