import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PaymentRule {
  id: string;
  counterpartyAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
  amountFrom: number | null;
  amountTo: number | null;
  active: boolean;
}

interface PairingHealth {
  state: 'nenastaveno' | 'ok' | 'chyba';
  message: string | null;
  lastSyncAt: string | null;
}

interface RuleResponse {
  rule: PaymentRule | null;
  health: PairingHealth;
}

const ANY = 'cokoliv';

function fmtKc(halere: number | null): string {
  if (halere === null) return '—';
  return `${(halere / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč`;
}

/** Haléře → an editable korun string, e.g. 3500000 → "35000,00". */
function toKorunInput(halere: number | null): string {
  if (halere === null) return '';
  return (halere / 100).toFixed(2).replace('.', ',');
}

/** Korun string → haléře. Integer arithmetic; never a float amount. */
function toHaler(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const normalised = trimmed.replace(/\s/g, '').replace(',', '.');
  const value = Number.parseFloat(normalised);
  if (Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

function HealthField({ health }: { health: PairingHealth }) {
  const { label, tone } = health.state === 'chyba'
    ? { label: 'Chyba', tone: 'text-red-700' }
    : health.state === 'ok'
      ? { label: 'Vše v pořádku', tone: 'text-green-700' }
      : { label: 'Nenastaveno', tone: 'text-muted-foreground' };
  return (
    <div>
      <span className="text-muted-foreground text-sm">Stav</span>
      <p className={`font-medium ${tone}`}>{label}</p>
      {health.state === 'chyba' && health.message && (
        <p className="text-xs text-red-700 mt-1 break-words">{health.message}</p>
      )}
      {health.state === 'ok' && health.lastSyncAt && (
        <p className="text-xs text-muted-foreground mt-1">
          naposledy {new Date(health.lastSyncAt).toLocaleString('cs-CZ')}
        </p>
      )}
      {health.state === 'nenastaveno' && (
        <p className="text-xs text-muted-foreground mt-1">
          Chybí pravidlo nebo aktivní bankovní integrace.
        </p>
      )}
    </div>
  );
}

interface DialogProps {
  contractId: string;
  rule: PaymentRule | null;
  expectedMonthlyTotal: number | null;
  onClose: () => void;
  onSaved: () => void;
}

function PairingDialog({ contractId, rule, expectedMonthlyTotal, onClose, onSaved }: DialogProps) {
  // Prefill the band from the contract's own expected monthly total ±10 %,
  // rounded to whole korun — the number the detail page already shows. Fully
  // editable; it is a starting point, not a constraint.
  const suggested = expectedMonthlyTotal === null ? null : {
    from: Math.round((expectedMonthlyTotal * 0.9) / 100) * 100,
    to: Math.round((expectedMonthlyTotal * 1.1) / 100) * 100,
  };

  const [form, setForm] = useState({
    counterpartyAccount: rule?.counterpartyAccount ?? '',
    vs: rule?.vs ?? '',
    ks: rule?.ks ?? '',
    ss: rule?.ss ?? '',
    amountFrom: toKorunInput(rule?.amountFrom ?? suggested?.from ?? null),
    amountTo: toKorunInput(rule?.amountTo ?? suggested?.to ?? null),
    active: rule?.active ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const blank = (s: string) => (s.trim() === '' ? null : s.trim());

  const save = useMutation({
    mutationFn: () => api.put<{ rule: PaymentRule }>(`/api/contracts/${contractId}/payment-rule`, {
      counterpartyAccount: blank(form.counterpartyAccount),
      vs: blank(form.vs),
      ks: blank(form.ks),
      ss: blank(form.ss),
      amountFrom: toHaler(form.amountFrom),
      amountTo: toHaler(form.amountTo),
      active: form.active,
    }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/api/contracts/${contractId}/payment-rule`),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold">Párování plateb</h2>
        <p className="text-sm text-muted-foreground">
          Prázdné pole znamená „cokoliv". Platba se spáruje, když vyhoví všem vyplněným kritériím.
        </p>

        <div>
          <Label>Číslo účtu plátce</Label>
          <Input
            value={form.counterpartyAccount}
            placeholder="např. 294153028/0300"
            onChange={e => set('counterpartyAccount')(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Předčíslí je významné — <code>123-294153028/0300</code> se nespáruje s <code>294153028/0300</code>.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Variabilní symbol</Label>
            <Input value={form.vs} onChange={e => set('vs')(e.target.value)} />
          </div>
          <div>
            <Label>Konstantní symbol</Label>
            <Input value={form.ks} onChange={e => set('ks')(e.target.value)} />
          </div>
          <div>
            <Label>Specifický symbol</Label>
            <Input value={form.ss} onChange={e => set('ss')(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Částka od (Kč)</Label>
            <Input value={form.amountFrom} onChange={e => set('amountFrom')(e.target.value)} />
          </div>
          <div>
            <Label>Částka do (Kč)</Label>
            <Input value={form.amountTo} onChange={e => set('amountTo')(e.target.value)} />
          </div>
        </div>
        {suggested && !rule && (
          <p className="text-xs text-muted-foreground">
            Předvyplněno z aktuálního měsíčního předpisu ({fmtKc(expectedMonthlyTotal)}) ±10 %.
          </p>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
          Párovat automaticky
        </label>

        {err && <p className="text-sm text-destructive">{err}</p>}

        <div className="flex justify-between">
          <div>
            {rule && (
              <Button
                variant="outline"
                disabled={remove.isPending}
                onClick={() => { if (confirm('Smazat pravidlo párování?')) { setErr(null); remove.mutate(); } }}
              >Smazat pravidlo</Button>
            )}
          </div>
          <div className="space-x-2">
            <Button variant="outline" onClick={onClose}>Zrušit</Button>
            <Button disabled={save.isPending} onClick={() => { setErr(null); save.mutate(); }}>
              {save.isPending ? 'Ukládám…' : 'Uložit'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function PairingCard({ contractId, expectedMonthlyTotal }: { contractId: string; expectedMonthlyTotal: number | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, isError, refetch } = useQuery({
    queryKey: ['payment-rule', contractId],
    queryFn: () => api.get<RuleResponse>(`/api/contracts/${contractId}/payment-rule`),
  });

  if (isError && !data) {
    return (
      <Card className="p-6 space-y-3">
        <h2 className="text-lg font-semibold">Párování plateb</h2>
        <p className="text-sm text-destructive">Nepodařilo se načíst data.</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>Zkusit znovu</Button>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-3">Párování plateb</h2>
        <p className="text-sm text-muted-foreground">Načítání…</p>
      </Card>
    );
  }

  const { rule, health } = data;
  const show = (v: string | null) => v ?? ANY;

  return (
    <>
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Párování plateb</h2>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {rule ? 'Upravit' : 'Nastavit'}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-3">
          <HealthField health={health} />
          <div>
            <span className="text-muted-foreground text-sm">Částka od</span>
            <p className="font-medium">{rule ? fmtKc(rule.amountFrom) : '—'}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-sm">Částka do</span>
            <p className="font-medium">{rule ? fmtKc(rule.amountTo) : '—'}</p>
          </div>
        </div>

        {rule ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 border-t pt-4">
            <div>
              <span className="text-muted-foreground text-xs">Číslo účtu</span>
              <p className="font-medium text-sm">{show(rule.counterpartyAccount)}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Variabilní symbol</span>
              <p className="font-medium text-sm">{show(rule.vs)}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Specifický symbol</span>
              <p className="font-medium text-sm">{show(rule.ss)}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Konstantní symbol</span>
              <p className="font-medium text-sm">{show(rule.ks)}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground border-t pt-4">
            Bez pravidla se platby k tomuto pronájmu nespárují automaticky —
            zůstanou v Nastavení → Nepřiřazené platby.
          </p>
        )}
      </Card>

      {open && (
        <PairingDialog
          contractId={contractId}
          rule={rule}
          expectedMonthlyTotal={expectedMonthlyTotal}
          onClose={() => setOpen(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['payment-rule', contractId] })}
        />
      )}
    </>
  );
}
