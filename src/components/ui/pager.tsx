import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Slices a list into pages and clamps the page index when the list shrinks. */
export function usePager<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const from = current * pageSize;
  const slice = items.slice(from, from + pageSize);
  return {
    page: current,
    pageCount,
    from,
    to: Math.min(items.length, from + pageSize),
    total: items.length,
    slice,
    setPage: (p: number) => setPage(Math.max(0, Math.min(pageCount - 1, p))),
  };
}

interface PagerProps {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  /** Genitive plural of what is paged: "měsíců", "plateb". */
  unit: string;
  onPage: (p: number) => void;
  prevLabel?: string;
  nextLabel?: string;
}

/** "1 až 12 z 33 měsíců" with previous / next arrows. Renders nothing for a single page. */
export function Pager({ page, pageCount, from, to, total, unit, onPage, prevLabel = 'Předchozí stránka', nextLabel = 'Další stránka' }: PagerProps) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-2.5 text-sm text-soft">
      <div>{from + 1} až {to} z {total} {unit}</div>
      <div className="flex items-center gap-1">
        <span className="mr-1 tabular-nums">{page + 1} / {pageCount}</span>
        <button type="button" aria-label={prevLabel} disabled={page === 0} onClick={() => onPage(page - 1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-soft hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" aria-label={nextLabel} disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-soft hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
