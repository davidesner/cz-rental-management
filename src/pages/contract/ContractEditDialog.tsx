import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

export interface EditableContract {
  id: string;
  startDate: string;
  endDate: string | null;
  autoRenew: boolean;
  renewalMonths: number | null;
  effectiveEndDate: string | null;
}

/** "2025-01-01 – 2026-12-31 (prodlužuje se o 12 měs., původně do 2025-12-31)" */
export function contractPeriodLabel(c: EditableContract): string {
  if (!c.autoRenew || c.endDate === null) return `${c.startDate} – ${c.endDate ?? 'běží'}`;
  const original = c.effectiveEndDate !== c.endDate ? `, původně do ${c.endDate}` : '';
  return `${c.startDate} – ${c.effectiveEndDate} (prodlužuje se o ${c.renewalMonths} měs.${original})`;
}

interface Props {
  contract: EditableContract;
  onClose: () => void;
  onUpdated: () => void;
}

export function ContractEditDialog({ contract, onClose, onUpdated }: Props) {
  const [form, setForm] = useState({
    startDate: contract.startDate,
    endDate: contract.endDate ?? '',
    autoRenew: contract.autoRenew,
    renewalMonths: contract.renewalMonths != null ? String(contract.renewalMonths) : '12',
  });
  const [err, setErr] = useState<string | null>(null);

  const renewalMonths = Number(form.renewalMonths);
  const renewalInvalid = form.autoRenew && (!Number.isInteger(renewalMonths) || renewalMonths < 1);
  const endMissing = form.autoRenew && !form.endDate;
  // Switching renewal off with the original end date untouched: the server
  // closes the lease at the end of the renewal period running today.
  const stoppingRenewal = contract.autoRenew && !form.autoRenew && form.endDate === (contract.endDate ?? '');

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        startDate: form.startDate,
        autoRenew: form.autoRenew,
        renewalMonths: form.autoRenew ? renewalMonths : contract.renewalMonths,
      };
      if (!stoppingRenewal) body.endDate = form.endDate || null;
      return api.patch(`/api/contracts/${contract.id}`, body);
    },
    onSuccess: () => { onUpdated(); onClose(); },
    onError: (e: unknown) => setErr(apiErrorMessage(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold">Upravit smlouvu</h2>
        <div>
          <Label>Datum začátku</Label>
          <Input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
        </div>
        <div>
          <Label>{form.autoRenew ? 'Konec doby určité (původní)' : 'Datum konce (volitelné)'}</Label>
          <Input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.autoRenew} onChange={e => setForm({ ...form, autoRenew: e.target.checked })} />
          Automatické prodloužení za stejných podmínek
        </label>
        {form.autoRenew && (
          <div>
            <Label>Prodlužuje se o (měsíců)</Label>
            <Input type="number" min={1} value={form.renewalMonths} onChange={e => setForm({ ...form, renewalMonths: e.target.value })} />
            {renewalInvalid && <p className="text-sm text-destructive mt-1">Zadej celý počet měsíců, alespoň 1.</p>}
            {endMissing && <p className="text-sm text-destructive mt-1">Prodloužení potřebuje datum konce doby určité.</p>}
          </div>
        )}
        {stoppingRenewal && contract.effectiveEndDate && (
          <p className="text-xs text-muted-foreground">
            Smlouva skončí ke konci aktuálního období: {contract.effectiveEndDate}. Jiný konec nastav v poli výše.
          </p>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Zrušit</Button>
          <Button onClick={() => save.mutate()} disabled={!form.startDate || renewalInvalid || endMissing || save.isPending}>
            Uložit
          </Button>
        </div>
      </Card>
    </div>
  );
}
