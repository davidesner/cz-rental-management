import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Payment {
  id: string;
  paidAt: string;
  amount: number;
  counterparty: string | null;
  contractId: string | null;
  source: string;
  externalId: string | null;
}

interface Contract { id: string; propertyId: string; tenantId: string; }
interface Property { id: string; name: string; }
interface Tenant { id: string; name: string; }

function fmtKc(halere: number) {
  return (halere / 100).toFixed(2) + ' Kč';
}

export function PaymentsPage() {
  const qc = useQueryClient();
  const [showUnassigned, setShowUnassigned] = useState(false);

  const { data } = useQuery({
    queryKey: ['payments', showUnassigned],
    queryFn: () => api.get<{ payments: Payment[] }>(`/api/payments${showUnassigned ? '?unassigned=true' : ''}`),
  });
  const { data: contractsData } = useQuery({ queryKey: ['contracts'], queryFn: () => api.get<{ contracts: Contract[] }>('/api/contracts') });
  const { data: propertiesData } = useQuery({ queryKey: ['properties'], queryFn: () => api.get<{ properties: Property[] }>('/api/properties') });
  const { data: tenantsData } = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<{ tenants: Tenant[] }>('/api/tenants') });

  const contracts = contractsData?.contracts ?? [];
  const propertyMap = Object.fromEntries((propertiesData?.properties ?? []).map(p => [p.id, p.name]));
  const tenantMap = Object.fromEntries((tenantsData?.tenants ?? []).map(t => [t.id, t.name]));

  const contractLabel = (c: Contract) =>
    `${propertyMap[c.propertyId] ?? c.propertyId} / ${tenantMap[c.tenantId] ?? c.tenantId}`;

  // New payment dialog
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ contractId: '', amount: '', paidAt: '', counterparty: '', source: 'manual', externalId: '' });
  const [newErr, setNewErr] = useState<string | null>(null);

  const createPayment = useMutation({
    mutationFn: () => api.post<{ payment: Payment }>('/api/payments', {
      contractId: newForm.contractId || null,
      amount: Math.round(parseFloat(newForm.amount) * 100),
      paidAt: newForm.paidAt,
      counterparty: newForm.counterparty || null,
      source: newForm.source,
      externalId: newForm.externalId || null,
    }),
    onSuccess: () => {
      setNewOpen(false);
      setNewForm({ contractId: '', amount: '', paidAt: '', counterparty: '', source: 'manual', externalId: '' });
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (e: unknown) => setNewErr(e instanceof Error ? e.message : String(e)),
  });

  // Assign dialog
  const [assignPayment, setAssignPayment] = useState<Payment | null>(null);
  const [assignContractId, setAssignContractId] = useState('');
  const [assignErr, setAssignErr] = useState<string | null>(null);

  const assignMutation = useMutation({
    mutationFn: () => api.patch<{ payment: Payment }>(`/api/payments/${assignPayment!.id}/assign`, { contractId: assignContractId }),
    onSuccess: () => {
      setAssignPayment(null);
      setAssignContractId('');
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (e: unknown) => setAssignErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Payments</h1>
        <div className="flex gap-2">
          <Button variant={showUnassigned ? 'outline' : 'default'} size="sm" onClick={() => setShowUnassigned(false)}>All</Button>
          <Button variant={showUnassigned ? 'default' : 'outline'} size="sm" onClick={() => setShowUnassigned(true)}>Inbox (unassigned)</Button>
          <Button onClick={() => { setNewErr(null); setNewOpen(true); }}>New payment</Button>
        </div>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Paid at</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Counterparty</TableHead>
              <TableHead>Contract</TableHead>
              <TableHead>Source</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.payments ?? []).map(p => (
              <TableRow key={p.id}>
                <TableCell>{p.paidAt}</TableCell>
                <TableCell>{fmtKc(p.amount)}</TableCell>
                <TableCell>{p.counterparty ?? '—'}</TableCell>
                <TableCell>{p.contractId ?? '—'}</TableCell>
                <TableCell>{p.source}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setAssignErr(null); setAssignContractId(p.contractId ?? ''); setAssignPayment(p); }}
                  >
                    Assign
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(data?.payments ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No payments.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* New payment dialog */}
      {newOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setNewOpen(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">New payment</h2>
            <div>
              <Label>Contract (optional)</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={newForm.contractId}
                onChange={e => setNewForm({ ...newForm, contractId: e.target.value })}
              >
                <option value="">None</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{contractLabel(c)}</option>)}
              </select>
            </div>
            <div>
              <Label>Amount (Kč)</Label>
              <Input type="text" placeholder="0.00" value={newForm.amount} onChange={e => setNewForm({ ...newForm, amount: e.target.value })} />
            </div>
            <div>
              <Label>Paid at</Label>
              <Input type="date" value={newForm.paidAt} onChange={e => setNewForm({ ...newForm, paidAt: e.target.value })} />
            </div>
            <div>
              <Label>Counterparty</Label>
              <Input value={newForm.counterparty} onChange={e => setNewForm({ ...newForm, counterparty: e.target.value })} />
            </div>
            <div>
              <Label>Source</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={newForm.source}
                onChange={e => setNewForm({ ...newForm, source: e.target.value })}
              >
                <option value="manual">manual</option>
                <option value="bank">bank</option>
              </select>
            </div>
            <div>
              <Label>External ID (optional)</Label>
              <Input value={newForm.externalId} onChange={e => setNewForm({ ...newForm, externalId: e.target.value })} />
            </div>
            {newErr && <p className="text-sm text-destructive">{newErr}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
              <Button
                onClick={() => createPayment.mutate()}
                disabled={!newForm.amount || !newForm.paidAt || createPayment.isPending}
              >
                Create
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Assign dialog */}
      {assignPayment && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setAssignPayment(null)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">Assign payment</h2>
            <p className="text-sm text-muted-foreground">Amount: {fmtKc(assignPayment.amount)} on {assignPayment.paidAt}</p>
            <div>
              <Label>Contract</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={assignContractId}
                onChange={e => setAssignContractId(e.target.value)}
              >
                <option value="">Select contract…</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{contractLabel(c)}</option>)}
              </select>
            </div>
            {assignErr && <p className="text-sm text-destructive">{assignErr}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAssignPayment(null)}>Cancel</Button>
              <Button onClick={() => assignMutation.mutate()} disabled={!assignContractId || assignMutation.isPending}>Assign</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
