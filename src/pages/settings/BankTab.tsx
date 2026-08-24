import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableError } from '@/components/ui/table-error';
import { IntegrationDialog, type BankIntegration } from './IntegrationDialog';
import { TransactionInbox } from './TransactionInbox';

type TestBankIntegrationResult =
  | { ok: true; mailboxExists: number; fromMatches: number; filterMatches: number; truncated: boolean; sinceDays: number }
  | { ok: false; error: string };

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('cs-CZ');
}

export function StatusPill({ integration }: { integration: BankIntegration }) {
  // Mirrors computePairingHealth on the server: not configured / working /
  // failing. An inactive integration reads as "not configured" because it
  // collects nothing.
  if (!integration.active) {
    return <span className="text-xs rounded-full px-2 py-0.5 bg-muted text-muted-foreground">Vypnuto</span>;
  }
  if (integration.lastSyncStatus === 'error') {
    return (
      <span
        className="text-xs rounded-full px-2 py-0.5 bg-red-100 text-red-800"
        title={integration.lastSyncError ?? undefined}
      >Chyba</span>
    );
  }
  if (integration.lastSyncStatus === 'ok') {
    return <span className="text-xs rounded-full px-2 py-0.5 bg-green-100 text-green-800">Vše v pořádku</span>;
  }
  return <span className="text-xs rounded-full px-2 py-0.5 bg-muted text-muted-foreground">Nesynchronizováno</span>;
}

export function BankTab() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data, isError, refetch } = useQuery({
    queryKey: ['bank-integrations'],
    queryFn: () => api.get<{ bankIntegrations: BankIntegration[] }>('/api/bank-integrations'),
  });

  const [dialog, setDialog] = useState<{ open: boolean; target: BankIntegration | null }>({ open: false, target: null });
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  // ?action=new opens the create dialog on load — the deep link the MCP
  // bank_integrations_setup_url tool hands to the user.
  useEffect(() => {
    if (params.get('action') !== 'new') return;
    setDialog({ open: true, target: null });
    const next = new URLSearchParams(params);
    next.delete('action');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bank-integrations'] });
    qc.invalidateQueries({ queryKey: ['bank-transactions'] });
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
      const truncatedNote = r.truncated ? ' Počet je spodní odhad — zkontrolována byla jen část zpráv od tohoto odesílatele.' : '';
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
        ? { kind: 'ok', text: `Hotovo — ${result.fetched} zpráv, ${result.created} nových, ${result.matched} spárováno.` }
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Bankovní integrace</h2>
        <Button onClick={() => setDialog({ open: true, target: null })}>Nová integrace</Button>
      </div>

      {notice && (
        <Card className={`p-4 flex items-start justify-between gap-4 ${
          notice.kind === 'ok' ? 'border-green-500 bg-green-50'
          : notice.kind === 'warn' ? 'border-amber-500 bg-amber-100'
          : 'border-destructive bg-red-50'
        }`}>
          <p className={`text-sm ${
            notice.kind === 'ok' ? 'text-green-900'
            : notice.kind === 'warn' ? 'text-amber-900'
            : 'text-red-900'
          }`}>{notice.text}</p>
          <Button size="sm" variant="outline" onClick={() => setNotice(null)}>Zavřít</Button>
        </Card>
      )}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Název</TableHead>
              <TableHead>Účet / server</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead>Poslední synchronizace</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError && !data ? (
              <TableError cols={5} onRetry={() => refetch()} />
            ) : !data ? (
              <TableSkeleton cols={5} />
            ) : integrations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">
                  Žádná integrace. Přidej mailbox, do kterého chodí notifikace z KB.
                </TableCell>
              </TableRow>
            ) : integrations.map(i => (
              <TableRow key={i.id}>
                <TableCell className="font-medium">{i.name}</TableCell>
                <TableCell className="text-sm">
                  <div>{i.imapUser}</div>
                  <div className="text-muted-foreground text-xs">
                    {i.imapHost}:{i.imapPort} · {i.imapFolder}
                    {i.accountNumber && ` · ${i.accountNumber}`}
                  </div>
                </TableCell>
                <TableCell><StatusPill integration={i} /></TableCell>
                <TableCell className="text-sm">{fmtDateTime(i.lastSyncAt)}</TableCell>
                <TableCell className="text-right whitespace-nowrap space-x-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => { setNotice(null); test.mutate(i.id); }}>Test</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => { setNotice(null); sync.mutate(i.id); }}>Synchronizovat</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ open: true, target: i })}>Upravit</Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => { if (confirm(`Smazat integraci „${i.name}"? Nasbírané transakce se smažou s ní.`)) remove.mutate(i.id); }}
                  >Smazat</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {integrations.some(i => i.active && i.lastSyncStatus === 'error' && (i.lastSyncError ?? '').includes('unexpected_structure')) && (
        <Card className="p-4 border-destructive bg-red-50">
          <p className="text-sm text-red-900">
            <strong>Struktura notifikace se změnila.</strong> KB pravděpodobně upravila
            šablonu e-mailu — do té doby se platby nesbírají. Detail je u dotčené
            transakce níže se stavem „Nezpracováno".
          </p>
        </Card>
      )}

      <TransactionInbox />

      {dialog.open && (
        <IntegrationDialog
          integration={dialog.target}
          onClose={() => setDialog({ open: false, target: null })}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}
