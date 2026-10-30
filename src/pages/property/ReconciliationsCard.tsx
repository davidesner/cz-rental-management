import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Status } from '@/components/ui/status';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableEmpty, TableError } from '@/components/ui/table-error';
import type { ContractListRow } from '@/hooks/useContracts';
import { fmtDate, fmtDateTime, fmtKcSigned } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Reconciliation {
  id: string;
  contractId: string;
  periodFrom: string;
  periodTo: string;
  status: string;
  computedAt: string | null;
  items: Array<{ kind: string; difference: number }>;
}

const STATUS_LABEL: Record<string, { label: string; tone: 'ok' | 'wait' | 'soft' }> = {
  draft: { label: 'Návrh', tone: 'wait' },
  finalized: { label: 'Finalizováno', tone: 'ok' },
};

/** Every annual statement ever made for the property, across all its leases. */
export function ReconciliationsCard({ leases, leasesLoaded }: { leases: ContractListRow[]; leasesLoaded: boolean }) {
  const queries = useQueries({
    queries: leases.map(c => ({
      queryKey: ['reconciliations-by-contract', c.id],
      queryFn: () => api.get<{ reconciliations: Reconciliation[] }>(`/api/reconciliations?contractId=${c.id}`),
    })),
  });
  const isPending = !leasesLoaded || queries.some(q => q.isPending);
  const isError = queries.some(q => q.isError && !q.data);
  const rows = queries
    .flatMap((q, i) => (q.data?.reconciliations ?? []).map(r => ({ r, lease: leases[i]! })))
    .sort((a, b) => b.r.periodFrom.localeCompare(a.r.periodFrom));
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Vyúčtování nájemcům</CardTitle>
        <CardDescription>Roční porovnání zaplacených záloh se skutečnými náklady, napříč všemi pronájmy.</CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Období</TableHead>
            <TableHead>Nájemce</TableHead>
            <TableHead>Stav</TableHead>
            <TableHead className="num">Celkový rozdíl</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isError ? (
            <TableError cols={4} onRetry={() => queries.forEach(q => q.refetch())} />
          ) : isPending ? (
            <TableSkeleton cols={4} rows={2} />
          ) : rows.length === 0 ? (
            <TableEmpty cols={4}>{leases.length === 0 ? 'Bez pronájmu není co vyúčtovat.' : 'Zatím žádné vyúčtování. Spočítá se z detailu pronájmu.'}</TableEmpty>
          ) : rows.map(({ r, lease }) => {
            const totalDiff = (r.items ?? []).reduce((s, i) => s + i.difference, 0);
            const st = STATUS_LABEL[r.status] ?? { label: r.status, tone: 'soft' as const };
            return (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap"><Link to={`/reconciliations/${r.id}`} className="font-medium text-ink">{fmtDate(r.periodFrom)} až {fmtDate(r.periodTo)}</Link></TableCell>
                <TableCell><Link to={`/contracts/${lease.id}`} className="text-ink">{lease.tenantName}</Link></TableCell>
                <TableCell>
                  <Status tone={st.tone}>{st.label}</Status>
                  {r.computedAt && <div className="text-sm text-soft">spočítáno {fmtDateTime(r.computedAt)}</div>}
                </TableCell>
                <TableCell className={cn('num font-semibold', totalDiff < 0 ? 'text-late' : totalDiff > 0 ? 'text-accent' : 'text-soft')}>
                  {fmtKcSigned(totalDiff)}
                  <div className="text-sm font-normal text-soft">{totalDiff > 0 ? 'vrátit nájemci' : totalDiff < 0 ? 'nájemce doplácí' : 'vyrovnáno'}</div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
