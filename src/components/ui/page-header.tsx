import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface BreadcrumbItem {
  label: ReactNode;
  to: string;
}

/**
 * Ancestors of the current page, never the page itself: the title says where
 * you are, the crumbs say what it belongs to. Items follow the sidebar's
 * hierarchy (list → record → sub-record), not the route the visitor came by.
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Drobečková navigace" className="flex flex-wrap items-center gap-x-1.5 text-sm text-soft">
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-x-1.5">
          {i > 0 && <span aria-hidden="true" className="text-wait">/</span>}
          <Link to={item.to} className="truncate text-soft hover:text-ink">{item.label}</Link>
        </span>
      ))}
    </nav>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  /** Breadcrumb line above the title; usually `<Breadcrumbs items={…} />`. */
  crumb?: ReactNode;
  /** One line under the title in the soft colour. */
  sub?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, crumb, sub, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {crumb && <div className="text-sm text-soft [&_a]:text-soft">{crumb}</div>}
        <h1 className="m-0 text-[22px] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
        {sub && <div className="mt-0.5 text-sm text-soft">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
