import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';

interface CostStatementEntry {
  id: string;
  periodFrom: string;
  periodTo: string;
  totalAmount: number;
  adjustmentAmount: number;
  adjustmentNote: string | null;
  note: string | null;
  documentRef: string | null;
}

interface MonthEntry {
  month: string;
  daysActive: number;
  daysInMonth: number;
  expectedThisKind: number;
  expectedTotal: number;
  receivedTotal: number;
  paidThisKind: number;
}

interface ItemBreakdown {
  costStatements: CostStatementEntry[];
  months: MonthEntry[];
  matchPeriod?: { from: string; to: string };
  matchPeriodSource?: 'default' | 'from-cost-statements';
  matchPeriodIsDifferentFromDefault?: boolean;
  /** When auto-shift applied (prior statement claimed boundary month), original natural start date. */
  matchPeriodNaturalFrom?: string;
}

interface ReconciliationItem {
  kind: string;
  paid: number;
  actualCost: number;
  difference: number;
  breakdown?: ItemBreakdown;
}

interface Reconciliation {
  id: string;
  contractId: string;
  periodFrom: string;
  periodTo: string;
  status: string;
  computedAt: string | null;
  items: ReconciliationItem[];
}

function fmtKc(halere: number) {
  return (halere / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
}

function fmtKcSigned(halere: number) {
  const s = (halere / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
  const sign = halere >= 0 ? '+' : '';
  return sign + s;
}

function ItemBreakdownPanel({ breakdown }: { breakdown: ItemBreakdown | undefined }) {
  if (!breakdown || (breakdown.costStatements.length === 0 && breakdown.months.length === 0)) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground italic">Žádné podklady.</div>
    );
  }

  const costTotal = breakdown.costStatements.reduce(
    (s, cs) => s + cs.totalAmount + cs.adjustmentAmount, 0
  );
  const paidTotal = breakdown.months.reduce((s, m) => s + m.paidThisKind, 0);

  return (
    <div className="bg-muted/30 border-t px-4 py-3 space-y-4">
      {/* Cost statements */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Reálné náklady — podklady
        </p>
        {breakdown.costStatements.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Žádné doklady.</p>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="pb-1 pr-3 font-medium">Období</th>
                <th className="pb-1 pr-3 font-medium text-right">Celková částka</th>
                <th className="pb-1 pr-3 font-medium text-right">Korekce</th>
                <th className="pb-1 pr-3 font-medium">Poznámka ke korekci</th>
                <th className="pb-1 font-medium">Doklad</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.costStatements.map((cs) => (
                <tr key={cs.id} className="border-b border-border/40">
                  <td className="py-1 pr-3 whitespace-nowrap">{cs.periodFrom} – {cs.periodTo}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmtKc(cs.totalAmount)}</td>
                  <td className={`py-1 pr-3 text-right tabular-nums ${cs.adjustmentAmount < 0 ? 'text-destructive' : cs.adjustmentAmount > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {cs.adjustmentAmount !== 0 ? fmtKcSigned(cs.adjustmentAmount) : '—'}
                  </td>
                  <td className="py-1 pr-3 text-muted-foreground">{cs.adjustmentNote ?? '—'}</td>
                  <td className="py-1">{
                    cs.documentRef
                      ? /^https?:\/\//.test(cs.documentRef)
                        ? <a href={cs.documentRef} target="_blank" rel="noreferrer" className="text-primary underline">odkaz</a>
                        : <span className="text-muted-foreground">{cs.documentRef}</span>
                      : <span className="text-muted-foreground">—</span>
                  }</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="pt-1 pr-3 font-semibold" colSpan={1}>Σ k vyúčtování</td>
                <td colSpan={1}></td>
                <td colSpan={1}></td>
                <td colSpan={2} className="pt-1 text-right font-semibold tabular-nums">{fmtKc(costTotal)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Monthly allocations */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Zaplaceno — měsíční alokace
        </p>
        {breakdown.months.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Žádné měsíce.</p>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="pb-1 pr-3 font-medium">Měsíc</th>
                <th className="pb-1 pr-3 font-medium text-right">Aktivní dny</th>
                <th className="pb-1 pr-3 font-medium text-right text-muted-foreground/70 italic">Celk. předpis</th>
                <th className="pb-1 pr-3 font-medium text-right text-muted-foreground/70 italic">Přijato celkem</th>
                <th className="pb-1 pr-3 font-medium text-right text-foreground">Předpis (druh)</th>
                <th className="pb-1 font-medium text-right text-foreground">Zaplaceno (druh)</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.months.map((m) => (
                <tr key={m.month} className="border-b border-border/40">
                  <td className="py-1 pr-3 font-medium">{m.month}</td>
                  <td className="py-1 pr-3 text-right text-muted-foreground">
                    {m.daysActive}/{m.daysInMonth}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground/70 italic">{fmtKc(m.expectedTotal)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground/70 italic">{fmtKc(m.receivedTotal)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmtKc(m.expectedThisKind)}</td>
                  <td className="py-1 text-right tabular-nums font-semibold">{fmtKc(m.paidThisKind)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="pt-1 pr-3 font-semibold" colSpan={5}>Σ zaplaceno (druh)</td>
                <td className="pt-1 text-right font-semibold tabular-nums">{fmtKc(paidTotal)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

function ReconciliationItemRow({
  item,
  live,
}: {
  item: ReconciliationItem;
  live: { actualCost: number; paid: number; difference: number } | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const mp = item.breakdown?.matchPeriod;
  const mpSource = item.breakdown?.matchPeriodSource;
  const mpDiffers = item.breakdown?.matchPeriodIsDifferentFromDefault ?? false;
  const naturalFrom = item.breakdown?.matchPeriodNaturalFrom;
  const isShifted = Boolean(naturalFrom);

  const periodLabel = mp
    ? `${mp.from} – ${mp.to}`
    : '—';

  const sourceLabel = isShifted
    ? '(ze statementu, posunuto)'
    : mpSource === 'from-cost-statements'
      ? '(ze statementu)'
      : '(default)';

  // Show tooltip when matchPeriod differs from default OR when auto-shift was applied
  const tooltipText = isShifted && mp && naturalFrom
    ? `Matching období bylo posunuto z ${naturalFrom} na ${mp.from}, protože měsíc ${naturalFrom.slice(0, 7)} už pokrývá předchozí vyúčtování stejného druhu (cost statement co končí v tom měsíci). Tím se brání double-count platby na boundary mezi dvěma cykly.`
    : mpDiffers && mp
      ? `Matching období je odvozeno z cost statementu (${mp.from} až ${mp.to}). Pokud existuje cost statement daného druhu jehož periodFrom startuje uvnitř reconciliation období, jeho period (sjednocený přes víc statementů) určuje matching okno pro platby. Jinak default = reconciliation období.`
      : '';

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(e => !e)}
      >
        <TableCell>
          <div className="flex items-center gap-1">
            {expanded
              ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            }
            {item.kind}
            {live && (
              <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                změna
              </span>
            )}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1 text-sm">
            <span className={mpDiffers ? 'text-amber-700 font-medium' : 'text-muted-foreground'}>
              {periodLabel}
            </span>
            <span className="text-xs text-muted-foreground">{sourceLabel}</span>
            {(mpDiffers || isShifted) && tooltipText && (
              <div className="relative inline-block">
                <button
                  className={`${isShifted ? 'text-amber-600 hover:text-amber-700' : 'text-blue-500 hover:text-blue-700'} text-xs leading-none`}
                  onMouseEnter={() => setTooltipVisible(true)}
                  onMouseLeave={() => setTooltipVisible(false)}
                  onClick={e => e.stopPropagation()}
                  aria-label="Informace o matching období"
                >
                  ⓘ
                </button>
                {tooltipVisible && (
                  <div className="absolute z-50 left-0 top-5 w-72 rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md">
                    {tooltipText}
                  </div>
                )}
              </div>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div>{fmtKc(item.paid)}</div>
          {live && <div className="text-xs text-blue-700">{fmtKc(live.paid)} (aktuální)</div>}
        </TableCell>
        <TableCell className="text-right">
          <div>{fmtKc(item.actualCost)}</div>
          {live && <div className="text-xs text-blue-700">{fmtKc(live.actualCost)} (aktuální)</div>}
        </TableCell>
        <TableCell className={`text-right font-medium ${item.difference < 0 ? 'text-destructive' : 'text-green-600'}`}>
          <div>{fmtKc(item.difference)}</div>
          {live && (
            <div className={`text-xs ${live.difference < 0 ? 'text-destructive' : 'text-blue-700'}`}>
              {fmtKc(live.difference)} (aktuální)
            </div>
          )}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="p-0">
            <ItemBreakdownPanel breakdown={item.breakdown} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function ReconciliationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['reconciliations', id],
    queryFn: () => api.get<{ reconciliation: Reconciliation }>(`/api/reconciliations/${id}`),
    enabled: !!id,
  });

  const rec = data?.reconciliation;

  // Fetch contract + related tenant/property to display readable name (not the cuid)
  const { data: contractData } = useQuery({
    queryKey: ['contract', rec?.contractId],
    queryFn: () => api.get<{ contract: { id: string; propertyId: string; tenantId: string } }>(
      `/api/contracts/${rec!.contractId}`
    ),
    enabled: !!rec?.contractId,
  });
  const contract = contractData?.contract;
  const { data: tenantsData } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => api.get<{ tenants: Array<{ id: string; name: string }> }>('/api/tenants'),
  });
  const { data: propertiesData } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get<{ properties: Array<{ id: string; name: string }> }>('/api/properties'),
  });
  const tenantName = contract && tenantsData?.tenants.find(t => t.id === contract.tenantId)?.name;
  const propertyName = contract && propertiesData?.properties.find(p => p.id === contract.propertyId)?.name;

  const finalize = useMutation({
    mutationFn: () => api.patch<{ reconciliation: Reconciliation }>(`/api/reconciliations/${id}/finalize`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reconciliations', id] }),
  });

  const recompute = useMutation({
    mutationFn: () => api.post<{ reconciliation: Reconciliation }>(`/api/reconciliations/${id}/recompute`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reconciliations', id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete<void>(`/api/reconciliations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reconciliations'] });
      if (rec?.contractId) {
        navigate(`/contracts/${rec.contractId}?tab=vyuctovani`, { replace: true });
      } else {
        navigate('/contracts', { replace: true });
      }
    },
  });

  const r = rec;
  const items = r?.items ?? [];
  const totalDiff = items.reduce((sum, i) => sum + i.difference, 0);

  // Live values recomputed from current breakdown (cost statements + payments + reductions)
  // Compare to persisted values stored on each item to detect divergence.
  const itemsWithLive = items.map((item) => {
    if (!item.breakdown) {
      return { item, liveActualCost: item.actualCost, livePaid: item.paid, liveDifference: item.difference, stale: false };
    }
    // For rent there are no cost statements — actualCost = sum of effective expected rent per month.
    // For other kinds — actualCost = sum from cost statements (totalAmount + adjustment).
    const liveActualCost = item.kind === 'rent'
      ? item.breakdown.months.reduce((s, m) => s + m.expectedThisKind, 0)
      : item.breakdown.costStatements.reduce((s, cs) => s + cs.totalAmount + cs.adjustmentAmount, 0);
    // livePaid respects matchPeriod filtering (same as backend) for non-rent kinds
    const mp = item.breakdown.matchPeriod;
    const livePaid = item.kind === 'rent' || !mp
      ? item.breakdown.months.reduce((s, m) => s + m.paidThisKind, 0)
      : item.breakdown.months
          .filter(m => m.month >= mp.from.slice(0, 7) && m.month <= mp.to.slice(0, 7))
          .reduce((s, m) => s + m.paidThisKind, 0);
    const liveDifference = livePaid - liveActualCost;
    const stale = liveActualCost !== item.actualCost || livePaid !== item.paid;
    return { item, liveActualCost, livePaid, liveDifference, stale };
  });
  const liveTotalDiff = itemsWithLive.reduce((sum, it) => sum + it.liveDifference, 0);
  const isStale = itemsWithLive.some((it) => it.stale);

  if (isLoading) return <div className="p-8 text-muted-foreground">Načítání…</div>;
  if (!r) return <div className="p-8 text-muted-foreground">Nenalezeno.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        {rec ? (
          <Link
            to={`/contracts/${rec.contractId}?tab=vyuctovani`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Zpět na pronájem
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">← Zpět</span>
        )}
        <h1 className="text-3xl font-bold">Vyúčtování</h1>
      </div>

      <Card className="p-6 space-y-2">
        <p>
          <span className="font-medium">Pronájem:</span>{' '}
          {tenantName && propertyName ? (
            <Link to={`/contracts/${r.contractId}?tab=vyuctovani`} className="text-primary hover:underline">
              {tenantName} · {propertyName}
            </Link>
          ) : (
            <span className="text-muted-foreground">{r.contractId}</span>
          )}
        </p>
        <p><span className="font-medium">Období:</span> {r.periodFrom} – {r.periodTo}</p>
        <p><span className="font-medium">Stav:</span> {r.status}</p>
        {r.computedAt && <p><span className="font-medium">Spočítáno dne:</span> {r.computedAt}</p>}
      </Card>

      {isStale && (
        <div className="rounded-md border border-amber-400 bg-amber-50 p-4 text-sm">
          <p className="font-semibold text-amber-900">
            ⚠ Podklady se od posledního výpočtu změnily
          </p>
          <p className="text-amber-900 mt-1">
            Hodnoty zaplacené / skutečných nákladů níže (modře) jsou{' '}
            <strong>fresh</strong> z aktuálních plateb, srážek a vyúčtování nákladů.{' '}
            Persistovaný stav (černě, finalizovaný) je z času posledního výpočtu.
            {r.status === 'draft' ? (
              <> Klikni „Přepočítat" pro aktualizaci.</>
            ) : (
              <> Vyúčtování je <strong>finalized</strong>; pro novou pravdu klikni „Přepočítat" (přepíše snapshot).</>
            )}
          </p>
        </div>
      )}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Druh</TableHead>
              <TableHead>Období</TableHead>
              <TableHead className="text-right">Zaplaceno</TableHead>
              <TableHead className="text-right">Předepsáno / Náklady</TableHead>
              <TableHead className="text-right">Rozdíl</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itemsWithLive.map(({ item, liveActualCost, livePaid, liveDifference, stale }, idx) => (
              <ReconciliationItemRow
                key={idx}
                item={item}
                live={stale ? { actualCost: liveActualCost, paid: livePaid, difference: liveDifference } : null}
              />
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-6">Žádné položky.</TableCell>
              </TableRow>
            )}
          </TableBody>
          {items.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="font-medium">
                  Celkový rozdíl {isStale && <span className="text-xs text-muted-foreground">(persistovaný)</span>}
                </TableCell>
                <TableCell className={`text-right font-bold ${totalDiff < 0 ? 'text-destructive' : 'text-green-600'}`}>
                  {fmtKc(totalDiff)}
                </TableCell>
              </TableRow>
              {isStale && (
                <TableRow>
                  <TableCell colSpan={4} className="font-medium text-blue-700">
                    Celkový rozdíl (aktuální, fresh z podkladů)
                  </TableCell>
                  <TableCell className={`text-right font-bold text-blue-700`}>
                    {fmtKc(liveTotalDiff)}
                  </TableCell>
                </TableRow>
              )}
            </TableFooter>
          )}
        </Table>
      </Card>

      <div className="flex gap-3">
        {r.status === 'draft' && (
          <Button
            onClick={() => finalize.mutate()}
            disabled={finalize.isPending}
          >
            Finalizovat
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => {
            const msg = r.status === 'finalized'
              ? 'Přepočítat FINALIZOVANÉ vyúčtování? Stávající položky budou nahrazeny novým výpočtem.'
              : 'Přepočítat toto vyúčtování? Stávající položky budou nahrazeny.';
            if (confirm(msg)) recompute.mutate();
          }}
          disabled={recompute.isPending}
        >
          Přepočítat
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            const msg = r.status === 'finalized'
              ? 'Smazat FINALIZOVANÉ vyúčtování? Toto je nevratné.'
              : 'Smazat toto vyúčtování?';
            if (confirm(msg)) deleteMutation.mutate();
          }}
          disabled={deleteMutation.isPending}
        >
          Smazat
        </Button>
      </div>
    </div>
  );
}
