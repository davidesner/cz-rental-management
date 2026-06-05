import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ApiToken {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export function ApiTokensPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
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
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/api-tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens'] }),
  });

  const tokens = data?.tokens ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">API tokens</h1>
        <Button onClick={() => { setErr(null); setOpen(true); }}>New token</Button>
      </div>

      {/* One-time issued token alert */}
      {issuedToken && (
        <Card className="p-4 border-green-500 bg-green-50 space-y-2">
          <p className="font-semibold text-green-800">Save this token now — it won't be shown again:</p>
          <p className="font-mono text-sm break-all text-green-900">{issuedToken}</p>
          <Button size="sm" variant="outline" onClick={() => setIssuedToken(null)}>Dismiss</Button>
        </Card>
      )}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map(t => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>{t.lastUsedAt ?? '—'}</TableCell>
                <TableCell>{t.createdAt}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (confirm(`Revoke token "${t.name}"?`)) revoke.mutate(t.id);
                    }}
                    disabled={revoke.isPending}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {tokens.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No API tokens yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">New API token</h2>
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. ci-deploy" />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!name || create.isPending}>Create</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
