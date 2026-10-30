import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KV, KVRow } from '@/components/ui/kv';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableEmpty, TableError } from '@/components/ui/table-error';
import { useDashboard, type Period } from '@/hooks/useDashboard';
import { useReminders } from '@/hooks/useReminders';
import { useContracts } from '@/hooks/useContracts';
import { Agenda, reminderItems } from '@/components/Agenda';
import { fmtKc, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

const MONTHS_SHORT = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];

export function periodLabel(p: Period): string {
  return p.month === null ? `rok ${p.year}` : `${MONTHS[p.month - 1]} ${p.year}`;
}

export function PeriodPicker({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const [open, setOpen] = useState(false);
  const [pickYear, setPickYear] = useState(period.year);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const isCurrent = period.month === null ? period.year >= curY : (period.year > curY || (period.year === curY && period.month >= curM));
  const step = (dir: -1 | 1) => {
    if (period.month === null) { onChange({ year: period.year + dir, month: null }); return; }
    let m = period.month + dir; let y = period.year;
    if (m === 0) { m = 12; y -= 1; } else if (m === 13) { m = 1; y += 1; }
    onChange({ year: y, month: m });
  };
  const pick = (p: Period) => { onChange(p); setOpen(false); };
  const stepBtn = 'inline-flex h-8 w-8 items-center justify-center rounded-sm text-soft hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <div ref={ref} className="relative flex items-center gap-0.5">
      <button type="button" className={stepBtn} aria-label="Předchozí období" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></button>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setPickYear(period.year); setOpen(o => !o); }}
        className={cn('inline-flex h-8 items-center gap-2 rounded-sm px-2.5 font-medium hover:bg-hover', open && 'bg-hover')}
      >
        <CalendarDays className="h-[15px] w-[15px] text-soft" strokeWidth={1.8} />
        <span className="min-w-[92px] text-left">{periodLabel(period)}</span>
      </button>
      <button type="button" className={stepBtn} aria-label="Další období" onClick={() => step(1)} disabled={isCurrent}><ChevronRight className="h-4 w-4" /></button>
      {open && (
        <div role="dialog" aria-label="Vybrat období" className="absolute right-0 top-10 z-20 w-64 rounded-xl border border-line bg-card p-3 shadow-pop">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className={stepBtn} aria-label="Předchozí rok" onClick={() => setPickYear(y => y - 1)}><ChevronLeft className="h-4 w-4" /></button>
            <span className="font-semibold">{pickYear}</span>
            <button type="button" className={stepBtn} aria-label="Další rok" onClick={() => setPickYear(y => y + 1)} disabled={pickYear >= curY}><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTHS_SHORT.map((label, i) => {
              const m = i + 1;
              const disabled = pickYear > curY || (pickYear === curY && m > curM);
              const on = period.month === m && period.year === pickYear;
              return (
                <button
                  key={m}
                  type="button"
                  disabled={disabled}
                  aria-pressed={on}
                  onClick={() => pick({ year: pickYear, month: m })}
                  className={cn('h-8 rounded-sm text-sm font-medium hover:bg-hover disabled:cursor-default disabled:text-wait disabled:hover:bg-transparent', on && 'bg-accent-soft text-accent hover:bg-accent-soft')}
                >{label}</button>
              );
            })}
          </div>
          <button
            type="button"
            aria-pressed={period.month === null && period.year === pickYear}
            onClick={() => pick({ year: pickYear, month: null })}
            className={cn('mt-2 h-8 w-full rounded-sm border border-line text-sm font-medium hover:bg-hover', period.month === null && period.year === pickYear && 'bg-accent-soft text-accent hover:bg-accent-soft')}
          >Celý rok {pickYear}</button>
        </div>
      )}
    </div>
  );
}

export function Figure({ dot, label, value, sub, tone }: { dot: string; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-soft"><span className={cn('h-2 w-2 rounded-full', dot)} />{label}</div>
      <div className={cn('mt-1 text-[26px] font-semibold tracking-[-0.02em]', tone)}>{value}</div>
      {sub && <div className="text-sm text-soft">{sub}</div>}
    </div>
  );
}

export function DashboardPage() {
  const now = new Date();
  const [period, setPeriod] = useState<Period>({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const d = useDashboard(period);
  const { income, portfolio, debts } = d;
  const reminders = useReminders();
  const contracts = useContracts();
  const contractList = contracts.data?.contracts ?? [];
  const contractLabel = (id: string | null) => { const c = contractList.find(x => x.id === id); return c ? `${c.propertyName}, ${c.tenantName}` : ''; };
  const manual = reminderItems(reminders.query.data ?? [], r => r.contractId ? `/contracts/${r.contractId}` : r.propertyId ? `/properties/${r.propertyId}` : '/', r => contractLabel(r.contractId));
  const agenda = [...manual.filter(i => !i.done), ...d.agenda].sort((a, b) => a.date.localeCompare(b.date)).concat(manual.filter(i => i.done));
  const paidPct = income.expected > 0 ? Math.round((income.paid / income.expected) * 100) : 0;
  const nothingExpected = !d.isPending && income.expected === 0;

  return (
    <>
      <PageHeader
        title="Přehled"
        actions={<Button asChild><Link to="/payments?action=new"><Plus className="h-4 w-4" strokeWidth={2.2} />Nová platba</Link></Button>}
      />

      <div className="flex flex-wrap items-stretch gap-5">
        <Card className="flex-[3_1_520px]">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>Příjmy z pronájmu</CardTitle>
            <PeriodPicker period={period} onChange={setPeriod} />
          </CardHeader>
          <CardContent>
            {d.isError ? (
              <div>
                <p className="mb-3 text-sm text-late">Nepodařilo se načíst data.</p>
                <Button size="sm" variant="outline" onClick={d.refetch}>Zkusit znovu</Button>
              </div>
            ) : nothingExpected ? (
              <p className="py-4 text-sm text-soft">Za {periodLabel(period)} není žádný předpis. {d.activeContracts === 0 ? 'Zatím neběží žádný pronájem.' : ''}</p>
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

        <Card className="flex-[1_1_260px]">
          <CardHeader><CardTitle>Portfolio</CardTitle></CardHeader>
          <CardContent>
            <KV className={cn(d.isPending && 'opacity-50')}>
              <KVRow label="Nemovitosti">{portfolio.properties}</KVRow>
              <KVRow label="Obsazenost">
                {portfolio.properties > 0 ? `${Math.round((portfolio.occupied / portfolio.properties) * 100)} %` : '—'}
                {portfolio.properties > 0 && <span className="font-normal text-soft"> ({portfolio.occupied} z {portfolio.properties})</span>}
              </KVRow>
              <KVRow label="Měsíční předpis">{fmtKc(portfolio.monthlyExpected)}</KVRow>
              <KVRow label="Kauce v držení">{fmtKc(portfolio.deposits)}</KVRow>
            </KV>
          </CardContent>
        </Card>
      </div>

      <Agenda
        items={agenda}
        isPending={reminders.query.isPending || d.isPending}
        contracts={contractList.map(c => ({ id: c.id, label: `${c.propertyName}, ${c.tenantName}` }))}
        emptyText="Nic nečeká. Nájmy jsou zaplacené, platby přiřazené a žádná připomínka není otevřená."
      />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Neuhrazené pronájmy</CardTitle>
          <CardDescription>Dluh po splatnosti ke dnešku, od nejvyššího.</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nájemník a nemovitost</TableHead>
              <TableHead className="num">Dluh</TableHead>
              <TableHead>Po splatnosti</TableHead>
              <TableHead><span className="sr-only">Akce</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.isError ? (
              <TableError cols={4} onRetry={d.refetch} />
            ) : d.isPending ? (
              <TableSkeleton cols={4} rows={2} />
            ) : debts.length === 0 ? (
              <TableEmpty cols={4}>Všechny pronájmy jsou uhrazené.</TableEmpty>
            ) : debts.map(row => (
              <TableRow key={row.contractId}>
                <TableCell>
                  <Link to={`/contracts/${row.contractId}?tab=platby`} className="font-medium text-ink">{row.tenantName}</Link>
                  <div className="text-sm text-soft">{row.propertyName}</div>
                </TableCell>
                <TableCell className="num font-semibold">{fmtKc(row.debt)}</TableCell>
                <TableCell className="whitespace-nowrap text-late">{plural(row.lateDays, 'den', 'dny', 'dní')}</TableCell>
                <TableCell className="text-right"><Link to={`/contracts/${row.contractId}?tab=platby&action=new`}>Přidat platbu</Link></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
