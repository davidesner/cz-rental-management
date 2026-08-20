import { TableCell, TableRow } from './table';
import { Button } from './button';

interface TableErrorProps {
  /** Number of columns in the table — must match the header, or the row misaligns. */
  cols: number;
  /** Re-runs the failed query. Wire this to the query's `refetch`. */
  onRetry: () => void;
}

/**
 * Shown when a list's query failed.
 *
 * Without this, a failed query is indistinguishable from a loading one: queries
 * that error leave `data` undefined forever, so a `!data → skeleton` branch
 * pulses indefinitely with no explanation and no way out. Retries (configured in
 * main.tsx) absorb transient failures; this covers the ones that survive them.
 */
export function TableError({ cols, onRetry }: TableErrorProps) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-center py-8">
        <p className="text-sm text-destructive mb-3">Nepodařilo se načíst data.</p>
        <Button size="sm" variant="outline" onClick={onRetry}>Zkusit znovu</Button>
      </TableCell>
    </TableRow>
  );
}
