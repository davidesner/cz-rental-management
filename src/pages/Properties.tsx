import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Property {
  id: string; name: string; address: string | null;
  reconciliationSkill: string | null; note: string | null;
}

export function PropertiesPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['properties'], queryFn: () => api.get<{ properties: Property[] }>('/api/properties') });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', reconciliationSkill: '' });
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ property: Property }>('/api/properties', {
      name: form.name,
      address: form.address || null,
      reconciliationSkill: form.reconciliationSkill || null,
    }),
    onSuccess: () => {
      setOpen(false);
      setForm({ name: '', address: '', reconciliationSkill: '' });
      qc.invalidateQueries({ queryKey: ['properties'] });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Properties</h1>
        <Button onClick={() => { setErr(null); setOpen(true); }}>New property</Button>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead><TableHead>Address</TableHead><TableHead>Skill</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.properties ?? []).map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.address ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs">{p.reconciliationSkill ?? '—'}</TableCell>
              </TableRow>
            ))}
            {(data?.properties ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground py-8">No properties yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">New property</h2>
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Address</Label>
              <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
            </div>
            <div>
              <Label>Reconciliation skill</Label>
              <Input placeholder="e.g. reference-reconciliation" value={form.reconciliationSkill} onChange={e => setForm({ ...form, reconciliationSkill: e.target.value })} />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending}>Create</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
