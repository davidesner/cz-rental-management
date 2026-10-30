import { cn } from '@/lib/utils';

export interface SegOption<T extends string> { value: T; label: React.ReactNode }

/** Segmented control for a small, exclusive choice (a list filter, a view switch). */
export function Seg<T extends string>({ value, options, onChange, label, className }: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex rounded-[9px] border border-line bg-card p-[3px]', className)}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 whitespace-nowrap rounded-md px-3 font-medium text-soft transition-colors hover:text-ink',
            value === o.value && 'bg-side text-ink shadow-[inset_0_0_0_1px_var(--line)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
