import type { ReactNode } from 'react';
import { Button } from './button';
import { cn } from '@/lib/utils';

export type NoticeKind = 'ok' | 'warn' | 'err' | 'info';

/**
 * An inline message box. Only two tones exist in the design: the terracotta
 * "late" wash for anything that needs attention and the quiet side colour for
 * the rest; the kind still decides the dot colour so a scan tells them apart.
 */
export function Notice({ kind, children, onClose, action, className }: { kind: NoticeKind; children: ReactNode; onClose?: () => void; action?: ReactNode; className?: string }) {
  const attention = kind === 'err' || kind === 'warn';
  return (
    <div role={kind === 'err' ? 'alert' : 'status'} className={cn(
      'flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-sm',
      attention ? 'border-transparent bg-late-soft text-ink' : 'border-line bg-card text-ink',
      className,
    )}>
      <div className="flex min-w-0 items-start gap-2.5">
        <i aria-hidden="true" className={cn('mt-[6px] h-2 w-2 flex-none rounded-full', attention ? 'bg-late' : kind === 'ok' ? 'bg-accent' : 'bg-soft')} />
        <div className="min-w-0 break-words">{children}</div>
      </div>
      <div className="flex flex-none items-center gap-2">
        {action}
        {onClose && <Button size="sm" variant="outline" onClick={onClose}>Zavřít</Button>}
      </div>
    </div>
  );
}
