import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { daysSince, todayIso } from '@/lib/format';

export interface Reminder {
  id: string;
  title: string;
  dueDate: string;
  note: string | null;
  contractId: string | null;
  propertyId: string | null;
  doneAt: string | null;
  createdAt: string;
}

export interface ReminderInput {
  title: string;
  dueDate: string;
  note?: string | null;
  contractId?: string | null;
  propertyId?: string | null;
}

/** Manual reminders and the three mutations the dashboard needs. */
export function useReminders() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['reminders'],
    queryFn: () => api.get<{ reminders: Reminder[] }>('/api/reminders?includeDone=1'),
    select: d => d.reminders,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['reminders'] });
  const create = useMutation({
    mutationFn: (input: ReminderInput) => api.post<{ reminder: Reminder }>('/api/reminders', input),
    onSuccess: invalidate,
  });
  const setDone = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api.patch<{ reminder: Reminder }>(`/api/reminders/${id}`, { done }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/reminders/${id}`),
    onSuccess: invalidate,
  });
  return { query, create, setDone, remove };
}

/** One row of the "Termíny a připomínky" list, manual or derived from the data. */
export interface AgendaItem {
  key: string;
  date: string;
  title: string;
  /** Short context after the title: property, amount, tenant. */
  ref: string;
  href: string;
  /** Manual reminders can be ticked off and deleted; derived ones resolve themselves. */
  reminderId: string | null;
  done: boolean;
  /** Relative label: "za 2 dny", "po termínu o 5 dní", "čeká 23 dní". */
  left: string;
  tone: 'over' | 'soon' | 'later' | 'done';
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n);
  return `${a} ${a === 1 ? one : a >= 2 && a <= 4 ? few : many}`;
}

/** Relative wording and tone for a due date; `soon` is within a week. */
export function dueLabel(date: string, today = todayIso()): { left: string; tone: AgendaItem['tone'] } {
  const diff = -daysSince(date); // days until the date
  if (date < today) return { left: `po termínu o ${plural(-diff, 'den', 'dny', 'dní')}`, tone: 'over' };
  if (diff === 0) return { left: 'dnes', tone: 'soon' };
  return { left: `za ${plural(diff, 'den', 'dny', 'dní')}`, tone: diff <= 7 ? 'soon' : 'later' };
}

/**
 * When the annual statement must reach the tenant: the last day of the fourth
 * month after the billing period ends (a calendar year → 30. 4.).
 */
export function reconciliationDeadline(periodTo: string): string {
  const [y, m] = periodTo.split('-').map(Number) as [number, number, number];
  // Day 0 of month (m + 5) is the last day of month (m + 4); Date handles the year roll-over.
  const d = new Date(Date.UTC(y, m - 1 + 5, 0));
  return d.toISOString().slice(0, 10);
}
