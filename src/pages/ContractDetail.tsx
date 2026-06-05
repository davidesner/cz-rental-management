import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ContractTerm {
  id: string;
  validFrom: string;
  baseRent: number;
  serviceAdvance: number;
  source: string;
  note: string | null;
}

interface Utility {
  id: string;
  kind: string;
  validFrom: string;
  monthlyAdvance: number;
  note: string | null;
}

interface Contract {
  id: string;
  propertyId: string;
  tenantId: string;
  startDate: string;
  endDate: string | null;
  securityDeposit: number | null;
}

function fmtKc(halere: number) {
  return (halere / 100).toFixed(2) + ' Kč';
}

export function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: contractData } = useQuery({
    queryKey: ['contracts', id],
    queryFn: () => api.get<{ contract: Contract }>(`/api/contracts/${id}`),
    enabled: !!id,
  });
  const { data: termsData } = useQuery({
    queryKey: ['contracts', id, 'terms'],
    queryFn: () => api.get<{ terms: ContractTerm[] }>(`/api/contracts/${id}/terms`),
    enabled: !!id,
  });
  const { data: utilitiesData } = useQuery({
    queryKey: ['contracts', id, 'utilities'],
    queryFn: () => api.get<{ utilities: Utility[] }>(`/api/contracts/${id}/utilities`),
    enabled: !!id,
  });

  // Add terms dialog
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsForm, setTermsForm] = useState({ validFrom: '', baseRent: '', serviceAdvance: '', source: 'initial', note: '' });
  const [termsErr, setTermsErr] = useState<string | null>(null);

  const addTerms = useMutation({
    mutationFn: () => api.post<{ term: ContractTerm }>(`/api/contracts/${id}/terms`, {
      validFrom: termsForm.validFrom,
      baseRent: Math.round(parseFloat(termsForm.baseRent) * 100),
      serviceAdvance: Math.round(parseFloat(termsForm.serviceAdvance) * 100),
      source: termsForm.source,
      note: termsForm.note || null,
    }),
    onSuccess: () => {
      setTermsOpen(false);
      setTermsForm({ validFrom: '', baseRent: '', serviceAdvance: '', source: 'initial', note: '' });
      qc.invalidateQueries({ queryKey: ['contracts', id, 'terms'] });
    },
    onError: (e: unknown) => setTermsErr(e instanceof Error ? e.message : String(e)),
  });

  // Add utility dialog
  const [utilOpen, setUtilOpen] = useState(false);
  const [utilForm, setUtilForm] = useState({ kind: 'electricity', validFrom: '', monthlyAdvance: '', note: '' });
  const [utilErr, setUtilErr] = useState<string | null>(null);

  const addUtility = useMutation({
    mutationFn: () => api.post<{ utility: Utility }>(`/api/contracts/${id}/utilities`, {
      kind: utilForm.kind,
      validFrom: utilForm.validFrom,
      monthlyAdvance: Math.round(parseFloat(utilForm.monthlyAdvance) * 100),
      note: utilForm.note || null,
    }),
    onSuccess: () => {
      setUtilOpen(false);
      setUtilForm({ kind: 'electricity', validFrom: '', monthlyAdvance: '', note: '' });
      qc.invalidateQueries({ queryKey: ['contracts', id, 'utilities'] });
    },
    onError: (e: unknown) => setUtilErr(e instanceof Error ? e.message : String(e)),
  });

  const contract = contractData?.contract;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/contracts" className="text-sm text-muted-foreground hover:underline">← Contracts</Link>
        <h1 className="text-3xl font-bold">Contract detail</h1>
      </div>

      {contract && (
        <Card className="p-6 space-y-2">
          <p><span className="font-medium">Property ID:</span> {contract.propertyId}</p>
          <p><span className="font-medium">Tenant ID:</span> {contract.tenantId}</p>
          <p><span className="font-medium">Start:</span> {contract.startDate}</p>
          <p><span className="font-medium">End:</span> {contract.endDate ?? '—'}</p>
          <p><span className="font-medium">Security deposit:</span> {contract.securityDeposit != null ? fmtKc(contract.securityDeposit) : '—'}</p>
        </Card>
      )}

      {/* Terms */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Terms</h2>
          <Button size="sm" onClick={() => { setTermsErr(null); setTermsOpen(true); }}>Add terms</Button>
        </div>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Valid from</TableHead>
                <TableHead>Base rent</TableHead>
                <TableHead>Service advance</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(termsData?.terms ?? []).map(t => (
                <TableRow key={t.id}>
                  <TableCell>{t.validFrom}</TableCell>
                  <TableCell>{fmtKc(t.baseRent)}</TableCell>
                  <TableCell>{fmtKc(t.serviceAdvance)}</TableCell>
                  <TableCell>{t.source}</TableCell>
                  <TableCell>{t.note ?? '—'}</TableCell>
                </TableRow>
              ))}
              {(termsData?.terms ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">No terms yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Utilities */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Utilities</h2>
          <Button size="sm" onClick={() => { setUtilErr(null); setUtilOpen(true); }}>Add utility</Button>
        </div>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Valid from</TableHead>
                <TableHead>Monthly advance</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(utilitiesData?.utilities ?? []).map(u => (
                <TableRow key={u.id}>
                  <TableCell>{u.kind}</TableCell>
                  <TableCell>{u.validFrom}</TableCell>
                  <TableCell>{fmtKc(u.monthlyAdvance)}</TableCell>
                  <TableCell>{u.note ?? '—'}</TableCell>
                </TableRow>
              ))}
              {(utilitiesData?.utilities ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6">No utilities yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Add terms dialog */}
      {termsOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setTermsOpen(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">Add terms</h2>
            <div>
              <Label>Valid from</Label>
              <Input type="date" value={termsForm.validFrom} onChange={e => setTermsForm({ ...termsForm, validFrom: e.target.value })} />
            </div>
            <div>
              <Label>Base rent (Kč)</Label>
              <Input type="text" placeholder="0.00" value={termsForm.baseRent} onChange={e => setTermsForm({ ...termsForm, baseRent: e.target.value })} />
            </div>
            <div>
              <Label>Service advance (Kč)</Label>
              <Input type="text" placeholder="0.00" value={termsForm.serviceAdvance} onChange={e => setTermsForm({ ...termsForm, serviceAdvance: e.target.value })} />
            </div>
            <div>
              <Label>Source</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={termsForm.source}
                onChange={e => setTermsForm({ ...termsForm, source: e.target.value })}
              >
                <option value="initial">initial</option>
                <option value="addendum">addendum</option>
                <option value="change">change</option>
              </select>
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Input value={termsForm.note} onChange={e => setTermsForm({ ...termsForm, note: e.target.value })} />
            </div>
            {termsErr && <p className="text-sm text-destructive">{termsErr}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTermsOpen(false)}>Cancel</Button>
              <Button
                onClick={() => addTerms.mutate()}
                disabled={!termsForm.validFrom || !termsForm.baseRent || !termsForm.serviceAdvance || addTerms.isPending}
              >
                Add
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Add utility dialog */}
      {utilOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setUtilOpen(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold">Add utility</h2>
            <div>
              <Label>Kind</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={utilForm.kind}
                onChange={e => setUtilForm({ ...utilForm, kind: e.target.value })}
              >
                <option value="electricity">electricity</option>
                <option value="gas">gas</option>
                <option value="internet">internet</option>
                <option value="water">water</option>
                <option value="other">other</option>
              </select>
            </div>
            <div>
              <Label>Valid from</Label>
              <Input type="date" value={utilForm.validFrom} onChange={e => setUtilForm({ ...utilForm, validFrom: e.target.value })} />
            </div>
            <div>
              <Label>Monthly advance (Kč)</Label>
              <Input type="text" placeholder="0.00" value={utilForm.monthlyAdvance} onChange={e => setUtilForm({ ...utilForm, monthlyAdvance: e.target.value })} />
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Input value={utilForm.note} onChange={e => setUtilForm({ ...utilForm, note: e.target.value })} />
            </div>
            {utilErr && <p className="text-sm text-destructive">{utilErr}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setUtilOpen(false)}>Cancel</Button>
              <Button
                onClick={() => addUtility.mutate()}
                disabled={!utilForm.validFrom || !utilForm.monthlyAdvance || addUtility.isPending}
              >
                Add
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
