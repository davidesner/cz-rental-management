import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableEmpty, TableError } from '@/components/ui/table-error';
import { CostStatementDialog } from '@/pages/ContractDetail';
import { fmtDate, fmtKc, fmtKcSigned } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DocRef } from './DocRef';
import { kindLabel } from './labels';

export interface CostStatement {
  id: string;
  propertyId: string;
  kind: string;
  periodFrom: string;
  periodTo: string;
  totalAmount: number;
  adjustmentAmount: number | null;
  adjustmentNote: string | null;
  documentRef: string | null;
}

export function useCostStatements(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['cost-statements', 'property', propertyId],
    queryFn: () => api.get<{ statements: CostStatement[] }>(`/api/cost-statements?propertyId=${propertyId}`),
    enabled: !!propertyId,
  });
}

/** Real annual costs of the property per kind: what the tenant's advances are settled against. */
export function CostsCard({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
  const qc = useQueryClient();
  const statements = useCostStatements(propertyId);
  const [open, setOpen] = useState(false);
  const rows = [...(statements.data?.statements ?? [])].sort((a, b) => b.periodFrom.localeCompare(a.periodFrom) || a.kind.localeCompare(b.kind));
  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Náklady</CardTitle>
            <CardDescription>Skutečné náklady za období, jak je vyúčtovalo SVJ nebo dodavatel.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" strokeWidth={2.2} />Nový záznam</Button>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Druh</TableHead>
              <TableHead>Období</TableHead>
              <TableHead className="num">Náklady</TableHead>
              <TableHead className="num"><span className="inline-flex items-center gap-1">Úprava<Hint label="Co je úprava">Částka, o kterou se náklady upraví před porovnáním se zálohami: typicky odečet položek, které nese pronajímatel (fond oprav, pojištění domu).</Hint></span></TableHead>
              <TableHead className="num">K vyúčtování</TableHead>
              <TableHead>Doklad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statements.isError && !statements.data ? (
              <TableError cols={6} onRetry={() => statements.refetch()} />
            ) : !statements.data ? (
              <TableSkeleton cols={6} />
            ) : rows.length === 0 ? (
              <TableEmpty cols={6}>Zatím žádné vyúčtované náklady. Přidej první záznam, až přijde vyúčtování od SVJ nebo dodavatele.</TableEmpty>
            ) : rows.map(s => {
              const adj = s.adjustmentAmount ?? 0;
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{kindLabel(s.kind)}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(s.periodFrom)} až {fmtDate(s.periodTo)}</TableCell>
                  <TableCell className="num">{fmtKc(s.totalAmount)}</TableCell>
                  <TableCell className={cn('num', adj === 0 && 'text-soft')} title={s.adjustmentNote ?? undefined}>
                    {adj === 0 ? '—' : fmtKcSigned(adj)}
                    {s.adjustmentNote && <div className="max-w-[220px] truncate text-sm font-normal text-soft">{s.adjustmentNote}</div>}
                  </TableCell>
                  <TableCell className="num font-semibold">{fmtKc(s.totalAmount + adj)}</TableCell>
                  <TableCell><DocRef value={s.documentRef} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      {open && (
        <CostStatementDialog
          fixedPropertyId={propertyId}
          properties={[{ id: propertyId, name: propertyName }]}
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['cost-statements'] }); qc.invalidateQueries({ queryKey: ['cost-statements-by-property', propertyId] }); }}
        />
      )}
    </>
  );
}
