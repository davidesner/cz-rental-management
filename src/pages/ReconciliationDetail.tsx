import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';

interface ReconciliationItem {
  kind: string;
  paid: number;
  actualCost: number;
  difference: number;
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
  return (halere / 100).toFixed(2) + ' Kč';
}

export function ReconciliationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['reconciliations', id],
    queryFn: () => api.get<{ reconciliation: Reconciliation }>(`/api/reconciliations/${id}`),
    enabled: !!id,
  });

  const finalize = useMutation({
    mutationFn: () => api.patch<{ reconciliation: Reconciliation }>(`/api/reconciliations/${id}/finalize`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reconciliations', id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete<void>(`/api/reconciliations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reconciliations'] });
      window.location.href = '/reconciliations';
    },
  });

  const r = data?.reconciliation;
  const items = r?.items ?? [];
  const totalDiff = items.reduce((sum, i) => sum + i.difference, 0);

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
            {items.map((item, idx) => (
              <TableRow key={idx}>
                <TableCell>{item.kind}</TableCell>
                <TableCell className="text-right">{fmtKc(item.paid)}</TableCell>
                <TableCell className="text-right">{fmtKc(item.actualCost)}</TableCell>
                <TableCell className={`text-right font-medium ${item.difference < 0 ? 'text-destructive' : 'text-green-600'}`}>
                  {fmtKc(item.difference)}
                </TableCell>
              </TableRow>
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
                <TableCell colSpan={3} className="font-medium">Celkový rozdíl</TableCell>
                <TableCell className={`text-right font-bold ${totalDiff < 0 ? 'text-destructive' : 'text-green-600'}`}>
                  {fmtKc(totalDiff)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </Card>

      {r.status === 'draft' && (
        <div className="flex gap-3">
          <Button
            onClick={() => finalize.mutate()}
            disabled={finalize.isPending}
          >
            Finalizovat
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (confirm('Smazat toto vyúčtování?')) deleteMutation.mutate();
            }}
            disabled={deleteMutation.isPending}
          >
            Smazat
          </Button>
        </div>
      )}
    </div>
  );
}
