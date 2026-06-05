import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ReconciliationItem {
  kind: string;
  paid: number;
  actualCost: number;
  difference: number;
}

interface Reconciliation {
  id: string;
  contractId: string;
  periodFrom: string;
  periodTo: string;
  status: string;
  computedAt: string | null;
  items: ReconciliationItem[];
}

interface Contract { id: string; propertyId: string; tenantId: string; }
interface Property { id: string; name: string; }
interface Tenant { id: string; name: string; }

function fmtKc(halere: number) {
  return (halere / 100).toFixed(2) + ' Kč';
}

export function ReconciliationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['reconciliations'],
    queryFn: () => api.get<{ reconciliations: Reconciliation[] }>('/api/reconciliations'),
  });
  const { data: contractsData } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => api.get<{ contracts: Contract[] }>('/api/contracts'),
  });
  const { data: propertiesData } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get<{ properties: Property[] }>('/api/properties'),
  });
  const { data: tenantsData } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => api.get<{ tenants: Tenant[] }>('/api/tenants'),
  });

  const contracts = contractsData?.contracts ?? [];
  const propertyMap = Object.fromEntries((propertiesData?.properties ?? []).map(p => [p.id, p.name]));
  const tenantMap = Object.fromEntries((tenantsData?.tenants ?? []).map(t => [t.id, t.name]));

  const contractLabel = (contractId: string) => {
    const c = contracts.find(x => x.id === contractId);
    if (!c) return contractId;
    return `${propertyMap[c.propertyId] ?? c.propertyId} / ${tenantMap[c.tenantId] ?? c.tenantId}`;
  };

  const totalDiff = (items: ReconciliationItem[]) =>
    items.reduce((sum, i) => sum + i.difference, 0);

  // Compute dialog
  const [computeOpen, setComputeOpen] = useState(false);
  const [computeForm, setComputeForm] = useState({ contractId: '', periodFrom: '', periodTo: '' });
  const [computeErr, setComputeErr] = useState<string | null>(null);

  const computeMutation = useMutation({
    mutationFn: () =>
      api.post<{ reconciliation: Reconciliation }>(
        `/api/contracts/${computeForm.contractId}/reconciliations/compute`,
        { periodFrom: computeForm.periodFrom, periodTo: computeForm.periodTo }
      ),
    onSuccess: (result) => {
      setComputeOpen(false);
      setComputeForm({ contractId: '', periodFrom: '', periodTo: '' });
      qc.invalidateQueries({ queryKey: ['reconciliations'] });
      navigate(`/reconciliations/${result.reconciliation.id}`);
    },
    onError: (e: unknown) => setComputeErr(e instanceof Error ? e.message : String(e)),
  });

  const reconciliations = data?.reconciliations ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Reconciliations</h1>
        <Button onClick={() => { setComputeErr(null); setComputeOpen(true); }}>Compute</Button>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contract</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Total diff</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reconciliations.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{contractLabel(r.contractId)}</TableCell>
                <TableCell>{r.periodFrom} – {r.periodTo}</TableCell>
                <TableCell>{r.status}</TableCell>
                <TableCell>{fmtKc(totalDiff(r.items ?? []))}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => navigate(`/reconciliations/${r.id}`)}>Open</Button>
                </TableCell>
              </TableRow>
            ))}
            {reconciliations.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No reconciliations yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Compute dialog */}
      {computeOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setComputeOpen(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">Compute reconciliation</h2>
            <div>
              <Label>Contract</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={computeForm.contractId}
                onChange={e => setComputeForm({ ...computeForm, contractId: e.target.value })}
              >
                <option value="">Select contract…</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{contractLabel(c.id)}</option>)}
              </select>
            </div>
            <div>
              <Label>Period from</Label>
              <Input type="date" value={computeForm.periodFrom} onChange={e => setComputeForm({ ...computeForm, periodFrom: e.target.value })} />
            </div>
            <div>
              <Label>Period to</Label>
              <Input type="date" value={computeForm.periodTo} onChange={e => setComputeForm({ ...computeForm, periodTo: e.target.value })} />
            </div>
            {computeErr && <p className="text-sm text-destructive">{computeErr}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setComputeOpen(false)}>Cancel</Button>
              <Button
                onClick={() => computeMutation.mutate()}
                disabled={!computeForm.contractId || !computeForm.periodFrom || !computeForm.periodTo || computeMutation.isPending}
              >
                Compute
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
