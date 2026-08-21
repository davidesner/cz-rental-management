import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface BankIntegration {
  id: string;
  kind: 'kb_email';
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
  onClose: () => void;
  onSaved: () => void;
}

export function IntegrationDialog({ integration, onClose, onSaved }: Props) {
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
