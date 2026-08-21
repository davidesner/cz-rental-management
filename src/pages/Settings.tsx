import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMe } from '@/hooks/useMe';
import { ApiTokensPanel } from './ApiTokens';
import { BankTab } from './settings/BankTab';

const TABS = ['bank', 'api-tokens'] as const;
type TabKey = (typeof TABS)[number];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const { data: me, isError } = useMe();

  // Every bank endpoint is requireOwner, so the whole tab is owner-only. The nav
  // points EVERY user at /settings, and a restricted member could previously
  // manage their own API tokens here — defaulting them into the bank tab would
  // greet them with a 403 on a page they have legitimate business on. So the tab
  // is hidden, and ?tab=bank is not honoured, for anyone but an owner.
  const role = me?.memberships.find((m) => m.orgId === me.activeOrgId)?.role ?? null;
  const isOwner = role === 'owner';

  const requested = params.get('tab');
  const valid = TABS.includes(requested as TabKey) ? (requested as TabKey) : null;
  const tab: TabKey = valid === 'bank' && !isOwner ? 'api-tokens'
    : valid ?? (isOwner ? 'bank' : 'api-tokens');

  // The tab lives in the URL so it can be linked to — the MCP
  // bank_integrations_setup_url tool hands the user /settings?tab=bank&action=new,
  // and `replace` keeps tab switching out of the back-button history.
  const selectTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    next.delete('action');
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Nastavení</h1>
      {/* Waiting on the role rather than assuming one: guessing wrong renders the
          bank tab and then yanks it away (or the reverse) as /api/me resolves.
          An /api/me FAILURE is treated as "not an owner" — the safe side, and
          the tokens tab is the one every member may use. */}
      {!me && !isError ? (
        <p className="text-sm text-muted-foreground">Načítání…</p>
      ) : (
        <Tabs value={tab} onValueChange={selectTab} className="w-full">
          <TabsList>
            {isOwner && <TabsTrigger value="bank">Bankovní integrace</TabsTrigger>}
            <TabsTrigger value="api-tokens">API tokeny</TabsTrigger>
          </TabsList>
          {isOwner && (
            <TabsContent value="bank" className="space-y-6 pt-4">
              <BankTab />
            </TabsContent>
          )}
          <TabsContent value="api-tokens" className="space-y-6 pt-4">
            <ApiTokensPanel />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
