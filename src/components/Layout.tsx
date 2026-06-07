import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useMe } from '@/hooks/useMe';
import { SignOutButton } from './SignOutButton';
import { useEffect } from 'react';

export function ProtectedLayout() {
  const { data: me, isLoading, isError } = useMe();
  const navigate = useNavigate();
  useEffect(() => { if (isError) navigate('/login'); }, [isError, navigate]);
  if (isLoading) return <div className="p-8">Načítání…</div>;
  if (!me) return null;
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 border-r p-6 space-y-3">
        <div className="font-bold mb-6">Správa pronájmu</div>
        <nav className="flex flex-col space-y-1 text-sm">
          <Link className="hover:underline" to="/">Přehled</Link>
          <Link className="hover:underline" to="/properties">Nemovitosti</Link>
          <Link className="hover:underline" to="/tenants">Nájemci</Link>
          <Link className="hover:underline" to="/contracts">Pronájmy</Link>
          <Link className="hover:underline" to="/payments">Platby</Link>
          <Link className="hover:underline" to="/settings/api-tokens">API tokeny</Link>
        </nav>
        <div className="pt-6 mt-6 border-t text-xs text-muted-foreground">
          <div>{me.user.email}</div>
          <div className="mb-2">{me.memberships[0]?.orgName ?? 'No org'}</div>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 p-8"><Outlet /></main>
    </div>
  );
}
