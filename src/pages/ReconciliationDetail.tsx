import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtKc, fmtKcSigned, fmtMonth } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
import { Status } from '@/components/ui/status';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Crumb } from '@/components/Layout';
import { Hint } from '@/components/ui/hint';

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
  gaps?: Array<{ from: string; to: string }>;
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

const KIND_LABEL: Record<string, string> = {
  rent: 'Nájem', services: 'Služby (SVJ)', electricity: 'Elektřina', gas: 'Plyn', internet: 'Internet', water: 'Voda', other: 'Ostatní',
};

const STATUS: Record<string, { label: string; tone: 'ok' | 'wait' | 'soft' }> = {
  draft: { label: 'Návrh', tone: 'wait' },
  finalized: { label: 'Finalizováno', tone: 'ok' },
};

function diffTone(h: number) {
  return h < 0 ? 'text-late' : h > 0 ? 'text-accent' : 'text-soft';
}

/** "Vyúčtování za rok 2026" when the period is a calendar year, otherwise the dates. */
function titleFor(from: string, to: string): string {
  const y = from.slice(0, 4);
  if (from === `${y}-01-01` && to === `${y}-12-31`) return `Vyúčtování za rok ${y}`;
  return `Vyúčtování ${fmtDate(from)} až ${fmtDate(to)}`;
}

function ItemBreakdownPanel({ breakdown }: { breakdown: ItemBreakdown | undefined }) {
  if (!breakdown || (breakdown.costStatements.length === 0 && breakdown.months.length === 0)) {
    return <div className="px-5 py-3 text-sm text-soft">Žádné podklady.</div>;
  }

  const costTotal = breakdown.costStatements.reduce(
    (s, cs) => s + cs.totalAmount + cs.adjustmentAmount, 0
  );
  const paidTotal = breakdown.months.reduce((s, m) => s + m.paidThisKind, 0);
  const sub = 'px-3 py-1.5 text-sm first:pl-0 last:pr-0 group-hover/row:bg-transparent';
  const subHead = 'border-b-0 bg-transparent px-3 py-1 first:pl-0 last:pr-0';

  return (
    <div className="space-y-4 bg-side px-5 py-4">
      {breakdown.gaps && breakdown.gaps.length > 0 && (
        <Notice kind="warn">
          <div className="font-semibold">Mezera v podkladech</div>
          <div>Pro tento druh chybí vyúčtování nákladů za: {breakdown.gaps.map(g => `${fmtDate(g.from)} až ${fmtDate(g.to)}`).join(', ')}.</div>
          <div className="text-soft">Platby v tom období se nepárují s žádným nákladem. Doplň vyúčtování nákladů, nebo zkontroluj, že je to záměr.</div>
        </Notice>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-x-8 gap-y-4">
        <div>
          <div className="mb-1 text-sm font-medium">Skutečné náklady</div>
          {breakdown.costStatements.length === 0 ? (
            <p className="text-sm text-soft">Žádné vyúčtování nákladů.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <TableHead className={subHead}>Období</TableHead>
                  <TableHead className={cn(subHead, 'num')}>Částka</TableHead>
                  <TableHead className={cn(subHead, 'num')}>Korekce</TableHead>
                  <TableHead className={subHead}>Doklad</TableHead>
                </tr>
              </thead>
              <tbody>
                {breakdown.costStatements.map((cs) => (
                  <tr key={cs.id}>
                    <TableCell className={cn(sub, 'whitespace-nowrap')}>{fmtDate(cs.periodFrom)} až {fmtDate(cs.periodTo)}</TableCell>
                    <TableCell className={cn(sub, 'num')}>{fmtKc(cs.totalAmount)}</TableCell>
                    <TableCell className={cn(sub, 'num', diffTone(cs.adjustmentAmount))} title={cs.adjustmentNote ?? undefined}>
                      {cs.adjustmentAmount !== 0 ? fmtKcSigned(cs.adjustmentAmount) : '—'}
                    </TableCell>
                    <TableCell className={sub}>{
                      cs.documentRef
                        ? /^https?:\/\//.test(cs.documentRef)
                          ? <a href={cs.documentRef} target="_blank" rel="noreferrer">odkaz</a>
                          : <span className="text-soft" title={cs.documentRef}>{cs.documentRef.length > 24 ? cs.documentRef.slice(0, 22) + '…' : cs.documentRef}</span>
                        : <span className="text-soft">—</span>
                    }</TableCell>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <TableCell className={cn(sub, 'font-semibold')}>K vyúčtování</TableCell>
                  <TableCell className={cn(sub, 'num font-semibold')} colSpan={3}>{fmtKc(costTotal)}</TableCell>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div>
          <div className="mb-1 text-sm font-medium">Zaplaceno po měsících</div>
          {breakdown.months.length === 0 ? (
            <p className="text-sm text-soft">Žádné měsíce.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <TableHead className={subHead}>Měsíc</TableHead>
                  <TableHead className={cn(subHead, 'num')}>Předpis druhu</TableHead>
                  <TableHead className={cn(subHead, 'num')}>Zaplaceno druhu</TableHead>
                </tr>
              </thead>
              <tbody>
                {breakdown.months.map((m) => (
                  <tr key={m.month}>
                    <TableCell className={cn(sub, 'whitespace-nowrap')}>
                      {fmtMonth(m.month)}
                      {m.daysActive < m.daysInMonth && <span className="ml-2 text-soft">{m.daysActive}/{m.daysInMonth} dní</span>}
                    </TableCell>
                    <TableCell className={cn(sub, 'num')}>{fmtKc(m.expectedThisKind)}</TableCell>
                    <TableCell className={cn(sub, 'num font-medium')}>{fmtKc(m.paidThisKind)}</TableCell>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <TableCell className={cn(sub, 'font-semibold')} colSpan={2}>Zaplaceno celkem</TableCell>
                  <TableCell className={cn(sub, 'num font-semibold')}>{fmtKc(paidTotal)}</TableCell>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
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

  const mp = item.breakdown?.matchPeriod;
  const mpSource = item.breakdown?.matchPeriodSource;
  const mpDiffers = item.breakdown?.matchPeriodIsDifferentFromDefault ?? false;
  const naturalFrom = item.breakdown?.matchPeriodNaturalFrom;
  const isShifted = Boolean(naturalFrom);

  const periodLabel = mp ? `${fmtDate(mp.from)} až ${fmtDate(mp.to)}` : '—';

  const sourceLabel = isShifted
    ? 'z vyúčtování nákladů, posunuto'
    : mpSource === 'from-cost-statements'
      ? 'z vyúčtování nákladů'
      : 'období vyúčtování';

  const tooltipText = isShifted && mp && naturalFrom
    ? `Období párování bylo posunuto z ${fmtDate(naturalFrom)} na ${fmtDate(mp.from)}, protože měsíc ${fmtMonth(naturalFrom)} už pokrývá předchozí vyúčtování nákladů stejného druhu. Platba na rozhraní dvou cyklů se tak nezapočítá dvakrát.`
    : mpDiffers && mp
      ? `Období párování plateb je odvozeno z vyúčtování nákladů (${fmtDate(mp.from)} až ${fmtDate(mp.to)}). Když vyúčtování nákladů tohoto druhu začíná uvnitř období vyúčtování, jeho období určuje, které platby se započítají.`
      : undefined;

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <TableCell>
          <div className="flex items-center gap-1.5">
            {expanded
              ? <ChevronDown className="h-4 w-4 flex-none text-soft" />
              : <ChevronRight className="h-4 w-4 flex-none text-soft" />
            }
            <span className="font-medium">{KIND_LABEL[item.kind] ?? item.kind}</span>
            {live && <span className="ml-1 text-xs font-medium text-late">změna</span>}
          </div>
        </TableCell>
        <TableCell>
          <div className={cn('whitespace-nowrap', mpDiffers && 'font-medium')}>{periodLabel}</div>
          <div className="text-sm text-soft" title={tooltipText}>
            {sourceLabel}
            {tooltipText && <span aria-label="Vysvětlení" className="ml-1 cursor-help underline decoration-dotted underline-offset-2">proč</span>}
          </div>
        </TableCell>
        <TableCell className="num">
          <div>{fmtKc(item.paid)}</div>
          {live && <div className="text-sm text-soft">aktuálně {fmtKc(live.paid)}</div>}
        </TableCell>
        <TableCell className="num">
          <div>{fmtKc(item.actualCost)}</div>
          {live && <div className="text-sm text-soft">aktuálně {fmtKc(live.actualCost)}</div>}
        </TableCell>
        <TableCell className={cn('num font-medium', diffTone(item.difference))}>
          <div>{fmtKcSigned(item.difference)}</div>
          {live && <div className={cn('text-sm font-normal', diffTone(live.difference))}>aktuálně {fmtKcSigned(live.difference)}</div>}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={5} className="p-0 group-hover/row:bg-transparent">
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

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['reconciliations', id],
    queryFn: () => api.get<{ reconciliation: Reconciliation }>(`/api/reconciliations/${id}`),
    enabled: !!id,
  });

  const rec = data?.reconciliation;

  // Fetch contract to display readable tenant + property names (not the cuid)
  const { data: contractData } = useQuery({
    queryKey: ['contracts', rec?.contractId],
    queryFn: () => api.get<{ contract: { id: string; propertyId: string; tenantId: string; propertyName: string; tenantName: string } }>(
      `/api/contracts/${rec!.contractId}`
    ),
    enabled: !!rec?.contractId,
  });
  const contract = contractData?.contract;

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
      qc.invalidateQueries({ queryKey: ['reconciliations-by-contract'] });
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

  if (isLoading) return <p className="text-sm text-soft">Načítání…</p>;
  // Only a real 404 means "nenalezeno" — a failed request must not be reported
  // as a missing reconciliation.
  if (isError && !(error instanceof ApiError && error.status === 404)) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-late">Nepodařilo se načíst vyúčtování.</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>Zkusit znovu</Button>
      </div>
    );
  }
  if (!r) return <p className="text-sm text-soft">Vyúčtování nenalezeno.</p>;

  const st = STATUS[r.status] ?? { label: r.status, tone: 'soft' as const };
  const backTo = `/contracts/${r.contractId}?tab=vyuctovani`;

  return (
    <>
      <PageHeader
        crumb={<><Crumb to="/contracts">Pronájmy</Crumb> / <Crumb to={backTo}>{contract?.tenantName ?? 'Pronájem'}</Crumb></>}
        title={titleFor(r.periodFrom, r.periodTo)}
        sub={<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          {contract && <Link to={backTo}>{contract.tenantName} · {contract.propertyName}</Link>}
          <span>{fmtDate(r.periodFrom)} až {fmtDate(r.periodTo)}</span>
          <Status tone={st.tone}>{st.label}</Status>
          {r.computedAt && <span>spočítáno {fmtDateTime(r.computedAt)}</span>}
        </span>}
        actions={<>
          <Button
            variant="outline"
            className="text-late hover:text-late"
            onClick={() => {
              const msg = r.status === 'finalized'
                ? 'Smazat finalizované vyúčtování? Tohle nejde vrátit.'
                : 'Smazat toto vyúčtování?';
              if (confirm(msg)) deleteMutation.mutate();
            }}
            disabled={deleteMutation.isPending}
          >
            Smazat
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const msg = r.status === 'finalized'
                ? 'Přepočítat finalizované vyúčtování? Uložené položky se nahradí novým výpočtem.'
                : 'Přepočítat toto vyúčtování? Uložené položky se nahradí.';
              if (confirm(msg)) recompute.mutate();
            }}
            disabled={recompute.isPending}
          >
            Přepočítat
          </Button>
          {r.status === 'draft' && (
            <Button onClick={() => finalize.mutate()} disabled={finalize.isPending}>Finalizovat</Button>
          )}
        </>}
      />

      {isStale && (
        <Notice kind="warn">
          <div className="font-semibold">Podklady se od posledního výpočtu změnily</div>
          <div className="text-soft">
            U položek označených „změna" je pod uloženou hodnotou aktuální hodnota z plateb, srážek a vyúčtování nákladů.
            {r.status === 'draft' ? ' Přepočítat uloží aktuální stav.' : ' Vyúčtování je finalizované; Přepočítat přepíše uložený stav aktuálním.'}
          </div>
        </Notice>
      )}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Druh</TableHead>
              <TableHead><span className="inline-flex items-center gap-1">Období párování plateb<Hint label="Co je období párování">Měsíce, jejichž platby se u tohoto druhu započítají. U nájmu je to období vyúčtování. U služeb a energií se řídí obdobím vyúčtování nákladů, pokud začíná uvnitř vyúčtovávaného roku, aby se platba na přelomu roku nepočítala dvakrát.</Hint></span></TableHead>
              <TableHead className="num">Zaplaceno</TableHead>
              <TableHead className="num">Předepsáno / náklady</TableHead>
              <TableHead className="num">Rozdíl</TableHead>
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
                <TableCell colSpan={5} className="py-8 text-center text-sm text-soft">Žádné položky.</TableCell>
              </TableRow>
            )}
          </TableBody>
          {items.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4}>
                  Celkový rozdíl
                  <span className="ml-2 font-normal text-soft">{totalDiff > 0 ? 'vrátit nájemníkovi' : totalDiff < 0 ? 'nájemník doplácí' : 'vyrovnáno'}</span>
                  {isStale && <span className="ml-2 text-sm font-normal text-soft">(uložený)</span>}
                </TableCell>
                <TableCell className={cn('num', diffTone(totalDiff))}>{fmtKcSigned(totalDiff)}</TableCell>
              </TableRow>
              {isStale && (
                <TableRow>
                  <TableCell colSpan={4} className="font-normal text-soft">Celkový rozdíl aktuálně z podkladů</TableCell>
                  <TableCell className={cn('num', diffTone(liveTotalDiff))}>{fmtKcSigned(liveTotalDiff)}</TableCell>
                </TableRow>
              )}
            </TableFooter>
          )}
        </Table>
      </Card>

      <p className="text-sm text-soft">
        Kladný rozdíl znamená, že nájemník zaplatil na zálohách víc, než stály skutečné náklady, a částka se mu vrací. Záporný rozdíl doplácí.
        Období párování plateb se u služeb a energií řídí vyúčtováním nákladů, které začíná uvnitř období vyúčtování.
      </p>
    </>
  );
}
