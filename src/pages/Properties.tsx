import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableEmpty, TableError } from '@/components/ui/table-error';
import { isActiveContract, useContracts } from '@/hooks/useContracts';

interface Property {
  id: string; name: string; address: string | null;
  reconciliationSkill: string | null; note: string | null;
}

export function PropertiesPage() {
  const qc = useQueryClient();
  const { data, isError, refetch } = useQuery({ queryKey: ['properties'], queryFn: () => api.get<{ properties: Property[] }>('/api/properties') });
  const contracts = useContracts();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', reconciliationSkill: '' });
  const [err, setErr] = useState<string | null>(null);

  // Current tenant per property: the contract running today. Joined here
  // because the properties endpoint knows nothing about contracts.
  const tenantByProperty = new Map<string, { contractId: string; tenantName: string }>();
  for (const c of contracts.data?.contracts ?? []) {
    if (isActiveContract(c) && !tenantByProperty.has(c.propertyId)) tenantByProperty.set(c.propertyId, { contractId: c.id, tenantName: c.tenantName });
  }

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
    onError: (e: unknown) => setErr(apiErrorMessage(e)),
  });

  return (
    <>
      <PageHeader
        title="Nemovitosti"
        actions={<Button onClick={() => { setErr(null); setOpen(true); }}><Plus className="h-4 w-4" strokeWidth={2.2} />Nová nemovitost</Button>}
      />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nemovitost</TableHead>
              <TableHead>Aktuální nájemník</TableHead>
              <TableHead>Postup vyúčtování</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError && !data ? (
              <TableError cols={3} onRetry={() => refetch()} />
            ) : !data ? (
              <TableSkeleton cols={3} />
            ) : data.properties.length === 0 ? (
              <TableEmpty cols={3}>Zatím žádné nemovitosti. Přidej první.</TableEmpty>
            ) : (
              data.properties.map(p => {
                const t = tenantByProperty.get(p.id);
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link to={`/properties/${p.id}`} className="font-medium text-ink">{p.name}</Link>
                      {p.address && <div className="text-sm text-soft">{p.address}</div>}
                    </TableCell>
                    <TableCell>
                      {t ? <Link to={`/contracts/${t.contractId}`} className="text-ink">{t.tenantName}</Link>
                        : contracts.data ? <span className="text-soft">volná</span> : <span className="text-wait">…</span>}
                    </TableCell>
                    <TableCell>{p.reconciliationSkill ? <code>{p.reconciliationSkill}</code> : <span className="text-soft">—</span>}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {open && (
        <Modal
          title="Nová nemovitost"
          onClose={() => setOpen(false)}
          footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
            <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending}>Vytvořit</Button>
          </>}
        >
          <div>
            <Label htmlFor="p-name">Název</Label>
            <Input id="p-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="p-address">Adresa</Label>
            <Input id="p-address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="p-skill">Postup vyúčtování</Label>
            <Input id="p-skill" placeholder="např. svj-lipova" value={form.reconciliationSkill} onChange={e => setForm({ ...form, reconciliationSkill: e.target.value })} />
            <p className="mt-1 text-xs text-soft">Název postupu, který agent použije při ročním vyúčtování této nemovitosti.</p>
          </div>
          {err && <p className="text-sm text-late">{err}</p>}
        </Modal>
      )}
    </>
  );
}
