import { Fragment, useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { computeDeductibleForPeriod } from '@/lib/proration';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Hint } from '@/components/ui/hint';
import { Modal } from '@/components/ui/modal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { KV, KVRow } from '@/components/ui/kv';
import { Seg } from '@/components/ui/seg';
import { Status } from '@/components/ui/status';
import { Notice } from '@/components/ui/notice';
import { Pager, usePager } from '@/components/ui/pager';
import { Crumb } from '@/components/Layout';
import { breakdownRange } from '@/hooks/useContracts';
import { useReminders, dueLabel, reconciliationDeadline, type AgendaItem } from '@/hooks/useReminders';
import { Agenda, reminderItems } from '@/components/Agenda';
import { cn } from '@/lib/utils';
import { fmtDate, fmtDateTime, fmtKc, fmtKcExact, fmtKcSigned, fmtMonth, fmtRange, plural, todayIso } from '@/lib/format';
import { formatSymbols } from '@/lib/symbols';
import { parseKorun } from '@/lib/money';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableEmpty, TableError } from '@/components/ui/table-error';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DuplicatePaymentError } from '@/components/DuplicatePaymentError';
import { PairingCard } from './contract/PairingCard';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface Contract {
  id: string;
  propertyId: string;
  tenantId: string;
  propertyName: string;
  tenantName: string;
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
  paymentDueDay: number;
  paymentAppliesTo: 'current' | 'next';
  source: string;
  documentRef: string | null;
  note: string | null;
}

function DocRefLink({ value }: { value: string | null }) {
  if (!value) return <span className="text-soft">—</span>;
  const isUrl = /^https?:\/\//.test(value);
  if (isUrl) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="text-primary underline" title={value}>
        {(() => { try { return new URL(value).hostname; } catch { return 'odkaz'; } })()}
      </a>
    );
  }
  return <span className="text-xs text-soft" title={value}>{value.length > 24 ? value.slice(0, 22) + '…' : value}</span>;
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

interface Payment {
  id: string;
  paidAt: string;
  amount: number;
  counterparty: string | null;
  counterpartyAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
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

type Kind = 'rent' | 'services' | 'electricity' | 'gas' | 'internet' | 'water' | 'other';
const KINDS_TO_SHOW: Kind[] = ['rent', 'services', 'electricity', 'gas', 'internet', 'water', 'other'];
const KIND_LABEL_CS: Record<string, string> = { rent: 'Nájem', services: 'Služby (SVJ)', electricity: 'Elektřina', gas: 'Plyn', internet: 'Internet', water: 'Voda', other: 'Ostatní' };

function deriveMatchPeriodClient(
  kind: Kind,
  reconFrom: string,
  reconTo: string,
  statements: CostStatement[],
): { from: string; to: string; source: 'default' | 'from-cost-statements'; count: number } {
  const candidates = statements.filter(
    s => s.kind === kind
      && s.periodFrom >= reconFrom
      && s.periodFrom <= reconTo
  );
  if (candidates.length === 0) {
    return { from: reconFrom, to: reconTo, source: 'default', count: 0 };
  }
  const from = candidates.reduce((min, s) => s.periodFrom < min ? s.periodFrom : min, candidates[0]!.periodFrom);
  const to = candidates.reduce((max, s) => s.periodTo > max ? s.periodTo : max, candidates[0]!.periodTo);
  return { from, to, source: 'from-cost-statements', count: candidates.length };
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
  /** Opens the edit dialog for a timeline date (terms row and/or utility rows starting that day). */
  onEditRow?: (date: string) => void;
  /** True while the terms/utilities queries feeding this table haven't returned data yet. */
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}

function PodminkyTable({ terms, utilities, onEditRow, isPending, isError, onRetry }: PodminkyTableProps) {
  // Which utility kinds appear at all in this contract
  const presentKinds = UTILITY_KINDS.filter(k => utilities.some(u => u.kind === k));

  // All unique transition dates from both tables, newest first.
  const dates = Array.from(new Set([
    ...terms.map(t => t.validFrom),
    ...utilities.map(u => u.validFrom),
  ])).sort().reverse();

  const cols = 8 + presentKinds.length + (onEditRow ? 1 : 0);
  const SOURCE_LABEL: Record<string, string> = { initial: 'Počáteční', addendum: 'Dodatek', change: 'Změna' };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Platnost od</TableHead>
          <TableHead className="num">Nájem</TableHead>
          <TableHead className="num">Záloha SVJ</TableHead>
          {presentKinds.map(k => <TableHead key={k} className="num">{UTILITY_LABEL[k]}</TableHead>)}
          <TableHead className="num">Měsíčně</TableHead>
          <TableHead>Splatnost</TableHead>
          <TableHead>Zdroj</TableHead>
          <TableHead>Doklad</TableHead>
          <TableHead>Poznámka</TableHead>
          {onEditRow && <TableHead><span className="sr-only">Akce</span></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isError ? (
          <TableError cols={cols} onRetry={onRetry} />
        ) : isPending ? (
          <TableSkeleton cols={cols} />
        ) : dates.length === 0 ? (
          <TableEmpty cols={cols}>Zatím žádné podmínky. Přidej první změnu.</TableEmpty>
        ) : (
        dates.map(d => {
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
          // The open row (active term with no validTo) is the one in force today.
          const isLatest = activeTerm?.validTo === null || activeTerm?.validTo === undefined;
          // Collect notes from active term and active utilities
          const noteParts: string[] = [];
          if (activeTerm?.note) noteParts.push(activeTerm.note);
          for (const k of presentKinds) {
            const u = validAt(utilities.filter(x => x.kind === k), d);
            if (u?.note && u.validFrom === d) noteParts.push(`${UTILITY_LABEL[k]}: ${u.note}`);
          }

          return (
            <TableRow key={d} className="rem">
              <TableCell className="whitespace-nowrap">
                <span className="font-medium">{fmtDate(d)}</span>
                {isLatest && <span className="ml-2 text-xs font-medium text-accent">platí</span>}
              </TableCell>
              <TableCell className="num">{fmtKc(baseRent)}</TableCell>
              <TableCell className="num">{fmtKc(serviceAdvance)}</TableCell>
              {presentKinds.map(k => (
                <TableCell key={k} className="num">{utilByKind[k] !== undefined ? fmtKc(utilByKind[k]!) : <span className="text-soft">—</span>}</TableCell>
              ))}
              <TableCell className="num font-semibold">{fmtKc(total)}</TableCell>
              <TableCell className="whitespace-nowrap">
                {activeTerm ? `do ${activeTerm.paymentDueDay}. ${activeTerm.paymentAppliesTo === 'next' ? 'předch.' : 'akt.'} měsíce` : '—'}
              </TableCell>
              <TableCell>{activeTerm?.validFrom === d ? (SOURCE_LABEL[activeTerm.source] ?? activeTerm.source) : <span className="text-soft">—</span>}</TableCell>
              <TableCell className="whitespace-nowrap">
                {activeTerm?.validFrom === d ? <DocRefLink value={activeTerm?.documentRef ?? null} /> : <span className="text-soft">—</span>}
              </TableCell>
              <TableCell className="max-w-md truncate text-sm text-soft" title={noteParts.join(' · ')}>
                {noteParts.join(' · ') || '—'}
              </TableCell>
              {onEditRow && (
                <TableCell className="text-right">
                  <button
                    type="button"
                    className="acts text-sm text-soft hover:text-accent"
                    onClick={() => onEditRow(d)}
                  >Upravit</button>
                </TableCell>
              )}
            </TableRow>
          );
        })
        )}
      </TableBody>
    </Table>
  );
}


// ─── CostStatement create dialog (extracted for reuse) ────────────────────────

interface CostStatementDialogProps {
  fixedPropertyId: string;
  properties: Property[];
  onClose: () => void;
  onCreated: () => void;
}

export function CostStatementDialog({ fixedPropertyId, properties, onClose, onCreated }: CostStatementDialogProps) {
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
    const deductibleNote = repTariff?.deductibleNote ?? 'odečitatelná část z evidenčního listu';
    const note = `Odečitatelná část (${deductibleNote}) za ${daysCovered} dní = ${(totalHaler / 100).toFixed(2)} Kč`;
    setForm(prev => ({ ...prev, adjustmentAmount: (-totalHaler / 100).toFixed(2), adjustmentNote: note }));
    setAutoFillLabel('(automaticky z evidenčního listu)');
  }, [adjustmentTouched, form.kind, form.propertyId, form.periodFrom, form.periodTo, tariffsQuery.data]);

  // totalAmount is required — 'empty' is as unsubmittable as 'invalid'.
  // adjustmentAmount is optional and signed: empty or a parsed zero both mean
  // "no adjustment" (null on the wire), matching the previous '' / '0' checks.
  const totalAmount = parseKorun(form.totalAmount);
  const totalAmountInvalid = totalAmount.kind !== 'value';
  const adjustmentAmount = parseKorun(form.adjustmentAmount);
  const adjustmentAmountInvalid = adjustmentAmount.kind === 'invalid';

  const create = useMutation({
    mutationFn: () => {
      const periodFrom = periodMode === 'year' ? `${year}-01-01` : form.periodFrom;
      const periodTo = periodMode === 'year' ? `${year}-12-31` : form.periodTo;
      return api.post<{ statement: CostStatement }>('/api/cost-statements', {
        propertyId: form.propertyId,
        kind: form.kind,
        periodFrom,
        periodTo,
        totalAmount: totalAmount.kind === 'value' ? totalAmount.halere : 0,
        adjustmentAmount: adjustmentAmount.kind === 'value' && adjustmentAmount.halere !== 0
          ? adjustmentAmount.halere
          : null,
        adjustmentNote: form.adjustmentNote || null,
        documentRef: form.documentRef || null,
      });
    },
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal title="Nové vyúčtování nákladů" onClose={onClose} footer={<>
        <Button variant="outline" onClick={onClose}>Zrušit</Button>
        <Button
          onClick={() => create.mutate()}
          disabled={!form.propertyId || totalAmountInvalid || adjustmentAmountInvalid || (periodMode === 'custom' && (!form.periodFrom || !form.periodTo)) || create.isPending}
        >
          Vytvořit
        </Button>
    </>}>
        <div>
          <Label>Nemovitost</Label>
          <select
            className="select-native"
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
            className="select-native"
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
          <div className="mb-1 flex items-center gap-1.5"><Label className="mb-0">Období</Label><Hint label="K čemu je období">Období říká, co náklad pokrývá. Při vyúčtování nájemci se podle něj párují i platby stejného druhu, pokud období začíná uvnitř vyúčtovávaného roku. Náklad přes přelom roku rozděl na dva záznamy, každý ve svém kalendářním roce.</Hint></div>
          <div className="flex gap-2 mb-2">
            <Button type="button" variant={periodMode === 'year' ? 'default' : 'outline'} size="sm" onClick={() => setPeriodMode('year')}>Rok</Button>
            <Button type="button" variant={periodMode === 'custom' ? 'default' : 'outline'} size="sm" onClick={() => setPeriodMode('custom')}>Vlastní</Button>
          </div>
          {periodMode === 'year' ? (
            <div className="space-y-1">
              <Input type="number" min={2000} max={2100} value={year} onChange={e => { setYearTouched(true); setYear(parseInt(e.target.value, 10) || new Date().getFullYear()); }} />
              {!yearTouched && form.propertyId && form.kind && (
                <p className="text-xs text-soft">Návrh: další rok bez vyúčtování pro tuto kombinaci.</p>
              )}
              <p className="text-xs text-soft">{`Od ${year}-01-01 do ${year}-12-31`}</p>
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
          <Input type="text" placeholder="35000,50" value={form.totalAmount} onChange={e => setForm({ ...form, totalAmount: e.target.value })} />
          {form.totalAmount !== '' && totalAmountInvalid && (
            <p className="text-sm text-late mt-1">Částka musí být číslo v korunách, např. 35000 nebo 35000,50.</p>
          )}
        </div>
        <div>
          <div className="mb-1 flex items-center gap-1.5">
              <Label className="mb-0">Částka úpravy (Kč)</Label>
              <Hint label="K čemu je úprava">Část nákladů, kterou nájemce neplatí, třeba fond oprav nebo odměny výboru v předpisu SVJ. Záporná částka se od celkových nákladů odečte, kladná přičte. Předvyplní se z evidenčního listu nemovitosti podle délky období; můžeš ji přepsat.</Hint>
              {autoFillLabel && !adjustmentTouched && <span className="text-xs text-soft">{autoFillLabel}</span>}
            </div>
          <Input type="text" placeholder="0.00" value={form.adjustmentAmount} onChange={e => { setAdjustmentTouched(true); setAutoFillLabel(null); setForm({ ...form, adjustmentAmount: e.target.value }); }} />
          {adjustmentAmountInvalid && (
            <p className="text-sm text-late mt-1">Částka musí být číslo v korunách, např. -350 nebo 35000,50.</p>
          )}
        </div>
        <div>
          <Label>Poznámka k úpravě (volitelné)</Label>
          <Input value={form.adjustmentNote} onChange={e => setForm({ ...form, adjustmentNote: e.target.value })} />
        </div>
        <div>
          <Label>Reference dokumentu (volitelné)</Label>
          <Input value={form.documentRef} onChange={e => setForm({ ...form, documentRef: e.target.value })} />
        </div>
        {err && <p className="text-sm text-late">{err}</p>}
    </Modal>
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
  const [err, setErr] = useState<unknown>(null);
  // Every field edit clears err (see setField below) — a corrected amount can
  // never silently carry forward a stale "yes, duplicate" decision from a
  // previous submission of this dialog.
  const setField = (patch: Partial<typeof form>) => { setForm(f => ({ ...f, ...patch })); setErr(null); };
  // A payment amount is required, so 'empty' is just as unsubmittable as
  // 'invalid' — there is no "cokoliv" meaning here.
  const amount = parseKorun(form.amount);
  const amountInvalid = amount.kind !== 'value';

  const create = useMutation({
    mutationFn: (vars?: { allowDuplicate?: boolean }) => api.post<{ payment: Payment }>('/api/payments', {
      contractId: fixedContractId,
      amount: amount.kind === 'value' ? amount.halere : 0,
      paidAt: form.paidAt,
      counterparty: form.counterparty || null,
      counterpartyAccount: form.counterpartyAccount || null,
      source: form.source,
      externalId: form.externalId || null,
      description: form.description || null,
      note: form.note || null,
      allowDuplicate: vars?.allowDuplicate,
    }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e: unknown) => setErr(e),
  });

  return (
    <Modal title="Nová platba" onClose={onClose} footer={<>
        <Button variant="outline" onClick={onClose}>Zrušit</Button>
        <Button
          onClick={() => create.mutate({})}
          disabled={amountInvalid || !form.paidAt || create.isPending}
        >
          Vytvořit
        </Button>
    </>}>
        <div>
          <Label>Částka (Kč)</Label>
          <Input type="text" placeholder="35000,50" value={form.amount} onChange={e => setField({ amount: e.target.value })} />
          {form.amount !== '' && amountInvalid && (
            <p className="text-sm text-late mt-1">Částka musí být číslo v korunách, např. 35000 nebo 35000,50.</p>
          )}
        </div>
        <div>
          <Label>Zaplaceno dne</Label>
          <Input type="date" value={form.paidAt} onChange={e => setField({ paidAt: e.target.value })} />
        </div>
        <div>
          <Label>Protistrana (volitelné)</Label>
          <Input value={form.counterparty} onChange={e => setField({ counterparty: e.target.value })} />
        </div>
        <div>
          <Label>Číslo účtu protistrany (volitelné)</Label>
          <Input value={form.counterpartyAccount} onChange={e => setField({ counterpartyAccount: e.target.value })} />
        </div>
        <div>
          <Label>Zdroj</Label>
          <select
            className="select-native"
            value={form.source}
            onChange={e => setField({ source: e.target.value as 'manual' | 'bank' })}
          >
            <option value="manual">Ručně</option>
            <option value="bank">Banka</option>
          </select>
        </div>
        <div>
          <Label>Externí ID (volitelné)</Label>
          <Input value={form.externalId} onChange={e => setField({ externalId: e.target.value })} />
        </div>
        <div>
          <Label>Popis (volitelné)</Label>
          <Input value={form.description} onChange={e => setField({ description: e.target.value })} />
        </div>
        <div>
          <Label>Poznámka (volitelné)</Label>
          <Input value={form.note} onChange={e => setField({ note: e.target.value })} />
        </div>
        <DuplicatePaymentError
          error={err}
          pending={create.isPending}
          onForce={() => create.mutate({ allowDuplicate: true })}
        />
    </Modal>
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

  // Fetch cost statements for this contract's property to compute preview
  const contractQuery = useQuery({
    queryKey: ['contracts', contractId],
    queryFn: () => api.get<{ contract: Contract }>(`/api/contracts/${contractId}`),
  });
  const propertyId = contractQuery.data?.contract?.propertyId;

  const statementsQuery = useQuery({
    queryKey: ['cost-statements-for-preview', propertyId],
    queryFn: () => api.get<{ statements: CostStatement[] }>(`/api/cost-statements?propertyId=${propertyId}`),
    enabled: !!propertyId,
  });
  const allStatements = statementsQuery.data?.statements ?? [];

  // Compute per-kind preview when both period fields are filled
  const preview: Array<{ kind: Kind; from: string; to: string; source: 'default' | 'from-cost-statements'; count: number; differs: boolean }> | null =
    form.periodFrom && form.periodTo
      ? KINDS_TO_SHOW
          .map(kind => {
            const mp = deriveMatchPeriodClient(kind, form.periodFrom, form.periodTo, allStatements);
            const differs = mp.source === 'from-cost-statements'
              && (mp.from !== form.periodFrom || mp.to !== form.periodTo);
            return { kind, ...mp, differs };
          })
          .filter(p => p.source === 'from-cost-statements' || p.kind === 'rent' || allStatements.some(s => s.kind === p.kind))
      : null;

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
    <Modal title="Spočítat vyúčtování nájemci" onClose={onClose} className="max-w-lg" footer={<>
        <Button variant="outline" onClick={onClose}>Zrušit</Button>
        <Button
          onClick={() => computeMutation.mutate()}
          disabled={!form.periodFrom || !form.periodTo || computeMutation.isPending}
        >
          Spočítat
        </Button>
    </>}>
        <div>
          <Label>Období od</Label>
          <Input type="date" value={form.periodFrom} onChange={e => setForm({ ...form, periodFrom: e.target.value })} />
        </div>
        <div>
          <Label>Období do</Label>
          <Input type="date" value={form.periodTo} onChange={e => setForm({ ...form, periodTo: e.target.value })} />
        </div>

        {preview && preview.length > 0 && (
          <div className="rounded-md border bg-side p-3 space-y-2">
            <p className="text-sm font-semibold">Období párování plateb podle druhu</p>
            <p className="text-xs text-soft">
              Vyúčtování za {fmtDate(form.periodFrom)} až {fmtDate(form.periodTo)}
            </p>
            <div className="space-y-1">
              {preview.map(p => (
                <div key={p.kind} className="flex items-center gap-2 text-xs">
                  <span className="w-24 font-medium text-soft">{KIND_LABEL_CS[p.kind] ?? p.kind}</span>
                  <span className={p.differs ? 'font-medium' : undefined}>
                    {fmtDate(p.from)} až {fmtDate(p.to)}
                  </span>
                  <span className="text-soft">
                    {p.source === 'from-cost-statements'
                      ? `podle ${p.count === 1 ? 'vyúčtování nákladů' : `${p.count} vyúčtování nákladů`}`
                      : 'období vyúčtování, bez vyúčtování nákladů'}
                  </span>
                  {p.differs && (
                    <span className="font-medium text-late">liší se od období vyúčtování</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {err && <p className="text-sm text-late">{err}</p>}
    </Modal>
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
    paymentDueDay: activeTerm ? String(activeTerm.paymentDueDay) : '10',
    paymentAppliesTo: (activeTerm?.paymentAppliesTo ?? 'current') as 'current' | 'next',
    source: (hasExisting ? 'addendum' : 'initial') as 'initial' | 'addendum' | 'change',
    documentRef: '',
    note: '',
    utilities: initialUtilities as Partial<Record<UtilityKind, string>>,
  });

  // New utility kind fields
  const [newUtilityKind, setNewUtilityKind] = useState<UtilityKind | ''>('');
  const [newUtilityCzk, setNewUtilityCzk] = useState('');

  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const availableNewKinds = UTILITY_KINDS.filter(k => !presentKinds.includes(k));

  // Required amounts: 'empty' is as unsubmittable as 'invalid'. Utility
  // amounts stay optional — an empty field is still a legitimate no-op skip.
  const baseRent = parseKorun(form.baseRentCzk);
  const serviceAdvance = parseKorun(form.serviceAdvanceCzk);
  const requiredAmountInvalid = baseRent.kind !== 'value' || serviceAdvance.kind !== 'value';
  const utilityInvalid = (k: UtilityKind) => {
    const v = form.utilities[k];
    return !!v && v.trim() !== '' && parseKorun(v).kind === 'invalid';
  };
  const anyUtilityInvalid = presentKinds.some(utilityInvalid);
  const newUtilityInvalid = newUtilityCzk.trim() !== '' && parseKorun(newUtilityCzk).kind === 'invalid';

  async function handleSubmit() {
    if (!form.validFrom || requiredAmountInvalid || anyUtilityInvalid || newUtilityInvalid) return;
    setSubmitting(true);
    setErr(null);
    try {
      // 1. POST terms
      await api.post(`/api/contracts/${contractId}/terms`, {
        validFrom: form.validFrom,
        baseRent: baseRent.kind === 'value' ? baseRent.halere : 0,
        serviceAdvance: serviceAdvance.kind === 'value' ? serviceAdvance.halere : 0,
        paymentDueDay: parseInt(form.paymentDueDay, 10) || 10,
        paymentAppliesTo: form.paymentAppliesTo,
        source: form.source,
        documentRef: form.documentRef || null,
        note: form.note || null,
      });

      // 2. POST utilities for each kind that has a value and differs from current
      const errors: string[] = [];
      for (const k of presentKinds) {
        const valStr = form.utilities[k];
        if (!valStr || valStr.trim() === '') continue; // skip empty — no-op (known limitation: doesn't remove utility)
        const parsed = parseKorun(valStr);
        if (parsed.kind !== 'value') continue; // guarded by anyUtilityInvalid above; defensive only
        const newAmount = parsed.halere;
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
        const parsedNew = parseKorun(newUtilityCzk);
        if (parsedNew.kind === 'value') {
          try {
            await api.post(`/api/contracts/${contractId}/utilities`, {
              kind: newUtilityKind,
              validFrom: form.validFrom,
              monthlyAdvance: parsedNew.halere,
              note: null,
            });
          } catch (e) {
            errors.push(`${UTILITY_LABEL[newUtilityKind]}: ${e instanceof Error ? e.message : String(e)}`);
          }
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
    <Modal title="Přidat změnu" onClose={onClose} className="max-w-lg" footer={<>
        <Button variant="outline" onClick={onClose}>Zrušit</Button>
        <Button
          onClick={handleSubmit}
          disabled={!form.validFrom || requiredAmountInvalid || anyUtilityInvalid || newUtilityInvalid || submitting}
        >
          {submitting ? 'Ukládám…' : 'Přidat'}
        </Button>
    </>}>
        <div>
          <Label>Platnost od</Label>
          <Input type="date" value={form.validFrom} onChange={e => setForm({ ...form, validFrom: e.target.value })} />
        </div>
        <div>
          <Label>Nájem (Kč)</Label>
          <Input type="text" placeholder="35000,50" value={form.baseRentCzk} onChange={e => setForm({ ...form, baseRentCzk: e.target.value })} />
          {form.baseRentCzk !== '' && baseRent.kind === 'invalid' && (
            <p className="text-sm text-late mt-1">Částka musí být číslo v korunách, např. 35000 nebo 35000,50.</p>
          )}
        </div>
        <div>
          <Label>Záloha SVJ (Kč)</Label>
          <Input type="text" placeholder="35000,50" value={form.serviceAdvanceCzk} onChange={e => setForm({ ...form, serviceAdvanceCzk: e.target.value })} />
          {form.serviceAdvanceCzk !== '' && serviceAdvance.kind === 'invalid' && (
            <p className="text-sm text-late mt-1">Částka musí být číslo v korunách, např. 35000 nebo 35000,50.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Splatnost ke dni</Label>
            <Input type="number" min={1} max={31} value={form.paymentDueDay} onChange={e => setForm({ ...form, paymentDueDay: e.target.value })} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5"><Label className="mb-0">Platba za</Label><Hint label="Jak se počítá splatnost">„Aktuální měsíc“ znamená, že nájem za říjen je splatný v říjnu. „Následující měsíc“ znamená placení předem: nájem za listopad je splatný už v říjnu.</Hint></div>
            <select
              className="select-native"
              value={form.paymentAppliesTo}
              onChange={e => setForm({ ...form, paymentAppliesTo: e.target.value as 'current' | 'next' })}
            >
              <option value="current">Aktuální měsíc</option>
              <option value="next">Následující měsíc (předem)</option>
            </select>
          </div>
        </div>
        <div>
          <Label>Zdroj</Label>
          <select
            className="select-native"
            value={form.source}
            onChange={e => setForm({ ...form, source: e.target.value as 'initial' | 'addendum' | 'change' })}
          >
            <option value="initial">Počáteční</option>
            <option value="addendum">Dodatek</option>
            <option value="change">Změna</option>
          </select>
        </div>
        <div>
          <Label>Doklad (URL nebo cesta) — volitelné</Label>
          <Input
            placeholder="https://drive.google.com/file/d/... nebo /path/to/dodatek-5.pdf"
            value={form.documentRef}
            onChange={e => setForm({ ...form, documentRef: e.target.value })}
          />
        </div>
        <div>
          <Label>Poznámka (volitelné)</Label>
          <Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
        </div>

        {presentKinds.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Energie</p>
            <p className="text-xs text-soft">Ponech prázdné = beze změny. Vymazání hodnoty energii neodstraní (mazání řádku zatím není podporované). Opravu existujícího řádku dělej přes Upravit v tabulce.</p>
            {presentKinds.map(k => (
              <div key={k}>
                <Label className="text-sm">{UTILITY_LABEL[k]} (Kč)</Label>
                <Input
                  type="text"
                  placeholder="0.00"
                  value={form.utilities[k] ?? ''}
                  onChange={e => setForm({ ...form, utilities: { ...form.utilities, [k]: e.target.value } })}
                />
                {utilityInvalid(k) && (
                  <p className="text-sm text-late mt-1">Částka musí být číslo v korunách, např. 35000 nebo 35000,50.</p>
                )}
              </div>
            ))}
          </div>
        )}

        {availableNewKinds.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Přidat další energii</p>
            <div className="flex gap-2">
              <select
                className="select-native"
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
            {newUtilityInvalid && (
              <p className="text-sm text-late mt-1">Částka musí být číslo v korunách, např. 35000 nebo 35000,50.</p>
            )}
          </div>
        )}

        {err && <p className="text-sm text-late">{err}</p>}
    </Modal>
  );
}

// ─── Edit existing Podminky (terms) dialog ────────────────────────────────────

interface EditPodminkyDialogProps {
  contractId: string;
  /** Timeline date being edited. */
  date: string;
  terms: ContractTerm[];
  utilities: Utility[];
  onClose: () => void;
  onUpdated: () => void;
}

/**
 * Edits a single date of the podminky timeline: the terms row starting that day
 * (if any) plus every utility row starting that day. A utility merely *active* on
 * the date started earlier — it belongs to its own row, so it is shown read-only
 * with a pointer to the date that owns it.
 */
function EditPodminkyDialog({ contractId, date, terms, utilities, onClose, onUpdated }: EditPodminkyDialogProps) {
  const term = terms.find(t => t.validFrom === date) ?? null;
  const editableUtils = UTILITY_KINDS.flatMap(k => utilities.filter(u => u.kind === k && u.validFrom === date));
  const inheritedUtils = UTILITY_KINDS
    .map(k => validAt(utilities.filter(u => u.kind === k), date))
    .filter((u): u is Utility => u !== null && u.validFrom !== date);

  const [form, setForm] = useState({
    baseRentCzk: ((term?.baseRent ?? 0) / 100).toFixed(2),
    serviceAdvanceCzk: ((term?.serviceAdvance ?? 0) / 100).toFixed(2),
    paymentDueDay: String(term?.paymentDueDay ?? 10),
    paymentAppliesTo: (term?.paymentAppliesTo ?? 'current') as 'current' | 'next',
    source: (term?.source ?? 'change') as 'initial' | 'addendum' | 'change',
    documentRef: term?.documentRef ?? '',
    note: term?.note ?? '',
  });
  const [utilForm, setUtilForm] = useState<Record<string, { amountCzk: string; note: string }>>(
    Object.fromEntries(editableUtils.map(u => [
      u.id,
      { amountCzk: (u.monthlyAdvance / 100).toFixed(2), note: u.note ?? '' },
    ])),
  );
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const baseRent = parseKorun(form.baseRentCzk);
  const serviceAdvance = parseKorun(form.serviceAdvanceCzk);
  const termAmountsInvalid = term !== null && (baseRent.kind !== 'value' || serviceAdvance.kind !== 'value');
  const utilAmount = (id: string) => parseKorun(utilForm[id]?.amountCzk ?? '');
  const utilAmountsInvalid = editableUtils.some(u => utilAmount(u.id).kind !== 'value');

  async function handleSubmit() {
    if (termAmountsInvalid || utilAmountsInvalid) return;
    setSubmitting(true);
    setErr(null);
    try {
      const reqs: Promise<unknown>[] = [];

      if (term && baseRent.kind === 'value' && serviceAdvance.kind === 'value') {
        reqs.push(api.patch(`/api/contracts/${contractId}/terms/${term.id}`, {
          baseRent: baseRent.halere,
          serviceAdvance: serviceAdvance.halere,
          paymentDueDay: parseInt(form.paymentDueDay, 10) || 10,
          paymentAppliesTo: form.paymentAppliesTo,
          source: form.source,
          documentRef: form.documentRef || null,
          note: form.note || null,
        }));
      }

      for (const u of editableUtils) {
        const amount = utilAmount(u.id);
        if (amount.kind !== 'value') continue;
        const note = (utilForm[u.id]?.note ?? '') || null;
        // Skip untouched rows — a PATCH per utility is cheap, but a no-op write
        // is still a write against a shared timeline.
        if (amount.halere === u.monthlyAdvance && note === (u.note ?? null)) continue;
        reqs.push(api.patch(`/api/contracts/${contractId}/utilities/${u.id}`, {
          monthlyAdvance: amount.halere,
          note,
        }));
      }

      if (reqs.length > 0) await Promise.all(reqs);
      onUpdated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Upravit podmínky" onClose={onClose} className="max-w-lg" footer={<>
        <Button variant="outline" onClick={onClose} disabled={submitting}>Zrušit</Button>
        <Button onClick={handleSubmit} disabled={termAmountsInvalid || utilAmountsInvalid || submitting}>
          {submitting ? 'Ukládám…' : 'Uložit'}
        </Button>
    </>}>
        <p className="text-xs text-soft">
          Platnost od <strong>{date}</strong> (datum nelze změnit — pro přesun v čase smaž a přidej nové).
        </p>

        {term ? (
          <>
            <div>
              <Label>Nájem (Kč)</Label>
              <Input type="text" value={form.baseRentCzk} onChange={e => setForm({ ...form, baseRentCzk: e.target.value })} />
              {form.baseRentCzk !== '' && baseRent.kind === 'invalid' && (
                <p className="text-sm text-late mt-1">Částka musí být číslo v korunách, např. 35000 nebo 35000,50.</p>
              )}
            </div>
            <div>
              <Label>Záloha SVJ (Kč)</Label>
              <Input type="text" value={form.serviceAdvanceCzk} onChange={e => setForm({ ...form, serviceAdvanceCzk: e.target.value })} />
              {form.serviceAdvanceCzk !== '' && serviceAdvance.kind === 'invalid' && (
                <p className="text-sm text-late mt-1">Částka musí být číslo v korunách, např. 35000 nebo 35000,50.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Splatnost ke dni</Label>
                <Input type="number" min={1} max={31} value={form.paymentDueDay} onChange={e => setForm({ ...form, paymentDueDay: e.target.value })} />
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1.5"><Label className="mb-0">Platba za</Label><Hint label="Jak se počítá splatnost">„Aktuální měsíc“ znamená, že nájem za říjen je splatný v říjnu. „Následující měsíc“ znamená placení předem: nájem za listopad je splatný už v říjnu.</Hint></div>
                <select
                  className="select-native"
                  value={form.paymentAppliesTo}
                  onChange={e => setForm({ ...form, paymentAppliesTo: e.target.value as 'current' | 'next' })}
                >
                  <option value="current">Aktuální měsíc</option>
                  <option value="next">Následující měsíc (předem)</option>
                </select>
              </div>
            </div>
            <div>
              <Label>Zdroj</Label>
              <select
                className="select-native"
                value={form.source}
                onChange={e => setForm({ ...form, source: e.target.value as 'initial' | 'addendum' | 'change' })}
              >
                <option value="initial">Počáteční</option>
                <option value="addendum">Dodatek</option>
                <option value="change">Změna</option>
              </select>
            </div>
            <div>
              <Label>Doklad (URL nebo cesta) — volitelné</Label>
              <Input
                placeholder="https://drive.google.com/file/d/... nebo /path/to/dodatek-5.pdf"
                value={form.documentRef}
                onChange={e => setForm({ ...form, documentRef: e.target.value })}
              />
            </div>
            <div>
              <Label>Poznámka (volitelné)</Label>
              <Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
            </div>
          </>
        ) : (
          <p className="text-sm text-soft">
            K tomuto datu se nemění nájem ani záloha SVJ — jen energie níže.
          </p>
        )}

        {editableUtils.length > 0 && (
          <div className="space-y-3 border-t pt-4">
            <p className="text-sm font-medium">Energie od {date}</p>
            {editableUtils.map(u => (
              <div key={u.id} className="space-y-1">
                <Label className="text-sm">{UTILITY_LABEL[u.kind as UtilityKind]} (Kč)</Label>
                <Input
                  type="text"
                  value={utilForm[u.id]?.amountCzk ?? ''}
                  onChange={e => setUtilForm({ ...utilForm, [u.id]: { ...utilForm[u.id]!, amountCzk: e.target.value } })}
                />
                {utilAmount(u.id).kind === 'invalid' && (
                  <p className="text-sm text-late">Částka musí být číslo v korunách, např. 35000 nebo 35000,50.</p>
                )}
                <Input
                  placeholder="Poznámka (volitelné)"
                  value={utilForm[u.id]?.note ?? ''}
                  onChange={e => setUtilForm({ ...utilForm, [u.id]: { ...utilForm[u.id]!, note: e.target.value } })}
                />
              </div>
            ))}
          </div>
        )}

        {inheritedUtils.length > 0 && (
          <div className="space-y-1 border-t pt-4">
            <p className="text-sm font-medium">Energie platné k tomuto datu, ale beze změny</p>
            {inheritedUtils.map(u => (
              <p key={u.id} className="text-xs text-soft">
                {UTILITY_LABEL[u.kind as UtilityKind]}: {(u.monthlyAdvance / 100).toLocaleString('cs-CZ')} Kč — platí od {u.validFrom}, uprav na tom řádku.
              </p>
            ))}
          </div>
        )}

        {err && <p className="text-sm text-late">{err}</p>}
    </Modal>
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

  const amount = parseKorun(form.amountCzk);
  const amountInvalid = amount.kind !== 'value';

  const create = useMutation({
    mutationFn: () => api.post(`/api/contracts/${contractId}/rent-reductions`, {
      forMonth: form.forMonth,
      amount: amount.kind === 'value' ? amount.halere : 0,
      reason: form.reason || null,
    }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal title="Přidat srážku nájmu" onClose={onClose} footer={<>
        <Button variant="outline" onClick={onClose}>Zrušit</Button>
        <Button
          onClick={() => create.mutate()}
          disabled={!form.forMonth || amountInvalid || create.isPending}
        >
          Přidat
        </Button>
    </>}>
        <div>
          <Label>Měsíc (1. den měsíce)</Label>
          <Input type="date" value={form.forMonth} onChange={e => setForm({ ...form, forMonth: e.target.value })} />
        </div>
        <div>
          <Label>Částka srážky (Kč)</Label>
          <Input type="text" placeholder="35000,50" value={form.amountCzk} onChange={e => setForm({ ...form, amountCzk: e.target.value })} />
          {form.amountCzk !== '' && amountInvalid && (
            <p className="text-sm text-late mt-1">Částka musí být číslo v korunách, např. 35000 nebo 35000,50.</p>
          )}
        </div>
        <div>
          <Label>Důvod (volitelné)</Label>
          <Input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Např. nájemce uhradil opravu pronajímatele" />
        </div>
        {err && <p className="text-sm text-late">{err}</p>}
    </Modal>
  );
}
// ─── Měsíční rozpis ──────────────────────────────────────────────────────────

interface MesicniRozpisProps {
  contractId: string;
  contract: Contract;
}

const MONTHS_PER_PAGE = 12;

function MesicniRozpis({ contractId, contract }: MesicniRozpisProps) {
  const qc = useQueryClient();
  const [rrDialogOpen, setRrDialogOpen] = useState(false);
  const [prefillMonth, setPrefillMonth] = useState<string | undefined>(undefined);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const today = todayIso();
  const { from, to } = breakdownRange(contract, today);

  const breakdown = useQuery({
    queryKey: ['payment-breakdown', contractId, from, to],
    queryFn: () => api.get<PaymentBreakdownData>(
      `/api/contracts/${contractId}/payment-breakdown?from=${from}&to=${to}`
    ),
    enabled: !!contract,
  });

  const deleteReduction = useMutation({
    mutationFn: (rid: string) => api.delete(`/api/contracts/${contractId}/rent-reductions/${rid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-breakdown', contractId] }),
  });

  // Newest first, and only months that have come due: the current month and
  // earlier, plus a later month whose due date already passed (rent paid in
  // advance). A contract that ends next year would otherwise list months
  // nobody can pay yet. Months after the contract's end that carry nothing
  // are dropped too; they exist only so late payments can be matched.
  const currentMonth = today.slice(0, 7);
  const months = (breakdown.data?.months ?? [])
    .filter(m => m.month <= currentMonth || m.dueDate <= today)
    .filter(m => !(m.daysActive === 0 && m.effectiveExpected === 0 && m.receivedTotal === 0))
    .slice()
    .reverse();
  const pager = usePager(months, MONTHS_PER_PAGE);

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

  if (breakdown.isLoading) return <p className="px-5 py-6 text-sm text-soft">Načítám rozpis…</p>;
  if (breakdown.error) {
    return (
      <div className="px-5 py-6">
        <p className="mb-3 text-sm text-late">Chyba při načítání rozpisu.</p>
        <Button size="sm" variant="outline" onClick={() => breakdown.refetch()}>Zkusit znovu</Button>
      </div>
    );
  }
  if (months.length === 0) return <p className="px-5 py-6 text-sm text-soft">Zatím žádný měsíc k rozpisu.</p>;

  // Which utility kinds have any non-zero expected across all months
  const activeKinds = UTIL_ORDER.filter(k => months.some(m => m.expected.utilities[k] > 0));
  const COLS = 8;

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"><span className="sr-only">Rozbalit</span></TableHead>
            <TableHead>Měsíc</TableHead>
            <TableHead>Splatnost</TableHead>
            <TableHead className="num"><span className="inline-flex items-center gap-1">Plán<Hint label="Co je plán">Měsíční předpis podle smlouvy: nájem, záloha SVJ a energie.</Hint></span></TableHead>
            <TableHead className="num"><span className="inline-flex items-center gap-1">Srážka<Hint label="Co je srážka">Jednorázové snížení nájmu v daném měsíci, třeba když nájemce zaplatil opravu za pronajímatele. Snižuje nájem, ne zálohy.</Hint></span></TableHead>
            <TableHead className="num"><span className="inline-flex items-center gap-1">Předepsáno<Hint label="Co je předepsáno">Plán po odečtení srážky, tedy částka, kterou měl nájemce za měsíc skutečně zaplatit. Platba se nejdřív počítá na nájem, pak na zálohu SVJ a energie.</Hint></span></TableHead>
            <TableHead className="num">Zaplaceno</TableHead>
            <TableHead className="num">Rozdíl</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pager.slice.map(row => {
            const diff = row.receivedTotal - row.effectiveExpected;
            const isExpanded = expandedMonths.has(row.month);
            const reductionEntry = breakdown.data?.rentReductions.find(r => r.forMonth === `${row.month}-01`);
            const open = isExpanded;

            return (
              <Fragment key={row.month}>
                <TableRow className={cn('rem', row.daysActive === 0 && 'opacity-40')}>
                  <TableCell className="py-2.5 pr-0">
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-soft hover:bg-hover hover:text-ink"
                      onClick={() => toggleExpand(row.month)}
                      aria-expanded={open}
                      aria-label={open ? `Skrýt rozpis za ${fmtMonth(row.month)}` : `Zobrazit rozpis za ${fmtMonth(row.month)}`}
                    >
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-medium">{fmtMonth(row.month)}</span>
                    {row.isLate && (
                      <span className="ml-2 text-sm text-late">pozdě o {plural(row.maxLateDays, 'den', 'dny', 'dní')}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-soft">{fmtDate(row.dueDate)}</TableCell>
                  <TableCell className="num">{fmtKc(row.expected.total)}</TableCell>
                  <TableCell className="num">
                    {reductionEntry ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span title={reductionEntry.reason ?? 'Bez poznámky'} className={reductionEntry.reason ? 'cursor-help underline decoration-dotted underline-offset-2' : undefined}>
                          {fmtKc(reductionEntry.amount)}
                        </span>
                        <button
                          type="button"
                          className="acts text-xs text-soft hover:text-late"
                          aria-label="Smazat srážku"
                          title="Smazat srážku"
                          onClick={() => {
                            const msg = reductionEntry.reason
                              ? `Smazat srážku ${fmtKc(reductionEntry.amount)} (${reductionEntry.reason}) za ${fmtMonth(row.month)}?`
                              : `Smazat srážku ${fmtKc(reductionEntry.amount)} za ${fmtMonth(row.month)}?`;
                            if (confirm(msg)) deleteReduction.mutate(reductionEntry.id);
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="acts text-sm text-soft hover:text-accent"
                        onClick={() => {
                          setPrefillMonth(`${row.month}-01`);
                          setRrDialogOpen(true);
                        }}
                      >
                        + Přidat
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="num">{fmtKc(row.effectiveExpected)}</TableCell>
                  <TableCell className="num">{fmtKc(row.receivedTotal)}</TableCell>
                  <TableCell className={cn('num font-medium', diff < 0 ? 'text-late' : diff > 0 ? 'text-accent' : 'text-soft')}>{fmtKcSigned(diff)}</TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow>
                    <TableCell colSpan={COLS} className="bg-side px-5 py-3.5 group-hover/row:bg-side">
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-6 gap-y-3 text-sm">
                        <div>
                          <div className="text-soft">Nájem uhrazen</div>
                          <div className="font-medium">{fmtKc(row.allocation.baseRentPaid)} <span className="font-normal text-soft">/ {fmtKc(row.expected.baseRent)}</span></div>
                        </div>
                        <div>
                          <div className="text-soft">Záloha SVJ</div>
                          <div className="font-medium">{fmtKc(row.allocation.servicePaid)} <span className="font-normal text-soft">/ {fmtKc(row.expected.serviceAdvance)}</span></div>
                        </div>
                        {activeKinds.map(k => (
                          <div key={k}>
                            <div className="text-soft">{UTIL_LABEL[k]}</div>
                            <div className="font-medium">{fmtKc(row.allocation.utilityPaid[k])} <span className="font-normal text-soft">/ {fmtKc(row.expected.utilities[k])}</span></div>
                          </div>
                        ))}
                        {row.allocation.surplus > 0 && (
                          <div>
                            <div className="text-soft">Přeplatek</div>
                            <div className="font-medium text-accent">{fmtKc(row.allocation.surplus)}</div>
                          </div>
                        )}
                        {row.allocation.deficitTotal > 0 && (
                          <div>
                            <div className="text-soft">Dluh celkem</div>
                            <div className="font-medium text-late">{fmtKc(row.allocation.deficitTotal)}</div>
                          </div>
                        )}
                        {row.daysActive < row.daysInMonth && (
                          <div>
                            <div className="text-soft">Aktivní dny</div>
                            <div className="font-medium">{row.daysActive} / {row.daysInMonth}</div>
                          </div>
                        )}
                      </div>
                      {(row.appliedPayments ?? []).length > 0 && (
                        <div className="mt-3 border-t border-line pt-3">
                          <div className="mb-1.5 text-sm text-soft">Přiřazené platby</div>
                          <div className="space-y-1">
                            {(row.appliedPayments ?? []).map(ap => (
                              <div key={ap.paymentId} className="flex items-center gap-4 text-sm">
                                <span className="text-soft">{fmtDate(ap.paidAt)}</span>
                                <span className="font-medium">{fmtKc(ap.amount)}</span>
                                {ap.lateDays > 0 ? (
                                  <span className="text-late">pozdě o {plural(ap.lateDays, 'den', 'dny', 'dní')}</span>
                                ) : (
                                  <span className="text-accent">včas</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      <Pager page={pager.page} pageCount={pager.pageCount} from={pager.from} to={pager.to} total={pager.total} unit="měsíců" onPage={pager.setPage} prevLabel="Novější měsíce" nextLabel="Starší měsíce" />

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

// ─── Události ────────────────────────────────────────────────────────────────

interface UdalostiProps {
  contractId: string;
  contract: Contract;
  terms: ContractTerm[];
  reconciliations: Reconciliation[];
}

const TERM_SOURCE: Record<string, string> = { initial: 'Počáteční podmínky', addendum: 'Dodatek ke smlouvě', change: 'Změna podmínek' };

/**
 * What happened and what is coming up on this lease: open deadlines and
 * reminders on top, the history underneath. Deadlines are derived from the
 * data (next rent, end of the lease, an unfinished reconciliation); reminders
 * are the manual ones tied to this contract.
 */
function UdalostiTab({ contractId, contract, terms, reconciliations }: UdalostiProps) {
  const today = todayIso();
  const { from, to } = breakdownRange(contract, today);
  const breakdown = useQuery({
    queryKey: ['payment-breakdown', contractId, from, to],
    queryFn: () => api.get<PaymentBreakdownData>(`/api/contracts/${contractId}/payment-breakdown?from=${from}&to=${to}`),
  });
  const reminders = useReminders();

  const derived: AgendaItem[] = [];
  const next = (breakdown.data?.months ?? []).find(m => m.dueDate >= today && m.allocation.deficitTotal > 0);
  if (next) derived.push({ key: 'due', date: next.dueDate, title: 'Splatnost nájmu', ref: `${fmtMonth(next.month)}, ${fmtKc(next.allocation.deficitTotal)}`, href: `/contracts/${contractId}?tab=platby`, reminderId: null, done: false, ...dueLabel(next.dueDate, today) });
  if (contract.endDate && contract.endDate >= today) derived.push({ key: 'end', date: contract.endDate, title: 'Končí nájemní smlouva', ref: 'prodloužení nebo předání bytu', href: `/contracts/${contractId}`, reminderId: null, done: false, ...dueLabel(contract.endDate, today) });
  for (const r of reconciliations) {
    if (r.status !== 'draft') continue;
    const deadline = reconciliationDeadline(r.periodTo);
    derived.push({ key: `rec:${r.id}`, date: deadline, title: `Dokončit vyúčtování ${fmtDate(r.periodFrom)} až ${fmtDate(r.periodTo)}`, ref: 'nájemci do 4 měsíců po konci období', href: `/reconciliations/${r.id}`, reminderId: null, done: false, ...dueLabel(deadline, today) });
  }
  const manual = reminderItems((reminders.query.data ?? []).filter(r => r.contractId === contractId), () => `/contracts/${contractId}?tab=udalosti`, () => '');
  const items = [...manual.filter(i => !i.done), ...derived].sort((a, b) => a.date.localeCompare(b.date)).concat(manual.filter(i => i.done));

  // History, newest first.
  const history: Array<{ date: string; title: string; detail: string; href?: string }> = [];
  history.push({ date: contract.startDate, title: 'Začátek nájmu', detail: contract.securityDeposit != null ? `kauce ${fmtKc(contract.securityDeposit)}` : '' });
  for (const t of terms) {
    history.push({ date: t.validFrom, title: TERM_SOURCE[t.source] ?? t.source, detail: `nájem ${fmtKc(t.baseRent)}, záloha SVJ ${fmtKc(t.serviceAdvance)}, splatnost do ${t.paymentDueDay}. dne${t.note ? `, ${t.note}` : ''}` });
  }
  for (const r of reconciliations) {
    if (!r.computedAt) continue;
    history.push({ date: r.computedAt.slice(0, 10), title: r.status === 'finalized' ? 'Vyúčtování finalizováno' : 'Vyúčtování spočítáno', detail: `${fmtDate(r.periodFrom)} až ${fmtDate(r.periodTo)}`, href: `/reconciliations/${r.id}` });
  }
  if (contract.endDate && contract.endDate < today) history.push({ date: contract.endDate, title: 'Konec nájmu', detail: '' });
  history.sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="flex flex-col gap-5">
      <Agenda
        title="Termíny a připomínky"
        items={items}
        isPending={reminders.query.isPending || breakdown.isPending}
        newDefaults={{ contractId }}
        emptyText="Nic nečeká. Nájem je zaplacený a žádná připomínka není otevřená."
      />
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Historie</CardTitle>
          <CardDescription>Co se na smlouvě stalo, od nejnovějšího.</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Událost</TableHead>
              <TableHead>Podrobnosti</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((h, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap">{fmtDate(h.date)}</TableCell>
                <TableCell className="font-medium">{h.href ? <Link to={h.href} className="text-ink">{h.title}</Link> : h.title}</TableCell>
                <TableCell className="text-soft">{h.detail || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, { label: string; tone: 'ok' | 'wait' | 'soft' }> = {
  draft: { label: 'Návrh', tone: 'wait' },
  finalized: { label: 'Finalizováno', tone: 'ok' },
};

const CS_KIND_LABEL: Record<string, string> = {
  services: 'Služby (SVJ)', electricity: 'Elektřina', gas: 'Plyn', internet: 'Internet', water: 'Voda', other: 'Ostatní',
};

const PAYMENTS_PER_PAGE = 10;

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
  const { data: termsData, isError: termsError, refetch: termsRefetch } = useQuery({
    queryKey: ['contracts', id, 'terms'],
    queryFn: () => api.get<{ terms: ContractTerm[] }>(`/api/contracts/${id}/terms`),
    enabled: !!id,
  });
  const { data: utilitiesData, isError: utilitiesError, refetch: utilitiesRefetch } = useQuery({
    queryKey: ['contracts', id, 'utilities'],
    queryFn: () => api.get<{ utilities: Utility[] }>(`/api/contracts/${id}/utilities`),
    enabled: !!id,
  });

  const contract = contractData?.contract;

  // Properties lookup — still needed for the cost-statement dialog's dropdown.
  const { data: propertiesData } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get<{ properties: Property[] }>('/api/properties'),
  });

  // Cost statements for this property
  const { data: costStatementsData, isError: costStatementsDataError, refetch: costStatementsDataRefetch } = useQuery({
    queryKey: ['cost-statements-by-property', contract?.propertyId],
    queryFn: () => api.get<{ statements: CostStatement[] }>(`/api/cost-statements?propertyId=${contract!.propertyId}`),
    enabled: !!contract?.propertyId,
  });

  // Reconciliations for this contract
  const { data: reconciliationsData, isError: reconciliationsDataError, refetch: reconciliationsDataRefetch } = useQuery({
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
  const { data: paymentsData, isError: paymentsDataError, refetch: paymentsDataRefetch } = useQuery({
    queryKey: ['payments-by-contract', id],
    queryFn: () => api.get<{ payments: Payment[] }>(`/api/payments?contractId=${id}`),
    enabled: !!id,
  });
  const paymentsSorted = [...(paymentsData?.payments ?? [])].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  const paymentsPager = usePager(paymentsSorted, PAYMENTS_PER_PAGE);

  const [paymentDeleteErr, setPaymentDeleteErr] = useState<string | null>(null);

  const deletePayment = useMutation({
    mutationFn: (paymentId: string) => api.delete<void>(`/api/payments/${paymentId}`),
    onSuccess: () => {
      setPaymentDeleteErr(null);
      qc.invalidateQueries({ queryKey: ['payments-by-contract', id] });
      qc.invalidateQueries({ queryKey: ['payment-breakdown', id] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      // A deleted bank-sourced payment returns its bank_transaction to the
      // Nepřiřazené platby inbox (paymentId is SET NULL) — refresh it so the
      // returned transaction shows up without a manual reload.
      qc.invalidateQueries({ queryKey: ['bank-transactions'] });
    },
    onError: (e: unknown) => setPaymentDeleteErr(apiErrorMessage(e)),
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
      ).sort((a, b) => b.periodFrom.localeCompare(a.periodFrom))
    : [];

  const reconciliations = [...(reconciliationsData?.reconciliations ?? [])].sort((a, b) => b.periodFrom.localeCompare(a.periodFrom));

  // ── Monthly total ──────────────────────────────────────────────────────────
  const monthlyTotal = currentTerm
    ? currentTerm.baseRent +
      currentTerm.serviceAdvance +
      currentUtilities.reduce((sum, u) => sum + u.monthlyAdvance, 0)
    : null;

  // ── Dialog state ───────────────────────────────────────────────────────────
  const [podminkyOpen, setPodminkyOpen] = useState(false);
  const [editRowDate, setEditRowDate] = useState<string | null>(null);
  const [csOpen, setCsOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
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
  const [payView, setPayView] = useState<'rozpis' | 'prijate'>(searchParams.get('action') === 'new' ? 'prijate' : 'rozpis');

  // ?tab=platby&action=new (the dashboard's "Přidat platbu") opens the payment
  // dialog straight away and drops the flag from the URL.
  useEffect(() => {
    if (searchParams.get('action') !== 'new' || !id) return;
    setPayView('prijate');
    setPaymentOpen(true);
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      n.delete('action');
      return n;
    }, { replace: true });
  }, [searchParams, setSearchParams, id]);

  const termsFailed = (termsError && !termsData) || (utilitiesError && !utilitiesData);
  const termsPending = !termsData || !utilitiesData;
  const retryTerms = () => { if (!termsData) termsRefetch(); if (!utilitiesData) utilitiesRefetch(); };
  const sluzbyTotal = (currentTerm?.serviceAdvance ?? 0) + currentUtilities.reduce((s, u) => s + u.monthlyAdvance, 0);

  return (
    <>
      <PageHeader
        crumb={<Crumb to="/contracts">Pronájmy</Crumb>}
        title={contract ? <Link to={`/properties/${contract.propertyId}`} className="text-ink hover:no-underline">{contract.propertyName}</Link> : ' '}
        sub={contract && <>Nájemce · <span className="text-ink">{contract.tenantName}</span></>}
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList aria-label="Sekce pronájmu">
          <TabsTrigger value="prehled">Přehled</TabsTrigger>
          <TabsTrigger value="platby">Platby</TabsTrigger>
          <TabsTrigger value="sluzby">Služby / Energie</TabsTrigger>
          <TabsTrigger value="vyuctovani">Vyúčtování nájemci</TabsTrigger>
          <TabsTrigger value="udalosti">Události</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Přehled ─────────────────────────────────────────────── */}
        <TabsContent value="prehled" className="flex flex-col gap-5">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5">
            {/* Smlouva */}
            <Card>
              <CardHeader><CardTitle>Smlouva</CardTitle></CardHeader>
              <CardContent>
                {contract ? (
                  <KV>
                    <KVRow label="Platnost">{fmtRange(contract.startDate, contract.endDate)}</KVRow>
                    <KVRow label="Kauce">{contract.securityDeposit != null ? fmtKc(contract.securityDeposit) : <span className="text-soft">—</span>}</KVRow>
                    <KVRow label="Splatnost (aktuální)">
                      {currentTerm
                        ? `do ${currentTerm.paymentDueDay}. dne ${currentTerm.paymentAppliesTo === 'next' ? 'předchozího' : 'aktuálního'} měsíce`
                        : <span className="text-soft">—</span>}
                    </KVRow>
                    {contract.note && <KVRow label="Poznámka" wide>{contract.note}</KVRow>}
                  </KV>
                ) : <p className="text-sm text-soft">Načítání…</p>}
              </CardContent>
            </Card>

            {/* Aktuální podmínky */}
            <Card>
              <CardHeader><CardTitle>Aktuální podmínky</CardTitle></CardHeader>
              <CardContent>
                {termsFailed ? (
                  <div>
                    <p className="mb-3 text-sm text-late">Nepodařilo se načíst data.</p>
                    <Button size="sm" variant="outline" onClick={retryTerms}>Zkusit znovu</Button>
                  </div>
                ) : termsPending ? (
                  <p className="text-sm text-soft">Načítání…</p>
                ) : !currentTerm && currentUtilities.length === 0 ? (
                  <p className="text-sm text-soft">Žádné aktuální podmínky. Přidej první změnu v historii smlouvy níže.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4">
                      <div>
                        <div className="text-sm text-soft">Nájem</div>
                        <div className="text-[18px] font-semibold tracking-[-0.01em]">{fmtKc(currentTerm?.baseRent ?? 0)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-soft">Služby celkem</div>
                        <div className="text-[18px] font-semibold tracking-[-0.01em]">{fmtKc(sluzbyTotal)}</div>
                      </div>
                      {monthlyTotal !== null && (
                        <div>
                          <div className="text-sm text-soft">Měsíčně celkem</div>
                          <div className="text-[18px] font-semibold tracking-[-0.01em]">{fmtKc(monthlyTotal)}</div>
                        </div>
                      )}
                    </div>
                    {sluzbyTotal > 0 && (
                      <KV className="mt-4 border-t border-rule pt-3">
                        {currentTerm && currentTerm.serviceAdvance > 0 && <KVRow label="Záloha SVJ">{fmtKc(currentTerm.serviceAdvance)}</KVRow>}
                        {currentUtilities.map(u => <KVRow key={u.id} label={utilKindLabel(u.kind)}>{fmtKc(u.monthlyAdvance)}</KVRow>)}
                      </KV>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Párování plateb */}
            {id && <PairingCard contractId={id} expectedMonthlyTotal={monthlyTotal} />}
          </div>

          {/* Historie smlouvy */}
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>Historie smlouvy</CardTitle>
                <CardDescription>Nájem, zálohy a splatnost v čase. Každá změna platí od svého data.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => setPodminkyOpen(true)}><Plus className="h-3.5 w-3.5" strokeWidth={2.2} />Přidat změnu</Button>
            </CardHeader>
            <PodminkyTable
              terms={terms}
              utilities={utilities}
              onEditRow={(d) => setEditRowDate(d)}
              isPending={termsPending}
              isError={termsFailed}
              onRetry={retryTerms}
            />
          </Card>
        </TabsContent>

        {/* ── Tab 2: Platby ──────────────────────────────────────────────── */}
        <TabsContent value="platby" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Seg
              label="Pohled na platby"
              value={payView}
              onChange={setPayView}
              options={[{ value: 'rozpis', label: 'Měsíční rozpis' }, { value: 'prijate', label: 'Přijaté platby' }]}
            />
            {id && payView === 'prijate' && (
              <Button onClick={() => setPaymentOpen(true)}><Plus className="h-4 w-4" strokeWidth={2.2} />Nová platba</Button>
            )}
          </div>

          {payView === 'rozpis' && id && contract && (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Měsíční rozpis</CardTitle>
                <CardDescription>Předpis, srážky a přiřazené platby po měsících, od nejnovějšího.</CardDescription>
              </CardHeader>
              <MesicniRozpis contractId={id} contract={contract} />
            </Card>
          )}

          {payView === 'prijate' && (
            <>
              {paymentDeleteErr && <Notice kind="err" onClose={() => setPaymentDeleteErr(null)}>{paymentDeleteErr}</Notice>}
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>Přijaté platby</CardTitle>
                  <CardDescription>Platby přiřazené k tomuto pronájmu, od nejnovější.</CardDescription>
                </CardHeader>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Datum</TableHead>
                      <TableHead className="num">Částka</TableHead>
                      <TableHead>Protistrana</TableHead>
                      <TableHead>Číslo účtu a symboly</TableHead>
                      <TableHead>Zdroj</TableHead>
                      <TableHead>Externí ID</TableHead>
                      <TableHead>Poznámka</TableHead>
                      <TableHead><span className="sr-only">Akce</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paymentsDataError && !paymentsData ? (
                      <TableError cols={8} onRetry={() => paymentsDataRefetch()} />
                    ) : !paymentsData ? (
                      <TableSkeleton cols={8} />
                    ) : paymentsSorted.length === 0 ? (
                      <TableEmpty cols={8}>Žádné platby pro tento pronájem.</TableEmpty>
                    ) : (
                      paymentsPager.slice.map(p => (
                        <TableRow key={p.id} className="rem">
                          <TableCell className="whitespace-nowrap">{fmtDate(p.paidAt)}</TableCell>
                          <TableCell className="num font-medium">{fmtKcExact(p.amount)}</TableCell>
                          <TableCell>{p.counterparty ?? <span className="text-soft">—</span>}</TableCell>
                          {/* Folded into the account cell, which is already the
                              bank-identifiers cell, rather than widening a
                              seven-column table to ten. */}
                          <TableCell className="text-sm text-soft">
                            <div>{p.counterpartyAccount ?? '—'}</div>
                            {formatSymbols(p) && <div>{formatSymbols(p)}</div>}
                          </TableCell>
                          <TableCell className="text-soft">{p.source === 'bank' ? 'banka' : p.source === 'manual' ? 'ručně' : p.source}</TableCell>
                          <TableCell className="max-w-[10rem] truncate text-sm text-soft" title={p.externalId ?? undefined}>{p.externalId ?? '—'}</TableCell>
                          <TableCell className="max-w-xs truncate text-sm text-soft" title={p.note ?? p.description ?? undefined}>
                            {p.note ?? p.description ?? '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <button
                              type="button"
                              className="acts text-sm text-soft hover:text-late disabled:opacity-50"
                              disabled={deletePayment.isPending}
                              title="Smazat platbu"
                              onClick={() => {
                                const base = `Smazat platbu ${fmtKcExact(p.amount)} ze dne ${fmtDate(p.paidAt)}?`;
                                const msg = p.source === 'bank'
                                  ? `${base} Pokud k ní existuje navázaná bankovní transakce, vrátí se zpět do Nepřiřazených plateb k novému přiřazení.`
                                  : base;
                                if (confirm(msg)) deletePayment.mutate(p.id);
                              }}
                            >
                              Smazat
                            </button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <Pager page={paymentsPager.page} pageCount={paymentsPager.pageCount} from={paymentsPager.from} to={paymentsPager.to} total={paymentsPager.total} unit="plateb" onPage={paymentsPager.setPage} prevLabel="Novější platby" nextLabel="Starší platby" />
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Tab 3: Služby / Energie ────────────────────────────────────── */}
        <TabsContent value="sluzby">
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>Vyúčtování nákladů</CardTitle>
                <CardDescription>Skutečné náklady od SVJ a dodavatelů za období pronájmu.</CardDescription>
              </div>
              {contract && (
                <Button size="sm" variant="outline" onClick={() => setCsOpen(true)}><Plus className="h-3.5 w-3.5" strokeWidth={2.2} />Nové vyúčtování nákladů</Button>
              )}
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Druh</TableHead>
                  <TableHead>Období</TableHead>
                  <TableHead className="num">Celkem</TableHead>
                  <TableHead className="num"><span className="inline-flex items-center gap-1">Úprava<Hint label="Co je úprava">Část nákladů, kterou nese pronajímatel a nájemci se nevyúčtovává, třeba fond oprav v předpisu SVJ.</Hint></span></TableHead>
                  <TableHead className="num">K vyúčtování</TableHead>
                  <TableHead>Poznámka k úpravě</TableHead>
                  <TableHead>Doklad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costStatementsDataError && !costStatementsData ? (
                  <TableError cols={7} onRetry={() => costStatementsDataRefetch()} />
                ) : !costStatementsData ? (
                  <TableSkeleton cols={7} />
                ) : filteredStatements.length === 0 ? (
                  <TableEmpty cols={7}>Žádné vyúčtování nákladů pro toto období.</TableEmpty>
                ) : (
                  filteredStatements.map(s => {
                    const adj = s.adjustmentAmount ?? 0;
                    const reconciliable = s.totalAmount + adj;
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{CS_KIND_LABEL[s.kind] ?? s.kind}</TableCell>
                        <TableCell className="whitespace-nowrap">{fmtDate(s.periodFrom)} až {fmtDate(s.periodTo)}</TableCell>
                        <TableCell className="num">{fmtKc(s.totalAmount)}</TableCell>
                        <TableCell className={cn('num', adj < 0 ? 'text-late' : adj > 0 ? 'text-accent' : 'text-soft')}>{s.adjustmentAmount != null && adj !== 0 ? fmtKcSigned(adj) : '—'}</TableCell>
                        <TableCell className="num font-semibold">{fmtKc(reconciliable)}</TableCell>
                        <TableCell className="max-w-xs truncate text-sm text-soft" title={s.adjustmentNote ?? undefined}>
                          {s.adjustmentNote ?? '—'}
                        </TableCell>
                        <TableCell><DocRefLink value={s.documentRef} /></TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* ── Tab 4: Vyúčtování nájemci ──────────────────────────────── */}
        <TabsContent value="vyuctovani">
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>Vyúčtování nájemci</CardTitle>
                <CardDescription>Roční porovnání zaplacených záloh se skutečnými náklady.</CardDescription>
              </div>
              {id && (
                <Button size="sm" variant="outline" onClick={() => setReconcileOpen(true)}><Plus className="h-3.5 w-3.5" strokeWidth={2.2} />Spočítat nové vyúčtování</Button>
              )}
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Období</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead className="num">Celkový rozdíl</TableHead>
                  <TableHead><span className="sr-only">Akce</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reconciliationsDataError && !reconciliationsData ? (
                  <TableError cols={4} onRetry={() => reconciliationsDataRefetch()} />
                ) : !reconciliationsData ? (
                  <TableSkeleton cols={4} />
                ) : reconciliations.length === 0 ? (
                  <TableEmpty cols={4}>Žádná vyúčtování pro tento pronájem.</TableEmpty>
                ) : (
                  reconciliations.map(r => {
                    const totalDiff = (r.items ?? []).reduce((sum, i) => sum + i.difference, 0);
                    const st = STATUS_LABEL[r.status] ?? { label: r.status, tone: 'soft' as const };
                    return (
                      <TableRow key={r.id} className="rem">
                        <TableCell className="whitespace-nowrap">
                          <Link to={`/reconciliations/${r.id}`} className="font-medium text-ink">{fmtDate(r.periodFrom)} až {fmtDate(r.periodTo)}</Link>
                        </TableCell>
                        <TableCell>
                          <Status tone={st.tone}>{st.label}</Status>
                          {r.computedAt && <div className="text-sm text-soft">spočítáno {fmtDateTime(r.computedAt)}</div>}
                        </TableCell>
                        <TableCell className={cn('num font-semibold', totalDiff < 0 ? 'text-late' : totalDiff > 0 ? 'text-accent' : 'text-soft')}>
                          {fmtKcSigned(totalDiff)}
                          <div className="text-sm font-normal text-soft">{totalDiff > 0 ? 'vrátit nájemci' : totalDiff < 0 ? 'nájemce doplácí' : 'vyrovnáno'}</div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          <Link to={`/reconciliations/${r.id}`} className="text-sm">Otevřít</Link>
                          <span className="acts">
                            <button
                              type="button"
                              className="ml-3.5 text-sm text-soft hover:text-ink disabled:opacity-50"
                              disabled={recomputeReconciliation.isPending}
                              onClick={() => {
                                const msg = r.status === 'finalized'
                                  ? 'Přepočítat finalizované vyúčtování? Uložené hodnoty se přepíšou.'
                                  : 'Přepočítat toto vyúčtování?';
                                if (confirm(msg)) recomputeReconciliation.mutate(r.id);
                              }}
                            >
                              Přepočítat
                            </button>
                            <button
                              type="button"
                              className="ml-3.5 text-sm text-soft hover:text-late disabled:opacity-50"
                              disabled={deleteReconciliation.isPending}
                              onClick={() => {
                                const msg = r.status === 'finalized'
                                  ? 'Smazat finalizované vyúčtování? Tohle nejde vrátit.'
                                  : 'Smazat toto vyúčtování?';
                                if (confirm(msg)) deleteReconciliation.mutate(r.id);
                              }}
                            >
                              Smazat
                            </button>
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
        {/* ── Tab 5: Události ────────────────────────────────────────────── */}
        <TabsContent value="udalosti">
          {id && contract ? <UdalostiTab contractId={id} contract={contract} terms={terms} reconciliations={reconciliations} /> : <p className="text-sm text-soft">Načítání…</p>}
        </TabsContent>
      </Tabs>

      {/* ── Payment create dialog ─────────────────────────────────────────── */}
      {paymentOpen && id && (
        <PaymentDialog
          fixedContractId={id}
          onClose={() => setPaymentOpen(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['payments-by-contract', id] });
            qc.invalidateQueries({ queryKey: ['payments'] });
            // Without this, staleTime: 30_000 on payment-breakdown means
            // Měsíční rozpis can show pre-payment allocation for up to 30s
            // after creating a payment — the delete mutation above already
            // invalidates both keys; this create path must match.
            qc.invalidateQueries({ queryKey: ['payment-breakdown', id] });
          }}
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

      {/* ── Edit Podmínky dialog ───────────────────────────────────────────── */}
      {editRowDate && id && (
        <EditPodminkyDialog
          contractId={id}
          date={editRowDate}
          terms={terms}
          utilities={utilities}
          onClose={() => setEditRowDate(null)}
          onUpdated={() => {
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
    </>
  );
}
