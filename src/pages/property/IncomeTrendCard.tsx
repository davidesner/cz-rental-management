import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { Seg } from '@/components/ui/seg';
import type { IncomeSummary } from '@/hooks/useDashboard';
import { fmtKc, fmtKcSigned } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CostStatement } from './CostsCard';
import { kindLabel } from './labels';

interface IncomeTrendCardProps {
  byYear: Record<string, IncomeSummary>;
  statements: CostStatement[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
  className?: string;
}

type View = 'gross' | 'net';

const W = 600;
const H = 180;
const PAD = { top: 26, bottom: 24, left: 4, right: 4 };

/** "1 234 567 Kč" shortened for a bar label: "1,2 mil." / "234 tis." */
function short(halere: number): string {
  const sign = halere < 0 ? '−' : '';
  const kc = Math.abs(halere) / 100;
  if (kc >= 1_000_000) return `${sign}${(kc / 1_000_000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} mil.`;
  if (kc >= 1_000) return `${sign}${Math.round(kc / 1_000).toLocaleString('cs-CZ')} tis.`;
  return sign + kc.toLocaleString('cs-CZ', { maximumFractionDigits: 0 });
}

interface YearRow {
  year: string;
  /** Rent plus advances as prescribed for the months that came due. */
  gross: number;
  /** Every cost statement whose period starts in the year, the full amount the landlord paid. */
  costs: Array<{ kind: string; amount: number }>;
  costTotal: number;
  net: number;
}

/**
 * Rent income per calendar year. Gross is the prescription (rent + advances);
 * net takes off the real costs recorded for the year: the SVJ statement in
 * full, including the items the landlord carries, and the utility statements.
 * A year without any statement shows its gross as net and says so.
 */
export function IncomeTrendCard({ byYear, statements, isPending, isError, refetch, className }: IncomeTrendCardProps) {
  const thisYear = String(new Date().getFullYear());
  const [view, setView] = useState<View>('gross');
  const [picked, setPicked] = useState<string | null>(null);

  const rows: YearRow[] = Object.keys(byYear).sort().map(year => {
    const costs = (statements ?? []).filter(s => s.periodFrom.startsWith(year)).map(s => ({ kind: s.kind, amount: s.totalAmount }));
    const costTotal = costs.reduce((sum, c) => sum + c.amount, 0);
    const gross = byYear[year]!.expected;
    return { year, gross, costs, costTotal, net: gross - costTotal };
  });
  const shown = rows.find(r => r.year === picked) ?? rows[rows.length - 1] ?? null;
  const value = (r: YearRow) => (view === 'gross' ? r.gross : r.net);
  const max = Math.max(1, ...rows.map(r => Math.abs(value(r))));
  const plotH = H - PAD.top - PAD.bottom;
  const slot = (W - PAD.left - PAD.right) / Math.max(1, rows.length);
  const barW = Math.min(64, slot * 0.6);
  const base = H - PAD.bottom;
  const anyWithoutCosts = view === 'net' && rows.some(r => r.costs.length === 0);

  return (
    <Card className={className}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Příjmy z pronájmu</CardTitle>
          <CardDescription>
            {view === 'gross' ? 'Předepsaný nájem a zálohy po letech.' : 'Předpis po odečtení skutečných nákladů za rok.'}
            <Hint label="Jak se počítá čistý příjem" className="ml-1">Hrubý příjem je nájem a zálohy podle předpisu za měsíce, které už nastaly. Čistý příjem od něj odečte náklady zadané v sekci Náklady za daný rok: vyúčtování SVJ v plné výši, včetně fondu oprav a dalších položek, které nese pronajímatel, a vyúčtování energií.</Hint>
          </CardDescription>
        </div>
        <Seg label="Hrubý nebo čistý příjem" value={view} onChange={setView} options={[{ value: 'gross', label: 'Hrubý' }, { value: 'net', label: 'Čistý' }]} />
      </CardHeader>
      <CardContent>
        {isError ? (
          <div>
            <p className="mb-3 text-sm text-late">Nepodařilo se načíst data.</p>
            <Button size="sm" variant="outline" onClick={refetch}>Zkusit znovu</Button>
          </div>
        ) : !isPending && rows.length === 0 ? (
          <p className="py-4 text-sm text-soft">Zatím žádný předpis. Nemovitost nikdo nepronajímal.</p>
        ) : (
          <div className={cn(isPending && 'opacity-50')}>
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Sloupcový graf ${view === 'gross' ? 'hrubého' : 'čistého'} příjmu po letech; čísla jsou v přehledu pod grafem.`}>
              <line x1={PAD.left} x2={W - PAD.right} y1={base} y2={base} stroke="var(--line)" />
              {rows.map((r, i) => {
                const v = value(r);
                const h = (Math.abs(v) / max) * plotH;
                const x = PAD.left + slot * i + (slot - barW) / 2;
                const active = shown?.year === r.year;
                const estimated = view === 'net' && r.costs.length === 0;
                return (
                  <g key={r.year} tabIndex={0} role="button" aria-label={`${r.year}: ${fmtKc(v)}`}
                    onMouseEnter={() => setPicked(r.year)} onFocus={() => setPicked(r.year)} onClick={() => setPicked(r.year)} className="cursor-pointer outline-none">
                    <rect x={PAD.left + slot * i} y={PAD.top - 12} width={slot} height={H - PAD.top + 12} fill="transparent" />
                    {h > 0 && (
                      <rect x={x} y={v >= 0 ? base - h : base} width={barW} height={h} rx={4}
                        fill={v < 0 ? 'var(--late)' : estimated ? 'var(--wait)' : 'var(--accent)'} opacity={active ? 1 : 0.85} />
                    )}
                    <text x={x + barW / 2} y={v >= 0 ? base - h - 8 : base - 8} textAnchor="middle" fontSize="12" fontWeight={active ? 600 : 500} fill="var(--ink)">{short(v)}</text>
                    <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="12" fill={active ? 'var(--ink)' : 'var(--soft)'} fontWeight={active ? 600 : 400}>{r.year}{r.year === thisYear ? '*' : ''}</text>
                  </g>
                );
              })}
            </svg>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-soft">
              {rows.some(r => r.year === thisYear) && <span>* letošní rok zatím</span>}
              {anyWithoutCosts && <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-wait" />bez zadaných nákladů, rovná se hrubému</span>}
            </div>
            {shown && (
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-t border-rule pt-3 text-sm">
                <dt className="text-soft">Rok</dt><dd className="m-0 text-right font-semibold">{shown.year}</dd>
                <dt className="text-soft">Hrubý příjem (předpis)</dt><dd className="m-0 text-right font-medium">{fmtKc(shown.gross)}</dd>
                {shown.costs.length === 0
                  ? <><dt className="text-soft">Náklady</dt><dd className="m-0 text-right text-soft">zatím nezadány</dd></>
                  : shown.costs.map((c, i) => <div key={i} className="contents"><dt className="text-soft">{kindLabel(c.kind)}</dt><dd className="m-0 text-right font-medium">{fmtKcSigned(-c.amount)}</dd></div>)}
                <dt className="border-t border-rule pt-1 text-soft">Čistý příjem</dt>
                <dd className={cn('m-0 border-t border-rule pt-1 text-right font-semibold', shown.net < 0 && 'text-late')}>{fmtKc(shown.net)}</dd>
              </dl>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
