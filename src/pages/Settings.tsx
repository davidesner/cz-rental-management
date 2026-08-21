import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiTokensPanel } from './ApiTokens';
import { BankTab } from './settings/BankTab';

const TABS = ['bank', 'api-tokens'] as const;
type TabKey = (typeof TABS)[number];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: TabKey = TABS.includes(requested as TabKey) ? (requested as TabKey) : 'bank';

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
      <Tabs value={tab} onValueChange={selectTab} className="w-full">
        <TabsList>
          <TabsTrigger value="bank">Bankovní integrace</TabsTrigger>
          <TabsTrigger value="api-tokens">API tokeny</TabsTrigger>
        </TabsList>
        <TabsContent value="bank" className="space-y-6 pt-4">
          <BankTab />
        </TabsContent>
        <TabsContent value="api-tokens" className="space-y-6 pt-4">
          <ApiTokensPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
