# Bank Payment Pairing — Plan 3: UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the feature usable by a human — a general settings page holding bank integrations and the unmatched-payment inbox, plus the "Párování plateb" card on the pronájem detail.

**Architecture:** React 19 + Vite + TanStack Query + Tailwind + shadcn-style primitives, matching the existing pages exactly. Dialogs follow this repo's established pattern (a `fixed inset-0` backdrop wrapping a `<Card>`, closing on backdrop click) rather than Radix Dialog, which the codebase does not use for these. Every list gets the `TableSkeleton` / `TableError` treatment the other pages have.

**Tech Stack:** React 19, react-router-dom 7, TanStack Query 5, TailwindCSS, `src/lib/api.ts`.

**Spec:** `docs/superpowers/specs/2026-08-20-bank-payment-pairing-design.md`
**Depends on:** Plan 2 (all endpoints live)

## Global Constraints

- **UI copy is Czech.** Match the existing tone (`Nemovitosti`, `Pronájmy`, `Zkusit znovu`).
- **Money is haléře in the API, korun in the input.** Read with `fmtKc` (`(v/100).toLocaleString('cs-CZ')`), write with `Math.round(parseFloat(x.replace(',', '.')) * 100)` — the same conversion `ContractDetail.tsx` already uses. Never send a float.
- **Never render the IMAP password.** The API returns `imapPasswordSet: boolean`; the field shows `•••• nastaveno` and sends a value only when retyped.
- **Every query handles three states:** loading (`TableSkeleton`), error (`TableError` with `refetch`), empty. A failed query leaves `data` undefined forever, so `!data → skeleton` alone pulses indefinitely.
- **`pnpm build` is typecheck only.** Also run `npx vite build` before the final commit — CI runs it as a separate job.
- **Work on `feat/bank-payment-pairing`.**

---

### Task 14: Settings shell with tabs

The nav currently links straight to `/settings/api-tokens`. The request is for a *general* settings page, so `/settings` becomes a tabbed shell and the API-tokens content moves into it unchanged.

**Files:**
- Create: `src/pages/Settings.tsx`
- Modify: `src/pages/ApiTokens.tsx` — export the body as a component without its own `<h1>`
- Modify: `src/main.tsx` — route `/settings`, redirect `/settings/api-tokens`
- Modify: `src/components/Layout.tsx` — one "Nastavení" nav entry

**Interfaces:**
- Produces: `SettingsPage` (default export of `src/pages/Settings.tsx`), reading and writing the `?tab=` query parameter so a tab is linkable.
- Consumes: `ApiTokensPanel` (renamed body of the existing page), `BankTab` (Tasks 15–16 — stub it in this task).

- [ ] **Step 1: Extract the API-tokens body into a panel**

In `src/pages/ApiTokens.tsx`, rename the exported component and drop its page heading (the shell owns the `<h1>` now). Change:

```tsx
export function ApiTokensPage() {
```

to:

```tsx
export function ApiTokensPanel() {
```

and inside its returned JSX, replace the header block:

```tsx
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">API tokeny</h1>
        <Button onClick={() => { setErr(null); setOpen(true); }}>Nový token</Button>
      </div>
```

with:

```tsx
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">API tokeny</h2>
        <Button onClick={() => { setErr(null); setOpen(true); }}>Nový token</Button>
      </div>
```

- [ ] **Step 2: Create the shell with a stub bank tab**

Create `src/pages/Settings.tsx`:

```tsx
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiTokensPanel } from './ApiTokens';
import { BankTab } from './settings/BankTab';

const TABS = ['bank', 'api-tokens'] as const;
type TabKey = (typeof TABS)[number];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: TabKey = TABS.includes(requested as TabKey) ? (requested as TabKey) : 'bank';

  // The tab lives in the URL so it can be linked to — the MCP
  // bank_integrations_setup_url tool hands the user /settings?tab=bank&action=new,
  // and `replace` keeps tab switching out of the back-button history.
  const selectTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    next.delete('action');
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Nastavení</h1>
      <Tabs value={tab} onValueChange={selectTab} className="w-full">
        <TabsList>
          <TabsTrigger value="bank">Bankovní integrace</TabsTrigger>
          <TabsTrigger value="api-tokens">API tokeny</TabsTrigger>
        </TabsList>
        <TabsContent value="bank" className="space-y-6 pt-4">
          <BankTab />
        </TabsContent>
        <TabsContent value="api-tokens" className="space-y-6 pt-4">
          <ApiTokensPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

Create a placeholder `src/pages/settings/BankTab.tsx` so this task compiles on its own — Tasks 15 and 16 fill it in:

```tsx
export function BankTab() {
  return <p className="text-sm text-muted-foreground">Připravuje se…</p>;
}
```

- [ ] **Step 3: Wire the routes**

In `src/main.tsx`, replace the `ApiTokensPage` import:

```tsx
import { SettingsPage } from './pages/Settings';
```

and replace the `/settings/api-tokens` route with:

```tsx
            <Route path="/settings" element={<SettingsPage />} />
            {/* Old bookmarks and any external link keep working. */}
            <Route path="/settings/api-tokens" element={<Navigate to="/settings?tab=api-tokens" replace />} />
```

`Navigate` is already imported in this file.

- [ ] **Step 4: Update the nav**

In `src/components/Layout.tsx`, replace the API-tokens link:

```tsx
          <Link className="hover:underline" to="/settings/api-tokens">API tokeny</Link>
```

with:

```tsx
          <Link className="hover:underline" to="/settings">Nastavení</Link>
```

- [ ] **Step 5: Verify by hand**

```bash
pnpm build
npx vite build
```

Then run the app and check three things:

```bash
pnpm dev
```

- `/settings` renders with the two tabs, Bankovní integrace selected.
- Clicking **API tokeny** puts `?tab=api-tokens` in the URL, and reloading keeps that tab.
- `/settings/api-tokens` redirects to `/settings?tab=api-tokens`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Settings.tsx src/pages/settings/BankTab.tsx src/pages/ApiTokens.tsx src/main.tsx src/components/Layout.tsx
git commit -m "feat(web): general settings page with tabs

Nav collapses to one Nastavení entry; API tokens become a panel inside it
rather than their own page. The active tab lives in ?tab= so it is linkable —
the MCP setup-url tool points at /settings?tab=bank&action=new — and
/settings/api-tokens redirects so existing bookmarks keep working."
```

---

### Task 15: Bank integrations list and dialog

**Files:**
- Create: `src/pages/settings/IntegrationDialog.tsx`
- Modify: `src/pages/settings/BankTab.tsx` — replace the stub with the integration list

**Interfaces:**
- Produces:
  - `interface BankIntegration` — mirrors `BankIntegrationRow` from Plan 2, Task 8
  - `IntegrationDialog({ integration, onClose, onSaved })` — `integration: BankIntegration | null` (null = create)
  - `StatusPill({ integration })`
- Consumes: `/api/bank-integrations` endpoints from Plan 2, Task 11.

- [ ] **Step 1: Write the dialog**

Create `src/pages/settings/IntegrationDialog.tsx`:

```tsx
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
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
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
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
```

- [ ] **Step 2: Write the integrations list**

Replace `src/pages/settings/BankTab.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableError } from '@/components/ui/table-error';
import { IntegrationDialog, type BankIntegration } from './IntegrationDialog';
import { TransactionInbox } from './TransactionInbox';

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('cs-CZ');
}

export function StatusPill({ integration }: { integration: BankIntegration }) {
  // Mirrors computePairingHealth on the server: not configured / working /
  // failing. An inactive integration reads as "not configured" because it
  // collects nothing.
  if (!integration.active) {
    return <span className="text-xs rounded-full px-2 py-0.5 bg-muted text-muted-foreground">Vypnuto</span>;
  }
  if (integration.lastSyncStatus === 'error') {
    return (
      <span
        className="text-xs rounded-full px-2 py-0.5 bg-red-100 text-red-800"
        title={integration.lastSyncError ?? undefined}
      >Chyba</span>
    );
  }
  if (integration.lastSyncStatus === 'ok') {
    return <span className="text-xs rounded-full px-2 py-0.5 bg-green-100 text-green-800">Vše v pořádku</span>;
  }
  return <span className="text-xs rounded-full px-2 py-0.5 bg-muted text-muted-foreground">Nesynchronizováno</span>;
}

export function BankTab() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data, isError, refetch } = useQuery({
    queryKey: ['bank-integrations'],
    queryFn: () => api.get<{ bankIntegrations: BankIntegration[] }>('/api/bank-integrations'),
  });

  const [dialog, setDialog] = useState<{ open: boolean; target: BankIntegration | null }>({ open: false, target: null });
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // ?action=new opens the create dialog on load — the deep link the MCP
  // bank_integrations_setup_url tool hands to the user.
  useEffect(() => {
    if (params.get('action') !== 'new') return;
    setDialog({ open: true, target: null });
    const next = new URLSearchParams(params);
    next.delete('action');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bank-integrations'] });
    qc.invalidateQueries({ queryKey: ['bank-transactions'] });
  };

  const test = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; mailboxExists?: number; error?: string }>(`/api/bank-integrations/${id}/test`, {}),
    onSuccess: (r) => setNotice(r.ok
      ? { kind: 'ok', text: `Připojení funguje. Ve složce je ${r.mailboxExists ?? 0} zpráv.` }
      : { kind: 'err', text: `Připojení selhalo: ${r.error ?? 'neznámá chyba'}` }),
    onError: (e: unknown) => setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) }),
  });

  const sync = useMutation({
    mutationFn: (id: string) => api.post<{ result: { fetched: number; created: number; matched: number; failed: number; status: string; error: string | null } }>(`/api/bank-integrations/${id}/sync`, {}),
    onSuccess: ({ result }) => {
      invalidate();
      setNotice(result.status === 'ok'
        ? { kind: 'ok', text: `Hotovo — ${result.fetched} zpráv, ${result.created} nových, ${result.matched} spárováno.` }
        : { kind: 'err', text: `Synchronizace skončila chybou: ${result.error ?? 'neznámá chyba'}` });
    },
    onError: (e: unknown) => setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/bank-integrations/${id}`),
    onSuccess: invalidate,
    onError: (e: unknown) => setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) }),
  });

  const integrations = data?.bankIntegrations ?? [];
  const busy = test.isPending || sync.isPending || remove.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Bankovní integrace</h2>
        <Button onClick={() => setDialog({ open: true, target: null })}>Nová integrace</Button>
      </div>

      {notice && (
        <Card className={`p-4 flex items-start justify-between gap-4 ${notice.kind === 'ok' ? 'border-green-500 bg-green-50' : 'border-destructive bg-red-50'}`}>
          <p className={`text-sm ${notice.kind === 'ok' ? 'text-green-900' : 'text-red-900'}`}>{notice.text}</p>
          <Button size="sm" variant="outline" onClick={() => setNotice(null)}>Zavřít</Button>
        </Card>
      )}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Název</TableHead>
              <TableHead>Účet / server</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead>Poslední synchronizace</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError && !data ? (
              <TableError cols={5} onRetry={() => refetch()} />
            ) : !data ? (
              <TableSkeleton cols={5} />
            ) : integrations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">
                  Žádná integrace. Přidej mailbox, do kterého chodí notifikace z KB.
                </TableCell>
              </TableRow>
            ) : integrations.map(i => (
              <TableRow key={i.id}>
                <TableCell className="font-medium">{i.name}</TableCell>
                <TableCell className="text-sm">
                  <div>{i.imapUser}</div>
                  <div className="text-muted-foreground text-xs">
                    {i.imapHost}:{i.imapPort} · {i.imapFolder}
                    {i.accountNumber && ` · ${i.accountNumber}`}
                  </div>
                </TableCell>
                <TableCell><StatusPill integration={i} /></TableCell>
                <TableCell className="text-sm">{fmtDateTime(i.lastSyncAt)}</TableCell>
                <TableCell className="text-right whitespace-nowrap space-x-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => { setNotice(null); test.mutate(i.id); }}>Test</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => { setNotice(null); sync.mutate(i.id); }}>Synchronizovat</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ open: true, target: i })}>Upravit</Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => { if (confirm(`Smazat integraci „${i.name}"? Nasbírané transakce se smažou s ní.`)) remove.mutate(i.id); }}
                  >Smazat</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {integrations.some(i => i.active && i.lastSyncStatus === 'error' && (i.lastSyncError ?? '').includes('unexpected_structure')) && (
        <Card className="p-4 border-destructive bg-red-50">
          <p className="text-sm text-red-900">
            <strong>Struktura notifikace se změnila.</strong> KB pravděpodobně upravila
            šablonu e-mailu — do té doby se platby nesbírají. Detail je u dotčené
            transakce níže se stavem „Nezpracováno".
          </p>
        </Card>
      )}

      <TransactionInbox />

      {dialog.open && (
        <IntegrationDialog
          integration={dialog.target}
          onClose={() => setDialog({ open: false, target: null })}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}
```

Create a placeholder `src/pages/settings/TransactionInbox.tsx` so this compiles — Task 16 fills it in:

```tsx
export function TransactionInbox() {
  return null;
}
```

- [ ] **Step 3: Verify by hand**

```bash
pnpm build && npx vite build && pnpm dev
```

- `/settings` shows an empty integrations table with the guidance row.
- **Nová integrace** opens the dialog; Save is disabled until name/host/user/password are filled.
- Create one with a bogus host, then **Test** → red notice with the connection error. This is the end-to-end proof that the encrypted password round-trips.
- **Upravit** shows `•••• nastaveno` and saving without retyping the password succeeds.
- `/settings?tab=bank&action=new` opens the create dialog immediately and strips `action` from the URL.

- [ ] **Step 4: Commit**

```bash
git add src/pages/settings/IntegrationDialog.tsx src/pages/settings/BankTab.tsx src/pages/settings/TransactionInbox.tsx
git commit -m "feat(web): bank integration management

The password field sends a value only when retyped, so editing other fields
cannot wipe the stored credential, and it carries inline App Password guidance
— on Gmail a normal password fails with AUTHENTICATIONFAILED, which reads as a
typo. Test connection surfaces the real IMAP error rather than making the user
wait for a silent cron failure. ?action=new opens the create dialog for the MCP
deep link."
```

---

### Task 16: The unmatched-payment inbox

**Files:**
- Modify: `src/pages/settings/TransactionInbox.tsx` — replace the placeholder

**Interfaces:**
- Produces: `TransactionInbox()`
- Consumes: `/api/bank-transactions*` endpoints, `/api/contracts` for the assign dropdown.

- [ ] **Step 1: Write the inbox**

Replace `src/pages/settings/TransactionInbox.tsx` with:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { TableError } from '@/components/ui/table-error';

const SELECT_CLS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface BankTransaction {
  id: string;
  amount: number;
  currency: string;
  valueDate: string;
  fromAccount: string | null;
  toAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
  messageForRecipient: string | null;
  sourceLink: string | null;
  status: 'unmatched' | 'matched' | 'ambiguous' | 'suspected_duplicate' | 'ignored' | 'parse_failed';
  statusReason: string | null;
  duplicateOfTransactionId: string | null;
  paymentId: string | null;
}

interface Contract {
  id: string;
  propertyName: string;
  tenantName: string;
  startDate: string;
  endDate: string | null;
}

function fmtKc(halere: number): string {
  return `${(halere / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč`;
}

const STATUS_LABEL: Record<BankTransaction['status'], string> = {
  unmatched: 'Nespárováno',
  matched: 'Spárováno',
  ambiguous: 'Více pravidel',
  suspected_duplicate: 'Možný duplikát',
  ignored: 'Ignorováno',
  parse_failed: 'Nezpracováno',
};

function StatusBadge({ status }: { status: BankTransaction['status'] }) {
  const tone = status === 'parse_failed' || status === 'ambiguous'
    ? 'bg-red-100 text-red-800'
    : status === 'suspected_duplicate'
      ? 'bg-amber-100 text-amber-900'
      : 'bg-muted text-muted-foreground';
  return <span className={`text-xs rounded-full px-2 py-0.5 whitespace-nowrap ${tone}`}>{STATUS_LABEL[status]}</span>;
}

export function TransactionInbox() {
  const qc = useQueryClient();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const { data, isError, refetch } = useQuery({
    queryKey: ['bank-transactions', 'pending'],
    queryFn: () => api.get<{ bankTransactions: BankTransaction[] }>('/api/bank-transactions?pending=1'),
  });
  // isError is destructured, not ignored: without it a failed contracts fetch
  // renders an EMPTY "Přiřadit k pronájmu…" dropdown, which looks identical to
  // "this org has no contracts yet". A user trying to resolve a pending payment
  // would have no way to tell the difference.
  const { data: contractsData, isError: contractsError } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => api.get<{ contracts: Contract[] }>('/api/contracts'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bank-transactions'] });
    qc.invalidateQueries({ queryKey: ['payments'] });
  };
  const onError = (e: unknown) => setErr(e instanceof Error ? e.message : String(e));

  const assign = useMutation({
    mutationFn: ({ id, contractId }: { id: string; contractId: string }) =>
      api.post<unknown>(`/api/bank-transactions/${id}/assign`, { contractId }),
    onSuccess: invalidate, onError,
  });
  const ignore = useMutation({
    mutationFn: (id: string) => api.post<unknown>(`/api/bank-transactions/${id}/ignore`, {}),
    onSuccess: invalidate, onError,
  });
  const reparse = useMutation({
    mutationFn: (id: string) => api.post<unknown>(`/api/bank-transactions/${id}/reparse`, {}),
    onSuccess: invalidate, onError,
  });

  const rows = data?.bankTransactions ?? [];
  const contracts = contractsData?.contracts ?? [];
  const busy = assign.isPending || ignore.isPending || reparse.isPending;

  const contractLabel = (c: Contract) =>
    `${c.propertyName} — ${c.tenantName} (od ${c.startDate})`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Nepřiřazené platby</h2>
        {rows.length > 0 && (
          <span className="text-sm text-muted-foreground">{rows.length} čeká na vyřešení</span>
        )}
      </div>

      {err && (
        <Card className="p-4 border-destructive bg-red-50 flex items-start justify-between gap-4">
          <p className="text-sm text-red-900">{err}</p>
          <Button size="sm" variant="outline" onClick={() => setErr(null)}>Zavřít</Button>
        </Card>
      )}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead className="text-right">Částka</TableHead>
              <TableHead>Z účtu</TableHead>
              <TableHead>Symboly / zpráva</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError && !data ? (
              <TableError cols={6} onRetry={() => refetch()} />
            ) : !data ? (
              <TableSkeleton cols={6} />
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">
                  Nic nečeká — všechny platby jsou spárované.
                </TableCell>
              </TableRow>
            ) : rows.map(t => (
              <TableRow key={t.id}>
                <TableCell className="whitespace-nowrap">{t.valueDate}</TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap">
                  {fmtKc(t.amount)}
                  {t.currency !== 'CZK' && <span className="text-xs text-muted-foreground"> ({t.currency})</span>}
                </TableCell>
                <TableCell className="text-sm">{t.fromAccount ?? '—'}</TableCell>
                <TableCell className="text-sm">
                  {t.messageForRecipient && <div>{t.messageForRecipient}</div>}
                  <div className="text-muted-foreground text-xs">
                    {[t.vs && `VS ${t.vs}`, t.ks && `KS ${t.ks}`, t.ss && `SS ${t.ss}`]
                      .filter(Boolean).join(' · ') || 'bez symbolů'}
                  </div>
                  {t.sourceLink && (
                    <a href={t.sourceLink} target="_blank" rel="noreferrer" className="text-xs underline">
                      notifikace v bance
                    </a>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={t.status} />
                  {t.statusReason && (
                    <div className="text-xs text-muted-foreground mt-1 max-w-xs break-words">{t.statusReason}</div>
                  )}
                </TableCell>
                <TableCell className="text-right space-y-2 min-w-[18rem]">
                  {t.status === 'parse_failed' ? (
                    <div className="space-x-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => { setErr(null); reparse.mutate(t.id); }}>
                        Znovu zpracovat
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => { setErr(null); ignore.mutate(t.id); }}>
                        Ignorovat
                      </Button>
                    </div>
                  ) : (
                    <>
                      {t.status === 'suspected_duplicate' && (
                        <p className="text-xs text-amber-900 text-left">
                          Shodná platba už je spárovaná. Pokud šlo o dvě samostatné platby,
                          přiřaď ji ručně — jinak ignoruj.
                        </p>
                      )}
                      <div className="flex gap-2 justify-end">
                        <select
                          className={SELECT_CLS}
                          value={choice[t.id] ?? ''}
                          onChange={e => setChoice(c => ({ ...c, [t.id]: e.target.value }))}
                        >
                          <option value="">Přiřadit k pronájmu…</option>
                          {contracts.map(c => (
                            <option key={c.id} value={c.id}>{contractLabel(c)}</option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          disabled={busy || !choice[t.id]}
                          onClick={() => { setErr(null); assign.mutate({ id: t.id, contractId: choice[t.id]! }); }}
                        >
                          {t.status === 'suspected_duplicate' ? 'Není duplikát' : 'Přiřadit'}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => { setErr(null); ignore.mutate(t.id); }}>
                          Ignorovat
                        </Button>
                      </div>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify by hand against a seeded transaction**

The inbox needs a row to look at. Insert one directly:

```bash
docker exec -i rental-pg psql -U postgres -d rental_dev <<'SQL'
INSERT INTO bank_transaction
  (id, org_id, integration_id, message_id, amount_haler, currency, value_date,
   from_account, to_account, vs, status, received_at)
SELECT 'seed-tx-1', bi.org_id, bi.id, 'seed-1', 3800000, 'CZK', '2026-08-20',
       '294153028/0300', bi.account_number, '2026008', 'unmatched', now()
FROM bank_integration bi LIMIT 1;
SQL
```

Then in the browser:

- The row appears under **Nepřiřazené platby** with the amount as `38 000,00 Kč`.
- Picking a contract and pressing **Přiřadit** makes the row disappear and a matching payment show up on the contract's Platby tab.
- Deleting that payment returns the row to the inbox — the `paymentId IS NULL` rule, visible.

Clean up:

```bash
docker exec -i rental-pg psql -U postgres -d rental_dev -c "DELETE FROM payment WHERE external_id='kbemail:seed-1'; DELETE FROM bank_transaction WHERE id='seed-tx-1';"
```

- [ ] **Step 3: Commit**

```bash
pnpm build && npx vite build
git add src/pages/settings/TransactionInbox.tsx
git commit -m "feat(web): inbox for bank transactions needing attention

One row per transaction where paymentId IS NULL and status is not ignored, with
per-status affordances: reparse for parse failures, and for a suspected
duplicate an explicit 'Není duplikát' that reuses the assign endpoint. The
duplicate row explains itself rather than just showing a badge, since the user
is the only one who can tell a resend from two real transfers."
```

---

### Task 17: "Párování plateb" card on the pronájem detail

**Files:**
- Create: `src/pages/contract/PairingCard.tsx`
- Modify: `src/lib/api.ts` — add the missing `put` method
- Modify: `src/pages/ContractDetail.tsx` — render the card in the Přehled tab

**Interfaces:**
- Produces: `PairingCard({ contractId, expectedMonthlyTotal })` where `expectedMonthlyTotal: number | null` is the `monthlyTotal` the page already computes, in haléře.
- Consumes: `/api/contracts/:id/payment-rule`.

- [ ] **Step 1: Add `put` to the frontend API client**

`src/lib/api.ts` exposes `get`/`post`/`patch`/`delete` but **no `put`**, and the rule endpoint is a PUT. Add it to the exported object:

```ts
export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b: unknown) => request<T>('POST', p, b),
  put: <T>(p: string, b: unknown) => request<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  delete: <T>(p: string) => request<T>('DELETE', p),
};

/**
 * The message to show a user for a failed request.
 *
 * `ApiError.message` is only ever the string `API <status>` — the server's real
 * message lives in `body.error.message` (see server/middleware/errors.ts, which
 * serialises an AppError as `{ error: { kind, message, details } }`). So the
 * common `e instanceof Error ? e.message : String(e)` idiom renders "API 422"
 * and throws away the actual explanation. That matters here specifically:
 * validateRuleCriteria's Czech messages were written to be read by the user,
 * and without this helper none of them ever reach the screen.
 */
export function apiErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.body as { error?: { message?: string } } | undefined;
    if (typeof body?.error?.message === 'string' && body.error.message !== '') {
      return body.error.message;
    }
    return `Chyba ${e.status}`;
  }
  return e instanceof Error ? e.message : String(e);
}
```

Every `onError` handler in this plan's UI must use `apiErrorMessage(e)` rather than
`e instanceof Error ? e.message : String(e)`. The repo has 18 pre-existing call sites
using the old idiom; retrofitting those is **out of scope** for this feature, but no new
one should be added.

- [ ] **Step 2: Write the card and its dialog**

Create `src/pages/contract/PairingCard.tsx`:

```tsx
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
          {/* Specifický before Konstantní, matching the read-only card's
              mockup-mandated order — the same data should not be ordered two
              different ways depending on whether you are reading or editing. */}
          <div>
            <Label>Specifický symbol</Label>
            <Input value={form.ss} onChange={e => set('ss')(e.target.value)} />
          </div>
          <div>
            <Label>Konstantní symbol</Label>
            <Input value={form.ks} onChange={e => set('ks')(e.target.value)} />
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
            {/* `cokoliv` for an unset bound, like every other criterion — an em
                dash reads as "missing", but a null bound means "any amount
                matches", which is a different statement. */}
            <p className="font-medium">{!rule ? '—' : rule.amountFrom === null ? ANY : fmtKc(rule.amountFrom)}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-sm">Částka do</span>
            <p className="font-medium">{!rule ? '—' : rule.amountTo === null ? ANY : fmtKc(rule.amountTo)}</p>
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
```

- [ ] **Step 3: Render it on the contract detail**

In `src/pages/ContractDetail.tsx`, add the import next to the other page imports:

```tsx
import { PairingCard } from './contract/PairingCard';
```

Then, in the **Přehled** tab, insert the card after the "Aktuální podmínky" `</Card>` and before the "Sekce Historie smlouvy" comment:

```tsx
          {/* Sekce Párování plateb */}
          {id && <PairingCard contractId={id} expectedMonthlyTotal={monthlyTotal} />}
```

`id` comes from `useParams` and `monthlyTotal` is the haléře total the page already computes for the "Měsíčně celkem" field — confirm both names before inserting:

```bash
grep -n "const { id }\|useParams\|monthlyTotal" src/pages/ContractDetail.tsx | head
```

If `monthlyTotal` is scoped inside the "Aktuální podmínky" IIFE rather than the component body, pass `null` instead and note it — the prefill is a convenience, and a wrong variable would be a compile error rather than a silent bug.

- [ ] **Step 4: Verify by hand**

```bash
pnpm build && npx vite build && pnpm dev
```

On a contract detail → Přehled:

- With no rule and no integration: **Stav → Nenastaveno** (grey), criteria replaced by the explanatory line, button reads **Nastavit**.
- **Nastavit** prefills the amount band from the monthly total ±10 %.
- Saving an empty form → the 422 message *„Pravidlo musí mít alespoň jedno kritérium…"* appears in the dialog.
- Saving `Částka od` 500 / `Částka do` 100 → the inverted-band message.
- After saving a valid rule with an active integration: **Stav → Vše v pořádku** (green), unset criteria render as *cokoliv*, and the card matches the mockup's field order — Stav / Částka od / Částka do, then Číslo účtu / VS / SS / KS.
- Break the integration (edit it to a bogus host, press **Synchronizovat**), reload the contract: **Stav → Chyba** with the IMAP error underneath.

- [ ] **Step 5: Full verification and commit**

```bash
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" pnpm test
pnpm build
npx vite build
git add src/pages/contract/PairingCard.tsx src/lib/api.ts src/pages/ContractDetail.tsx
git commit -m "feat(web): Párování plateb card on the pronájem detail

Field order follows the agreed mockup: Stav / Částka od / Částka do, then účet
and the three symbols, with unset criteria shown as 'cokoliv'. Stav is the
operational health from the server — grey when there is no rule or no active
integration, green on a clean last sync, red with the IMAP error when one
failed.

Creating a rule prefills the amount band from the contract's own monthly total
±10 %, so the common case is one click, and the account field warns that the
prefix is significant — entering it without one is the easiest way to write a
rule that never matches."
```

---

## Plan 3 Definition of Done

- [ ] `TEST_DATABASE_URL=… pnpm test` green
- [ ] `pnpm build` and `npx vite build` both clean
- [ ] `grep -rn "imapPassword" src/ | grep -v "imapPasswordSet\|form.imapPassword\|'imapPassword'"` shows nothing that renders a stored secret
- [ ] Every new list handles loading / error / empty
- [ ] `/settings/api-tokens` still resolves (redirect)
- [ ] Four commits on `feat/bank-payment-pairing`

---

## Whole-feature Definition of Done

Once Plans 1–3 are complete:

- [ ] Full suite green, including `tests/reference-property-2024.test.ts` — this feature adds no allocation or reconciliation logic, so movement there means something leaked
- [ ] `pnpm build`, `npx vite build` clean; CI green on the branch
- [ ] `SECRET_ENCRYPTION_KEY` and `CRON_SECRET` set on the Vercel project (all environments / production respectively) **before** merging, since merging to `main` migrates and deploys production
- [ ] A real end-to-end run: point an integration at the actual mailbox, press **Synchronizovat**, and confirm a real KB notification lands as a payment on the right contract
- [ ] PR opened against `main` with CI green and the branch up to date

## Deferred, with reasons

Recorded so they are decisions rather than omissions:

- **Rule lists per contract** — declined during design in favour of one rule per contract. If rent and services arrive as two separate transfers with different amounts, a single band cannot match both; the workaround is a band wide enough for either, and the existing rent-first allocation sorts out the rest. Revisit only if that turns out to be the normal case (spec risk 6).
- **The near-miss prefix hint in the inbox** — specified in the design's account-normalization section but not built here, because it needs a rules-vs-transaction comparison endpoint that nothing else wants yet. The canonical-form echo in the rule dialog covers the same mistake at the point where it is made.
- **"Target month already fully covered" on a suspected-duplicate row** — the design offers this as displayed context to help judge a resend from a real second transfer. Not built: it needs the payment-breakdown computation for the *original* transaction's contract, which is a second query per row on a list that should stay cheap, and the design already states it is never load-bearing. The row explains the situation in words instead. Worth adding if duplicates turn out to be common rather than rare.
- **Encryption key rotation** — the `v1:` envelope prefix makes it additive later. No rotation script now.
- **Sync failure notifications** (e-mail/push) — the red Stav pill is the only surface, per the spec's scope section.
