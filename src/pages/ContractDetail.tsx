import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { computeDeductibleForPeriod } from '@/lib/proration';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface Contract {
  id: string;
  propertyId: string;
  tenantId: string;
  startDate: string;
  endDate: string | null;
  securityDeposit: number | null;
  note?: string | null;
  paymentDueDay: number;
  paymentAppliesTo: 'current' | 'next';
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

interface Payment {
  id: string;
  paidAt: string;
  amount: number;
  counterparty: string | null;
  counterpartyAccount: string | null;
  contractId: string | null;
  source: string;
  externalId: string | null;
  description: string | null;
  note: string | null;
}

type UtilityKindBE = 'electricity' | 'gas' | 'internet' | 'water' | 'other';

interface RentReductionItem {
  id: string;
  forMonth: string;
  amount: number;
  reason: string | null;
}

interface AppliedPayment {
  paymentId: string;
  paidAt: string;
  amount: number;
  lateDays: number;
}

interface MonthBreakdown {
  month: string;
  daysActive: number;
  daysInMonth: number;
  expected: {
    baseRent: number;
    serviceAdvance: number;
    utilities: Record<UtilityKindBE, number>;
    total: number;
  };
  rentReduction: number;
  effectiveExpected: number;
  receivedTotal: number;
  allocation: {
    baseRentPaid: number;
    servicePaid: number;
    utilityPaid: Record<UtilityKindBE, number>;
    surplus: number;
    deficitTotal: number;
  };
  dueDate: string;
  appliedPayments: AppliedPayment[];
  isLate: boolean;
  maxLateDays: number;
  paymentIds: string[];
}

interface PaymentBreakdownData {
  months: MonthBreakdown[];
  rentReductions: RentReductionItem[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtKc(halere: number) {
  return (halere / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
}

function fmtKcSigned(halere: number) {
  const s = (halere / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
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

// ─── Podmínky (unified terms + utilities timeline) ────────────────────────────

const UTILITY_KINDS = ['electricity', 'gas', 'internet', 'water', 'other'] as const;
type UtilityKind = typeof UTILITY_KINDS[number];
const UTILITY_LABEL: Record<UtilityKind, string> = {
  electricity: 'Elektřina',
  gas: 'Plyn',
  internet: 'Internet',
  water: 'Voda',
  other: 'Ostatní',
};

function validAt<T extends { validFrom: string; validTo?: string | null }>(rows: T[], date: string): T | null {
  // Return the most recent row where validFrom <= date and (validTo is null/undefined OR date < validTo)
  // rows are assumed sorted so we iterate and take the last matching
  let result: T | null = null;
  for (const r of rows) {
    if (r.validFrom <= date && (r.validTo === null || r.validTo === undefined || date < r.validTo)) {
      if (result === null || r.validFrom >= result.validFrom) {
        result = r;
      }
    }
  }
  return result;
}

interface PodminkyTableProps {
  terms: ContractTerm[];
  utilities: Utility[];
}

function PodminkyTable({ terms, utilities }: PodminkyTableProps) {
  const fmt = (h: number) => (h / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';

  // Which utility kinds appear at all in this contract
  const presentKinds = UTILITY_KINDS.filter(k => utilities.some(u => u.kind === k));

  // All unique transition dates from both tables
  const dates = Array.from(new Set([
    ...terms.map(t => t.validFrom),
    ...utilities.map(u => u.validFrom),
  ])).sort();

  if (dates.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Zatím žádné podmínky. Přidej první.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Platnost od</TableHead>
            <TableHead>Nájem</TableHead>
            <TableHead>Záloha SVJ</TableHead>
            {presentKinds.map(k => <TableHead key={k}>{UTILITY_LABEL[k]}</TableHead>)}
            <TableHead>Σ Měsíčně</TableHead>
            <TableHead>Zdroj</TableHead>
            <TableHead>Poznámka</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dates.map(d => {
            const activeTerm = validAt(terms, d);
            const baseRent = activeTerm?.baseRent ?? 0;
            const serviceAdvance = activeTerm?.serviceAdvance ?? 0;
            const utilByKind: Partial<Record<UtilityKind, number>> = {};
            let utilSum = 0;
            for (const k of presentKinds) {
              const u = validAt(utilities.filter(x => x.kind === k), d);
              if (u) {
                utilByKind[k] = u.monthlyAdvance;
                utilSum += u.monthlyAdvance;
              }
            }
            const total = baseRent + serviceAdvance + utilSum;
            // Highlight the latest open row (active term with no validTo)
            const isLatest = activeTerm?.validTo === null || activeTerm?.validTo === undefined;
            // Collect notes from active term and active utilities
            const noteParts: string[] = [];
            if (activeTerm?.note) noteParts.push(`smlouva: ${activeTerm.note}`);
            for (const k of presentKinds) {
              const u = validAt(utilities.filter(x => x.kind === k), d);
              if (u?.note) noteParts.push(`${UTILITY_LABEL[k]}: ${u.note}`);
            }

            return (
              <TableRow key={d} className={isLatest ? 'bg-accent/30' : ''}>
                <TableCell className="font-medium">{d}</TableCell>
                <TableCell>{fmt(baseRent)}</TableCell>
                <TableCell>{fmt(serviceAdvance)}</TableCell>
                {presentKinds.map(k => (
                  <TableCell key={k}>{utilByKind[k] !== undefined ? fmt(utilByKind[k]!) : '—'}</TableCell>
                ))}
                <TableCell className="font-semibold">{fmt(total)}</TableCell>
                <TableCell className="text-xs">{activeTerm?.source ?? '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-md truncate" title={noteParts.join(' · ')}>
                  {noteParts.join(' · ') || '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

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

// ─── Payment create dialog ────────────────────────────────────────────────────

interface PaymentDialogProps {
  fixedContractId: string;
  onClose: () => void;
  onCreated: () => void;
}

function PaymentDialog({ fixedContractId, onClose, onCreated }: PaymentDialogProps) {
  const [form, setForm] = useState({
    amount: '',
    paidAt: '',
    counterparty: '',
    counterpartyAccount: '',
    source: 'manual' as 'manual' | 'bank',
    externalId: '',
    description: '',
    note: '',
  });
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ payment: Payment }>('/api/payments', {
      contractId: fixedContractId,
      amount: Math.round(parseFloat(form.amount.replace(',', '.')) * 100),
      paidAt: form.paidAt,
      counterparty: form.counterparty || null,
      counterpartyAccount: form.counterpartyAccount || null,
      source: form.source,
      externalId: form.externalId || null,
      description: form.description || null,
      note: form.note || null,
    }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold">Nová platba</h2>
        <div>
          <Label>Částka (Kč)</Label>
          <Input type="text" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
        </div>
        <div>
          <Label>Zaplaceno dne</Label>
          <Input type="date" value={form.paidAt} onChange={e => setForm({ ...form, paidAt: e.target.value })} />
        </div>
        <div>
          <Label>Protistrana (volitelné)</Label>
          <Input value={form.counterparty} onChange={e => setForm({ ...form, counterparty: e.target.value })} />
        </div>
        <div>
          <Label>Číslo účtu protistrany (volitelné)</Label>
          <Input value={form.counterpartyAccount} onChange={e => setForm({ ...form, counterpartyAccount: e.target.value })} />
        </div>
        <div>
          <Label>Zdroj</Label>
          <select
            className={SELECT_CLS}
            value={form.source}
            onChange={e => setForm({ ...form, source: e.target.value as 'manual' | 'bank' })}
          >
            <option value="manual">Ručně</option>
            <option value="bank">Banka</option>
          </select>
        </div>
        <div>
          <Label>Externí ID (volitelné)</Label>
          <Input value={form.externalId} onChange={e => setForm({ ...form, externalId: e.target.value })} />
        </div>
        <div>
          <Label>Popis (volitelné)</Label>
          <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <Label>Poznámka (volitelné)</Label>
          <Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Zrušit</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!form.amount || !form.paidAt || create.isPending}
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

// ─── Podmínky dialog (unified terms + utilities entry) ────────────────────────

interface PodminkyDialogProps {
  contractId: string;
  terms: ContractTerm[];
  utilities: Utility[];
  onClose: () => void;
  onCreated: () => void;
}

function PodminkyDialog({ contractId, terms, utilities, onClose, onCreated }: PodminkyDialogProps) {
  const presentKinds = UTILITY_KINDS.filter(k => utilities.some(u => u.kind === k));
  const hasExisting = terms.length > 0;

  // Pre-fill from currently active term + utilities (validTo === null)
  const activeTerm = terms.find(t => t.validTo === null || t.validTo === undefined);
  const initialUtilities: Partial<Record<UtilityKind, string>> = {};
  for (const k of presentKinds) {
    const u = utilities.filter(x => x.kind === k).find(x => x.validTo === null || x.validTo === undefined);
    if (u) initialUtilities[k] = (u.monthlyAdvance / 100).toFixed(2);
  }

  const [form, setForm] = useState({
    validFrom: '',
    baseRentCzk: activeTerm ? (activeTerm.baseRent / 100).toFixed(2) : '',
    serviceAdvanceCzk: activeTerm ? (activeTerm.serviceAdvance / 100).toFixed(2) : '',
    source: (hasExisting ? 'addendum' : 'initial') as 'initial' | 'addendum' | 'change',
    note: '',
    utilities: initialUtilities as Partial<Record<UtilityKind, string>>,
  });

  // New utility kind fields
  const [newUtilityKind, setNewUtilityKind] = useState<UtilityKind | ''>('');
  const [newUtilityCzk, setNewUtilityCzk] = useState('');

  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const availableNewKinds = UTILITY_KINDS.filter(k => !presentKinds.includes(k));

  async function handleSubmit() {
    if (!form.validFrom || !form.baseRentCzk || !form.serviceAdvanceCzk) return;
    setSubmitting(true);
    setErr(null);
    try {
      // 1. POST terms
      await api.post(`/api/contracts/${contractId}/terms`, {
        validFrom: form.validFrom,
        baseRent: Math.round(parseFloat(form.baseRentCzk.replace(',', '.')) * 100),
        serviceAdvance: Math.round(parseFloat(form.serviceAdvanceCzk.replace(',', '.')) * 100),
        source: form.source,
        note: form.note || null,
      });

      // 2. POST utilities for each kind that has a value and differs from current
      const errors: string[] = [];
      for (const k of presentKinds) {
        const valStr = form.utilities[k];
        if (!valStr || valStr.trim() === '') continue; // skip empty — no-op (known limitation: doesn't remove utility)
        const newAmount = Math.round(parseFloat(valStr.replace(',', '.')) * 100);
        const currentU = utilities.filter(x => x.kind === k).find(x => x.validTo === null || x.validTo === undefined);
        const currentAmount = currentU?.monthlyAdvance ?? null;
        // Only POST if value changed or it's a new entry
        if (currentAmount === null || newAmount !== currentAmount) {
          try {
            await api.post(`/api/contracts/${contractId}/utilities`, {
              kind: k,
              validFrom: form.validFrom,
              monthlyAdvance: newAmount,
              note: null,
            });
          } catch (e) {
            errors.push(`${UTILITY_LABEL[k]}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }

      // 3. POST new utility kind if filled in
      if (newUtilityKind && newUtilityCzk.trim() !== '') {
        try {
          await api.post(`/api/contracts/${contractId}/utilities`, {
            kind: newUtilityKind,
            validFrom: form.validFrom,
            monthlyAdvance: Math.round(parseFloat(newUtilityCzk.replace(',', '.')) * 100),
            note: null,
          });
        } catch (e) {
          errors.push(`${UTILITY_LABEL[newUtilityKind]}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (errors.length > 0) {
        setErr(`Podmínky uloženy, ale chyba u energií: ${errors.join('; ')}`);
      }
      onCreated();
      if (errors.length === 0) onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold">Přidat změnu</h2>
        <div>
          <Label>Platnost od</Label>
          <Input type="date" value={form.validFrom} onChange={e => setForm({ ...form, validFrom: e.target.value })} />
        </div>
        <div>
          <Label>Nájem (Kč)</Label>
          <Input type="text" placeholder="0.00" value={form.baseRentCzk} onChange={e => setForm({ ...form, baseRentCzk: e.target.value })} />
        </div>
        <div>
          <Label>Záloha SVJ (Kč)</Label>
          <Input type="text" placeholder="0.00" value={form.serviceAdvanceCzk} onChange={e => setForm({ ...form, serviceAdvanceCzk: e.target.value })} />
        </div>
        <div>
          <Label>Zdroj</Label>
          <select
            className={SELECT_CLS}
            value={form.source}
            onChange={e => setForm({ ...form, source: e.target.value as 'initial' | 'addendum' | 'change' })}
          >
            <option value="initial">Počáteční</option>
            <option value="addendum">Dodatek</option>
            <option value="change">Změna</option>
          </select>
        </div>
        <div>
          <Label>Poznámka (volitelné)</Label>
          <Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
        </div>

        {presentKinds.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Energie</p>
            <p className="text-xs text-muted-foreground">Ponech prázdné = beze změny. Vymazání hodnoty energii neodstraní (pro odstranění je potřeba backend podpora).</p>
            {presentKinds.map(k => (
              <div key={k}>
                <Label className="text-sm">{UTILITY_LABEL[k]} (Kč)</Label>
                <Input
                  type="text"
                  placeholder="0.00"
                  value={form.utilities[k] ?? ''}
                  onChange={e => setForm({ ...form, utilities: { ...form.utilities, [k]: e.target.value } })}
                />
              </div>
            ))}
          </div>
        )}

        {availableNewKinds.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Přidat další energii</p>
            <div className="flex gap-2">
              <select
                className={SELECT_CLS}
                value={newUtilityKind}
                onChange={e => setNewUtilityKind(e.target.value as UtilityKind | '')}
              >
                <option value="">Vyber druh…</option>
                {availableNewKinds.map(k => <option key={k} value={k}>{UTILITY_LABEL[k]}</option>)}
              </select>
              <Input
                type="text"
                placeholder="Kč"
                className="w-32"
                value={newUtilityCzk}
                onChange={e => setNewUtilityCzk(e.target.value)}
              />
            </div>
          </div>
        )}

        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Zrušit</Button>
          <Button
            onClick={handleSubmit}
            disabled={!form.validFrom || !form.baseRentCzk || !form.serviceAdvanceCzk || submitting}
          >
            {submitting ? 'Ukládám…' : 'Přidat'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── RentReduction dialog ─────────────────────────────────────────────────────

interface RentReductionDialogProps {
  contractId: string;
  prefillMonth?: string; // YYYY-MM-01
  onClose: () => void;
  onCreated: () => void;
}

function RentReductionDialog({ contractId, prefillMonth, onClose, onCreated }: RentReductionDialogProps) {
  const [form, setForm] = useState({
    forMonth: prefillMonth ?? '',
    amountCzk: '',
    reason: '',
  });
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post(`/api/contracts/${contractId}/rent-reductions`, {
      forMonth: form.forMonth,
      amount: Math.round(parseFloat(form.amountCzk.replace(',', '.')) * 100),
      reason: form.reason || null,
    }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold">Přidat srážku nájmu</h2>
        <div>
          <Label>Měsíc (1. den měsíce)</Label>
          <Input type="date" value={form.forMonth} onChange={e => setForm({ ...form, forMonth: e.target.value })} />
        </div>
        <div>
          <Label>Částka srážky (Kč)</Label>
          <Input type="text" placeholder="0.00" value={form.amountCzk} onChange={e => setForm({ ...form, amountCzk: e.target.value })} />
        </div>
        <div>
          <Label>Důvod (volitelné)</Label>
          <Input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Např. nájemník uhradil opravu pronajímatele" />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Zrušit</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!form.forMonth || !form.amountCzk || create.isPending}
          >
            Přidat
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Měsíční rozpis ──────────────────────────────────────────────────────────

interface MesicniRozpisProps {
  contractId: string;
  contract: Contract;
}

function MesicniRozpis({ contractId, contract }: MesicniRozpisProps) {
  const qc = useQueryClient();
  const [rrDialogOpen, setRrDialogOpen] = useState(false);
  const [prefillMonth, setPrefillMonth] = useState<string | undefined>(undefined);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const today = new Date().toISOString().slice(0, 10);
  const periodTo = contract.endDate ?? today;

  const breakdown = useQuery({
    queryKey: ['payment-breakdown', contractId],
    queryFn: () => api.get<PaymentBreakdownData>(
      `/api/contracts/${contractId}/payment-breakdown?from=${contract.startDate}&to=${periodTo}`
    ),
    enabled: !!contract,
  });

  const deleteReduction = useMutation({
    mutationFn: (rid: string) => api.delete(`/api/contracts/${contractId}/rent-reductions/${rid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-breakdown', contractId] }),
  });

  function toggleExpand(month: string) {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month); else next.add(month);
      return next;
    });
  }

  const UTIL_LABEL: Record<UtilityKindBE, string> = {
    electricity: 'Elektřina', gas: 'Plyn', internet: 'Internet', water: 'Voda', other: 'Ostatní',
  };
  const UTIL_ORDER: UtilityKindBE[] = ['electricity', 'gas', 'internet', 'water', 'other'];

  if (breakdown.isLoading) return <p className="text-sm text-muted-foreground py-4">Načítám rozpis…</p>;
  if (breakdown.error) return <p className="text-sm text-destructive py-4">Chyba při načítání rozpisu.</p>;

  const months = breakdown.data?.months ?? [];
  if (months.length === 0) return <p className="text-sm text-muted-foreground py-4">Žádné měsíce v období smlouvy.</p>;

  // Which utility kinds have any non-zero expected across all months
  const activeKinds = UTIL_ORDER.filter(k => months.some(m => m.expected.utilities[k] > 0));

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Měsíc</TableHead>
              <TableHead>Splatnost</TableHead>
              <TableHead className="text-right">Plán</TableHead>
              <TableHead className="text-right">Srážka</TableHead>
              <TableHead className="text-right">Předepsáno</TableHead>
              <TableHead className="text-right">Zaplaceno</TableHead>
              <TableHead className="text-right">Rozdíl</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map(row => {
              const diff = row.receivedTotal - row.effectiveExpected;
              const isExpanded = expandedMonths.has(row.month);
              const reductionEntry = breakdown.data?.rentReductions.find(r => r.forMonth === `${row.month}-01`);

              return (
                <>
                  <TableRow
                    key={row.month}
                    className={row.daysActive === 0 ? 'opacity-40' : ''}
                  >
                    <TableCell className="p-1">
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground px-1"
                        onClick={() => toggleExpand(row.month)}
                        title={isExpanded ? 'Skrýt alokaci' : 'Zobrazit alokaci'}
                      >
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    </TableCell>
                    <TableCell className="font-medium">
                      <span>{row.month}</span>
                      {row.isLate && (
                        <span className="ml-2 inline-block rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700" title={`Pozdě o ${row.maxLateDays} dní`}>
                          +{row.maxLateDays} dní
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.dueDate ?? '—'}</TableCell>
                    <TableCell className="text-right">{fmtKc(row.expected.total)}</TableCell>
                    <TableCell className="text-right">
                      {reductionEntry ? (
                        <span className="flex items-center justify-end gap-1">
                          <span className="text-amber-600">{fmtKc(reductionEntry.amount)}</span>
                          <button
                            className="text-destructive hover:opacity-70 text-xs"
                            title={reductionEntry.reason ?? 'Smazat srážku'}
                            onClick={() => deleteReduction.mutate(reductionEntry.id)}
                          >
                            ✕
                          </button>
                        </span>
                      ) : (
                        <button
                          className="text-xs text-muted-foreground hover:text-primary"
                          onClick={() => {
                            setPrefillMonth(`${row.month}-01`);
                            setRrDialogOpen(true);
                          }}
                        >
                          + Přidat
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{fmtKc(row.effectiveExpected)}</TableCell>
                    <TableCell className="text-right">{fmtKc(row.receivedTotal)}</TableCell>
                    <TableCell className="text-right">{fmtKcSigned(diff)}</TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow key={`${row.month}-detail`} className="bg-muted/30">
                      <TableCell colSpan={8} className="py-3 px-6">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                          <div>
                            <p className="text-muted-foreground">Nájem uhrazen</p>
                            <p className="font-medium">{fmtKc(row.allocation.baseRentPaid)} <span className="text-muted-foreground">/ {fmtKc(row.expected.baseRent)}</span></p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Záloha SVJ</p>
                            <p className="font-medium">{fmtKc(row.allocation.servicePaid)} <span className="text-muted-foreground">/ {fmtKc(row.expected.serviceAdvance)}</span></p>
                          </div>
                          {activeKinds.map(k => (
                            <div key={k}>
                              <p className="text-muted-foreground">{UTIL_LABEL[k]}</p>
                              <p className="font-medium">{fmtKc(row.allocation.utilityPaid[k])} <span className="text-muted-foreground">/ {fmtKc(row.expected.utilities[k])}</span></p>
                            </div>
                          ))}
                          {row.allocation.surplus > 0 && (
                            <div>
                              <p className="text-muted-foreground">Přeplatek</p>
                              <p className="font-medium text-green-600">{fmtKc(row.allocation.surplus)}</p>
                            </div>
                          )}
                          {row.allocation.deficitTotal > 0 && (
                            <div>
                              <p className="text-muted-foreground">Dluh celkem</p>
                              <p className="font-medium text-red-600">{fmtKc(row.allocation.deficitTotal)}</p>
                            </div>
                          )}
                          {row.daysActive < row.daysInMonth && (
                            <div>
                              <p className="text-muted-foreground">Aktivní dny</p>
                              <p className="font-medium">{row.daysActive} / {row.daysInMonth}</p>
                            </div>
                          )}
                        </div>
                        {(row.appliedPayments ?? []).length > 0 && (
                          <div className="mt-3 border-t pt-2">
                            <p className="text-xs text-muted-foreground mb-1">Přiřazené platby (FIFO)</p>
                            <div className="space-y-1">
                              {(row.appliedPayments ?? []).map(ap => (
                                <div key={ap.paymentId} className="flex items-center gap-3 text-xs">
                                  <span className="text-muted-foreground">{ap.paidAt}</span>
                                  <span className="font-medium">{fmtKc(ap.amount)}</span>
                                  {ap.lateDays > 0 ? (
                                    <span className="text-red-600 font-semibold">pozdě o {ap.lateDays} dní</span>
                                  ) : (
                                    <span className="text-green-600">včas</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {rrDialogOpen && (
        <RentReductionDialog
          contractId={contractId}
          prefillMonth={prefillMonth}
          onClose={() => { setRrDialogOpen(false); setPrefillMonth(undefined); }}
          onCreated={() => qc.invalidateQueries({ queryKey: ['payment-breakdown', contractId] })}
        />
      )}
    </>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

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

  const recomputeReconciliation = useMutation({
    mutationFn: (recId: string) => api.post<{ reconciliation: Reconciliation }>(`/api/reconciliations/${recId}/recompute`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reconciliations-by-contract', id] }),
  });

  const deleteReconciliation = useMutation({
    mutationFn: (recId: string) => api.delete<void>(`/api/reconciliations/${recId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reconciliations-by-contract', id] }),
  });

  // Payments for this contract
  const { data: paymentsData } = useQuery({
    queryKey: ['payments-by-contract', id],
    queryFn: () => api.get<{ payments: Payment[] }>(`/api/payments?contractId=${id}`),
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

  // ── Podmínky dialog state ──────────────────────────────────────────────────
  const [podminkyOpen, setPodminkyOpen] = useState(false);

  // ── Cost statement dialog state ────────────────────────────────────────────
  const [csOpen, setCsOpen] = useState(false);

  // ── Reconciliation compute dialog state ───────────────────────────────────
  const [reconcileOpen, setReconcileOpen] = useState(false);

  // ── Payment create dialog state ────────────────────────────────────────────
  const [paymentOpen, setPaymentOpen] = useState(false);

  // ── Tab management ──────────────────────────────────────────────────────────
  const tab = searchParams.get('tab') ?? 'prehled';
  const setTab = (v: string) => {
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      n.set('tab', v);
      return n;
    }, { replace: true });
  };

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

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="prehled">Přehled</TabsTrigger>
          <TabsTrigger value="platby">Platby</TabsTrigger>
          <TabsTrigger value="sluzby">Služby / Energie</TabsTrigger>
          <TabsTrigger value="vyuctovani">Vyúčtování (nájemci)</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Přehled ─────────────────────────────────────────────── */}
        <TabsContent value="prehled" className="space-y-6">
          {/* Sekce Smlouva */}
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
                <div>
                  <span className="text-muted-foreground">Splatnost</span>
                  <p className="font-medium">
                    do {contract.paymentDueDay ?? 10}. dne {contract.paymentAppliesTo === 'next' ? 'předchozího' : 'aktuálního'} měsíce
                  </p>
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

          {/* Sekce Aktuální podmínky */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-3">Aktuální podmínky</h2>
            {!currentTerm && currentUtilities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Žádné aktuální podmínky.</p>
            ) : (() => {
                const sluzbyTotal = (currentTerm?.serviceAdvance ?? 0) + currentUtilities.reduce((s, u) => s + u.monthlyAdvance, 0);
                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Nájem</p>
                        <p className="font-medium text-base">{fmtKc(currentTerm?.baseRent ?? 0)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Služby (celkem)</p>
                        <p className="font-medium text-base">{fmtKc(sluzbyTotal)}</p>
                      </div>
                      {monthlyTotal !== null && (
                        <div>
                          <p className="text-muted-foreground">Měsíčně celkem</p>
                          <p className="font-bold text-base">{fmtKc(monthlyTotal)}</p>
                        </div>
                      )}
                    </div>
                    {sluzbyTotal > 0 && (
                      <div className="border-t pt-3">
                        <p className="text-xs text-muted-foreground mb-2">Rozklad složek služeb</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                          {currentTerm && currentTerm.serviceAdvance > 0 && (
                            <div>
                              <p className="text-muted-foreground text-xs">Záloha SVJ</p>
                              <p className="font-medium">{fmtKc(currentTerm.serviceAdvance)}</p>
                            </div>
                          )}
                          {currentUtilities.map(u => (
                            <div key={u.id}>
                              <p className="text-muted-foreground text-xs">{utilKindLabel(u.kind)}</p>
                              <p className="font-medium">{fmtKc(u.monthlyAdvance)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
          </Card>

          {/* Sekce Historie smlouvy */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Historie smlouvy</CardTitle>
              <Button onClick={() => setPodminkyOpen(true)}>Přidat změnu</Button>
            </CardHeader>
            <CardContent>
              <PodminkyTable terms={terms} utilities={utilities} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 2: Platby ──────────────────────────────────────────────── */}
        <TabsContent value="platby" className="space-y-4">
          {/* Měsíční rozpis */}
          {id && contract && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle>Měsíční rozpis</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <MesicniRozpis contractId={id} contract={contract} />
              </CardContent>
            </Card>
          )}

          {/* Platby tabulka */}
          <Card>
            <div className="p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Platby</h2>
                {id && (
                  <Button size="sm" onClick={() => setPaymentOpen(true)}>Nová platba</Button>
                )}
              </div>
              <div className="overflow-hidden border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Datum</TableHead>
                      <TableHead>Částka</TableHead>
                      <TableHead>Protistrana</TableHead>
                      <TableHead>Číslo účtu</TableHead>
                      <TableHead>Zdroj</TableHead>
                      <TableHead>Externí ID</TableHead>
                      <TableHead>Poznámka</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(paymentsData?.payments ?? []).map(p => (
                      <TableRow key={p.id}>
                        <TableCell>{p.paidAt}</TableCell>
                        <TableCell>{fmtKc(p.amount)}</TableCell>
                        <TableCell>{p.counterparty ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.counterpartyAccount ?? '—'}</TableCell>
                        <TableCell>{p.source}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.externalId ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate" title={p.note ?? undefined}>
                          {p.note ?? p.description ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(paymentsData?.payments ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">Žádné platby pro tento pronájem.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ── Tab 3: Služby / Energie ────────────────────────────────────── */}
        <TabsContent value="sluzby">
          <Card>
            <div className="p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Vyúčtování nákladů</h2>
                {contract && (
                  <Button size="sm" onClick={() => setCsOpen(true)}>Nové vyúčtování nákladů</Button>
                )}
              </div>
              <div className="overflow-hidden border rounded-md">
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
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ── Tab 3: Vyúčtování (nájemci) ────────────────────────────────── */}
        <TabsContent value="vyuctovani">
          <Card>
            <div className="p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Vyúčtování nájemníkovi</h2>
                {id && (
                  <Button size="sm" onClick={() => setReconcileOpen(true)}>Spočítat nové vyúčtování</Button>
                )}
              </div>
              <div className="overflow-hidden border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Období</TableHead>
                      <TableHead>Stav</TableHead>
                      <TableHead>Celkový rozdíl</TableHead>
                      <TableHead></TableHead>
                      <TableHead>Akce</TableHead>
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
                          <TableCell>
                            {r.status === 'draft' ? (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={recomputeReconciliation.isPending}
                                  onClick={() => {
                                    if (confirm('Přepočítat toto vyúčtování?')) recomputeReconciliation.mutate(r.id);
                                  }}
                                >
                                  Přepočítat
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  disabled={deleteReconciliation.isPending}
                                  onClick={() => {
                                    if (confirm('Smazat toto vyúčtování?')) deleteReconciliation.mutate(r.id);
                                  }}
                                >
                                  Smazat
                                </Button>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {reconciliations.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">Žádná vyúčtování pro tento pronájem.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Payment create dialog ─────────────────────────────────────────── */}
      {paymentOpen && id && (
        <PaymentDialog
          fixedContractId={id}
          onClose={() => setPaymentOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['payments-by-contract', id] })}
        />
      )}

      {/* ── Podmínky dialog ────────────────────────────────────────────────── */}
      {podminkyOpen && id && (
        <PodminkyDialog
          contractId={id}
          terms={terms}
          utilities={utilities}
          onClose={() => setPodminkyOpen(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['contracts', id, 'terms'] });
            qc.invalidateQueries({ queryKey: ['contracts', id, 'utilities'] });
          }}
        />
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
