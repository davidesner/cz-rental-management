import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { computeDeductibleForPeriod } from '@/lib/proration';
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

interface Tariff {
  id: string;
  propertyId: string;
  validFrom: string;
  validTo: string | null;
  totalSvjAdvance: number;
  deductibleAmount: number;
  deductibleNote: string | null;
  note: string | null;
}

function fmtKc(halere: number) {
  return (halere / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
}

function fmtKcSigned(halere: number) {
  const s = (halere / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
  if (halere < 0) return <span className="text-red-600">{s}</span>;
  if (halere > 0) return <span className="text-green-600">+{s}</span>;
  return <span className="text-muted-foreground">{s}</span>;
}

export function CostStatementsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['cost-statements'],
    queryFn: () => api.get<{ statements: CostStatement[] }>('/api/cost-statements'),
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
    adjustmentAmount: '0',
    adjustmentNote: '',
    documentRef: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [adjustmentTouched, setAdjustmentTouched] = useState(false);
  const [autoFillLabel, setAutoFillLabel] = useState<string | null>(null);
  const [periodMode, setPeriodMode] = useState<'year' | 'custom'>('year');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [yearTouched, setYearTouched] = useState(false);

  // Fetch tariffs for the selected property when kind=services
  const tariffsQuery = useQuery({
    queryKey: ['property-tariffs', form.propertyId],
    queryFn: () => api.get<{ tariffs: Tariff[] }>(`/api/properties/${form.propertyId}/tariffs`),
    enabled: !!form.propertyId && form.kind === 'services' && open,
  });

  // Fetch existing cost statements for auto-suggest
  const existingStatementsQuery = useQuery({
    queryKey: ['cost-statements-for-suggest', form.propertyId, form.kind],
    queryFn: () => api.get<{ statements: Array<{ periodFrom: string }> }>(
      `/api/cost-statements?propertyId=${form.propertyId}&kind=${form.kind}`
    ),
    enabled: !!(form.propertyId && form.kind && open),
  });

  // Auto-suggest year based on existing cost statements
  useEffect(() => {
    if (yearTouched || !existingStatementsQuery.data) return;

    const years = existingStatementsQuery.data.statements
      .map(s => parseInt(s.periodFrom.slice(0, 4), 10))
      .filter(n => !isNaN(n));

    const suggested = years.length > 0 ? Math.max(...years) + 1 : new Date().getFullYear() - 1;
    setYear(suggested);
  }, [existingStatementsQuery.data, yearTouched]);

  // Update form periodFrom/periodTo when year mode changes or year changes
  useEffect(() => {
    if (periodMode === 'year') {
      const newPeriodFrom = `${year}-01-01`;
      const newPeriodTo = `${year}-12-31`;
      setForm(prev => ({
        ...prev,
        periodFrom: newPeriodFrom,
        periodTo: newPeriodTo,
      }));
      setAdjustmentTouched(false);
      setAutoFillLabel(null);
    }
  }, [periodMode, year]);

  // Auto-prefill adjustmentAmount when kind=services and all required fields are set
  useEffect(() => {
    if (
      !open ||
      adjustmentTouched ||
      form.kind !== 'services' ||
      !form.propertyId ||
      !form.periodFrom ||
      !form.periodTo ||
      !tariffsQuery.data
    ) {
      return;
    }

    const tariffs = tariffsQuery.data.tariffs;
    if (tariffs.length === 0) return;

    const { totalHaler, daysCovered } = computeDeductibleForPeriod(tariffs, form.periodFrom, form.periodTo);
    if (totalHaler === 0) return;

    // Find the representative tariff note (pick the one active at periodFrom, fallback to first)
    const repTariff = tariffs.find(t =>
      t.validFrom <= form.periodFrom && (t.validTo === null || form.periodFrom < t.validTo)
    );
    const deductibleNote = repTariff?.deductibleNote ?? 'EL deductible';

    const note = `FO portion (${deductibleNote}) × period (${daysCovered} dní) = ${(totalHaler / 100).toFixed(2)} Kč`;

    setForm(prev => ({
      ...prev,
      adjustmentAmount: (-totalHaler / 100).toFixed(2),
      adjustmentNote: note,
    }));
    setAutoFillLabel('(automaticky z evidenčního listu)');
  }, [
    open,
    adjustmentTouched,
    form.kind,
    form.propertyId,
    form.periodFrom,
    form.periodTo,
    tariffsQuery.data,
  ]);

  const create = useMutation({
    mutationFn: () => {
      const periodFrom = periodMode === 'year' ? `${year}-01-01` : form.periodFrom;
      const periodTo = periodMode === 'year' ? `${year}-12-31` : form.periodTo;
      return api.post<{ statement: CostStatement }>('/api/cost-statements', {
        propertyId: form.propertyId,
        kind: form.kind,
        periodFrom,
        periodTo,
        totalAmount: Math.round(parseFloat(form.totalAmount) * 100),
        adjustmentAmount: form.adjustmentAmount !== '' && form.adjustmentAmount !== '0'
          ? Math.round(parseFloat(form.adjustmentAmount.replace(',', '.')) * 100)
          : null,
        adjustmentNote: form.adjustmentNote || null,
        documentRef: form.documentRef || null,
      });
    },
    onSuccess: () => {
      setOpen(false);
      resetForm();
      qc.invalidateQueries({ queryKey: ['cost-statements'] });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  function resetForm() {
    setForm({ propertyId: '', kind: 'services', periodFrom: '', periodTo: '', totalAmount: '', adjustmentAmount: '0', adjustmentNote: '', documentRef: '' });
    setAdjustmentTouched(false);
    setAutoFillLabel(null);
    setPeriodMode('year');
    setYearTouched(false);
    setYear(new Date().getFullYear());
  }

  const statements = data?.statements ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Vyúčtování nákladů</h1>
        <Button onClick={() => { setErr(null); resetForm(); setOpen(true); }}>Nový výkaz</Button>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nemovitost</TableHead>
              <TableHead>Druh</TableHead>
              <TableHead>Období</TableHead>
              <TableHead>Celkem</TableHead>
              <TableHead>Úprava</TableHead>
              <TableHead>Reconciliable</TableHead>
              <TableHead>Poznámka k úpravě</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statements.map(s => {
              const adj = s.adjustmentAmount ?? 0;
              const reconciliable = s.totalAmount + adj;
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{propertyMap[s.propertyId] ?? s.propertyId}</TableCell>
                  <TableCell>{s.kind}</TableCell>
                  <TableCell>{s.periodFrom} – {s.periodTo}</TableCell>
                  <TableCell>{fmtKc(s.totalAmount)}</TableCell>
                  <TableCell>{s.adjustmentAmount != null ? fmtKcSigned(s.adjustmentAmount) : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="font-bold">{fmtKc(reconciliable)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate" title={s.adjustmentNote ?? undefined}>
                    {s.adjustmentNote ?? '—'}
                  </TableCell>
                </TableRow>
              );
            })}
            {statements.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">Zatím žádné výkazy nákladů.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">Nový výkaz nákladů</h2>
            <div>
              <Label>Nemovitost</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.propertyId}
                onChange={e => {
                  setAdjustmentTouched(false);
                  setAutoFillLabel(null);
                  setForm(prev => ({ ...prev, propertyId: e.target.value, adjustmentAmount: '0', adjustmentNote: '' }));
                }}
              >
                <option value="">Vyber nemovitost…</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Druh</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.kind}
                onChange={e => {
                  setAdjustmentTouched(false);
                  setAutoFillLabel(null);
                  setForm(prev => ({ ...prev, kind: e.target.value, adjustmentAmount: '0', adjustmentNote: '' }));
                }}
              >
                <option value="services">Služby (SVJ)</option>
                <option value="electricity">Elektřina</option>
                <option value="gas">Plyn</option>
                <option value="internet">Internet</option>
                <option value="water">Voda</option>
                <option value="other">Ostatní</option>
              </select>
            </div>
            <div>
              <Label>Období</Label>
              <div className="flex gap-2 mb-2">
                <Button
                  type="button"
                  variant={periodMode === 'year' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPeriodMode('year')}
                >
                  Rok
                </Button>
                <Button
                  type="button"
                  variant={periodMode === 'custom' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPeriodMode('custom')}
                >
                  Vlastní období
                </Button>
              </div>
              {periodMode === 'year' ? (
                <div className="space-y-1">
                  <Input
                    type="number"
                    min={2000}
                    max={2100}
                    value={year}
                    onChange={e => {
                      setYearTouched(true);
                      setYear(parseInt(e.target.value, 10) || new Date().getFullYear());
                    }}
                  />
                  {!yearTouched && form.propertyId && form.kind && (
                    <p className="text-xs text-muted-foreground">
                      Návrh: další rok bez vyúčtování pro tuto kombinaci.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {`Od ${year}-01-01 do ${year}-12-31`}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Od</Label>
                    <Input
                      type="date"
                      value={form.periodFrom}
                      onChange={e => {
                        setAdjustmentTouched(false);
                        setAutoFillLabel(null);
                        setForm(prev => ({ ...prev, periodFrom: e.target.value, adjustmentAmount: '0', adjustmentNote: '' }));
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Do</Label>
                    <Input
                      type="date"
                      value={form.periodTo}
                      onChange={e => {
                        setAdjustmentTouched(false);
                        setAutoFillLabel(null);
                        setForm(prev => ({ ...prev, periodTo: e.target.value, adjustmentAmount: '0', adjustmentNote: '' }));
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div>
              <Label>Celková částka (Kč)</Label>
              <Input type="text" placeholder="0.00" value={form.totalAmount} onChange={e => setForm({ ...form, totalAmount: e.target.value })} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label>Částka úpravy (Kč, se znaménkem)</Label>
                {autoFillLabel && !adjustmentTouched && (
                  <span className="text-xs text-muted-foreground italic">{autoFillLabel}</span>
                )}
              </div>
              <Input
                type="text"
                placeholder="0.00"
                value={form.adjustmentAmount}
                onChange={e => {
                  setAdjustmentTouched(true);
                  setAutoFillLabel(null);
                  setForm({ ...form, adjustmentAmount: e.target.value });
                }}
              />
            </div>
            <div>
              <Label>Poznámka k úpravě (volitelné)</Label>
              <Input
                value={form.adjustmentNote}
                onChange={e => setForm({ ...form, adjustmentNote: e.target.value })}
              />
            </div>
            <div>
              <Label>Reference dokumentu (volitelné)</Label>
              <Input value={form.documentRef} onChange={e => setForm({ ...form, documentRef: e.target.value })} />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
              <Button
                onClick={() => create.mutate()}
                disabled={
                  !form.propertyId ||
                  !form.totalAmount ||
                  (periodMode === 'custom' && (!form.periodFrom || !form.periodTo)) ||
                  create.isPending
                }
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
