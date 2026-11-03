import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { fmtKc, fmtRange } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NewContractDialog } from './contract/NewContractDialog';
import { Seg } from '@/components/ui/seg';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableEmpty, TableError } from '@/components/ui/table-error';
import { isEndedContract, leaseEnd, useContracts, useCurrentTermsMap, type ContractListRow } from '@/hooks/useContracts';
import { renewalNote } from './contract/ContractEditDialog';

type Filter = 'active' | 'ended' | 'all';

export function ContractsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isError, refetch } = useContracts();
  const [filter, setFilter] = useState<Filter>('active');
  const [open, setOpen] = useState(false);

  const all = data?.contracts ?? [];
  const { map: termsMap } = useCurrentTermsMap(all.map(c => c.id));

  // "Aktivní" is everything not yet over, so a lease signed for next month is
  // listed with the running ones rather than hidden among the ended.
  const matches = (c: ContractListRow) => filter === 'all' ? true : filter === 'active' ? !isEndedContract(c) : isEndedContract(c);
  const rows = all.filter(matches).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const counts = { active: all.filter(c => !isEndedContract(c)).length, ended: all.filter(c => isEndedContract(c)).length };

  const empty = filter === 'active' ? 'Žádný běžící pronájem.' : filter === 'ended' ? 'Žádný ukončený pronájem.' : 'Zatím žádné pronájmy.';

  return (
    <>
      <PageHeader
        title="Pronájmy"
        actions={<>
          <Seg
            label="Filtr pronájmů"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active', label: data ? `Aktivní (${counts.active})` : 'Aktivní' },
              { value: 'ended', label: data ? `Ukončené (${counts.ended})` : 'Ukončené' },
              { value: 'all', label: 'Všechny' },
            ]}
          />
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" strokeWidth={2.2} />Nový pronájem</Button>
        </>}
      />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nájemce</TableHead>
              <TableHead>Nemovitost</TableHead>
              <TableHead className="num">Výše nájmu</TableHead>
              <TableHead>Období</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError && !data ? (
              <TableError cols={4} onRetry={() => refetch()} />
            ) : !data ? (
              <TableSkeleton cols={4} />
            ) : rows.length === 0 ? (
              <TableEmpty cols={4}>{empty}</TableEmpty>
            ) : (
              rows.map(c => {
                const t = termsMap[c.id];
                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/contracts/${c.id}`)}
                  >
                    <TableCell>
                      <Link to={`/contracts/${c.id}`} className="font-medium text-ink" onClick={e => e.stopPropagation()}>{c.tenantName}</Link>
                    </TableCell>
                    <TableCell>
                      <Link to={`/properties/${c.propertyId}`} className="text-ink" onClick={e => e.stopPropagation()}>{c.propertyName}</Link>
                    </TableCell>
                    <TableCell className="num">
                      {t === undefined ? <span className="text-wait">…</span>
                        : t.term ? <>
                            <div>{fmtKc(t.term.baseRent)}</div>
                            {t.monthlyTotal !== null && t.monthlyTotal !== t.term.baseRent && <div className="text-sm text-soft">celkem {fmtKc(t.monthlyTotal)}</div>}
                          </>
                        : <span className="text-soft">bez podmínek</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div>{fmtRange(c.startDate, leaseEnd(c))}</div>
                      {renewalNote(c) && <div className="text-sm text-soft">{renewalNote(c)}</div>}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {open && (
        <NewContractDialog
          onClose={() => setOpen(false)}
          onCreated={(newId) => {
            qc.invalidateQueries({ queryKey: ['contracts'] });
            navigate(`/contracts/${newId}`);
          }}
        />
      )}
    </>
  );
}
