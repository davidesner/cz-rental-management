import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { parseKorun } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Hint } from '@/components/ui/hint';
import { Modal } from '@/components/ui/modal';

interface Property { id: string; name: string; }
interface Tenant { id: string; name: string; }

const UTILITY_KINDS = ['electricity', 'gas', 'internet', 'water', 'other'] as const;
type UtilityKind = (typeof UTILITY_KINDS)[number];
const UTILITY_LABEL: Record<UtilityKind, string> = {
  electricity: 'Elektřina', gas: 'Plyn', internet: 'Internet', water: 'Voda', other: 'Ostatní',
};

const AMOUNT_HELP = 'Částka musí být číslo v korunách, např. 15000 nebo 15000,50.';

interface Props {
  onClose: () => void;
  /** Called with the new contract's id once the contract (and its terms) are saved. */
  onCreated: (contractId: string) => void;
  /** Preselects the property, e.g. when opened from a property's page. */
  propertyId?: string;
}

/**
 * Creates a lease together with its opening terms in one go: the contract row,
 * the initial rent/advance/due-day terms, and one utility advance per kind.
 * These are three endpoints on the API; a failure after the contract exists is
 * reported, and the caller still gets the id so the user can finish on the
 * detail page instead of starting over.
 */
export function NewContractDialog({ onClose, onCreated, propertyId }: Props) {
  const { data: propertiesData } = useQuery({ queryKey: ['properties'], queryFn: () => api.get<{ properties: Property[] }>('/api/properties') });
  const { data: tenantsData } = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<{ tenants: Tenant[] }>('/api/tenants') });
  const properties = propertiesData?.properties ?? [];
  const tenants = tenantsData?.tenants ?? [];

  const [form, setForm] = useState({
    propertyId: propertyId ?? '',
    tenantId: '',
    startDate: '',
    endDate: '',
    securityDeposit: '',
    baseRent: '',
    serviceAdvance: '',
    paymentDueDay: '10',
    paymentAppliesTo: 'current' as 'current' | 'next',
    documentRef: '',
    note: '',
  });
  const [utilities, setUtilities] = useState<Array<{ kind: UtilityKind; amount: string }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));

  // Kauce and the SVJ advance may be empty (null and 0 on the wire); rent is
  // required. An unparseable value must never slip through as "empty".
  const securityDeposit = parseKorun(form.securityDeposit);
  const baseRent = parseKorun(form.baseRent);
  const serviceAdvance = parseKorun(form.serviceAdvance);
  const invalid = {
    deposit: securityDeposit.kind === 'invalid',
    rent: baseRent.kind !== 'value',
    advance: serviceAdvance.kind === 'invalid',
    utilities: utilities.some(u => parseKorun(u.amount).kind !== 'value'),
  };
  const dueDay = parseInt(form.paymentDueDay, 10);
  const dueDayInvalid = !(dueDay >= 1 && dueDay <= 31);
  const canSubmit = !!form.propertyId && !!form.tenantId && !!form.startDate
    && !invalid.deposit && !invalid.rent && !invalid.advance && !invalid.utilities && !dueDayInvalid && !submitting;

  const usedKinds = new Set(utilities.map(u => u.kind));
  const freeKinds = UTILITY_KINDS.filter(k => !usedKinds.has(k));

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    let contractId: string | null = null;
    try {
      const { contract } = await api.post<{ contract: { id: string } }>('/api/contracts', {
        propertyId: form.propertyId,
        tenantId: form.tenantId,
        startDate: form.startDate,
        endDate: form.endDate || null,
        securityDeposit: securityDeposit.kind === 'value' ? securityDeposit.halere : null,
        note: form.note || null,
      });
      contractId = contract.id;
      await api.post(`/api/contracts/${contractId}/terms`, {
        validFrom: form.startDate,
        baseRent: baseRent.kind === 'value' ? baseRent.halere : 0,
        serviceAdvance: serviceAdvance.kind === 'value' ? serviceAdvance.halere : 0,
        paymentDueDay: dueDay,
        paymentAppliesTo: form.paymentAppliesTo,
        source: 'initial',
        documentRef: form.documentRef || null,
        note: null,
      });
      const failed: string[] = [];
      for (const u of utilities) {
        const amount = parseKorun(u.amount);
        if (amount.kind !== 'value') continue;
        try {
          await api.post(`/api/contracts/${contractId}/utilities`, { kind: u.kind, validFrom: form.startDate, monthlyAdvance: amount.halere, note: null });
        } catch (e) {
          failed.push(`${UTILITY_LABEL[u.kind]}: ${apiErrorMessage(e)}`);
        }
      }
      if (failed.length > 0) {
        setErr(`Pronájem je založený, ale neuložily se energie: ${failed.join('; ')}. Doplň je na detailu přes „Přidat změnu“.`);
        setSubmitting(false);
        onCreated(contractId);
        return;
      }
      onCreated(contractId);
      onClose();
    } catch (e) {
      setErr(contractId
        ? `Pronájem je založený, ale podmínky se neuložily: ${apiErrorMessage(e)}. Doplň je na detailu přes „Přidat změnu“.`
        : apiErrorMessage(e));
      if (contractId) onCreated(contractId);
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Nový pronájem"
      description="Smlouva a její podmínky od prvního dne. Pozdější změny přidáš na detailu pronájmu."
      onClose={onClose}
      className="max-w-lg"
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={submitting}>Zrušit</Button>
        <Button onClick={submit} disabled={!canSubmit}>{submitting ? 'Zakládám…' : 'Založit pronájem'}</Button>
      </>}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="nc-property">Nemovitost</Label>
          <select id="nc-property" className="select-native" value={form.propertyId} onChange={e => set('propertyId')(e.target.value)}>
            <option value="">Vyber nemovitost…</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="nc-tenant">Nájemce</Label>
          <select id="nc-tenant" className="select-native" value={form.tenantId} onChange={e => set('tenantId')(e.target.value)}>
            <option value="">Vyber nájemce…</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="nc-start">Začátek</Label>
          <Input id="nc-start" type="date" value={form.startDate} onChange={e => set('startDate')(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="nc-end">Konec</Label>
          <Input id="nc-end" type="date" value={form.endDate} onChange={e => set('endDate')(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="nc-deposit">Kauce (Kč)</Label>
          <Input id="nc-deposit" placeholder="30000" value={form.securityDeposit} onChange={e => set('securityDeposit')(e.target.value)} />
        </div>
      </div>
      {invalid.deposit && <p className="text-sm text-late">{AMOUNT_HELP}</p>}

      <div className="border-t border-rule pt-4">
        <div className="mb-3 flex items-center gap-1.5">
          <span className="font-medium">Měsíční předpis</span>
          <Hint label="Co je měsíční předpis">Částky, které nájemce platí každý měsíc od začátku smlouvy. Nájem je příjem pronajímatele, záloha na služby SVJ a energie se jednou za rok vyúčtují proti skutečným nákladům.</Hint>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="nc-rent">Nájem (Kč)</Label>
            <Input id="nc-rent" placeholder="15000" value={form.baseRent} onChange={e => set('baseRent')(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="nc-advance">Záloha na služby SVJ (Kč)</Label>
            <Input id="nc-advance" placeholder="3300" value={form.serviceAdvance} onChange={e => set('serviceAdvance')(e.target.value)} />
          </div>
        </div>
        {((form.baseRent !== '' && invalid.rent) || invalid.advance) && <p className="mt-1 text-sm text-late">{AMOUNT_HELP}</p>}

        <div className="mt-3 space-y-2">
          {utilities.map((u, i) => (
            <div key={u.kind} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
              <div>
                <Label htmlFor={`nc-util-kind-${i}`}>Energie</Label>
                <select id={`nc-util-kind-${i}`} className="select-native" value={u.kind} onChange={e => setUtilities(list => list.map((x, j) => j === i ? { ...x, kind: e.target.value as UtilityKind } : x))}>
                  {UTILITY_KINDS.filter(k => k === u.kind || !usedKinds.has(k)).map(k => <option key={k} value={k}>{UTILITY_LABEL[k]}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor={`nc-util-amount-${i}`}>Záloha (Kč/měsíc)</Label>
                <Input id={`nc-util-amount-${i}`} placeholder="1500" value={u.amount} onChange={e => setUtilities(list => list.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
              </div>
              <button type="button" aria-label={`Odebrat ${UTILITY_LABEL[u.kind]}`} onClick={() => setUtilities(list => list.filter((_, j) => j !== i))}
                className="mb-1 inline-flex h-7 w-7 items-center justify-center rounded-sm text-soft hover:bg-hover hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          {invalid.utilities && <p className="text-sm text-late">{AMOUNT_HELP}</p>}
          {freeKinds.length > 0 && (
            <button type="button" className="inline-flex items-center gap-1 text-sm text-accent hover:underline" onClick={() => setUtilities(list => [...list, { kind: freeKinds[0]!, amount: '' }])}>
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />Přidat zálohu na energie
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-rule pt-4">
        <div>
          <Label htmlFor="nc-due">Splatnost ke dni</Label>
          <Input id="nc-due" type="number" min={1} max={31} value={form.paymentDueDay} onChange={e => set('paymentDueDay')(e.target.value)} />
        </div>
        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <Label htmlFor="nc-applies" className="mb-0">Platba za</Label>
            <Hint label="Jak se počítá splatnost">„Aktuální měsíc“ znamená, že nájem za říjen je splatný v říjnu. „Následující měsíc“ znamená placení předem: nájem za listopad je splatný už v říjnu.</Hint>
          </div>
          <select id="nc-applies" className="select-native" value={form.paymentAppliesTo} onChange={e => set('paymentAppliesTo')(e.target.value as 'current' | 'next')}>
            <option value="current">Aktuální měsíc</option>
            <option value="next">Následující měsíc (předem)</option>
          </select>
        </div>
      </div>
      {dueDayInvalid && <p className="text-sm text-late">Den splatnosti musí být 1 až 31.</p>}

      <div>
        <Label htmlFor="nc-doc">Smlouva (odkaz nebo cesta k souboru)</Label>
        <Input id="nc-doc" placeholder="https://… nebo /cesta/smlouva.pdf" value={form.documentRef} onChange={e => set('documentRef')(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="nc-note">Poznámka</Label>
        <Input id="nc-note" placeholder="např. stav elektroměru při předání" value={form.note} onChange={e => set('note')(e.target.value)} />
      </div>

      {err && <p className="text-sm text-late">{err}</p>}
    </Modal>
  );
}
