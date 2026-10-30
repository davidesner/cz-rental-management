import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import { korunToHalerOrNull, parseKorun, toKorunInput } from '@/lib/money';
import { fmtDateTime, fmtKcExact } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KV, KVRow } from '@/components/ui/kv';
import { Modal } from '@/components/ui/modal';
import { Status } from '@/components/ui/status';
import { Hint } from '@/components/ui/hint';

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

const AMOUNT_HELP = 'Částka musí být číslo v korunách, např. 35000 nebo 35000,50. '
  + 'Pro „cokoliv" nech pole prázdné.';

function HealthValue({ health }: { health: PairingHealth }) {
  if (health.state === 'chyba') {
    return (
      <div>
        <Status tone="late">Chyba</Status>
        {health.message && <div className="mt-0.5 max-w-[16rem] break-words text-sm font-normal text-late">{health.message}</div>}
      </div>
    );
  }
  if (health.state === 'ok') {
    return (
      <div>
        <Status tone="ok">Vše v pořádku</Status>
        {health.lastSyncAt && <div className="text-sm font-normal text-soft">naposledy {fmtDateTime(health.lastSyncAt)}</div>}
      </div>
    );
  }
  return (
    <div>
      <Status tone="wait">Nenastaveno</Status>
      <div className="text-sm font-normal text-soft">Chybí pravidlo nebo aktivní bankovní integrace.</div>
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
    // Gated on `rule` existing, NOT on the field being null. `rule?.amountFrom
    // ?? suggested?.from` would populate an EXISTING rule's deliberately-unset
    // bound with a computed suggestion — and since the suggestion is
    // indistinguishable from a real value in the input, saving without touching
    // it silently narrows the rule from "any amount" to a band, changing which
    // payments match.
    amountFrom: rule ? toKorunInput(rule.amountFrom) : toKorunInput(suggested?.from ?? null),
    amountTo: rule ? toKorunInput(rule.amountTo) : toKorunInput(suggested?.to ?? null),
    active: rule?.active ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const blank = (s: string) => (s.trim() === '' ? null : s.trim());

  // An empty bound legitimately means "cokoliv" and goes to the API as null. An
  // UNPARSEABLE one must never take the same path: the API cannot tell the two
  // apart, so a typo in „Částka od" would silently widen the rule from a band to
  // every payment in the org.
  const amountFrom = parseKorun(form.amountFrom);
  const amountTo = parseKorun(form.amountTo);
  const badAmount = amountFrom.kind === 'invalid' || amountTo.kind === 'invalid';

  const save = useMutation({
    mutationFn: () => api.put<{ rule: PaymentRule }>(`/api/contracts/${contractId}/payment-rule`, {
      counterpartyAccount: blank(form.counterpartyAccount),
      vs: blank(form.vs),
      ks: blank(form.ks),
      ss: blank(form.ss),
      amountFrom: korunToHalerOrNull(amountFrom),
      amountTo: korunToHalerOrNull(amountTo),
      active: form.active,
    }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: unknown) => setErr(apiErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/api/contracts/${contractId}/payment-rule`),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: unknown) => setErr(apiErrorMessage(e)),
  });

  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal
      title="Párování plateb"
      description={'Prázdné pole znamená „cokoliv“. Platba se spáruje, když vyhoví všem vyplněným kritériím.'}
      onClose={onClose}
      className="max-w-lg"
      footer={<>
        {rule && (
          <Button
            variant="outline"
            className="mr-auto"
            disabled={remove.isPending}
            onClick={() => { if (confirm('Smazat pravidlo párování?')) { setErr(null); remove.mutate(); } }}
          >Smazat pravidlo</Button>
        )}
        <Button variant="outline" onClick={onClose}>Zrušit</Button>
        <Button
          disabled={save.isPending || badAmount}
          onClick={() => {
            setErr(null);
            if (badAmount) { setErr(AMOUNT_HELP); return; }
            save.mutate();
          }}
        >
          {save.isPending ? 'Ukládám…' : 'Uložit'}
        </Button>
      </>}
    >
      <div>
        <Label htmlFor="pr-account">Číslo účtu plátce</Label>
        <Input
          id="pr-account"
          value={form.counterpartyAccount}
          placeholder="např. 294153028/0300"
          onChange={e => set('counterpartyAccount')(e.target.value)}
        />
        <p className="mt-1 text-xs text-soft">
          Předčíslí je významné: <code>123-294153028/0300</code> se nespáruje s <code>294153028/0300</code>.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="pr-vs">Variabilní symbol</Label>
          <Input id="pr-vs" value={form.vs} onChange={e => set('vs')(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pr-ss">Specifický symbol</Label>
          <Input id="pr-ss" value={form.ss} onChange={e => set('ss')(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pr-ks">Konstantní symbol</Label>
          <Input id="pr-ks" value={form.ks} onChange={e => set('ks')(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 flex items-center gap-1.5"><Label htmlFor="pr-from" className="mb-0">Částka od (Kč)</Label><Hint label="K čemu je rozmezí částky">Platba z banky se k pronájmu přiřadí jen tehdy, když její částka leží v tomto rozmezí a sedí i ostatní vyplněná kritéria. Prázdné pole znamená jakoukoliv částku.</Hint></div>
          <Input id="pr-from" value={form.amountFrom} onChange={e => set('amountFrom')(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pr-to">Částka do (Kč)</Label>
          <Input id="pr-to" value={form.amountTo} onChange={e => set('amountTo')(e.target.value)} />
        </div>
      </div>
      {badAmount && (
        <p className="text-sm text-late">{AMOUNT_HELP}</p>
      )}
      {suggested && !rule && expectedMonthlyTotal !== null && (
        <p className="text-xs text-soft">
          Předvyplněno z aktuálního měsíčního předpisu ({fmtKcExact(expectedMonthlyTotal)}) ±10 %.
        </p>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
        Párovat automaticky
      </label>

      {err && <p className="text-sm text-late">{err}</p>}
    </Modal>
  );
}

export function PairingCard({ contractId, expectedMonthlyTotal }: { contractId: string; expectedMonthlyTotal: number | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, isError, refetch } = useQuery({
    queryKey: ['payment-rule', contractId],
    queryFn: () => api.get<RuleResponse>(`/api/contracts/${contractId}/payment-rule`),
  });

  const rule = data?.rule ?? null;
  const show = (v: string | null) => v ?? <span className="font-normal text-soft">{ANY}</span>;
  const amount = (v: number | null) => !rule ? <span className="font-normal text-soft">—</span> : v === null ? <span className="font-normal text-soft">{ANY}</span> : fmtKcExact(v);

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <CardTitle>Párování plateb</CardTitle>
          {data && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              {rule ? 'Upravit' : 'Nastavit'}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isError && !data ? (
            <div>
              <p className="mb-3 text-sm text-late">Nepodařilo se načíst data.</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Zkusit znovu</Button>
            </div>
          ) : !data ? (
            <p className="text-sm text-soft">Načítání…</p>
          ) : (
            <>
              <KV>
                <KVRow label="Stav"><HealthValue health={data.health} /></KVRow>
                <KVRow label="Částka od">{amount(rule?.amountFrom ?? null)}</KVRow>
                <KVRow label="Částka do">{amount(rule?.amountTo ?? null)}</KVRow>
                {rule && (
                  <>
                    <KVRow label="Číslo účtu">{show(rule.counterpartyAccount)}</KVRow>
                    <KVRow label="Variabilní symbol">{show(rule.vs)}</KVRow>
                    <KVRow label="Specifický symbol">{show(rule.ss)}</KVRow>
                    <KVRow label="Konstantní symbol">{show(rule.ks)}</KVRow>
                  </>
                )}
              </KV>
              {!rule && (
                <p className="mt-3 border-t border-rule pt-3 text-sm text-soft">
                  Bez pravidla se platby k tomuto pronájmu nespárují automaticky a zůstanou v Nastavení mezi nepřiřazenými platbami.
                </p>
              )}
            </>
          )}
        </CardContent>
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
