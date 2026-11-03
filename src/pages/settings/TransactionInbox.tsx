import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import { fmtDate, fmtKcExact } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Status, type StatusTone } from '@/components/ui/status';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableEmpty, TableError } from '@/components/ui/table-error';

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

const STATUS_LABEL: Record<BankTransaction['status'], string> = {
  unmatched: 'Nespárováno',
  matched: 'Spárováno',
  ambiguous: 'Více pravidel',
  suspected_duplicate: 'Možný duplikát',
  ignored: 'Ignorováno',
  parse_failed: 'Nezpracováno',
};

function StatusBadge({ status }: { status: BankTransaction['status'] }) {
  const tone: StatusTone = status === 'parse_failed' || status === 'ambiguous' || status === 'suspected_duplicate'
    ? 'late'
    : status === 'matched' ? 'ok' : 'wait';
  return <Status tone={tone}>{STATUS_LABEL[status]}</Status>;
}

export function TransactionInbox() {
  const qc = useQueryClient();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const { data, isError, refetch } = useQuery({
    queryKey: ['bank-transactions', 'pending'],
    queryFn: () => api.get<{ bankTransactions: BankTransaction[] }>('/api/bank-transactions?pending=1'),
  });
  // isError is destructured, not ignored: without it a failed contracts fetch
  // renders an EMPTY "Přiřadit k pronájmu…" dropdown, which looks identical to
  // "this org has no contracts yet".
  const { data: contractsData, isError: contractsError } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => api.get<{ contracts: Contract[] }>('/api/contracts'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bank-transactions'] });
    qc.invalidateQueries({ queryKey: ['payments'] });
  };
  const onError = (e: unknown) => setErr(apiErrorMessage(e));

  const assign = useMutation({
    mutationFn: ({ id, contractId, confirmDuplicate }: { id: string; contractId: string; confirmDuplicate: boolean }) =>
      api.post<unknown>(`/api/bank-transactions/${id}/assign`, { contractId, confirmDuplicate }),
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
    `${c.propertyName} / ${c.tenantName} (od ${fmtDate(c.startDate)})`;

  return (
    <>
      {err && <Notice kind="err" onClose={() => setErr(null)}>{err}</Notice>}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Nepřiřazené platby</CardTitle>
          <CardDescription>{rows.length > 0 ? `${rows.length} čeká na vyřešení` : 'Transakce z banky, které se nespárovaly samy.'}</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead className="num">Částka</TableHead>
              <TableHead>Z účtu</TableHead>
              <TableHead>Symboly a zpráva</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead><span className="sr-only">Akce</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError && !data ? (
              <TableError cols={6} onRetry={() => refetch()} />
            ) : !data ? (
              <TableSkeleton cols={6} />
            ) : rows.length === 0 ? (
              <TableEmpty cols={6}>Nic nečeká, všechny platby jsou spárované.</TableEmpty>
            ) : rows.map(t => (
              <TableRow key={t.id}>
                <TableCell className="whitespace-nowrap">{fmtDate(t.valueDate)}</TableCell>
                <TableCell className="num font-medium">
                  {fmtKcExact(t.amount)}
                  {t.currency !== 'CZK' && <span className="text-sm text-soft"> ({t.currency})</span>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{t.fromAccount ?? <span className="text-soft">—</span>}</TableCell>
                <TableCell>
                  {t.messageForRecipient && <div>{t.messageForRecipient}</div>}
                  <div className="text-sm text-soft">
                    {[t.vs && `VS ${t.vs}`, t.ks && `KS ${t.ks}`, t.ss && `SS ${t.ss}`]
                      .filter(Boolean).join(' · ') || 'bez symbolů'}
                  </div>
                  {t.sourceLink && (
                    <a href={t.sourceLink} target="_blank" rel="noreferrer" className="text-sm">notifikace v bance</a>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={t.status} />
                  {t.statusReason && (
                    <div className="mt-1 max-w-xs break-words text-sm text-soft">{t.statusReason}</div>
                  )}
                </TableCell>
                <TableCell className="min-w-[18rem] text-right">
                  {t.status === 'parse_failed' ? (
                    <div className="inline-flex items-center gap-3.5">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => { setErr(null); reparse.mutate(t.id); }}>
                        Znovu zpracovat
                      </Button>
                      <button type="button" className="text-sm text-soft hover:text-ink disabled:opacity-50" disabled={busy} onClick={() => { setErr(null); ignore.mutate(t.id); }}>
                        Ignorovat
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Gated strictly on status, not on duplicateOfTransactionId being
                          non-null: a reparse can move a row back to 'unmatched' while
                          leaving that field populated from the earlier duplicate check,
                          and showing this text then would describe a state the row is
                          no longer in. */}
                      {t.status === 'suspected_duplicate' && (
                        <p className="text-left text-sm text-soft">
                          Shodná platba už je spárovaná. Pokud šlo o dvě samostatné platby,
                          přiřaď ji ručně, jinak ji ignoruj.
                        </p>
                      )}
                      {contractsError && (
                        <p className="text-sm text-late">Nepodařilo se načíst pronájmy.</p>
                      )}
                      <div className="flex items-center justify-end gap-2">
                        <select
                          className="select-native h-7 w-auto max-w-[16rem] text-sm"
                          aria-label="Pronájem"
                          value={choice[t.id] ?? ''}
                          disabled={contractsError}
                          onChange={e => setChoice(c => ({ ...c, [t.id]: e.target.value }))}
                        >
                          <option value="">Přiřadit k pronájmu…</option>
                          {contracts.map(c => (
                            <option key={c.id} value={c.id}>{contractLabel(c)}</option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          disabled={busy || contractsError || !choice[t.id]}
                          onClick={() => {
                            setErr(null);
                            // On a suspected_duplicate this button IS the human
                            // override: the user has looked at the parked row and
                            // is saying it is a separate transfer. Anywhere else,
                            // no override — duplicate detection should still
                            // refuse a careless pairing.
                            assign.mutate({
                              id: t.id,
                              contractId: choice[t.id]!,
                              confirmDuplicate: t.status === 'suspected_duplicate',
                            });
                          }}
                        >
                          {t.status === 'suspected_duplicate' ? 'Není duplikát' : 'Přiřadit'}
                        </Button>
                        <button type="button" className="text-sm text-soft hover:text-ink disabled:opacity-50" disabled={busy} onClick={() => { setErr(null); ignore.mutate(t.id); }}>
                          Ignorovat
                        </button>
                      </div>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
