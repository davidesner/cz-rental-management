import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CreditCard, FileText, House, LayoutGrid, LogOut, Menu, SlidersHorizontal, User, X } from 'lucide-react';
import { useMe } from '@/hooks/useMe';
import { useSignOut } from './SignOutButton';
import { api } from '@/lib/api';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Přehled', icon: LayoutGrid, end: true },
  { to: '/properties', label: 'Nemovitosti', icon: House },
  { to: '/tenants', label: 'Nájemci', icon: User },
  { to: '/contracts', label: 'Pronájmy', icon: FileText },
  { to: '/payments', label: 'Platby', icon: CreditCard },
] as const;

// Title for the mobile top bar, by the first path segment.
const TITLES: Record<string, string> = {
  '': 'Přehled',
  properties: 'Nemovitosti',
  tenants: 'Nájemci',
  contracts: 'Pronájmy',
  payments: 'Platby',
  settings: 'Nastavení',
  reconciliations: 'Vyúčtování',
};

const COLLAPSE_KEY = 'sidebar-collapsed';
const MOBILE_QUERY = '(max-width: 767px)';

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

function Logo({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('flex-none text-accent', className)}>
      <path d="M3 10.5 12 3l9 7.5V21H3z" /><path d="M9 21v-6h6v6" />
    </svg>
  );
}

export function ProtectedLayout() {
  const { data: me, isError } = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const signOut = useSignOut();
  useEffect(() => { if (isError) navigate('/login'); }, [isError, navigate]);
  useEffect(() => {
    if (me?.user.mustChangePassword) navigate('/change-password', { replace: true });
  }, [me, navigate]);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  const toggleCollapsed = () => setCollapsed(c => {
    try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* storage unavailable */ }
    return !c;
  });

  // The drawer closes on navigation and on Escape.
  useEffect(() => { setMenuOpen(false); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Badge on Platby: payments that are not assigned to any contract yet.
  const unassigned = useQuery({
    queryKey: ['payments', 'unassigned-count'],
    queryFn: () => api.get<{ payments: unknown[] }>('/api/payments?unassigned=true'),
    enabled: !!me,
    select: d => d.payments.length,
  });
  const badge = unassigned.data ?? 0;

  // Both cases are mid-redirect (see effects above) — render nothing.
  if (isError) return null;
  if (me?.user.mustChangePassword) return null;

  // Deliberately NOT gated on `isLoading`. Blocking the whole subtree until
  // /api/me resolved made every section load in two serial waves: /api/me
  // first, and only then the page's own queries. Rendering the shell
  // immediately lets both waves overlap, roughly halving time-to-content.
  //
  // Safe because authorisation is enforced server-side, not here: this only
  // removes a client-side *render* gate, never an access-control check.
  const org = me?.memberships.find(m => m.orgId === me.activeOrgId) ?? me?.memberships[0];
  const segment = location.pathname.split('/')[1] ?? '';
  const mobileTitle = TITLES[segment] ?? 'Správa pronájmu';
  const lbl = cn(collapsed && 'md:hidden');

  const navClass = ({ isActive }: { isActive: boolean }) => cn(
    'relative flex h-[34px] items-center gap-2.5 rounded-sm px-2.5 text-soft hover:bg-hover hover:text-ink hover:no-underline',
    collapsed && 'md:justify-center md:px-0',
    isActive && 'bg-accent-soft font-medium text-accent hover:bg-accent-soft hover:text-accent',
  );

  return (
    <div className="flex min-h-screen bg-page text-ink">
      {/* Mobile top bar */}
      <div inert={isMobile && menuOpen} className="fixed inset-x-0 top-0 z-40 flex h-[52px] items-center gap-2.5 border-b border-line bg-card pl-2 pr-3 md:hidden">
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Otevřít menu" aria-expanded={menuOpen}
          className="inline-flex h-9 w-9 items-center justify-center rounded-sm text-soft hover:bg-hover hover:text-ink">
          <Menu className="h-5 w-5" />
        </button>
        <Logo className="h-5 w-5" />
        <span className="truncate font-semibold">{mobileTitle}</span>
      </div>

      {menuOpen && <div className="fixed inset-0 z-50 bg-[var(--scrim)] md:hidden" onClick={() => setMenuOpen(false)} />}

      {/* On a phone the closed drawer is off screen; `inert` keeps its links out
          of the tab order and away from assistive technology. While it is open
          the page behind it is inert instead. */}
      <aside
        inert={isMobile && !menuOpen}
        className={cn(
          'fixed inset-y-0 left-0 z-[60] flex w-[272px] flex-col gap-5 border-r border-line bg-nav p-3 transition-transform duration-200',
          menuOpen ? 'translate-x-0 shadow-drawer' : '-translate-x-full',
          'md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0 md:shadow-none md:transition-none',
          collapsed ? 'md:w-16' : 'md:w-[216px]',
          'md:flex-none',
        )}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Rozbalit menu' : 'Sbalit menu'}
          title={collapsed ? 'Rozbalit menu' : 'Sbalit menu'}
          className="absolute -right-3 top-5 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-line bg-card text-soft shadow-[0_1px_2px_rgba(16,24,40,0.06)] hover:border-soft hover:text-ink md:inline-flex"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" strokeWidth={2.4} /> : <ChevronLeft className="h-3 w-3" strokeWidth={2.4} />}
        </button>

        <div className={cn('flex items-center gap-2.5 py-1 pl-2.5 pr-1', collapsed && 'md:justify-center md:px-0')}>
          {/* The top bar gets inert too while the drawer is open; it lives outside <main>. */}
          <Logo />
          <span className={cn('whitespace-nowrap font-semibold', lbl)}>Správa pronájmu</span>
          <button type="button" onClick={() => setMenuOpen(false)} aria-label="Zavřít menu"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-sm text-soft hover:bg-hover hover:text-ink md:hidden">
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <nav aria-label="Hlavní" className="flex flex-col gap-0.5">
          {NAV.map(item => {
            const Icon = item.icon;
            const isPayments = item.to === '/payments';
            const title = isPayments && badge > 0 ? `Platby, ${badge} k přiřazení` : item.label;
            return (
              <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} className={navClass} title={title}>
                <Icon className="h-[17px] w-[17px] flex-none" strokeWidth={1.8} />
                <span className={lbl}>{item.label}</span>
                {isPayments && badge > 0 && (
                  <>
                    <span className={cn('ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-late px-1.5 text-xs font-semibold text-white', lbl)}>{badge}</span>
                    <span aria-hidden="true" className={cn('absolute left-6 top-1.5 hidden h-2 w-2 rounded-full bg-late ring-2 ring-nav', collapsed && 'md:block')} />
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <NavLink to="/settings" className={({ isActive }) => cn(navClass({ isActive }), 'mt-auto')} title="Nastavení">
          <SlidersHorizontal className="h-[17px] w-[17px] flex-none" strokeWidth={1.8} />
          <span className={lbl}>Nastavení</span>
        </NavLink>

        <div className={cn('flex items-center gap-2.5 border-t border-line px-1 pt-2.5', collapsed && 'md:justify-center md:px-0')} title={me ? `${org?.orgName ?? ''}, ${me.user.email}` : undefined}>
          <div aria-hidden="true" className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full border border-line bg-side text-xs font-semibold text-soft">
            {me ? initials(me.user.name, me.user.email) : ''}
          </div>
          <div className={cn('min-w-0 leading-[1.3]', lbl)}>
            <div className="truncate text-sm font-medium">{org?.orgName ?? (me ? 'Bez organizace' : ' ')}</div>
            <div className="truncate text-xs text-soft">{me?.user.email ?? ' '}</div>
          </div>
          <button type="button" onClick={signOut} aria-label="Odhlásit se" title="Odhlásit se"
            className={cn('ml-auto inline-flex h-7 w-7 flex-none items-center justify-center rounded-sm text-soft hover:bg-hover hover:text-ink', lbl)}>
            <LogOut className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </button>
        </div>
      </aside>

      <main inert={isMobile && menuOpen} className="min-w-0 flex-1 px-4 pb-12 pt-[68px] md:px-10 md:pb-14 md:pt-6">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-5">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/** Link back to a list page, for page-header crumbs. */
export function Crumb({ to, children }: { to: string; children: React.ReactNode }) {
  return <Link to={to} className="hover:text-ink">{children}</Link>;
}
