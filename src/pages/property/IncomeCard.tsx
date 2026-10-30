import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Figure, PeriodPicker, periodLabel } from '@/pages/Dashboard';
import type { Period, useDashboard } from '@/hooks/useDashboard';
import { fmtKc } from '@/lib/format';
import { cn } from '@/lib/utils';

interface IncomeCardProps {
  period: Period;
  onPeriod: (p: Period) => void;
  data: ReturnType<typeof useDashboard>;
  /** Whether any lease of the property has started; decides the empty wording. */
  hasLeases: boolean;
  className?: string;
}

/** The dashboard's income summary, scoped to one property. */
export function IncomeCard({ period, onPeriod, data: d, hasLeases, className }: IncomeCardProps) {
  const { income } = d;
  const paidPct = income.expected > 0 ? Math.round((income.paid / income.expected) * 100) : 0;
  const nothingExpected = !d.isPending && income.expected === 0;
  return (
    <Card className={className}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Příjmy z pronájmu</CardTitle>
        <PeriodPicker period={period} onChange={onPeriod} />
      </CardHeader>
      <CardContent>
        {d.isError ? (
          <div>
            <p className="mb-3 text-sm text-late">Nepodařilo se načíst data.</p>
            <Button size="sm" variant="outline" onClick={d.refetch}>Zkusit znovu</Button>
          </div>
        ) : nothingExpected ? (
          <p className="py-4 text-sm text-soft">Za {periodLabel(period)} není žádný předpis.{hasLeases ? '' : ' Nemovitost zatím nikdo nepronajímal.'}</p>
        ) : (
          <>
            <div className={cn('grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4', d.isPending && 'opacity-50')}>
              <Figure dot="bg-accent" label="Uhrazeno" value={fmtKc(income.paid)} sub={`z toho zálohy ${fmtKc(income.paidAdvances)}`} />
              <Figure dot="bg-late" label="Po splatnosti" value={fmtKc(income.overdue)} sub={`z toho zálohy ${fmtKc(income.overdueAdvances)}`} tone={income.overdue > 0 ? 'text-late' : undefined} />
              <Figure dot="bg-wait" label="Před splatností" value={fmtKc(income.upcoming)} sub={`z toho zálohy ${fmtKc(income.upcomingAdvances)}`} />
            </div>
            <div role="img" aria-label={`Z předpisu ${fmtKc(income.expected)} je uhrazeno ${paidPct} procent`} className="mt-4 flex h-2 gap-[3px]">
              {income.paid > 0 && <div className="rounded-full bg-accent" style={{ flex: income.paid }} />}
              {income.overdue > 0 && <div className="rounded-full bg-late" style={{ flex: income.overdue }} />}
              {income.upcoming > 0 && <div className="rounded-full bg-wait" style={{ flex: income.upcoming }} />}
            </div>
            <div className="mt-2 text-sm text-soft">Předpis {fmtKc(income.expected)}, uhrazeno {paidPct} %</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
