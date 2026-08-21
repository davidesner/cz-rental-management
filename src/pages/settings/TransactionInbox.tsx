import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableError } from '@/components/ui/table-error';

const SELECT_CLS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface BankTransaction {
  id: string;
  amount: number;
  currency: string;
  valueDate: string;
  fromAccount: string | null;
  toAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
  messageForRecipient: string | null;
  sourceLink: string | null;
  status: 'unmatched' | 'matched' | 'ambiguous' | 'suspected_duplicate' | 'ignored' | 'parse_failed';
  statusReason: string | null;
  // A successful reparse moves `status` back to 'unmatched' but leaves this
  // field populated from the earlier duplicate check — so it must never be
  // read except when status is actually 'suspected_duplicate', or a repaired
  // transaction shows stale duplicate state.
  duplicateOfTransactionId: string | null;
  paymentId: string | null;
}

interface Contract {
  id: string;
  propertyName: string;
  tenantName: string;
  startDate: string;
  endDate: string | null;
}

function fmtKc(halere: number): string {
  return `${(halere / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč`;
}

const STATUS_LABEL: Record<BankTransaction['status'], string> = {
  unmatched: 'Nespárováno',
  matched: 'Spárováno',
  ambiguous: 'Více pravidel',
  suspected_duplicate: 'Možný duplikát',
  ignored: 'Ignorováno',
  parse_failed: 'Nezpracováno',
};

function StatusBadge({ status }: { status: BankTransaction['status'] }) {
  const tone = status === 'parse_failed' || status === 'ambiguous'
    ? 'bg-red-100 text-red-800'
    : status === 'suspected_duplicate'
      ? 'bg-amber-100 text-amber-900'
      : 'bg-muted text-muted-foreground';
  return <span className={`text-xs rounded-full px-2 py-0.5 whitespace-nowrap ${tone}`}>{STATUS_LABEL[status]}</span>;
}

export function TransactionInbox() {
  const qc = useQueryClient();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const { data, isError, refetch } = useQuery({
    queryKey: ['bank-transactions', 'pending'],
    queryFn: () => api.get<{ bankTransactions: BankTransaction[] }>('/api/bank-transactions?pending=1'),
  });
  const { data: contractsData } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => api.get<{ contracts: Contract[] }>('/api/contracts'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bank-transactions'] });
    qc.invalidateQueries({ queryKey: ['payments'] });
  };
  const onError = (e: unknown) => setErr(apiErrorMessage(e));

  const assign = useMutation({
    mutationFn: ({ id, contractId }: { id: string; contractId: string }) =>
      api.post<unknown>(`/api/bank-transactions/${id}/assign`, { contractId }),
    onSuccess: invalidate, onError,
  });
  const ignore = useMutation({
    mutationFn: (id: string) => api.post<unknown>(`/api/bank-transactions/${id}/ignore`, {}),
    onSuccess: invalidate, onError,
  });
  const reparse = useMutation({
    mutationFn: (id: string) => api.post<unknown>(`/api/bank-transactions/${id}/reparse`, {}),
    onSuccess: invalidate, onError,
  });

  const rows = data?.bankTransactions ?? [];
  const contracts = contractsData?.contracts ?? [];
  const busy = assign.isPending || ignore.isPending || reparse.isPending;

  const contractLabel = (c: Contract) =>
    `${c.propertyName} — ${c.tenantName} (od ${c.startDate})`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Nepřiřazené platby</h2>
        {rows.length > 0 && (
          <span className="text-sm text-muted-foreground">{rows.length} čeká na vyřešení</span>
        )}
      </div>

      {err && (
        <Card className="p-4 border-destructive bg-red-50 flex items-start justify-between gap-4">
          <p className="text-sm text-red-900">{err}</p>
          <Button size="sm" variant="outline" onClick={() => setErr(null)}>Zavřít</Button>
        </Card>
      )}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead className="text-right">Částka</TableHead>
              <TableHead>Z účtu</TableHead>
              <TableHead>Symboly / zpráva</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError && !data ? (
              <TableError cols={6} onRetry={() => refetch()} />
            ) : !data ? (
              <TableSkeleton cols={6} />
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">
                  Nic nečeká — všechny platby jsou spárované.
                </TableCell>
              </TableRow>
            ) : rows.map(t => (
              <TableRow key={t.id}>
                <TableCell className="whitespace-nowrap">{t.valueDate}</TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap">
                  {fmtKc(t.amount)}
                  {t.currency !== 'CZK' && <span className="text-xs text-muted-foreground"> ({t.currency})</span>}
                </TableCell>
                <TableCell className="text-sm">{t.fromAccount ?? '—'}</TableCell>
                <TableCell className="text-sm">
                  {t.messageForRecipient && <div>{t.messageForRecipient}</div>}
                  <div className="text-muted-foreground text-xs">
                    {[t.vs && `VS ${t.vs}`, t.ks && `KS ${t.ks}`, t.ss && `SS ${t.ss}`]
                      .filter(Boolean).join(' · ') || 'bez symbolů'}
                  </div>
                  {t.sourceLink && (
                    <a href={t.sourceLink} target="_blank" rel="noreferrer" className="text-xs underline">
                      notifikace v bance
                    </a>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={t.status} />
                  {t.statusReason && (
                    <div className="text-xs text-muted-foreground mt-1 max-w-xs break-words">{t.statusReason}</div>
                  )}
                </TableCell>
                <TableCell className="text-right space-y-2 min-w-[18rem]">
                  {t.status === 'parse_failed' ? (
                    <div className="space-x-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => { setErr(null); reparse.mutate(t.id); }}>
                        Znovu zpracovat
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => { setErr(null); ignore.mutate(t.id); }}>
                        Ignorovat
                      </Button>
                    </div>
                  ) : (
                    <>
                      {/* Gated strictly on status, not on duplicateOfTransactionId being
                          non-null: a reparse can move a row back to 'unmatched' while
                          leaving that field populated from the earlier duplicate check,
                          and showing this text then would describe a state the row is
                          no longer in. */}
                      {t.status === 'suspected_duplicate' && (
                        <p className="text-xs text-amber-900 text-left">
                          Shodná platba už je spárovaná. Pokud šlo o dvě samostatné platby,
                          přiřaď ji ručně — jinak ignoruj.
                        </p>
                      )}
                      <div className="flex gap-2 justify-end">
                        <select
                          className={SELECT_CLS}
                          value={choice[t.id] ?? ''}
                          onChange={e => setChoice(c => ({ ...c, [t.id]: e.target.value }))}
                        >
                          <option value="">Přiřadit k pronájmu…</option>
                          {contracts.map(c => (
                            <option key={c.id} value={c.id}>{contractLabel(c)}</option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          disabled={busy || !choice[t.id]}
                          onClick={() => { setErr(null); assign.mutate({ id: t.id, contractId: choice[t.id]! }); }}
                        >
                          {t.status === 'suspected_duplicate' ? 'Není duplikát' : 'Přiřadit'}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => { setErr(null); ignore.mutate(t.id); }}>
                          Ignorovat
                        </Button>
                      </div>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
