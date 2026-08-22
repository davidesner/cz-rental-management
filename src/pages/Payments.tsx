import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableError } from '@/components/ui/table-error';
import { DuplicatePaymentError } from '@/components/DuplicatePaymentError';
import { formatSymbols } from '@/lib/symbols';

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

function fmtKc(halere: number) {
  return (halere / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
}

export function PaymentsPage() {
  const qc = useQueryClient();
  const [showUnassigned, setShowUnassigned] = useState(false);

  const { data, isError, refetch } = useQuery({
    queryKey: ['payments', showUnassigned],
    queryFn: () => api.get<{ payments: Payment[] }>(`/api/payments${showUnassigned ? '?unassigned=true' : ''}`),
  });
  const { data: contractsData } = useQuery({ queryKey: ['contracts'], queryFn: () => api.get<{ contracts: Contract[] }>('/api/contracts') });

  const contracts = contractsData?.contracts ?? [];

  const contractLabel = (c: Contract) => `${c.propertyName} / ${c.tenantName}`;

  // New payment dialog
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ contractId: '', amount: '', paidAt: '', counterparty: '', source: 'manual', externalId: '' });
  const [newErr, setNewErr] = useState<unknown>(null);
  // Every field edit clears newErr (see setNewField below) — a corrected
  // amount can never silently carry forward a stale "yes, duplicate" decision
  // from a previous submission of this dialog.
  const setNewField = (patch: Partial<typeof newForm>) => { setNewForm(f => ({ ...f, ...patch })); setNewErr(null); };

  const createPayment = useMutation({
    mutationFn: (vars?: { allowDuplicate?: boolean }) => api.post<{ payment: Payment }>('/api/payments', {
      contractId: newForm.contractId || null,
      amount: Math.round(parseFloat(newForm.amount) * 100),
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
      qc.invalidateQueries({ queryKey: ['payments'] });
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
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (e: unknown) => setAssignErr(e),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Platby</h1>
        <div className="flex gap-2">
          <Button variant={showUnassigned ? 'outline' : 'default'} size="sm" onClick={() => setShowUnassigned(false)}>Všechny</Button>
          <Button variant={showUnassigned ? 'default' : 'outline'} size="sm" onClick={() => setShowUnassigned(true)}>Inbox (nepřiřazené)</Button>
          <Button onClick={() => { setNewErr(null); setNewOpen(true); }}>Nová platba</Button>
        </div>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Zaplaceno dne</TableHead>
              <TableHead>Částka</TableHead>
              <TableHead>Protistrana</TableHead>
              <TableHead>Smlouva</TableHead>
              <TableHead>Zdroj</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError && !data ? (
              <TableError cols={6} onRetry={() => refetch()} />
            ) : !data ? (
              <TableSkeleton cols={6} />
            ) : data.payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">Žádné platby.</TableCell>
              </TableRow>
            ) : (
              data.payments.map(p => (
                <TableRow key={p.id}>
                  <TableCell>{p.paidAt}</TableCell>
                  <TableCell>{fmtKc(p.amount)}</TableCell>
                  {/* Symbols ride along under Protistrana instead of taking a
                      seventh column — this table is already six wide. */}
                  <TableCell>
                    <div>{p.counterparty ?? '—'}</div>
                    {formatSymbols(p) && (
                      <div className="text-xs text-muted-foreground">{formatSymbols(p)}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.contractId ? `${p.propertyName ?? '—'} / ${p.tenantName ?? '—'}` : '—'}
                  </TableCell>
                  <TableCell>{p.source}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setAssignPayment(p); setAssignContractId(p.contractId ?? ''); setAssignErr(null); }}
                    >
                      Přiřadit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* New payment dialog */}
      {newOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setNewOpen(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">Nová platba</h2>
            <div>
              <Label>Smlouva (volitelné)</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={newForm.contractId}
                onChange={e => setNewField({ contractId: e.target.value })}
              >
                <option value="">Žádná</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{contractLabel(c)}</option>)}
              </select>
            </div>
            <div>
              <Label>Částka (Kč)</Label>
              <Input type="text" placeholder="0.00" value={newForm.amount} onChange={e => setNewField({ amount: e.target.value })} />
            </div>
            <div>
              <Label>Zaplaceno dne</Label>
              <Input type="date" value={newForm.paidAt} onChange={e => setNewField({ paidAt: e.target.value })} />
            </div>
            <div>
              <Label>Protistrana</Label>
              <Input value={newForm.counterparty} onChange={e => setNewField({ counterparty: e.target.value })} />
            </div>
            <div>
              <Label>Zdroj</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={newForm.source}
                onChange={e => setNewField({ source: e.target.value })}
              >
                <option value="manual">Ručně</option>
                <option value="bank">Banka</option>
              </select>
            </div>
            <div>
              <Label>Externí ID (volitelné)</Label>
              <Input value={newForm.externalId} onChange={e => setNewField({ externalId: e.target.value })} />
            </div>
            <DuplicatePaymentError
              error={newErr}
              pending={createPayment.isPending}
              onForce={() => createPayment.mutate({ allowDuplicate: true })}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNewOpen(false)}>Zrušit</Button>
              <Button
                onClick={() => createPayment.mutate({})}
                disabled={!newForm.amount || !newForm.paidAt || createPayment.isPending}
              >
                Vytvořit
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Assign dialog */}
      {assignPayment && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setAssignPayment(null)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">Přiřadit platbu</h2>
            <p className="text-sm text-muted-foreground">Částka: {fmtKc(assignPayment.amount)} dne {assignPayment.paidAt}</p>
            <div>
              <Label>Smlouva</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={assignContractId}
                onChange={e => { setAssignContractId(e.target.value); setAssignErr(null); }}
              >
                <option value="">Vyber smlouvu…</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{contractLabel(c)}</option>)}
              </select>
            </div>
            <DuplicatePaymentError
              error={assignErr}
              pending={assignMutation.isPending}
              onForce={() => assignMutation.mutate({ allowDuplicate: true })}
              label="Přesto přiřadit"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAssignPayment(null)} disabled={assignMutation.isPending}>Zrušit</Button>
              <Button onClick={() => assignMutation.mutate({})} disabled={!assignContractId || assignMutation.isPending}>Přiřadit</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
