import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useMe } from '@/hooks/useMe';
import { SignOutButton } from './SignOutButton';
import { useEffect } from 'react';

export function ProtectedLayout() {
  const { data: me, isLoading, isError } = useMe();
  const navigate = useNavigate();
  useEffect(() => { if (isError) navigate('/login'); }, [isError, navigate]);
  if (isLoading) return <div className="p-8">Loading…</div>;
  if (!me) return null;
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 border-r p-6 space-y-3">
        <div className="font-bold mb-6">Rental Management</div>
        <nav className="flex flex-col space-y-1 text-sm">
          <Link className="hover:underline" to="/">Dashboard</Link>
          <Link className="hover:underline" to="/properties">Properties</Link>
          <Link className="hover:underline" to="/tenants">Tenants</Link>
          <Link className="hover:underline" to="/contracts">Contracts</Link>
          <Link className="hover:underline" to="/payments">Payments</Link>
          <Link className="hover:underline" to="/cost-statements">Cost statements</Link>
          <Link className="hover:underline" to="/reconciliations">Reconciliations</Link>
          <Link className="hover:underline" to="/settings/api-tokens">API tokens</Link>
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
