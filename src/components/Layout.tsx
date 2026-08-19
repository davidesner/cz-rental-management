import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useMe } from '@/hooks/useMe';
import { SignOutButton } from './SignOutButton';
import { useEffect } from 'react';

export function ProtectedLayout() {
  const { data: me, isError } = useMe();
  const navigate = useNavigate();
  useEffect(() => { if (isError) navigate('/login'); }, [isError, navigate]);
  useEffect(() => {
    if (me?.user.mustChangePassword) navigate('/change-password', { replace: true });
  }, [me, navigate]);

  // Both cases are mid-redirect (see effects above) — render nothing.
  if (isError) return null;
  if (me?.user.mustChangePassword) return null;

  // Deliberately NOT gated on `isLoading`. Blocking the whole subtree until
  // /api/me resolved made every section load in two serial waves: /api/me
  // first, and only then the page's own queries. Rendering the shell
  // immediately lets both waves overlap, roughly halving time-to-content.
  //
  // Safe because authorisation is enforced server-side, not here: an
  // unauthenticated or must-change-password user gets 401/403 on the page
  // queries and is redirected by the effects above. This only removes a
  // client-side *render* gate, never an access-control check.
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 border-r p-6 space-y-3">
        <div className="font-bold mb-6">Správa pronájmu</div>
        <nav className="flex flex-col space-y-1 text-sm">
          <Link className="hover:underline" to="/">Přehled</Link>
          <Link className="hover:underline" to="/properties">Nemovitosti</Link>
          <Link className="hover:underline" to="/tenants">Nájemci</Link>
          <Link className="hover:underline" to="/contracts">Pronájmy</Link>
          <Link className="hover:underline" to="/settings/api-tokens">API tokeny</Link>
        </nav>
        <div className="pt-6 mt-6 border-t text-xs text-muted-foreground">
          <div>{me?.user.email ?? ' '}</div>
          <div className="mb-2">{me ? (me.memberships[0]?.orgName ?? 'No org') : ' '}</div>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 p-8"><Outlet /></main>
    </div>
  );
}
