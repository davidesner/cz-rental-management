import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Two-column key/value list: labels at their natural width, values right-aligned and wrapping. */
export function KV({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5', className)}>{children}</dl>;
}

export function KVRow({ label, children, sum, wide, className }: { label: ReactNode; children: ReactNode; sum?: boolean; wide?: boolean; className?: string }) {
  const extra = cn(sum && 'border-t border-rule pt-2.5');
  if (wide) {
    // Long text (a note) takes the full width under its label.
    return (
      <div className={cn('col-span-2', extra)}>
        <dt className="text-soft">{label}</dt>
        <dd className={cn('m-0 mt-0.5', className)}>{children}</dd>
      </div>
    );
  }
  return (
    <>
      <dt className={cn('whitespace-nowrap text-soft', extra)}>{label}</dt>
      <dd className={cn('m-0 min-w-0 break-words text-right font-medium', extra, className)}>{children}</dd>
    </>
  );
}
