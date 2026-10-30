import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * Tables sit flush inside a <Card>: no outer border, 12px top header labels,
 * hairline rules between rows, 20px gutters on the first and last column so
 * cells align with the card's padding. Numeric columns take `className="num"`.
 */
export const Table = ({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
  <div className="relative w-full overflow-x-auto">
    <table className={cn('w-full border-collapse text-base', className)} {...props} />
  </div>
);
export const TableHeader = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className={cn(className)} {...props} />;
export const TableBody = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className={cn(className)} {...props} />;
export const TableRow = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn('group/row', className)} {...props} />;
export const TableHead = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    scope="col"
    className={cn(
      'whitespace-nowrap border-b border-line bg-side px-2 py-2.5 text-left text-sm font-semibold text-soft first:pl-5 last:pr-5',
      '[&.num]:text-right',
      className,
    )}
    {...props}
  />
);
export const TableCell = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td
    className={cn(
      'border-t border-rule px-2 py-3 align-top first:pl-5 last:pr-5 group-hover/row:bg-side [tbody>tr:first-child>&]:border-t-0',
      '[&.num]:whitespace-nowrap [&.num]:text-right',
      className,
    )}
    {...props}
  />
);
export const TableFooter = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => <tfoot className={cn('font-semibold [&_td]:bg-side', className)} {...props} />;
