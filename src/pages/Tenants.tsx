import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { isActiveContract, leaseEnd, useContracts } from '@/hooks/useContracts';
import { fmtDate } from '@/lib/format';
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

interface Tenant {
  id: string; name: string; email: string | null; phone: string | null; accountNumber: string | null;
}

export function TenantsPage() {
  const qc = useQueryClient();
  const { data, isError, refetch } = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<{ tenants: Tenant[] }>('/api/tenants') });
  const contracts = useContracts();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', accountNumber: '' });

  // The tenant's lease: the running one, otherwise the most recent. Joined
  // here because the tenants endpoint knows nothing about contracts.
  const leaseByTenant = new Map<string, { id: string; propertyName: string; active: boolean; endDate: string | null }>();
  for (const c of [...(contracts.data?.contracts ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate))) {
    const cur = leaseByTenant.get(c.tenantId);
    const active = isActiveContract(c);
    if (!cur || (active && !cur.active)) leaseByTenant.set(c.tenantId, { id: c.id, propertyName: c.propertyName, active, endDate: leaseEnd(c) });
  }
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ tenant: Tenant }>('/api/tenants', {
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      accountNumber: form.accountNumber || null,
    }),
    onSuccess: () => {
      setOpen(false);
      setForm({ name: '', email: '', phone: '', accountNumber: '' });
      qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (e: unknown) => setErr(apiErrorMessage(e)),
  });

  const dash = <span className="text-soft">—</span>;

  return (
    <>
      <PageHeader
        title="Nájemci"
        actions={<Button onClick={() => { setErr(null); setOpen(true); }}><Plus className="h-4 w-4" strokeWidth={2.2} />Nový nájemce</Button>}
      />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jméno</TableHead>
              <TableHead>Pronájem</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Telefon</TableHead>
              <TableHead>Číslo účtu</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError && !data ? (
              <TableError cols={5} onRetry={() => refetch()} />
            ) : !data ? (
              <TableSkeleton cols={5} />
            ) : data.tenants.length === 0 ? (
              <TableEmpty cols={5}>Zatím žádní nájemci. Přidej prvního.</TableEmpty>
            ) : (
              data.tenants.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>
                    {(() => {
                      const l = leaseByTenant.get(t.id);
                      if (!l) return contracts.data ? <span className="text-soft">bez pronájmu</span> : <span className="text-wait">…</span>;
                      return (
                        <>
                          <Link to={`/contracts/${l.id}`} className="text-ink">{l.propertyName}</Link>
                          {!l.active && <div className="text-sm text-soft">ukončen {l.endDate ? fmtDate(l.endDate) : ''}</div>}
                        </>
                      );
                    })()}
                  </TableCell>
                  <TableCell>{t.email ? <a href={`mailto:${t.email}`} className="text-ink">{t.email}</a> : dash}</TableCell>
                  <TableCell className="whitespace-nowrap">{t.phone ?? dash}</TableCell>
                  <TableCell className="whitespace-nowrap">{t.accountNumber ?? dash}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {open && (
        <Modal
          title="Nový nájemce"
          onClose={() => setOpen(false)}
          footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
            <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending}>Vytvořit</Button>
          </>}
        >
          <div>
            <Label htmlFor="t-name">Jméno</Label>
            <Input id="t-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="t-email">E-mail</Label>
            <Input id="t-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="t-phone">Telefon</Label>
            <Input id="t-phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="t-account">Číslo účtu</Label>
            <Input id="t-account" value={form.accountNumber} onChange={e => setForm({ ...form, accountNumber: e.target.value })} />
          </div>
          {err && <p className="text-sm text-late">{err}</p>}
        </Modal>
      )}
    </>
  );
}
