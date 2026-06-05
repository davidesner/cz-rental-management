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

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!r) return <div className="p-8 text-muted-foreground">Not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/reconciliations" className="text-sm text-muted-foreground hover:underline">← Reconciliations</Link>
        <h1 className="text-3xl font-bold">Reconciliation</h1>
      </div>

      <Card className="p-6 space-y-2">
        <p><span className="font-medium">Contract:</span> {r.contractId}</p>
        <p><span className="font-medium">Period:</span> {r.periodFrom} – {r.periodTo}</p>
        <p><span className="font-medium">Status:</span> {r.status}</p>
        {r.computedAt && <p><span className="font-medium">Computed at:</span> {r.computedAt}</p>}
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Actual cost</TableHead>
              <TableHead className="text-right">Difference</TableHead>
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
                <TableCell colSpan={4} className="text-center text-muted-foreground py-6">No items.</TableCell>
              </TableRow>
            )}
          </TableBody>
          {items.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-medium">Total difference</TableCell>
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
            Finalize
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (confirm('Delete this reconciliation?')) deleteMutation.mutate();
            }}
            disabled={deleteMutation.isPending}
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}
