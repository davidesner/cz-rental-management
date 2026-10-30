import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Status } from '@/components/ui/status';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableEmpty, TableError } from '@/components/ui/table-error';
import { IntegrationDialog, type BankIntegration } from './IntegrationDialog';
import { IntegrationMethodChooser, type BankIntegrationKind } from './IntegrationMethodChooser';
import { TransactionInbox } from './TransactionInbox';

// Closed: nothing shown. Chooser: "Nová integrace" — pick a collection
// method first (today there is exactly one). Form: the actual IntegrationDialog,
// either for a freshly chosen kind (create) or an existing row (edit, kind
// fixed).
type DialogState =
  | { mode: 'closed' }
  | { mode: 'chooser' }
  | { mode: 'form'; integration: BankIntegration | null; kind: BankIntegrationKind };

type TestBankIntegrationResult =
  | { ok: true; mailboxExists: number; fromMatches: number; filterMatches: number; truncated: boolean; sinceDays: number }
  | { ok: false; error: string };

export function StatusPill({ integration }: { integration: BankIntegration }) {
  // Mirrors computePairingHealth on the server: not configured / working /
  // failing. An inactive integration reads as "not configured" because it
  // collects nothing.
  if (!integration.active) return <Status tone="soft">Vypnuto</Status>;
  if (integration.lastSyncStatus === 'error') return <Status tone="late" title={integration.lastSyncError ?? undefined}>Chyba</Status>;
  if (integration.lastSyncStatus === 'ok') return <Status tone="ok">Vše v pořádku</Status>;
  return <Status tone="wait">Nesynchronizováno</Status>;
}

export function BankTab() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data, isError, refetch } = useQuery({
    queryKey: ['bank-integrations'],
    queryFn: () => api.get<{ bankIntegrations: BankIntegration[] }>('/api/bank-integrations'),
  });

  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' });
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  // ?action=new opens the chooser on load — the deep link the MCP
  // bank_integrations_setup_url tool hands to the user. With one method the
  // chooser is a single-item confirmation, but it's still the right first
  // step: it's where a future second method would need to be picked.
  useEffect(() => {
    if (params.get('action') !== 'new') return;
    setDialog({ mode: 'chooser' });
    const next = new URLSearchParams(params);
    next.delete('action');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bank-integrations'] });
    qc.invalidateQueries({ queryKey: ['bank-transactions'] });
    qc.invalidateQueries({ queryKey: ['payments'] });
  };

  const test = useMutation({
    mutationFn: (id: string) => api.post<TestBankIntegrationResult>(`/api/bank-integrations/${id}/test`, {}),
    onSuccess: (r) => {
      if (!r.ok) {
        setNotice({ kind: 'err', text: `Připojení selhalo: ${r.error ?? 'neznámá chyba'}` });
        return;
      }
      // truncated: the from-search matched more messages than we fetched
      // headers for (capped for speed on a shared mailbox), so filterMatches
      // is a floor, not an exact count.
      const truncatedNote = r.truncated ? ' Počet je spodní odhad, zkontrolována byla jen část zpráv od tohoto odesílatele.' : '';
      setNotice(r.filterMatches > 0
        ? {
            kind: 'ok',
            text: `Připojení funguje. Za posledních ${r.sinceDays} dní odpovídá filtru ${r.filterMatches} z ${r.mailboxExists} zpráv ve složce.${truncatedNote}`,
          }
        // A green tick here would be the original defect in a new costume:
        // the connection works, but the filter catches nothing, so the
        // integration is still useless.
        : {
            kind: 'warn',
            text: `Připojení funguje, ale za posledních ${r.sinceDays} dní filtru neodpovídá žádná zpráva. Zkontroluj odesílatele a předmět.${truncatedNote}`,
          });
    },
    onError: (e: unknown) => setNotice({ kind: 'err', text: apiErrorMessage(e) }),
  });

  const sync = useMutation({
    mutationFn: (id: string) => api.post<{ result: { fetched: number; created: number; matched: number; failed: number; status: string; error: string | null } }>(`/api/bank-integrations/${id}/sync`, {}),
    onSuccess: ({ result }) => {
      invalidate();
      setNotice(result.status === 'ok'
        ? { kind: 'ok', text: `Hotovo: ${result.fetched} zpráv, ${result.created} nových, ${result.matched} spárováno.` }
        : { kind: 'err', text: `Synchronizace skončila chybou: ${result.error ?? 'neznámá chyba'}` });
    },
    onError: (e: unknown) => setNotice({ kind: 'err', text: apiErrorMessage(e) }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/bank-integrations/${id}`),
    onSuccess: invalidate,
    onError: (e: unknown) => setNotice({ kind: 'err', text: apiErrorMessage(e) }),
  });

  const integrations = data?.bankIntegrations ?? [];
  const busy = test.isPending || sync.isPending || remove.isPending;

  return (
    <>
      {notice && <Notice kind={notice.kind} onClose={() => setNotice(null)}>{notice.text}</Notice>}

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Bankovní integrace</CardTitle>
            <CardDescription>Odkud se sbírají příchozí platby.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setDialog({ mode: 'chooser' })}><Plus className="h-3.5 w-3.5" strokeWidth={2.2} />Nová integrace</Button>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Název</TableHead>
              <TableHead>Účet / server</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead>Poslední synchronizace</TableHead>
              <TableHead><span className="sr-only">Akce</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError && !data ? (
              <TableError cols={5} onRetry={() => refetch()} />
            ) : !data ? (
              <TableSkeleton cols={5} />
            ) : integrations.length === 0 ? (
              <TableEmpty cols={5}>Žádná integrace. Přidej schránku, do které chodí notifikace z banky.</TableEmpty>
            ) : integrations.map(i => (
              <TableRow key={i.id} className="rem">
                <TableCell className="font-medium">{i.name}</TableCell>
                <TableCell>
                  <div>{i.imapUser}</div>
                  <div className="text-sm text-soft">
                    {i.imapHost}:{i.imapPort} · {i.imapFolder}
                    {i.accountNumber && ` · ${i.accountNumber}`}
                  </div>
                </TableCell>
                <TableCell><StatusPill integration={i} /></TableCell>
                <TableCell className="whitespace-nowrap">{fmtDateTime(i.lastSyncAt)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <span className="inline-flex items-center gap-3.5">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => { setNotice(null); sync.mutate(i.id); }}>Synchronizovat</Button>
                    <button type="button" className="acts text-sm text-soft hover:text-ink disabled:opacity-50" disabled={busy} onClick={() => { setNotice(null); test.mutate(i.id); }}>Test</button>
                    <button type="button" className="acts text-sm text-soft hover:text-ink disabled:opacity-50" disabled={busy} onClick={() => setDialog({ mode: 'form', integration: i, kind: i.kind })}>Upravit</button>
                    <button
                      type="button"
                      className="acts text-sm text-soft hover:text-late disabled:opacity-50"
                      disabled={busy}
                      onClick={() => { if (confirm(`Smazat integraci „${i.name}"? Nasbírané transakce se smažou s ní.`)) remove.mutate(i.id); }}
                    >Smazat</button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {integrations.some(i => i.active && i.lastSyncStatus === 'error' && (i.lastSyncError ?? '').includes('unexpected_structure')) && (
        <Notice kind="err">
          <strong>Struktura notifikace se změnila.</strong> Banka pravděpodobně upravila
          šablonu e-mailu a do té doby se platby nesbírají. Detail je u dotčené
          transakce níže se stavem „Nezpracováno".
        </Notice>
      )}

      <TransactionInbox />

      {dialog.mode === 'chooser' && (
        <IntegrationMethodChooser
          onClose={() => setDialog({ mode: 'closed' })}
          onSelect={(kind) => setDialog({ mode: 'form', integration: null, kind })}
        />
      )}

      {dialog.mode === 'form' && (
        <IntegrationDialog
          integration={dialog.integration}
          kind={dialog.kind}
          onClose={() => setDialog({ mode: 'closed' })}
          onSaved={invalidate}
        />
      )}
    </>
  );
}
