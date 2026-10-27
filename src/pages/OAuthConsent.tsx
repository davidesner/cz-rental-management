import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { oauthQueryFromLocation } from '@/lib/oauth';
import type { ConsentInfo } from '../../server/mcp/routes';

type State =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'ready'; oauthQuery: string; info: ConsentInfo };

/**
 * Consent screen of the remote MCP OAuth flow: an AI agent (Claude, ChatGPT,
 * Claude Code) asks to work in the app as the signed-in user. Reached from the
 * authorize endpoint (already signed in) or from /login (after signing in),
 * always with a signed query that this page passes back unchanged.
 */
export function OAuthConsentPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Read from window.location, not the router: the signature covers the
    // exact parameter list, including the repeated `ba_param`.
    const oauthQuery = oauthQueryFromLocation(window.location.search);
    if (!oauthQuery) { setState({ kind: 'invalid' }); return; }
    void (async () => {
      const res = await fetch(`/api/oauth/consent-info?oauth_query=${encodeURIComponent(oauthQuery)}`, {
        credentials: 'include',
      });
      if (res.status === 401) {
        // Session expired meanwhile: sign in again with the same signed query.
        window.location.href = `/login${window.location.search}`;
        return;
      }
      if (!res.ok) { setState({ kind: 'invalid' }); return; }
      setState({ kind: 'ready', oauthQuery, info: (await res.json()) as ConsentInfo });
    })().catch(() => setState({ kind: 'invalid' }));
  }, []);

  async function answer(accept: boolean) {
    if (state.kind !== 'ready') return;
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accept, oauth_query: state.oauthQuery }),
      });
      const data = (await res.json().catch(() => null)) as { url?: string; redirect_uri?: string } | null;
      const target = data?.url ?? data?.redirect_uri;
      if (!res.ok || !target) { setFailed(true); setPending(false); return; }
      // Leaves the app: back to the agent with a code or an error.
      window.location.href = target;
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  const info = state.kind === 'ready' ? state.info : null;
  const blocked = info?.user.mustChangePassword === true;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Připojit AI asistenta</CardTitle>
          {info && (
            <CardDescription>
              {info.agentName} chce pracovat se správou pronájmu vaším jménem ({info.user.name}, {info.user.email}).
            </CardDescription>
          )}
        </CardHeader>
        {state.kind === 'loading' && (
          <CardContent><p className="text-sm text-muted-foreground">Načítám…</p></CardContent>
        )}
        {state.kind === 'invalid' && (
          <CardContent>
            <p role="alert" className="text-sm text-destructive">Neplatný požadavek na připojení.</p>
          </CardContent>
        )}
        {info && (
          <>
            <CardContent className="space-y-3 text-sm">
              <p>
                Bude moci číst a měnit nemovitosti, nájemníky, smlouvy, platby, vyúčtování a bankovní integrace
                se stejnými právy, jako máte vy.
              </p>
              <p className="text-muted-foreground">
                Přesměrování na: <span className="font-medium text-foreground">{info.redirectHost}</span>
              </p>
              {info.loopback && (
                <p role="alert" className="rounded-md border border-destructive/50 p-3 text-destructive">
                  Aplikace běží na tomto počítači. Povolte ji, jen pokud jste ji právě sami spustili.
                </p>
              )}
              {blocked && (
                <p role="alert" className="text-destructive">
                  Nejdřív si změňte heslo (<a className="underline" href="/change-password">Změnit heslo</a>),
                  pak připojení zopakujte.
                </p>
              )}
              {failed && (
                <p role="alert" className="text-destructive">Odpověď se nepodařilo odeslat, zkuste to znovu.</p>
              )}
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => answer(false)} disabled={pending}>Zamítnout</Button>
              <Button onClick={() => answer(true)} disabled={pending || blocked}>Povolit</Button>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  );
}
