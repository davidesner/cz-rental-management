import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BankIntegrationKind } from './IntegrationMethodChooser';

export interface BankIntegration {
  id: string;
  kind: BankIntegrationKind;
  name: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPasswordSet: boolean;
  imapFolder: string;
  fromFilter: string;
  subjectFilter: string;
  accountNumber: string | null;
  active: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: 'ok' | 'error' | null;
  lastSyncError: string | null;
}

interface Props {
  integration: BankIntegration | null; // null = create
  // The method chosen in IntegrationMethodChooser (create), or the existing
  // integration's own kind (edit) — kind is fixed once created. Only
  // 'kb_email' exists today; a future kind is where a branch in this
  // component would go.
  kind: BankIntegrationKind;
  onClose: () => void;
  onSaved: () => void;
}

export function IntegrationDialog({ integration, kind, onClose, onSaved }: Props) {
  const editing = integration !== null;
  const [form, setForm] = useState({
    name: integration?.name ?? 'KB — notifikace',
    imapHost: integration?.imapHost ?? 'imap.gmail.com',
    imapPort: String(integration?.imapPort ?? 993),
    imapUser: integration?.imapUser ?? '',
    imapPassword: '',
    imapFolder: integration?.imapFolder ?? 'INBOX',
    fromFilter: integration?.fromFilter ?? 'servis@kbinfo.cz',
    subjectFilter: integration?.subjectFilter ?? 'Přijali jsme platbu',
    accountNumber: integration?.accountNumber ?? '',
    active: integration?.active ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: form.name,
        imapHost: form.imapHost,
        imapPort: Number(form.imapPort),
        imapUser: form.imapUser,
        imapFolder: form.imapFolder,
        fromFilter: form.fromFilter,
        subjectFilter: form.subjectFilter,
        accountNumber: form.accountNumber.trim() === '' ? null : form.accountNumber.trim(),
        active: form.active,
      };
      // kind is fixed at creation and never sent on an update — it doesn't
      // come from the DB row but from the chooser (or, on edit, from the
      // integration itself), so the seam is here rather than a hardcoded
      // 'kb_email' literal.
      if (!editing) body['kind'] = kind;
      // Only send the password when it was actually typed — an omitted field
      // leaves the stored one untouched, which is what makes editing safe.
      if (form.imapPassword !== '') body['imapPassword'] = form.imapPassword;
      return editing
        ? api.patch<{ bankIntegration: BankIntegration }>(`/api/bank-integrations/${integration!.id}`, body)
        : api.post<{ bankIntegration: BankIntegration }>('/api/bank-integrations', body);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: unknown) => setErr(apiErrorMessage(e)),
  });

  // imapPort is validated because `Number('')` is 0, and a cleared field would
  // otherwise persist port 0 — a plausible-looking value that can never connect.
  const portNum = Number(form.imapPort);
  const portValid = Number.isInteger(portNum) && portNum > 0 && portNum <= 65535;
  const canSave = form.name !== '' && form.imapHost !== '' && form.imapUser !== '' && portValid
    && (editing || form.imapPassword !== '');

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold">{editing ? 'Upravit integraci' : 'Nová bankovní integrace'}</h2>

        {kind === 'kb_email' && (
          // Open by default on create — a first-timer needs this to get any
          // e-mails at all. Collapsed on edit — someone fixing a port already
          // did this part.
          <details className="text-sm" open={!editing}>
            <summary className="cursor-pointer text-muted-foreground">Jak to nastavit v bance</summary>
            <div className="space-y-3 pt-3 text-muted-foreground">
              <div>
                <p className="font-medium text-foreground">Zapnout e-mailové oznámení o platbě</p>
                <p>
                  E-mailové notifikace jsou zdarma, SMS jsou placené (cca 3 Kč za zprávu). Nastavuje se{' '}
                  <strong>po jednotlivých účtech</strong> — je potřeba zopakovat pro každý účet, který chceš sbírat.
                </p>
                <ul className="list-disc pl-5 space-y-1 mt-1">
                  <li><strong>KB+ (web):</strong> Nastavení → Nastavení služeb → Oznámení → typ Příchozí platby → vyber účet → zapni e-mail → ulož.</li>
                  <li><strong>KB+ (mobilní aplikace):</strong> Nastavení → Oznámení, pak stejné volby. Názvy se mezi verzemi mírně liší.</li>
                  <li><strong>MojeBanka (starší IB):</strong> Nastavení → Oznámení o platbách → účet → směr Příchozí → příjemce → kanál e-mail → Pokračovat → potvrdit.</li>
                </ul>
                <p className="mt-1">
                  <a
                    href="https://www.kb.cz/cs/podpora/ucty-a-platby/jak-si-nastavim-notifikace-o-platbach"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >Návod KB k nastavení notifikací o platbách</a>
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground">Nastavit filtr v mailboxu</p>
                <p>
                  Vyhrazená složka zlevní každou synchronizaci oproti hledání ve velké schránce.
                </p>
                <p className="mt-1">
                  Gmail: Nastavení → Filtry a blokované adresy → Vytvořit filtr → Od: <code>servis@kbinfo.cz</code> →
                  Vytvořit filtr → Použít štítek (např. <code>KB platby</code>).
                </p>
                <p className="mt-1">
                  <strong>Pozor:</strong> pokud zaškrtneš i „Přeskočit doručenou poštu", Gmail zprávě odebere
                  štítek <code>INBOX</code> — zpráva pak v INBOX vůbec není. Proto: nastav <strong>Složku</strong>{' '}
                  níže v tomto formuláři na název štítku (např. <code>KB platby</code>, ne <code>INBOX</code>), a
                  ověř, že má tento štítek v nastavení Gmailu zapnuté „Zobrazit v IMAP" — Gmail umí štítky z IMAPu
                  úplně skrýt.
                </p>
                <p className="mt-1">
                  Po uložení integrace tlačítko <strong>Test</strong> v přehledu integrací ukáže, kolik zpráv
                  filtru odpovídá — špatná složka nebo skrytý štítek se tak projeví hned, ne až po tichém nočním
                  cronu.
                </p>
              </div>
            </div>
          </details>
        )}

        <div>
          <Label>Název</Label>
          <Input value={form.name} onChange={e => set('name')(e.target.value)} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Label>IMAP server</Label>
            <Input value={form.imapHost} onChange={e => set('imapHost')(e.target.value)} />
          </div>
          <div>
            <Label>Port</Label>
            <Input value={form.imapPort} onChange={e => set('imapPort')(e.target.value)} />
          </div>
        </div>

        <div>
          <Label>Uživatel (e-mail)</Label>
          <Input value={form.imapUser} onChange={e => set('imapUser')(e.target.value)} autoComplete="off" />
        </div>

        <div>
          <Label>Heslo {editing && integration!.imapPasswordSet && <span className="text-muted-foreground font-normal">— •••• nastaveno</span>}</Label>
          <Input
            type="password"
            value={form.imapPassword}
            placeholder={editing ? 'Nechat prázdné = neměnit' : ''}
            onChange={e => set('imapPassword')(e.target.value)}
            autoComplete="new-password"
          />
          {/* Required help text: on Gmail a normal account password simply does
              not work, and the resulting AUTHENTICATIONFAILED looks exactly like
              a typo. The explanation belongs where the mistake is made. */}
          <p className="text-xs text-muted-foreground mt-1">
            Gmail nepřijme běžné heslo k účtu — je potřeba{' '}
            <a
              href="https://support.google.com/accounts/answer/185833"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >App Password</a>
            , což vyžaduje zapnuté dvoufázové ověření.
          </p>
        </div>

        <div>
          <Label>Číslo vlastního účtu</Label>
          <Input
            value={form.accountNumber}
            placeholder="např. 321-9876543210/0100"
            onChange={e => set('accountNumber')(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Nepovinné. Když je vyplněné, notifikace na jiný účet se ignorují.
            Předčíslí je významné — <code>123-294153028/0300</code> je jiný účet než <code>294153028/0300</code>.
          </p>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Pokročilé filtry</summary>
          <div className="space-y-3 pt-3">
            <div>
              <Label>Složka</Label>
              <Input value={form.imapFolder} onChange={e => set('imapFolder')(e.target.value)} />
            </div>
            <div>
              <Label>Odesílatel obsahuje</Label>
              <Input value={form.fromFilter} onChange={e => set('fromFilter')(e.target.value)} />
            </div>
            <div>
              <Label>Předmět obsahuje</Label>
              <Input value={form.subjectFilter} onChange={e => set('subjectFilter')(e.target.value)} />
            </div>
          </div>
        </details>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.active}
            onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
          />
          Aktivní (zahrnout do automatické synchronizace)
        </label>

        {err && <p className="text-sm text-destructive">{err}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Zrušit</Button>
          <Button disabled={!canSave || save.isPending} onClick={() => { setErr(null); save.mutate(); }}>
            {save.isPending ? 'Ukládám…' : 'Uložit'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
