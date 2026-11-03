import { cn } from '@/lib/utils';

export type StatusTone = 'ok' | 'late' | 'wait' | 'soft';

const DOT: Record<StatusTone, string> = {
  ok: 'bg-accent',
  late: 'bg-late',
  wait: 'bg-wait',
  soft: 'bg-soft',
};

/** Status as a dot plus text, never a coloured pill. */
export function Status({ tone, children, title, className }: { tone: StatusTone; children: React.ReactNode; title?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-[7px] whitespace-nowrap', className)} title={title}>
      <i aria-hidden="true" className={cn('h-2 w-2 flex-none rounded-full', DOT[tone])} />
      {children}
    </span>
  );
}
