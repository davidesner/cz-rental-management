import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  /** Breadcrumb line above the title, e.g. a link back to the list. */
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
