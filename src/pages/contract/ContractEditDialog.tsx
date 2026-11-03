import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

export interface EditableContract {
  id: string;
  startDate: string;
  /** Original end of the fixed term; null = open-ended. */
  endDate: string | null;
  autoRenew: boolean;
  renewalMonths: number | null;
  /** End of the renewal period running today. */
  effectiveEndDate: string | null;
}

/** "prodlužuje se o 12 měsíců, původně do 31. 12. 2025", or null when nothing renews. */
export function renewalNote(c: Pick<EditableContract, 'endDate' | 'autoRenew' | 'renewalMonths' | 'effectiveEndDate'>): string | null {
  if (!c.autoRenew || c.endDate === null || !c.renewalMonths) return null;
  const n = c.renewalMonths;
  const unit = n === 1 ? 'měsíc' : n <= 4 ? 'měsíce' : 'měsíců';
  const original = c.effectiveEndDate && c.effectiveEndDate !== c.endDate ? `, původně do ${fmtDate(c.endDate)}` : '';
  return `prodlužuje se o ${n} ${unit}${original}`;
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
    <Modal
      title="Upravit smlouvu"
      description="Platnost smlouvy a automatické prodloužení. Nájem, zálohy a splatnost se mění dodatkem v historii smlouvy."
      onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose}>Zrušit</Button>
        <Button onClick={() => { setErr(null); save.mutate(); }} disabled={!form.startDate || renewalInvalid || endMissing || save.isPending}>
          {save.isPending ? 'Ukládám…' : 'Uložit'}
        </Button>
      </>}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ce-start">Začátek</Label>
          <Input id="ce-start" type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="ce-end">{form.autoRenew ? 'Konec doby určité' : 'Konec'}</Label>
          <Input id="ce-end" type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={form.autoRenew} onChange={e => setForm({ ...form, autoRenew: e.target.checked })} />
          Automatické prodloužení
          <Hint label="Co je automatické prodloužení">Smlouva na dobu určitou, kterou nikdo nevypoví, běží po konci dál za stejných podmínek vždy o další období. Konec doby určité zůstává v evidenci původní, aplikace si aktuální konec dopočítá.</Hint>
        </label>
        {form.autoRenew && (
          <label className="inline-flex items-center gap-2 text-sm">
            o
            <Input className="w-16" inputMode="numeric" value={form.renewalMonths} onChange={e => setForm({ ...form, renewalMonths: e.target.value })} aria-label="Prodloužení o měsíců" />
            měsíců
          </label>
        )}
      </div>
      {renewalInvalid && <p className="text-sm text-late">Zadej celý počet měsíců, alespoň 1.</p>}
      {endMissing && <p className="text-sm text-late">Prodloužení potřebuje konec doby určité.</p>}
      {stoppingRenewal && contract.effectiveEndDate && (
        <p className="text-sm text-soft">
          Smlouva skončí ke konci aktuálního období, tedy {fmtDate(contract.effectiveEndDate)}. Jiný konec nastav v poli výše.
        </p>
      )}
      {err && <p className="text-sm text-late">{err}</p>}
    </Modal>
  );
}
