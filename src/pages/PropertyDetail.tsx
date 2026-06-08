import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
  if (!value) return <span className="text-muted-foreground">—</span>;
  const isUrl = /^https?:\/\//.test(value);
  if (isUrl) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="text-primary underline truncate inline-block max-w-[200px]" title={value}>
        {(() => { try { return new URL(value).hostname; } catch { return value; } })()}
      </a>
    );
  }
  return <span className="text-xs text-muted-foreground" title={value}>{value}</span>;
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

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    validFrom: '', totalSvjAdvanceCzk: '', deductibleAmountCzk: '',
    deductibleNote: '', documentRef: '', note: '',
  });
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post(`/api/properties/${id}/tariffs`, {
      validFrom: form.validFrom,
      totalSvjAdvance: Math.round(parseFloat(form.totalSvjAdvanceCzk.replace(',', '.')) * 100),
      deductibleAmount: Math.round(parseFloat(form.deductibleAmountCzk.replace(',', '.')) * 100),
      deductibleNote: form.deductibleNote || null,
      documentRef: form.documentRef || null,
      note: form.note || null,
    }),
    onSuccess: () => {
      setOpen(false);
      setForm({ validFrom: '', totalSvjAdvanceCzk: '', deductibleAmountCzk: '', deductibleNote: '', documentRef: '', note: '' });
      qc.invalidateQueries({ queryKey: ['property-tariffs', id] });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  if (property.isLoading) return <div>Načítání…</div>;
  if (!property.data) return <div>Nemovitost nenalezena.</div>;
  const p = property.data.property;

  const fmt = (h: number) => (h / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';

  return (
    <div className="space-y-6">
      <div>
        <Link to="/properties" className="text-sm text-muted-foreground hover:underline">← Nemovitosti</Link>
        <h1 className="text-3xl font-bold mt-2">{p.name}</h1>
        {p.address && <p className="text-muted-foreground">{p.address}</p>}
      </div>

      <Card>
        <CardHeader><CardTitle>Informace o nemovitosti</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div><span className="text-muted-foreground">Adresa:</span> {p.address ?? '—'}</div>
          <div><span className="text-muted-foreground">Reconciliation skill:</span> <span className="font-mono text-xs">{p.reconciliationSkill ?? '—'}</span></div>
          <div><span className="text-muted-foreground">Poznámka:</span> {p.note ?? '—'}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Evidenční list (předpis SVJ)</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">SCD2 — nový řádek vždy uzavře předchozí. Aktuální je ten s prázdným „Platnost do".</p>
          </div>
          <Button onClick={() => { setErr(null); setOpen(true); }}>Nový záznam</Button>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Platnost od</TableHead>
                <TableHead>Platnost do</TableHead>
                <TableHead>Celkové zálohy SVJ</TableHead>
                <TableHead>Odečitatelné (FO)</TableHead>
                <TableHead>Reconciliable</TableHead>
                <TableHead>Složení</TableHead>
                <TableHead>Doklad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(tariffs.data?.tariffs ?? []).map(t => (
                <TableRow key={t.id} className={t.validTo === null ? 'bg-accent/30' : ''}>
                  <TableCell>{t.validFrom}</TableCell>
                  <TableCell>{t.validTo ?? <span className="font-semibold">aktuální</span>}</TableCell>
                  <TableCell>{fmt(t.totalSvjAdvance)}</TableCell>
                  <TableCell>{fmt(t.deductibleAmount)}</TableCell>
                  <TableCell className="font-medium">{fmt(t.totalSvjAdvance - t.deductibleAmount)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md">{t.deductibleNote ?? '—'}</TableCell>
                  <TableCell><DocRef value={t.documentRef} /></TableCell>
                </TableRow>
              ))}
              {(tariffs.data?.tariffs ?? []).length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Zatím žádný evidenční list. Přidej první „Nový záznam".</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">Nový záznam evidenčního listu</h2>
            <div>
              <Label>Platnost od (YYYY-MM-DD)</Label>
              <Input type="date" value={form.validFrom} onChange={e => setForm({ ...form, validFrom: e.target.value })} />
            </div>
            <div>
              <Label>Celkové zálohy SVJ (Kč/měs)</Label>
              <Input type="text" placeholder="8884" value={form.totalSvjAdvanceCzk} onChange={e => setForm({ ...form, totalSvjAdvanceCzk: e.target.value })} />
            </div>
            <div>
              <Label>Odečitatelné (FO + ostatní) (Kč/měs)</Label>
              <Input type="text" placeholder="1878" value={form.deductibleAmountCzk} onChange={e => setForm({ ...form, deductibleAmountCzk: e.target.value })} />
            </div>
            <div>
              <Label>Složení (poznámka)</Label>
              <Input placeholder="Fond oprav 1424 + Odměny výbor 110 + ..." value={form.deductibleNote} onChange={e => setForm({ ...form, deductibleNote: e.target.value })} />
            </div>
            <div>
              <Label>Doklad (URL nebo cesta)</Label>
              <Input placeholder="https://drive.google.com/file/d/... nebo /path/to/EL-2024.pdf" value={form.documentRef} onChange={e => setForm({ ...form, documentRef: e.target.value })} />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
              <Button onClick={() => create.mutate()} disabled={!form.validFrom || !form.totalSvjAdvanceCzk || !form.deductibleAmountCzk || create.isPending}>Vytvořit</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
