import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

export interface PropertyRow {
  id: string;
  name: string;
  address: string | null;
  reconciliationSkill: string | null;
  note: string | null;
  createdAt: string;
}

/** Edits the few fields a property has: name, address, the reconciliation procedure and a free note. */
export function EditPropertyDialog({ property, onClose }: { property: PropertyRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: property.name,
    address: property.address ?? '',
    reconciliationSkill: property.reconciliationSkill ?? '',
    note: property.note ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.patch(`/api/properties/${property.id}`, {
      name: form.name.trim(),
      address: form.address.trim() || null,
      reconciliationSkill: form.reconciliationSkill.trim() || null,
      note: form.note.trim() || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property', property.id] });
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['contracts'] });
      onClose();
    },
    onError: (e: unknown) => setErr(apiErrorMessage(e)),
  });
  const canSave = form.name.trim() !== '' && !save.isPending;
  return (
    <Modal
      title="Upravit nemovitost"
      onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose}>Zrušit</Button>
        <Button onClick={() => { setErr(null); save.mutate(); }} disabled={!canSave}>Uložit</Button>
      </>}
    >
      <div>
        <Label htmlFor="pe-name">Název</Label>
        <Input id="pe-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
      </div>
      <div>
        <Label htmlFor="pe-address">Adresa</Label>
        <Input id="pe-address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
      </div>
      <div>
        <div className="mb-1 flex items-center gap-1.5"><Label htmlFor="pe-skill" className="mb-0">Postup vyúčtování</Label><Hint label="K čemu je postup vyúčtování">Název postupu, podle kterého agent dělá roční vyúčtování této nemovitosti. Nechej prázdné, pokud žádný zvláštní postup nemá.</Hint></div>
        <Input id="pe-skill" placeholder="např. svj-lipova" value={form.reconciliationSkill} onChange={e => setForm({ ...form, reconciliationSkill: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="pe-note">Poznámka</Label>
        <textarea
          id="pe-note"
          rows={3}
          className="flex w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-base text-ink placeholder:text-wait focus:border-accent focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          value={form.note}
          onChange={e => setForm({ ...form, note: e.target.value })}
        />
      </div>
      {err && <p className="text-sm text-late">{err}</p>}
    </Modal>
  );
}
