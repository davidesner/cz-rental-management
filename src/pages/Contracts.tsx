import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Property { id: string; name: string; }
interface Tenant { id: string; name: string; }
interface Contract {
  id: string;
  propertyId: string;
  tenantId: string;
  startDate: string;
  endDate: string | null;
  securityDeposit: number | null;
}

export function ContractsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['contracts'], queryFn: () => api.get<{ contracts: Contract[] }>('/api/contracts') });
  const { data: propertiesData } = useQuery({ queryKey: ['properties'], queryFn: () => api.get<{ properties: Property[] }>('/api/properties') });
  const { data: tenantsData } = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<{ tenants: Tenant[] }>('/api/tenants') });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ propertyId: '', tenantId: '', startDate: '', endDate: '', securityDeposit: '' });
  const [err, setErr] = useState<string | null>(null);

  const properties = propertiesData?.properties ?? [];
  const tenants = tenantsData?.tenants ?? [];

  const propertiesById = Object.fromEntries(properties.map(p => [p.id, p]));
  const tenantsById = Object.fromEntries(tenants.map(t => [t.id, t]));

  const create = useMutation({
    mutationFn: () => {
      const depositHalere = form.securityDeposit
        ? Math.round(parseFloat(form.securityDeposit) * 100)
        : null;
      return api.post<{ contract: Contract }>('/api/contracts', {
        propertyId: form.propertyId,
        tenantId: form.tenantId,
        startDate: form.startDate,
        endDate: form.endDate || null,
        securityDeposit: depositHalere,
      });
    },
    onSuccess: () => {
      setOpen(false);
      setForm({ propertyId: '', tenantId: '', startDate: '', endDate: '', securityDeposit: '' });
      qc.invalidateQueries({ queryKey: ['contracts'] });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Pronájmy</h1>
        <Button onClick={() => { setErr(null); setOpen(true); }}>Nový pronájem</Button>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nájemník</TableHead>
              <TableHead>Nemovitost</TableHead>
              <TableHead>Výše nájmu</TableHead>
              <TableHead>Období</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.contracts ?? []).map(c => {
              const tenant = tenantsById[c.tenantId];
              const property = propertiesById[c.propertyId];
              return (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/contracts/${c.id}`)}
                >
                  <TableCell className="font-medium">
                    {tenant?.name ?? c.tenantId}
                  </TableCell>
                  <TableCell>
                    {property ? (
                      <Link
                        to={`/properties/${property.id}`}
                        className="underline text-primary hover:opacity-70"
                        onClick={e => e.stopPropagation()}
                      >
                        {property.name}
                      </Link>
                    ) : (
                      c.propertyId
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell>
                    {c.startDate} – {c.endDate ?? 'běží'}
                  </TableCell>
                </TableRow>
              );
            })}
            {(data?.contracts ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">Zatím žádné pronájmy.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">Nový pronájem</h2>
            <div>
              <Label>Nemovitost</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.propertyId}
                onChange={e => setForm({ ...form, propertyId: e.target.value })}
              >
                <option value="">Vyber nemovitost…</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Nájemník</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.tenantId}
                onChange={e => setForm({ ...form, tenantId: e.target.value })}
              >
                <option value="">Vyber nájemníka…</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Datum začátku</Label>
              <Input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div>
              <Label>Datum konce (volitelné)</Label>
              <Input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
            </div>
            <div>
              <Label>Kauce (Kč)</Label>
              <Input type="text" placeholder="0.00" value={form.securityDeposit} onChange={e => setForm({ ...form, securityDeposit: e.target.value })} />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
              <Button
                onClick={() => create.mutate()}
                disabled={!form.propertyId || !form.tenantId || !form.startDate || create.isPending}
              >
                Vytvořit
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
