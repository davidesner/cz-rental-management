import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface CostStatement {
  id: string;
  propertyId: string;
  kind: string;
  periodFrom: string;
  periodTo: string;
  totalAmount: number;
  adjustmentAmount: number | null;
  adjustmentNote: string | null;
  documentRef: string | null;
}

interface Property { id: string; name: string; }

function fmtKc(halere: number) {
  return (halere / 100).toFixed(2) + ' Kč';
}

export function CostStatementsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['cost-statements'],
    queryFn: () => api.get<{ costStatements: CostStatement[] }>('/api/cost-statements'),
  });
  const { data: propertiesData } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get<{ properties: Property[] }>('/api/properties'),
  });

  const properties = propertiesData?.properties ?? [];
  const propertyMap = Object.fromEntries(properties.map(p => [p.id, p.name]));

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    propertyId: '',
    kind: 'services',
    periodFrom: '',
    periodTo: '',
    totalAmount: '',
    adjustmentAmount: '',
    adjustmentNote: '',
    documentRef: '',
  });
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ costStatement: CostStatement }>('/api/cost-statements', {
      propertyId: form.propertyId,
      kind: form.kind,
      periodFrom: form.periodFrom,
      periodTo: form.periodTo,
      totalAmount: Math.round(parseFloat(form.totalAmount) * 100),
      adjustmentAmount: form.adjustmentAmount ? Math.round(parseFloat(form.adjustmentAmount) * 100) : null,
      adjustmentNote: form.adjustmentNote || null,
      documentRef: form.documentRef || null,
    }),
    onSuccess: () => {
      setOpen(false);
      setForm({ propertyId: '', kind: 'services', periodFrom: '', periodTo: '', totalAmount: '', adjustmentAmount: '', adjustmentNote: '', documentRef: '' });
      qc.invalidateQueries({ queryKey: ['cost-statements'] });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const statements = data?.costStatements ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Cost statements</h1>
        <Button onClick={() => { setErr(null); setOpen(true); }}>New statement</Button>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Property</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Adjustment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statements.map(s => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{propertyMap[s.propertyId] ?? s.propertyId}</TableCell>
                <TableCell>{s.kind}</TableCell>
                <TableCell>{s.periodFrom} – {s.periodTo}</TableCell>
                <TableCell>{fmtKc(s.totalAmount)}</TableCell>
                <TableCell>{s.adjustmentAmount != null ? fmtKc(s.adjustmentAmount) : '—'}</TableCell>
              </TableRow>
            ))}
            {statements.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No cost statements yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">New cost statement</h2>
            <div>
              <Label>Property</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.propertyId}
                onChange={e => setForm({ ...form, propertyId: e.target.value })}
              >
                <option value="">Select property…</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Kind</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.kind}
                onChange={e => setForm({ ...form, kind: e.target.value })}
              >
                <option value="services">services</option>
                <option value="electricity">electricity</option>
                <option value="gas">gas</option>
                <option value="internet">internet</option>
                <option value="water">water</option>
                <option value="other">other</option>
              </select>
            </div>
            <div>
              <Label>Period from</Label>
              <Input type="date" value={form.periodFrom} onChange={e => setForm({ ...form, periodFrom: e.target.value })} />
            </div>
            <div>
              <Label>Period to</Label>
              <Input type="date" value={form.periodTo} onChange={e => setForm({ ...form, periodTo: e.target.value })} />
            </div>
            <div>
              <Label>Total amount (Kč)</Label>
              <Input type="text" placeholder="0.00" value={form.totalAmount} onChange={e => setForm({ ...form, totalAmount: e.target.value })} />
            </div>
            <div>
              <Label>Adjustment amount (Kč, signed, optional)</Label>
              <Input type="text" placeholder="0.00" value={form.adjustmentAmount} onChange={e => setForm({ ...form, adjustmentAmount: e.target.value })} />
            </div>
            <div>
              <Label>Adjustment note (optional)</Label>
              <Input value={form.adjustmentNote} onChange={e => setForm({ ...form, adjustmentNote: e.target.value })} />
            </div>
            <div>
              <Label>Document ref (optional)</Label>
              <Input value={form.documentRef} onChange={e => setForm({ ...form, documentRef: e.target.value })} />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() => create.mutate()}
                disabled={!form.propertyId || !form.periodFrom || !form.periodTo || !form.totalAmount || create.isPending}
              >
                Create
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
