import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { fmtDate, todayIso } from '@/lib/format';
import { cn } from '@/lib/utils';
import { dueLabel, useReminders, type AgendaItem, type Reminder, type ReminderInput } from '@/hooks/useReminders';

/** Manual reminders as agenda rows. */
export function reminderItems(reminders: Reminder[], hrefFor: (r: Reminder) => string, refFor: (r: Reminder) => string, today = todayIso()): AgendaItem[] {
  return reminders.map(r => {
    const done = r.doneAt !== null;
    const due = dueLabel(r.dueDate, today);
    return {
      key: `rem:${r.id}`, date: r.dueDate, title: r.title, ref: [refFor(r), r.note].filter(Boolean).join(', '), href: hrefFor(r),
      reminderId: r.id, done, left: done ? 'vyřízeno' : due.left, tone: done ? 'done' : due.tone,
    };
  });
}

const DATE_TONE: Record<AgendaItem['tone'], string> = { over: 'text-late', soon: 'text-ink', later: 'text-ink', done: 'text-soft' };
const LEFT_TONE: Record<AgendaItem['tone'], string> = { over: 'text-late', soon: 'text-accent', later: 'text-soft', done: 'text-soft' };

interface AgendaProps {
  title?: string;
  /** Open items in date order; done manual reminders are appended when shown. */
  items: AgendaItem[];
  isPending?: boolean;
  /** Preset for the new-reminder dialog, e.g. the contract the page is about. */
  newDefaults?: Partial<ReminderInput>;
  /** Contracts offered in the dialog's "K pronájmu" select. */
  contracts?: Array<{ id: string; label: string }>;
  emptyText?: string;
}

/**
 * "Termíny a připomínky": derived deadlines mixed with manual reminders. Manual
 * ones have a checkbox and a hover-only delete; derived ones carry a dot and
 * resolve on their own when the underlying thing is done.
 */
export function Agenda({ title = 'Termíny a připomínky', items, isPending, newDefaults, contracts, emptyText = 'Nic nečeká.' }: AgendaProps) {
  const { setDone, remove } = useReminders();
  const [showDone, setShowDone] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const open = items.filter(i => !i.done);
  const doneList = items.filter(i => i.done);
  const overCount = open.filter(i => i.tone === 'over').length;
  const rows = showDone ? [...open, ...doneList] : open;

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>
              {isPending ? 'Načítání…' : open.length === 0 ? 'Nic otevřeného' : `${open.length} ${open.length === 1 ? 'otevřená' : open.length <= 4 ? 'otevřené' : 'otevřených'}${overCount > 0 ? `, ${overCount} po termínu` : ''}`}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}><Plus className="h-3.5 w-3.5" strokeWidth={2.2} />Nová připomínka</Button>
        </CardHeader>
        {!isPending && rows.length === 0 ? (
          <div className="border-t border-rule px-5 py-6 text-center text-sm text-soft">{emptyText}</div>
        ) : rows.map(item => (
          <div key={item.key} className="rem grid grid-cols-[22px_minmax(96px,120px)_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t border-rule px-5 py-2.5">
            {item.reminderId ? (
              <button
                type="button"
                role="checkbox"
                aria-checked={item.done}
                aria-label={`${item.done ? 'Vrátit mezi otevřené' : 'Označit jako vyřízené'}: ${item.title}`}
                disabled={setDone.isPending}
                onClick={() => setDone.mutate({ id: item.reminderId!, done: !item.done })}
                className={cn('inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition-colors', item.done ? 'border-accent bg-accent text-white' : 'border-wait bg-card hover:border-soft')}
              >
                {item.done && <Check className="h-3 w-3" strokeWidth={3.2} />}
              </button>
            ) : (
              <span aria-hidden="true" className="flex justify-center"><i className={cn('h-2 w-2 rounded-full', item.tone === 'over' ? 'bg-late' : item.tone === 'soon' ? 'bg-accent' : 'bg-wait')} /></span>
            )}
            <div className={cn('whitespace-nowrap font-medium', DATE_TONE[item.tone])}>{fmtDate(item.date)}</div>
            <div className="min-w-0">
              <Link to={item.href} className={cn('font-medium text-ink', item.done && 'text-soft line-through')}>{item.title}</Link>
              {item.ref && <span className="ml-2 text-sm text-soft">{item.ref}</span>}
            </div>
            <div className="flex items-center gap-3.5 whitespace-nowrap text-right text-sm">
              <span className={cn('font-medium', LEFT_TONE[item.tone])}>{item.left}</span>
              {item.reminderId && (
                <button type="button" className="acts text-soft hover:text-late disabled:opacity-50" disabled={remove.isPending}
                  onClick={() => { if (confirm(`Smazat připomínku „${item.title}“?`)) remove.mutate(item.reminderId!); }}>Smazat</button>
              )}
            </div>
          </div>
        ))}
        {doneList.length > 0 && (
          <div className="border-t border-rule px-5 py-2.5">
            <button type="button" className="text-sm text-soft hover:text-ink" onClick={() => setShowDone(v => !v)}>
              {showDone ? 'Skrýt vyřízené' : `Zobrazit vyřízené (${doneList.length})`}
            </button>
          </div>
        )}
      </Card>
      {newOpen && <NewReminderDialog defaults={newDefaults} contracts={contracts} onClose={() => setNewOpen(false)} />}
    </>
  );
}

export function NewReminderDialog({ defaults, contracts, onClose }: { defaults?: Partial<ReminderInput>; contracts?: Array<{ id: string; label: string }>; onClose: () => void }) {
  const { create } = useReminders();
  const [form, setForm] = useState({ title: defaults?.title ?? '', dueDate: defaults?.dueDate ?? '', note: defaults?.note ?? '', contractId: defaults?.contractId ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const canSave = form.title.trim() !== '' && form.dueDate !== '' && !create.isPending;
  return (
    <Modal
      title="Nová připomínka"
      onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose}>Zrušit</Button>
        <Button disabled={!canSave} onClick={() => {
          setErr(null);
          create.mutate({ title: form.title.trim(), dueDate: form.dueDate, note: form.note || null, contractId: form.contractId || null, propertyId: defaults?.propertyId ?? null }, {
            onSuccess: onClose,
            onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
          });
        }}>Uložit</Button>
      </>}
    >
      <div>
        <Label htmlFor="rm-title">Co je potřeba udělat</Label>
        <Input id="rm-title" placeholder="např. Poslat vyúčtování služeb" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="rm-date">Termín</Label>
          <Input id="rm-date" type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
        </div>
        {contracts && contracts.length > 0 && (
          <div>
            <Label htmlFor="rm-contract">K pronájmu</Label>
            <select id="rm-contract" className="select-native" value={form.contractId} onChange={e => setForm({ ...form, contractId: e.target.value })} disabled={!!defaults?.contractId}>
              <option value="">Bez vazby</option>
              {contracts.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        )}
      </div>
      <div>
        <Label htmlFor="rm-note">Poznámka</Label>
        <Input id="rm-note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
      </div>
      {err && <p className="text-sm text-late">{err}</p>}
    </Modal>
  );
}
