import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { parseKorun } from '@/lib/money';
import { fmtDate, fmtKc } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KV, KVRow } from '@/components/ui/kv';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableEmpty, TableError } from '@/components/ui/table-error';
import { Crumb } from '@/components/Layout';
import { Hint } from '@/components/ui/hint';
import { Status } from '@/components/ui/status';
import { isActiveContract, isEndedContract, useContracts, useCurrentTermsMap } from '@/hooks/useContracts';

interface Property {
  id: string; name: string; address: string | null;
  reconciliationSkill: string | null; note: string | null; createdAt: string;
}
interface Tariff {
  id: string; propertyId: string;
  validFrom: string; validTo: string | null;
  totalSvjAdvance: number; deductibleAmount: number;
  deductibleNote: string | null;
  documentRef: string | null;
  note: string | null;
}

function DocRef({ value }: { value: string | null }) {
  if (!value) return <span className="text-soft">—</span>;
  const isUrl = /^https?:\/\//.test(value);
  if (isUrl) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="inline-block max-w-[200px] truncate align-bottom text-sm" title={value}>
        {(() => { try { return new URL(value).hostname; } catch { return value; } })()}
      </a>
    );
  }
  return <span className="text-sm text-soft" title={value}>{value}</span>;
}

export function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const property = useQuery({
    queryKey: ['property', id],
    queryFn: () => api.get<{ property: Property }>(`/api/properties/${id}`),
    enabled: !!id,
  });
  const tariffs = useQuery({
    queryKey: ['property-tariffs', id],
    queryFn: () => api.get<{ tariffs: Tariff[] }>(`/api/properties/${id}/tariffs`),
    enabled: !!id,
  });

  const contracts = useContracts();
  const leases = [...(contracts.data?.contracts ?? [])]
    .filter(c => c.propertyId === id)
    .sort((a, b) => Number(isEndedContract(b)) - Number(isEndedContract(a)) || b.startDate.localeCompare(a.startDate));
  const { map: termsMap } = useCurrentTermsMap(leases.map(c => c.id));

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    validFrom: '', totalSvjAdvanceCzk: '', deductibleAmountCzk: '',
    deductibleNote: '', documentRef: '', note: '',
  });
  const [err, setErr] = useState<string | null>(null);

  const totalSvjAdvance = parseKorun(form.totalSvjAdvanceCzk);
  const deductibleAmount = parseKorun(form.deductibleAmountCzk);
  const amountsInvalid = totalSvjAdvance.kind !== 'value' || deductibleAmount.kind !== 'value';

  const create = useMutation({
    mutationFn: () => api.post(`/api/properties/${id}/tariffs`, {
      validFrom: form.validFrom,
      totalSvjAdvance: totalSvjAdvance.kind === 'value' ? totalSvjAdvance.halere : 0,
      deductibleAmount: deductibleAmount.kind === 'value' ? deductibleAmount.halere : 0,
      deductibleNote: form.deductibleNote || null,
      documentRef: form.documentRef || null,
      note: form.note || null,
    }),
    onSuccess: () => {
      setOpen(false);
      setForm({ validFrom: '', totalSvjAdvanceCzk: '', deductibleAmountCzk: '', deductibleNote: '', documentRef: '', note: '' });
      qc.invalidateQueries({ queryKey: ['property-tariffs', id] });
    },
    onError: (e: unknown) => setErr(apiErrorMessage(e)),
  });

  if (property.isLoading) return <p className="text-sm text-soft">Načítání…</p>;
  // A failed request is not the same as a missing property. Only a real 404
  // means "nenalezena"; anything else (network, 500) gets an error the user
  // can act on, instead of being told the property does not exist.
  if (property.isError && !(property.error instanceof ApiError && property.error.status === 404)) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-late">Nepodařilo se načíst nemovitost.</p>
        <Button size="sm" variant="outline" onClick={() => property.refetch()}>Zkusit znovu</Button>
      </div>
    );
  }
  if (!property.data) return <p className="text-sm text-soft">Nemovitost nenalezena.</p>;
  const p = property.data.property;
  const rows = [...(tariffs.data?.tariffs ?? [])].sort((a, b) => b.validFrom.localeCompare(a.validFrom));

  return (
    <>
      <PageHeader crumb={<Crumb to="/properties">Nemovitosti</Crumb>} title={p.name} sub={p.address ?? undefined} />

      <Card>
        <CardHeader><CardTitle>Základní údaje</CardTitle></CardHeader>
        <CardContent>
          <KV className="max-w-xl">
            <KVRow label="Adresa" className="font-normal">{p.address ?? <span className="text-soft">—</span>}</KVRow>
            <KVRow label="Postup vyúčtování" className="font-normal">{p.reconciliationSkill ? <code>{p.reconciliationSkill}</code> : <span className="text-soft">—</span>}</KVRow>
            <KVRow label="Poznámka" wide>{p.note ?? <span className="text-soft">—</span>}</KVRow>
          </KV>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Pronájmy</CardTitle>
          <CardDescription>Kdo v nemovitosti bydlí a bydlel.</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nájemník</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead>Období</TableHead>
              <TableHead className="num">Měsíčně</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contracts.isError && !contracts.data ? (
              <TableError cols={4} onRetry={() => contracts.refetch()} />
            ) : !contracts.data ? (
              <TableSkeleton cols={4} rows={2} />
            ) : leases.length === 0 ? (
              <TableEmpty cols={4}>Zatím žádný pronájem této nemovitosti.</TableEmpty>
            ) : leases.map(c => {
              const t = termsMap[c.id];
              const active = isActiveContract(c);
              const ended = isEndedContract(c);
              return (
                <TableRow key={c.id} className={ended ? 'text-soft' : undefined}>
                  <TableCell><Link to={`/contracts/${c.id}`} className="font-medium text-ink">{c.tenantName}</Link></TableCell>
                  <TableCell>
                    {active ? <Status tone="ok">Běží</Status> : ended ? <Status tone="soft">Ukončen</Status> : <Status tone="wait">Začne {fmtDate(c.startDate)}</Status>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(c.startDate)} až {c.endDate ? fmtDate(c.endDate) : 'dosud'}</TableCell>
                  <TableCell className="num">{t === undefined ? <span className="text-wait">…</span> : t.monthlyTotal !== null ? fmtKc(t.monthlyTotal) : <span className="text-soft">—</span>}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Evidenční list (předpis SVJ)</CardTitle>
            <CardDescription>Nový záznam vždy uzavře předchozí. Aktuální je ten bez konce platnosti.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => { setErr(null); setOpen(true); }}><Plus className="h-3.5 w-3.5" strokeWidth={2.2} />Nový záznam</Button>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Platí od</TableHead>
              <TableHead>Platí do</TableHead>
              <TableHead className="num">Zálohy SVJ celkem</TableHead>
              <TableHead className="num"><span className="inline-flex items-center gap-1">Odečitatelné<Hint label="Co je odečitatelné">Položky předpisu SVJ, které nese pronajímatel a nájemníkovi se nevyúčtovávají: fond oprav, odměny výboru, pojištění domu.</Hint></span></TableHead>
              <TableHead className="num"><span className="inline-flex items-center gap-1">K vyúčtování<Hint label="Co je k vyúčtování">Zálohy SVJ po odečtení položek pronajímatele. Tahle částka se porovnává se zálohami, které platí nájemník.</Hint></span></TableHead>
              <TableHead>Složení</TableHead>
              <TableHead>Doklad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tariffs.isError && !tariffs.data ? (
              <TableError cols={7} onRetry={() => tariffs.refetch()} />
            ) : !tariffs.data ? (
              <TableSkeleton cols={7} />
            ) : rows.length === 0 ? (
              <TableEmpty cols={7}>Zatím žádný evidenční list. Přidej první záznam.</TableEmpty>
            ) : (
              rows.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap font-medium">{fmtDate(t.validFrom)}</TableCell>
                  <TableCell className="whitespace-nowrap">{t.validTo ? fmtDate(t.validTo) : <span className="font-medium text-accent">aktuální</span>}</TableCell>
                  <TableCell className="num">{fmtKc(t.totalSvjAdvance)}</TableCell>
                  <TableCell className="num">{fmtKc(t.deductibleAmount)}</TableCell>
                  <TableCell className="num font-semibold">{fmtKc(t.totalSvjAdvance - t.deductibleAmount)}</TableCell>
                  <TableCell className="max-w-md text-sm text-soft">{t.deductibleNote ?? '—'}</TableCell>
                  <TableCell><DocRef value={t.documentRef} /></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {open && (
        <Modal
          title="Nový záznam evidenčního listu"
          onClose={() => setOpen(false)}
          className="max-w-lg"
          footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
            <Button onClick={() => create.mutate()} disabled={!form.validFrom || amountsInvalid || create.isPending}>Vytvořit</Button>
          </>}
        >
          <div>
            <Label htmlFor="el-from">Platí od</Label>
            <Input id="el-from" type="date" value={form.validFrom} onChange={e => setForm({ ...form, validFrom: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="el-total">Zálohy SVJ celkem (Kč/měsíc)</Label>
              <Input id="el-total" type="text" placeholder="8884" value={form.totalSvjAdvanceCzk} onChange={e => setForm({ ...form, totalSvjAdvanceCzk: e.target.value })} />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1.5"><Label htmlFor="el-ded" className="mb-0">Odečitatelné (Kč/měsíc)</Label><Hint label="Co je odečitatelné">Součet položek předpisu, které nese pronajímatel: fond oprav, odměny výboru, pojištění domu. Při vyúčtování nákladů se za období automaticky odečte.</Hint></div>
              <Input id="el-ded" type="text" placeholder="1878" value={form.deductibleAmountCzk} onChange={e => setForm({ ...form, deductibleAmountCzk: e.target.value })} />
            </div>
          </div>
          {((form.totalSvjAdvanceCzk !== '' && totalSvjAdvance.kind === 'invalid') || (form.deductibleAmountCzk !== '' && deductibleAmount.kind === 'invalid')) && (
            <p className="text-sm text-late">Částka musí být číslo v korunách, např. 8884 nebo 8884,50.</p>
          )}
          <div>
            <Label htmlFor="el-note">Složení</Label>
            <Input id="el-note" placeholder="Fond oprav 1424 + odměny výboru 110 + …" value={form.deductibleNote} onChange={e => setForm({ ...form, deductibleNote: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="el-doc">Doklad (URL nebo cesta)</Label>
            <Input id="el-doc" placeholder="https://… nebo /cesta/k/EL-2024.pdf" value={form.documentRef} onChange={e => setForm({ ...form, documentRef: e.target.value })} />
          </div>
          {err && <p className="text-sm text-late">{err}</p>}
        </Modal>
      )}
    </>
  );
}
