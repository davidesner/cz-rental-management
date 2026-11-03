import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { KV, KVRow } from '@/components/ui/kv';
import { Status } from '@/components/ui/status';
import { leaseEnd, type ContractListRow, type CurrentTerms } from '@/hooks/useContracts';
import type { DebtRow } from '@/hooks/useDashboard';
import { fmtDate, fmtKc, fmtRange, plural } from '@/lib/format';
import { kindLabel } from './labels';

interface CurrentLeaseCardProps {
  /** The lease running today, or the next one to start. */
  lease: ContractListRow | null;
  upcoming: boolean;
  terms: CurrentTerms | undefined;
  debt: DebtRow | undefined;
  loaded: boolean;
  className?: string;
}

/** Who rents the property now, what they pay each month and whether they owe anything. */
export function CurrentLeaseCard({ lease, upcoming, terms, debt, loaded, className }: CurrentLeaseCardProps) {
  const dash = <span className="text-soft">—</span>;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{upcoming ? 'Nadcházející pronájem' : 'Aktuální pronájem'}</CardTitle>
        {lease && <CardDescription>{fmtRange(lease.startDate, leaseEnd(lease), 'na dobu neurčitou')}</CardDescription>}
      </CardHeader>
      <CardContent>
        {!loaded ? (
          <p className="text-sm text-soft">Načítání…</p>
        ) : !lease ? (
          <p className="text-sm text-soft">Nemovitost je volná. Nový pronájem založíš v <Link to="/contracts">seznamu pronájmů</Link>.</p>
        ) : (
          <KV>
            <KVRow label="Nájemce"><Link to={`/contracts/${lease.id}`} className="text-ink">{lease.tenantName}</Link></KVRow>
            {terms === undefined ? (
              <KVRow label="Měsíčně"><span className="text-wait">…</span></KVRow>
            ) : terms.term === null ? (
              <KVRow label="Měsíčně" className="font-normal">{dash}</KVRow>
            ) : (
              <>
                <KVRow label="Nájem">{fmtKc(terms.term.baseRent)}</KVRow>
                <KVRow label="Záloha na služby">{fmtKc(terms.term.serviceAdvance)}</KVRow>
                {terms.utilities.map(u => <KVRow key={u.id} label={kindLabel(u.kind)}>{fmtKc(u.monthlyAdvance)}</KVRow>)}
                <KVRow label="Měsíčně celkem" sum className="font-semibold">{fmtKc(terms.monthlyTotal ?? 0)}</KVRow>
                <KVRow label={<span className="inline-flex items-center gap-1">Splatnost<Hint label="Jak se počítá splatnost">{terms.term.paymentAppliesTo === 'next' ? 'Platba se posílá měsíc dopředu: v tomto dni se platí na následující měsíc.' : 'V tomto dni se platí nájem za běžný měsíc.'}</Hint></span>} className="font-normal">
                  {terms.term.paymentDueDay}. den v měsíci
                </KVRow>
              </>
            )}
            <KVRow label="Kauce" className={lease.securityDeposit ? undefined : 'font-normal'}>{lease.securityDeposit ? fmtKc(lease.securityDeposit) : dash}</KVRow>
            {!upcoming && (
              <KVRow label="Dluh po splatnosti" sum className={debt ? 'text-late' : 'font-normal'}>
                {debt
                  ? <Link to={`/contracts/${lease.id}?tab=platby`} className="text-late">{fmtKc(debt.debt)} <span className="text-sm font-normal">({plural(debt.lateDays, 'den', 'dny', 'dní')})</span></Link>
                  : <Status tone="ok">žádný</Status>}
              </KVRow>
            )}
            {upcoming && <KVRow label="Začíná" className="font-normal">{fmtDate(lease.startDate)}</KVRow>}
          </KV>
        )}
      </CardContent>
    </Card>
  );
}
