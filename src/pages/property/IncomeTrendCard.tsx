import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { Seg } from '@/components/ui/seg';
import type { IncomeSummary } from '@/hooks/useDashboard';
import { fmtKc, fmtKcSigned } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The slice of a property tariff row the chart needs: when it applied and what the landlord carries per month. */
export interface TariffSlice {
  validFrom: string;
  validTo: string | null;
  deductibleAmount: number;
}

interface IncomeTrendCardProps {
  byYear: Record<string, IncomeSummary>;
  tariffs: TariffSlice[] | undefined;
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

/** The tariff in force on the first day of a month, if any. */
function tariffAt(tariffs: TariffSlice[], month: string): TariffSlice | undefined {
  const day = `${month}-01`;
  return tariffs.find(t => t.validFrom <= day && (t.validTo === null || day < t.validTo));
}

interface YearRow {
  year: string;
  /** Rent as prescribed for the months that came due, without advances. */
  rent: number;
  /** SVJ items the landlord carries (fond oprav and the like) per the evidenční list, taken off the rent. */
  landlordSvj: number;
  net: number;
}

/**
 * The landlord's income per calendar year. Advances are not income: the tenant
 * pays them on top of the rent and they are settled against the real costs in
 * the reconciliation. Gross is therefore the prescribed rent alone. Net takes
 * off the part of the SVJ prescription the landlord carries, the evidenční
 * list's deductible amount for each month that came due. Maintenance and
 * repairs are not tracked, so they are not in the number either.
 */
export function IncomeTrendCard({ byYear, tariffs, isPending, isError, refetch, className }: IncomeTrendCardProps) {
  const thisYear = String(new Date().getFullYear());
  const [view, setView] = useState<View>('gross');
  const [picked, setPicked] = useState<string | null>(null);

  const rows: YearRow[] = Object.keys(byYear).sort().map(year => {
    const y = byYear[year]!;
    const landlordSvj = y.months.reduce((sum, m) => sum + (tariffAt(tariffs ?? [], m)?.deductibleAmount ?? 0), 0);
    return { year, rent: y.rent, landlordSvj, net: y.rent - landlordSvj };
  });
  const shown = rows.find(r => r.year === picked) ?? rows[rows.length - 1] ?? null;
  const value = (r: YearRow) => (view === 'gross' ? r.rent : r.net);
  const max = Math.max(1, ...rows.map(r => Math.abs(value(r))));
  const plotH = H - PAD.top - PAD.bottom;
  const slot = (W - PAD.left - PAD.right) / Math.max(1, rows.length);
  const barW = Math.min(64, slot * 0.6);
  const base = H - PAD.bottom;

  return (
    <Card className={className}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Příjmy z pronájmu</CardTitle>
          <CardDescription>
            {view === 'gross' ? 'Předepsaný nájem po letech, bez záloh na služby.' : 'Nájem po odečtení položek SVJ, které jdou za pronajímatelem.'}
            <Hint label="Jak se počítá příjem" className="ml-1">Zálohy na služby a energie nejsou příjem: nájemce je platí navíc k nájmu a vyúčtování je srovná se skutečnými náklady. Hrubý příjem je proto samotný nájem podle předpisu za měsíce, které už nastaly. Čistý příjem z něj odečte část předpisu SVJ, kterou nese pronajímatel (fond oprav, odměny výboru, pojištění domu), podle odečitatelné částky z evidenčního listu za tytéž měsíce. Údržba a opravy bytu se neevidují, v čísle nejsou.</Hint>
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
                return (
                  <g key={r.year} tabIndex={0} role="button" aria-label={`${r.year}: ${fmtKc(v)}`}
                    onMouseEnter={() => setPicked(r.year)} onFocus={() => setPicked(r.year)} onClick={() => setPicked(r.year)} className="cursor-pointer outline-none">
                    <rect x={PAD.left + slot * i} y={PAD.top - 12} width={slot} height={H - PAD.top + 12} fill="transparent" />
                    {h > 0 && (
                      <rect x={x} y={v >= 0 ? base - h : base} width={barW} height={h} rx={4}
                        fill={v < 0 ? 'var(--late)' : 'var(--accent)'} opacity={active ? 1 : 0.85} />
                    )}
                    <text x={x + barW / 2} y={v >= 0 ? base - h - 8 : base - 8} textAnchor="middle" fontSize="12" fontWeight={active ? 600 : 500} fill="var(--ink)">{short(v)}</text>
                    <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="12" fill={active ? 'var(--ink)' : 'var(--soft)'} fontWeight={active ? 600 : 400}>{r.year}{r.year === thisYear ? '*' : ''}</text>
                  </g>
                );
              })}
            </svg>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-soft">
              {rows.some(r => r.year === thisYear) && <span>* letošní rok zatím</span>}
            </div>
            {shown && (
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-t border-rule pt-3 text-sm">
                <dt className="text-soft">Rok</dt><dd className="m-0 text-right font-semibold">{shown.year}</dd>
                <dt className="text-soft">Nájem (předpis)</dt><dd className="m-0 text-right font-medium">{fmtKc(shown.rent)}</dd>
                <dt className="text-soft">Položky SVJ za pronajímatele</dt>
                <dd className={cn('m-0 text-right font-medium', shown.landlordSvj === 0 && 'text-soft')}>{shown.landlordSvj === 0 ? '—' : fmtKcSigned(-shown.landlordSvj)}</dd>
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
