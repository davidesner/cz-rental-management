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
                  <td className="py-1 text-muted-foreground">{cs.documentRef ?? '—'}</td>
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
                <th className="pb-1 pr-3 font-medium text-right">Celk. předpis</th>
                <th className="pb-1 pr-3 font-medium text-right">Předpis (druh)</th>
                <th className="pb-1 pr-3 font-medium text-right">Přijato celkem</th>
                <th className="pb-1 font-medium text-right">Zaplaceno (druh)</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.months.map((m) => (
                <tr key={m.month} className="border-b border-border/40">
                  <td className="py-1 pr-3 font-medium">{m.month}</td>
                  <td className="py-1 pr-3 text-right text-muted-foreground">
                    {m.daysActive}/{m.daysInMonth}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmtKc(m.expectedTotal)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmtKc(m.expectedThisKind)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmtKc(m.receivedTotal)}</td>
                  <td className="py-1 text-right tabular-nums font-medium">{fmtKc(m.paidThisKind)}</td>
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
          <TableCell colSpan={4} className="p-0">
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
      navigate(-1);
    },
  });

  const r = data?.reconciliation;
  const items = r?.items ?? [];
  const totalDiff = items.reduce((sum, i) => sum + i.difference, 0);

  // Live values recomputed from current breakdown (cost statements + payments + reductions)
  // Compare to persisted values stored on each item to detect divergence.
  const itemsWithLive = items.map((item) => {
    if (!item.breakdown) {
      return { item, liveActualCost: item.actualCost, livePaid: item.paid, liveDifference: item.difference, stale: false };
    }
    const liveActualCost = item.breakdown.costStatements.reduce(
      (s, cs) => s + cs.totalAmount + cs.adjustmentAmount, 0
    );
    const livePaid = item.breakdown.months.reduce((s, m) => s + m.paidThisKind, 0);
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
        <Link to="/reconciliations" className="text-sm text-muted-foreground hover:underline">← Vyúčtování nájemci</Link>
        <h1 className="text-3xl font-bold">Vyúčtování</h1>
      </div>

      <Card className="p-6 space-y-2">
        <p><span className="font-medium">Smlouva:</span> {r.contractId}</p>
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
              <TableHead className="text-right">Zaplaceno</TableHead>
              <TableHead className="text-right">Skutečné náklady</TableHead>
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
                <TableCell colSpan={4} className="text-center text-muted-foreground py-6">Žádné položky.</TableCell>
              </TableRow>
            )}
          </TableBody>
          {items.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-medium">
                  Celkový rozdíl {isStale && <span className="text-xs text-muted-foreground">(persistovaný)</span>}
                </TableCell>
                <TableCell className={`text-right font-bold ${totalDiff < 0 ? 'text-destructive' : 'text-green-600'}`}>
                  {fmtKc(totalDiff)}
                </TableCell>
              </TableRow>
              {isStale && (
                <TableRow>
                  <TableCell colSpan={3} className="font-medium text-blue-700">
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
