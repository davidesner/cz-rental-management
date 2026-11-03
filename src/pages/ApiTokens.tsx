import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Notice } from '@/components/ui/notice';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableEmpty, TableError } from '@/components/ui/table-error';

interface ApiToken {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export function ApiTokensPanel() {
  const qc = useQueryClient();
  const { data, isError, refetch } = useQuery({
    queryKey: ['api-tokens'],
    queryFn: () => api.get<{ tokens: ApiToken[] }>('/api/api-tokens'),
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ token: string; apiToken: ApiToken }>('/api/api-tokens', { name }),
    onSuccess: (result) => {
      setOpen(false);
      setName('');
      setIssuedToken(result.token);
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
    },
    onError: (e: unknown) => setErr(apiErrorMessage(e)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/api-tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens'] }),
  });

  return (
    <>
      {/* One-time issued token alert */}
      {issuedToken && (
        <Notice kind="ok" onClose={() => setIssuedToken(null)}>
          <div className="font-semibold">Ulož si tento token, podruhé se nezobrazí.</div>
          <code className="mt-1 block select-all break-all text-[13px]">{issuedToken}</code>
        </Notice>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>API tokeny</CardTitle>
            <CardDescription>Přístup k REST API pro skripty a starší stdio MCP server.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => { setErr(null); setOpen(true); }}><Plus className="h-3.5 w-3.5" strokeWidth={2.2} />Nový token</Button>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Název</TableHead>
              <TableHead>Naposledy použit</TableHead>
              <TableHead>Vytvořen</TableHead>
              <TableHead><span className="sr-only">Akce</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError && !data ? (
              <TableError cols={4} onRetry={() => refetch()} />
            ) : !data ? (
              <TableSkeleton cols={4} />
            ) : data.tokens.length === 0 ? (
              <TableEmpty cols={4}>Zatím žádné API tokeny.</TableEmpty>
            ) : (
              data.tokens.map(t => (
                <TableRow key={t.id} className="rem">
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{t.lastUsedAt ? fmtDateTime(t.lastUsedAt) : <span className="text-soft">nikdy</span>}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDateTime(t.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      className="acts text-sm text-soft hover:text-late disabled:opacity-50"
                      onClick={() => {
                        if (confirm(`Odvolat token „${t.name}"?`)) revoke.mutate(t.id);
                      }}
                      disabled={revoke.isPending}
                    >
                      Odvolat
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {open && (
        <Modal
          title="Nový API token"
          onClose={() => setOpen(false)}
          footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
            <Button onClick={() => create.mutate()} disabled={!name || create.isPending}>Vytvořit</Button>
          </>}
        >
          <div>
            <Label htmlFor="tok-name">Název</Label>
            <Input id="tok-name" value={name} onChange={e => setName(e.target.value)} placeholder="např. skript na vyúčtování" />
          </div>
          {err && <p className="text-sm text-late">{err}</p>}
        </Modal>
      )}
    </>
  );
}
