import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { computeDeductibleForPeriod } from '@/lib/proration';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface Contract {
  id: string;
  propertyId: string;
  tenantId: string;
  startDate: string;
  endDate: string | null;
  securityDeposit: number | null;
  note?: string | null;
}

interface ContractTerm {
  id: string;
  validFrom: string;
  validTo?: string | null;
  baseRent: number;
  serviceAdvance: number;
  source: string;
  note: string | null;
}

interface Utility {
  id: string;
  kind: string;
  validFrom: string;
  validTo?: string | null;
  monthlyAdvance: number;
  note: string | null;
}

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
  costStatementNotes?: string[];
}

interface Property { id: string; name: string; }
interface Tenant { id: string; name: string; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtKc(halere: number) {
  return (halere / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 2 }) + ' Kč';
}

function fmtKcSigned(halere: number) {
  const s = (halere / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 2 }) + ' Kč';
  if (halere < 0) return <span className="text-red-600">{s}</span>;
  if (halere > 0) return <span className="text-green-600">+{s}</span>;
  return <span className="text-muted-foreground">{s}</span>;
}

function utilKindLabel(kind: string): string {
  const map: Record<string, string> = {
    electricity: 'Elektřina',
    gas: 'Plyn',
    internet: 'Internet',
    water: 'Voda',
    other: 'Ostatní',
  };
  return map[kind] ?? kind;
}

/** Returns true if two date ranges overlap. endA/endB null = open-ended. */
function periodsOverlap(
  startA: string, endA: string | null,
  startB: string, endB: string | null,
): boolean {
  // [startA, endA] overlaps [startB, endB] when startA <= endB AND startB <= endA
  const aEndsBeforeB = endA !== null && endA < startB;
  const bEndsBeforeA = endB !== null && endB < startA;
  return !aEndsBeforeB && !bEndsBeforeA;
}

const SELECT_CLS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

// ─── CostStatement create dialog (extracted for reuse) ────────────────────────

interface CostStatementDialogProps {
  fixedPropertyId: string;
  properties: Property[];
  onClose: () => void;
  onCreated: () => void;
}

function CostStatementDialog({ fixedPropertyId, properties, onClose, onCreated }: CostStatementDialogProps) {
  const [form, setForm] = useState({
    propertyId: fixedPropertyId,
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

  const tariffsQuery = useQuery({
    queryKey: ['property-tariffs', form.propertyId],
    queryFn: () => api.get<{ tariffs: Tariff[] }>(`/api/properties/${form.propertyId}/tariffs`),
    enabled: !!form.propertyId && form.kind === 'services',
  });

  const existingStatementsQuery = useQuery({
    queryKey: ['cost-statements-for-suggest', form.propertyId, form.kind],
    queryFn: () => api.get<{ statements: Array<{ periodFrom: string }> }>(
      `/api/cost-statements?propertyId=${form.propertyId}&kind=${form.kind}`
    ),
    enabled: !!(form.propertyId && form.kind),
  });

  useEffect(() => {
    if (yearTouched || !existingStatementsQuery.data) return;
    const years = existingStatementsQuery.data.statements
      .map(s => parseInt(s.periodFrom.slice(0, 4), 10))
      .filter(n => !isNaN(n));
    const suggested = years.length > 0 ? Math.max(...years) + 1 : new Date().getFullYear() - 1;
    setYear(suggested);
  }, [existingStatementsQuery.data, yearTouched]);

  useEffect(() => {
    if (periodMode === 'year') {
      setForm(prev => ({ ...prev, periodFrom: `${year}-01-01`, periodTo: `${year}-12-31` }));
      setAdjustmentTouched(false);
      setAutoFillLabel(null);
    }
  }, [periodMode, year]);

  useEffect(() => {
    if (
      adjustmentTouched ||
      form.kind !== 'services' ||
      !form.propertyId ||
      !form.periodFrom ||
      !form.periodTo ||
      !tariffsQuery.data
    ) return;
    const tariffs = tariffsQuery.data.tariffs;
    if (tariffs.length === 0) return;
    const { totalHaler, daysCovered } = computeDeductibleForPeriod(tariffs, form.periodFrom, form.periodTo);
    if (totalHaler === 0) return;
    const repTariff = tariffs.find(t =>
      t.validFrom <= form.periodFrom && (t.validTo === null || form.periodFrom < t.validTo)
    );
    const deductibleNote = repTariff?.deductibleNote ?? 'EL deductible';
    const note = `FO portion (${deductibleNote}) × period (${daysCovered} dní) = ${(totalHaler / 100).toFixed(2)} Kč`;
    setForm(prev => ({ ...prev, adjustmentAmount: (-totalHaler / 100).toFixed(2), adjustmentNote: note }));
    setAutoFillLabel('(automaticky z evidenčního listu)');
  }, [adjustmentTouched, form.kind, form.propertyId, form.periodFrom, form.periodTo, tariffsQuery.data]);

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
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold">Nový výkaz nákladů</h2>
        <div>
          <Label>Nemovitost</Label>
          <select
            className={SELECT_CLS}
            value={form.propertyId}
            disabled={!!fixedPropertyId}
            onChange={e => {
              setAdjustmentTouched(false); setAutoFillLabel(null);
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
            className={SELECT_CLS}
            value={form.kind}
            onChange={e => {
              setAdjustmentTouched(false); setAutoFillLabel(null);
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
            <Button type="button" variant={periodMode === 'year' ? 'default' : 'outline'} size="sm" onClick={() => setPeriodMode('year')}>Rok</Button>
            <Button type="button" variant={periodMode === 'custom' ? 'default' : 'outline'} size="sm" onClick={() => setPeriodMode('custom')}>Vlastní</Button>
          </div>
          {periodMode === 'year' ? (
            <div className="space-y-1">
              <Input type="number" min={2000} max={2100} value={year} onChange={e => { setYearTouched(true); setYear(parseInt(e.target.value, 10) || new Date().getFullYear()); }} />
              {!yearTouched && form.propertyId && form.kind && (
                <p className="text-xs text-muted-foreground">Návrh: další rok bez vyúčtování pro tuto kombinaci.</p>
              )}
              <p className="text-xs text-muted-foreground">{`Od ${year}-01-01 do ${year}-12-31`}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Od</Label>
                <Input type="date" value={form.periodFrom} onChange={e => { setAdjustmentTouched(false); setAutoFillLabel(null); setForm(prev => ({ ...prev, periodFrom: e.target.value, adjustmentAmount: '0', adjustmentNote: '' })); }} />
              </div>
              <div>
                <Label className="text-xs">Do</Label>
                <Input type="date" value={form.periodTo} onChange={e => { setAdjustmentTouched(false); setAutoFillLabel(null); setForm(prev => ({ ...prev, periodTo: e.target.value, adjustmentAmount: '0', adjustmentNote: '' })); }} />
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
            {autoFillLabel && !adjustmentTouched && <span className="text-xs text-muted-foreground italic">{autoFillLabel}</span>}
          </div>
          <Input type="text" placeholder="0.00" value={form.adjustmentAmount} onChange={e => { setAdjustmentTouched(true); setAutoFillLabel(null); setForm({ ...form, adjustmentAmount: e.target.value }); }} />
        </div>
        <div>
          <Label>Poznámka k úpravě (volitelné)</Label>
          <Input value={form.adjustmentNote} onChange={e => setForm({ ...form, adjustmentNote: e.target.value })} />
        </div>
        <div>
          <Label>Reference dokumentu (volitelné)</Label>
          <Input value={form.documentRef} onChange={e => setForm({ ...form, documentRef: e.target.value })} />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Zrušit</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!form.propertyId || !form.totalAmount || (periodMode === 'custom' && (!form.periodFrom || !form.periodTo)) || create.isPending}
          >
            Vytvořit
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Reconciliation compute dialog ───────────────────────────────────────────

interface ComputeDialogProps {
  contractId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}

function ComputeDialog({ contractId, onClose, onCreated }: ComputeDialogProps) {
  const [form, setForm] = useState({ periodFrom: '', periodTo: '' });
  const [err, setErr] = useState<string | null>(null);

  const computeMutation = useMutation({
    mutationFn: () =>
      api.post<{ reconciliation: Reconciliation }>(
        `/api/contracts/${contractId}/reconciliations/compute`,
        { periodFrom: form.periodFrom, periodTo: form.periodTo }
      ),
    onSuccess: (result) => { onCreated(result.reconciliation.id); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold">Spočítat vyúčtování nájemníkovi</h2>
        <div>
          <Label>Období od</Label>
          <Input type="date" value={form.periodFrom} onChange={e => setForm({ ...form, periodFrom: e.target.value })} />
        </div>
        <div>
          <Label>Období do</Label>
          <Input type="date" value={form.periodTo} onChange={e => setForm({ ...form, periodTo: e.target.value })} />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Zrušit</Button>
          <Button
            onClick={() => computeMutation.mutate()}
            disabled={!form.periodFrom || !form.periodTo || computeMutation.isPending}
          >
            Spočítat
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Core data fetches
  const { data: contractData } = useQuery({
    queryKey: ['contracts', id],
    queryFn: () => api.get<{ contract: Contract }>(`/api/contracts/${id}`),
    enabled: !!id,
  });
  const { data: termsData } = useQuery({
    queryKey: ['contracts', id, 'terms'],
    queryFn: () => api.get<{ terms: ContractTerm[] }>(`/api/contracts/${id}/terms`),
    enabled: !!id,
  });
  const { data: utilitiesData } = useQuery({
    queryKey: ['contracts', id, 'utilities'],
    queryFn: () => api.get<{ utilities: Utility[] }>(`/api/contracts/${id}/utilities`),
    enabled: !!id,
  });

  const contract = contractData?.contract;

  // Tenant + property lookups
  const { data: tenantsData } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => api.get<{ tenants: Tenant[] }>('/api/tenants'),
  });
  const { data: propertiesData } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get<{ properties: Property[] }>('/api/properties'),
  });

  const tenantsById = Object.fromEntries((tenantsData?.tenants ?? []).map(t => [t.id, t]));
  const propertiesById = Object.fromEntries((propertiesData?.properties ?? []).map(p => [p.id, p]));

  const tenant = contract ? tenantsById[contract.tenantId] : undefined;
  const property = contract ? propertiesById[contract.propertyId] : undefined;

  // Cost statements for this property
  const { data: costStatementsData } = useQuery({
    queryKey: ['cost-statements-by-property', contract?.propertyId],
    queryFn: () => api.get<{ statements: CostStatement[] }>(`/api/cost-statements?propertyId=${contract!.propertyId}`),
    enabled: !!contract?.propertyId,
  });

  // Reconciliations for this contract
  const { data: reconciliationsData } = useQuery({
    queryKey: ['reconciliations-by-contract', id],
    queryFn: () => api.get<{ reconciliations: Reconciliation[] }>(`/api/reconciliations?contractId=${id}`),
    enabled: !!id,
  });

  // ── Derived: current terms & utilities (validTo === null) ──────────────────
  const terms = termsData?.terms ?? [];
  const utilities = utilitiesData?.utilities ?? [];
  const currentTerm = terms.find(t => t.validTo === null || t.validTo === undefined);
  const currentUtilities = utilities.filter(u => u.validTo === null || u.validTo === undefined);

  // ── Derived: filter cost statements by period overlap ─────────────────────
  const allStatements = costStatementsData?.statements ?? [];
  const filteredStatements = contract
    ? allStatements.filter(s =>
        periodsOverlap(s.periodFrom, s.periodTo, contract.startDate, contract.endDate ?? null)
      )
    : [];

  const reconciliations = reconciliationsData?.reconciliations ?? [];

  // ── Monthly total ──────────────────────────────────────────────────────────
  const monthlyTotal = currentTerm
    ? currentTerm.baseRent +
      currentTerm.serviceAdvance +
      currentUtilities.reduce((sum, u) => sum + u.monthlyAdvance, 0)
    : null;

  // ── Terms dialog state ─────────────────────────────────────────────────────
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsForm, setTermsForm] = useState({ validFrom: '', baseRent: '', serviceAdvance: '', source: 'initial', note: '' });
  const [termsErr, setTermsErr] = useState<string | null>(null);

  const addTerms = useMutation({
    mutationFn: () => api.post<{ term: ContractTerm }>(`/api/contracts/${id}/terms`, {
      validFrom: termsForm.validFrom,
      baseRent: Math.round(parseFloat(termsForm.baseRent) * 100),
      serviceAdvance: Math.round(parseFloat(termsForm.serviceAdvance) * 100),
      source: termsForm.source,
      note: termsForm.note || null,
    }),
    onSuccess: () => {
      setTermsOpen(false);
      setTermsForm({ validFrom: '', baseRent: '', serviceAdvance: '', source: 'initial', note: '' });
      qc.invalidateQueries({ queryKey: ['contracts', id, 'terms'] });
    },
    onError: (e: unknown) => setTermsErr(e instanceof Error ? e.message : String(e)),
  });

  // ── Utility dialog state ───────────────────────────────────────────────────
  const [utilOpen, setUtilOpen] = useState(false);
  const [utilForm, setUtilForm] = useState({ kind: 'electricity', validFrom: '', monthlyAdvance: '', note: '' });
  const [utilErr, setUtilErr] = useState<string | null>(null);

  const addUtility = useMutation({
    mutationFn: () => api.post<{ utility: Utility }>(`/api/contracts/${id}/utilities`, {
      kind: utilForm.kind,
      validFrom: utilForm.validFrom,
      monthlyAdvance: Math.round(parseFloat(utilForm.monthlyAdvance) * 100),
      note: utilForm.note || null,
    }),
    onSuccess: () => {
      setUtilOpen(false);
      setUtilForm({ kind: 'electricity', validFrom: '', monthlyAdvance: '', note: '' });
      qc.invalidateQueries({ queryKey: ['contracts', id, 'utilities'] });
    },
    onError: (e: unknown) => setUtilErr(e instanceof Error ? e.message : String(e)),
  });

  // ── Cost statement dialog state ────────────────────────────────────────────
  const [csOpen, setCsOpen] = useState(false);

  // ── Reconciliation compute dialog state ───────────────────────────────────
  const [reconcileOpen, setReconcileOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <Link to="/contracts" className="text-sm text-muted-foreground hover:underline">← Pronájmy</Link>
        <h1 className="text-3xl font-bold mt-1">Pronájem</h1>
        {contract && (
          <p className="text-muted-foreground mt-1">
            <span className="font-medium text-foreground" title="Nájemník">
              {tenant?.name ?? contract.tenantId}
            </span>
            {' · '}
            <Link
              to={`/properties/${contract.propertyId}`}
              className="underline text-primary hover:opacity-70"
            >
              {property?.name ?? contract.propertyId}
            </Link>
          </p>
        )}
      </div>

      {/* ── Sekce Smlouva ──────────────────────────────────────────────────── */}
      {contract && (
        <Card className="p-6 space-y-2">
          <h2 className="text-lg font-semibold mb-3">Smlouva</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Platnost</span>
              <p className="font-medium">{contract.startDate} – {contract.endDate ?? 'běží'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Kauce</span>
              <p className="font-medium">{contract.securityDeposit != null ? fmtKc(contract.securityDeposit) : '—'}</p>
            </div>
            {contract.note && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Poznámka</span>
                <p className="font-medium">{contract.note}</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── Sekce Aktuální zálohy ──────────────────────────────────────────── */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-3">Aktuální zálohy</h2>
        {!currentTerm && currentUtilities.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žádné aktuální podmínky.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-3 text-sm">
              {currentTerm && (
                <>
                  <div>
                    <p className="text-muted-foreground">Nájem</p>
                    <p className="font-medium">{fmtKc(currentTerm.baseRent)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Záloha na služby</p>
                    <p className="font-medium">{fmtKc(currentTerm.serviceAdvance)}</p>
                  </div>
                </>
              )}
              {currentUtilities.map(u => (
                <div key={u.id}>
                  <p className="text-muted-foreground">Záloha {utilKindLabel(u.kind)}</p>
                  <p className="font-medium">{fmtKc(u.monthlyAdvance)}</p>
                </div>
              ))}
            </div>
            {monthlyTotal !== null && (
              <div className="border-t pt-3">
                <span className="text-sm font-semibold">Měsíčně celkem: </span>
                <span className="text-sm font-bold">{fmtKc(monthlyTotal)}</span>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Sekce Historie smlouvy (Terms) ─────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Historie smlouvy (Terms)</h2>
          <Button size="sm" onClick={() => { setTermsErr(null); setTermsOpen(true); }}>Přidat podmínky</Button>
        </div>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Platnost od</TableHead>
                <TableHead>Nájem (čistý)</TableHead>
                <TableHead>Záloha na služby</TableHead>
                <TableHead>Zdroj</TableHead>
                <TableHead>Poznámka</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {terms.map(t => (
                <TableRow key={t.id}>
                  <TableCell>{t.validFrom}</TableCell>
                  <TableCell>{fmtKc(t.baseRent)}</TableCell>
                  <TableCell>{fmtKc(t.serviceAdvance)}</TableCell>
                  <TableCell>{t.source}</TableCell>
                  <TableCell>{t.note ?? '—'}</TableCell>
                </TableRow>
              ))}
              {terms.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">Zatím žádné podmínky.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* ── Sekce Historie utility ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Historie utility</h2>
          <Button size="sm" onClick={() => { setUtilErr(null); setUtilOpen(true); }}>Přidat energii</Button>
        </div>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Druh</TableHead>
                <TableHead>Platnost od</TableHead>
                <TableHead>Měsíční záloha</TableHead>
                <TableHead>Poznámka</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {utilities.map(u => (
                <TableRow key={u.id}>
                  <TableCell>{utilKindLabel(u.kind)}</TableCell>
                  <TableCell>{u.validFrom}</TableCell>
                  <TableCell>{fmtKc(u.monthlyAdvance)}</TableCell>
                  <TableCell>{u.note ?? '—'}</TableCell>
                </TableRow>
              ))}
              {utilities.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6">Zatím žádné energie.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* ── Sekce Vyúčtování nákladů ───────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Vyúčtování nákladů</h2>
          {contract && (
            <Button size="sm" onClick={() => setCsOpen(true)}>Nové vyúčtování nákladů</Button>
          )}
        </div>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Druh</TableHead>
                <TableHead>Období</TableHead>
                <TableHead>Celkem</TableHead>
                <TableHead>Úprava</TableHead>
                <TableHead>Reconciliable</TableHead>
                <TableHead>Poznámka k úpravě</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredStatements.map(s => {
                const adj = s.adjustmentAmount ?? 0;
                const reconciliable = s.totalAmount + adj;
                return (
                  <TableRow key={s.id}>
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
              {filteredStatements.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">Žádné výkazy nákladů pro toto období.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* ── Sekce Vyúčtování nájemníkovi ──────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Vyúčtování nájemníkovi</h2>
          {id && (
            <Button size="sm" onClick={() => setReconcileOpen(true)}>Spočítat nové vyúčtování</Button>
          )}
        </div>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Období</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead>Celkový rozdíl</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reconciliations.map(r => {
                const totalDiff = (r.items ?? []).reduce((sum, i) => sum + i.difference, 0);
                return (
                  <TableRow key={r.id}>
                    <TableCell>{r.periodFrom} – {r.periodTo}</TableCell>
                    <TableCell>{r.status}</TableCell>
                    <TableCell>{fmtKc(totalDiff)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/reconciliations/${r.id}`)}>Otevřít</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {reconciliations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">Žádná vyúčtování pro tento pronájem.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* ── Add terms dialog ───────────────────────────────────────────────── */}
      {termsOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setTermsOpen(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">Přidat podmínky</h2>
            <div>
              <Label>Platnost od</Label>
              <Input type="date" value={termsForm.validFrom} onChange={e => setTermsForm({ ...termsForm, validFrom: e.target.value })} />
            </div>
            <div>
              <Label>Nájem (čistý) (Kč)</Label>
              <Input type="text" placeholder="0.00" value={termsForm.baseRent} onChange={e => setTermsForm({ ...termsForm, baseRent: e.target.value })} />
            </div>
            <div>
              <Label>Záloha na služby (Kč)</Label>
              <Input type="text" placeholder="0.00" value={termsForm.serviceAdvance} onChange={e => setTermsForm({ ...termsForm, serviceAdvance: e.target.value })} />
            </div>
            <div>
              <Label>Zdroj</Label>
              <select
                className={SELECT_CLS}
                value={termsForm.source}
                onChange={e => setTermsForm({ ...termsForm, source: e.target.value })}
              >
                <option value="initial">Počáteční</option>
                <option value="addendum">Dodatek</option>
                <option value="change">Změna</option>
              </select>
            </div>
            <div>
              <Label>Poznámka (volitelné)</Label>
              <Input value={termsForm.note} onChange={e => setTermsForm({ ...termsForm, note: e.target.value })} />
            </div>
            {termsErr && <p className="text-sm text-destructive">{termsErr}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTermsOpen(false)}>Zrušit</Button>
              <Button
                onClick={() => addTerms.mutate()}
                disabled={!termsForm.validFrom || !termsForm.baseRent || !termsForm.serviceAdvance || addTerms.isPending}
              >
                Přidat
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ── Add utility dialog ─────────────────────────────────────────────── */}
      {utilOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setUtilOpen(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">Přidat energii</h2>
            <div>
              <Label>Druh</Label>
              <select
                className={SELECT_CLS}
                value={utilForm.kind}
                onChange={e => setUtilForm({ ...utilForm, kind: e.target.value })}
              >
                <option value="electricity">Elektřina</option>
                <option value="gas">Plyn</option>
                <option value="internet">Internet</option>
                <option value="water">Voda</option>
                <option value="other">Ostatní</option>
              </select>
            </div>
            <div>
              <Label>Platnost od</Label>
              <Input type="date" value={utilForm.validFrom} onChange={e => setUtilForm({ ...utilForm, validFrom: e.target.value })} />
            </div>
            <div>
              <Label>Měsíční záloha (Kč)</Label>
              <Input type="text" placeholder="0.00" value={utilForm.monthlyAdvance} onChange={e => setUtilForm({ ...utilForm, monthlyAdvance: e.target.value })} />
            </div>
            <div>
              <Label>Poznámka (volitelné)</Label>
              <Input value={utilForm.note} onChange={e => setUtilForm({ ...utilForm, note: e.target.value })} />
            </div>
            {utilErr && <p className="text-sm text-destructive">{utilErr}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setUtilOpen(false)}>Zrušit</Button>
              <Button
                onClick={() => addUtility.mutate()}
                disabled={!utilForm.validFrom || !utilForm.monthlyAdvance || addUtility.isPending}
              >
                Přidat
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ── CostStatement create dialog ────────────────────────────────────── */}
      {csOpen && contract && (
        <CostStatementDialog
          fixedPropertyId={contract.propertyId}
          properties={propertiesData?.properties ?? []}
          onClose={() => setCsOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['cost-statements-by-property', contract.propertyId] })}
        />
      )}

      {/* ── Reconciliation compute dialog ──────────────────────────────────── */}
      {reconcileOpen && id && (
        <ComputeDialog
          contractId={id}
          onClose={() => setReconcileOpen(false)}
          onCreated={(newId) => {
            qc.invalidateQueries({ queryKey: ['reconciliations-by-contract', id] });
            navigate(`/reconciliations/${newId}`);
          }}
        />
      )}
    </div>
  );
}
