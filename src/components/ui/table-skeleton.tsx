import { TableCell, TableRow } from './table';
import { cn } from '@/lib/utils';

interface TableSkeletonProps {
  /** Number of columns in the table — must match the header, or the layout shifts. */
  cols: number;
  /** Placeholder rows to draw. Default 3 — enough to read as "a list", short enough not to imply a count. */
  rows?: number;
  className?: string;
}

/**
 * Placeholder rows shaped like the real table.
 *
 * Exists so a loading list is visually distinct from an empty one. Rendering
 * `(data ?? []).map(...)` makes those two states identical, which is how the app
 * came to announce "Zatím žádné…" before its request had returned.
 */
export function TableSkeleton({ cols, rows = 3, className }: TableSkeletonProps) {
  // Varying widths so it reads as content rather than a progress bar.
  const widths = ['w-32', 'w-24', 'w-40', 'w-20', 'w-28', 'w-36'];
  return (
    <>
      {/*
       * The bars themselves stay aria-hidden (decorative), but a screen-reader
       * user still needs to be told the table is loading — otherwise they
       * perceive a table with no rows and no message, the same loading/empty
       * conflation this component exists to prevent visually. This row is the
       * one perceivable thing here: sr-only text, not aria-hidden.
       */}
      <TableRow>
        <TableCell colSpan={cols} className="sr-only">Načítání…</TableCell>
      </TableRow>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r} aria-hidden="true">
          {Array.from({ length: cols }).map((_, c) => (
            <TableCell key={c}>
              <div className={cn('h-4 rounded bg-muted animate-pulse', widths[(r + c) % widths.length], className)} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
