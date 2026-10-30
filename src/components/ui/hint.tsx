import { useId, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A small info mark that shows an explanation on hover or keyboard focus.
 * For the "why does this field work like that" notes that used to sit as
 * grey paragraphs under inputs. Keep the text in plain words, no field names.
 */
export function Hint({ children, label = 'Vysvětlení', className }: { children: ReactNode; label?: string; className?: string }) {
  const id = useId();
  return (
    <span className={cn('group relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-soft hover:text-ink focus-visible:text-ink"
      >
        <Info className="h-[15px] w-[15px]" strokeWidth={1.8} />
      </button>
      <span
        role="tooltip"
        id={id}
        className={cn(
          'pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 hidden w-72 -translate-x-1/2 rounded-lg border border-line bg-card px-3 py-2.5 text-left text-sm font-normal leading-snug text-ink shadow-pop',
          'group-hover:block group-focus-within:block',
        )}
      >
        {children}
      </span>
    </span>
  );
}
