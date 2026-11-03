import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Notice } from '@/components/ui/notice';
import { Seg } from '@/components/ui/seg';
import { PageHeader } from '@/components/ui/page-header';
import { Pager, usePager } from '@/components/ui/pager';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableEmpty, TableError } from '@/components/ui/table-error';
import { DuplicatePaymentError } from '@/components/DuplicatePaymentError';
import { formatSymbols } from '@/lib/symbols';
import { parseKorun } from '@/lib/money';
import { fmtDate, fmtKcExact } from '@/lib/format';

interface Payment {
  id: string;
  paidAt: string;
  amount: number;
  counterparty: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
  contractId: string | null;
  source: string;
  externalId: string | null;
  propertyName: string | null;
  tenantName: string | null;
}

interface Contract { id: string; propertyId: string; tenantId: string; propertyName: string; tenantName: string; }

const SOURCE_LABEL: Record<string, string> = { manual: 'ručně', bank: 'banka' };
const PAGE_SIZE = 25;

export function PaymentsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [showUnassigned, setShowUnassigned] = useState(() => new URLSearchParams(window.location.search).get('filter') === 'unassigned');

  const { data, isError, refetch } = useQuery({
    queryKey: ['payments', showUnassigned],
    queryFn: () => api.get<{ payments: Payment[] }>(`/api/payments${showUnassigned ? '?unassigned=true' : ''}`),
  });
  const unassignedCount = useQuery({
    queryKey: ['payments', 'unassigned-count'],
    queryFn: () => api.get<{ payments: unknown[] }>('/api/payments?unassigned=true'),
    select: d => d.payments.length,
  });
  const { data: contractsData } = useQuery({ queryKey: ['contracts'], queryFn: () => api.get<{ contracts: Contract[] }>('/api/contracts') });

  const contracts = contractsData?.contracts ?? [];
  const contractLabel = (c: Contract) => `${c.propertyName} / ${c.tenantName}`;

  const sorted = [...(data?.payments ?? [])].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  const pager = usePager(sorted, PAGE_SIZE);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['payments'] });
  };

  // New payment dialog
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ contractId: '', amount: '', paidAt: '', counterparty: '', source: 'manual', externalId: '' });
  const [newErr, setNewErr] = useState<unknown>(null);
  // Every field edit clears newErr (see setNewField below) — a corrected
  // amount can never silently carry forward a stale "yes, duplicate" decision
  // from a previous submission of this dialog.
  const setNewField = (patch: Partial<typeof newForm>) => { setNewForm(f => ({ ...f, ...patch })); setNewErr(null); };
  // A payment amount is required, so 'empty' is just as unsubmittable as
  // 'invalid' — unlike PairingCard's amount band, there is no "cokoliv" here.
  const newAmount = parseKorun(newForm.amount);
  const newAmountInvalid = newAmount.kind !== 'value';

  // ?action=new opens the dialog on load (the dashboard's "Nová platba" link).
  useEffect(() => {
    if (params.get('action') !== 'new') return;
    setNewErr(null);
    setNewOpen(true);
    const next = new URLSearchParams(params);
    next.delete('action');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const createPayment = useMutation({
    mutationFn: (vars?: { allowDuplicate?: boolean }) => api.post<{ payment: Payment }>('/api/payments', {
      contractId: newForm.contractId || null,
      amount: newAmount.kind === 'value' ? newAmount.halere : 0,
      paidAt: newForm.paidAt,
      counterparty: newForm.counterparty || null,
      source: newForm.source,
      externalId: newForm.externalId || null,
      allowDuplicate: vars?.allowDuplicate,
    }),
    onSuccess: () => {
      setNewOpen(false);
      setNewForm({ contractId: '', amount: '', paidAt: '', counterparty: '', source: 'manual', externalId: '' });
      setNewErr(null);
      invalidate();
    },
    onError: (e: unknown) => setNewErr(e),
  });

  // Assign dialog
  const [assignPayment, setAssignPayment] = useState<Payment | null>(null);
  const [assignContractId, setAssignContractId] = useState('');
  const [assignErr, setAssignErr] = useState<unknown>(null);

  const assignMutation = useMutation({
    mutationFn: (vars?: { allowDuplicate?: boolean }) => api.patch<{ payment: Payment }>(`/api/payments/${assignPayment!.id}/assign`, { contractId: assignContractId, allowDuplicate: vars?.allowDuplicate }),
    onSuccess: () => {
      setAssignPayment(null);
      setAssignContractId('');
      setAssignErr(null);
      invalidate();
    },
    onError: (e: unknown) => setAssignErr(e),
  });

  // Delete
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (paymentId: string) => api.delete<void>(`/api/payments/${paymentId}`),
    onSuccess: () => {
      setDeleteErr(null);
      invalidate();
      // A deleted bank-sourced payment returns its bank_transaction to the
      // Nepřiřazené platby inbox (paymentId is SET NULL there) — refresh it
      // so the returned transaction shows up without a manual reload.
      qc.invalidateQueries({ queryKey: ['bank-transactions'] });
    },
    onError: (e: unknown) => setDeleteErr(apiErrorMessage(e)),
  });

  const unassignedLabel = unassignedCount.data ? `Nepřiřazené (${unassignedCount.data})` : 'Nepřiřazené';

  return (
    <>
      <PageHeader
        title="Platby"
        actions={<>
          <Seg
            label="Filtr plateb"
            value={showUnassigned ? 'unassigned' : 'all'}
            onChange={v => { setShowUnassigned(v === 'unassigned'); pager.setPage(0); }}
            options={[{ value: 'all', label: 'Všechny' }, { value: 'unassigned', label: unassignedLabel }]}
          />
          <Button onClick={() => { setNewErr(null); setNewOpen(true); }}><Plus className="h-4 w-4" strokeWidth={2.2} />Nová platba</Button>
        </>}
      />
      {deleteErr && <Notice kind="err" onClose={() => setDeleteErr(null)}>{deleteErr}</Notice>}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Zaplaceno dne</TableHead>
              <TableHead className="num">Částka</TableHead>
              <TableHead>Protistrana</TableHead>
              <TableHead>Pronájem</TableHead>
              <TableHead>Zdroj</TableHead>
              <TableHead><span className="sr-only">Akce</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError && !data ? (
              <TableError cols={6} onRetry={() => refetch()} />
            ) : !data ? (
              <TableSkeleton cols={6} />
            ) : sorted.length === 0 ? (
              <TableEmpty cols={6}>{showUnassigned ? 'Všechny platby jsou přiřazené.' : 'Zatím žádné platby.'}</TableEmpty>
            ) : (
              pager.slice.map(p => (
                <TableRow key={p.id} className="rem">
                  <TableCell className="whitespace-nowrap">{fmtDate(p.paidAt)}</TableCell>
                  <TableCell className="num font-medium">{fmtKcExact(p.amount)}</TableCell>
                  {/* Symbols ride along under Protistrana instead of taking a
                      seventh column — this table is already six wide. */}
                  <TableCell>
                    <div>{p.counterparty ?? <span className="text-soft">—</span>}</div>
                    {formatSymbols(p) && <div className="text-sm text-soft">{formatSymbols(p)}</div>}
                  </TableCell>
                  <TableCell>
                    {p.contractId ? (
                      <Link to={`/contracts/${p.contractId}`} className="text-ink">
                        <div>{p.tenantName ?? '—'}</div>
                        <div className="text-sm text-soft">{p.propertyName ?? '—'}</div>
                      </Link>
                    ) : <span className="text-late">nepřiřazeno</span>}
                  </TableCell>
                  <TableCell className="text-soft">{SOURCE_LABEL[p.source] ?? p.source}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <span className="inline-flex items-center gap-3.5">
                      {p.contractId ? (
                        <button type="button" className="acts text-sm text-soft hover:text-accent" onClick={() => { setAssignPayment(p); setAssignContractId(p.contractId ?? ''); setAssignErr(null); }}>Přiřadit jinam</button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => { setAssignPayment(p); setAssignContractId(''); setAssignErr(null); }}>Přiřadit</Button>
                      )}
                      <button
                        type="button"
                        className="acts text-sm text-soft hover:text-late disabled:opacity-50"
                        disabled={deleteMutation.isPending}
                        title="Smazat platbu"
                        onClick={() => {
                          const base = `Smazat platbu ${fmtKcExact(p.amount)} ze dne ${fmtDate(p.paidAt)}?`;
                          const msg = p.source === 'bank'
                            ? `${base} Pokud k ní existuje navázaná bankovní transakce, vrátí se zpět do Nepřiřazených plateb k novému přiřazení.`
                            : base;
                          if (confirm(msg)) deleteMutation.mutate(p.id);
                        }}
                      >
                        Smazat
                      </button>
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <Pager page={pager.page} pageCount={pager.pageCount} from={pager.from} to={pager.to} total={pager.total} unit="plateb" onPage={pager.setPage} />
      </Card>

      {/* New payment dialog */}
      {newOpen && (
        <Modal
          title="Nová platba"
          onClose={() => setNewOpen(false)}
          footer={<>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Zrušit</Button>
            <Button onClick={() => createPayment.mutate({})} disabled={newAmountInvalid || !newForm.paidAt || createPayment.isPending}>Vytvořit</Button>
          </>}
        >
          <div>
            <Label htmlFor="np-contract">Pronájem (volitelné)</Label>
            <select id="np-contract" className="select-native" value={newForm.contractId} onChange={e => setNewField({ contractId: e.target.value })}>
              <option value="">Žádný</option>
              {contracts.map(c => <option key={c.id} value={c.id}>{contractLabel(c)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="np-amount">Částka (Kč)</Label>
              <Input id="np-amount" type="text" placeholder="19800" value={newForm.amount} onChange={e => setNewField({ amount: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="np-date">Zaplaceno dne</Label>
              <Input id="np-date" type="date" value={newForm.paidAt} onChange={e => setNewField({ paidAt: e.target.value })} />
            </div>
          </div>
          {newForm.amount !== '' && newAmountInvalid && (
            <p className="text-sm text-late">Částka musí být číslo v korunách, např. 35000 nebo 35000,50.</p>
          )}
          <div>
            <Label htmlFor="np-cp">Protistrana</Label>
            <Input id="np-cp" value={newForm.counterparty} onChange={e => setNewField({ counterparty: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="np-source">Zdroj</Label>
              <select id="np-source" className="select-native" value={newForm.source} onChange={e => setNewField({ source: e.target.value })}>
                <option value="manual">Ručně</option>
                <option value="bank">Banka</option>
              </select>
            </div>
            <div>
              <Label htmlFor="np-ext">Externí ID (volitelné)</Label>
              <Input id="np-ext" value={newForm.externalId} onChange={e => setNewField({ externalId: e.target.value })} />
            </div>
          </div>
          <DuplicatePaymentError
            error={newErr}
            pending={createPayment.isPending}
            onForce={() => createPayment.mutate({ allowDuplicate: true })}
          />
        </Modal>
      )}

      {/* Assign dialog */}
      {assignPayment && (
        <Modal
          title="Přiřadit platbu"
          description={`${fmtKcExact(assignPayment.amount)} ze dne ${fmtDate(assignPayment.paidAt)}`}
          onClose={() => setAssignPayment(null)}
          footer={<>
            <Button variant="outline" onClick={() => setAssignPayment(null)} disabled={assignMutation.isPending}>Zrušit</Button>
            <Button onClick={() => assignMutation.mutate({})} disabled={!assignContractId || assignMutation.isPending}>Přiřadit</Button>
          </>}
        >
          <div>
            <Label htmlFor="as-contract">Pronájem</Label>
            <select id="as-contract" className="select-native" value={assignContractId} onChange={e => { setAssignContractId(e.target.value); setAssignErr(null); }}>
              <option value="">Vyber pronájem…</option>
              {contracts.map(c => <option key={c.id} value={c.id}>{contractLabel(c)}</option>)}
            </select>
          </div>
          <DuplicatePaymentError
            error={assignErr}
            pending={assignMutation.isPending}
            onForce={() => assignMutation.mutate({ allowDuplicate: true })}
            label="Přesto přiřadit"
          />
        </Modal>
      )}
    </>
  );
}
