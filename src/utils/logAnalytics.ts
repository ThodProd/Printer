import type { Printer, RefillLogEntry } from '../types';

export type JournalEventKind = 'refill_start' | 'refill_complete' | 'repair' | 'issue' | 'other';
export type ActivityRange = 'weeks' | 'months' | 'years';

export interface ActivityPoint {
  key: string;
  label: string;
  refills: number;
  issues: number;
  repairs: number;
}

const lower = (value: string | undefined) => (value ?? '').toLocaleLowerCase('ru');
const isConsumable = (entry: RefillLogEntry) => entry.consumableType !== 'device' && Boolean(entry.cartridgeId);

export function journalEventKind(entry: RefillLogEntry): JournalEventKind {
  const action = lower(entry.action);
  if (isConsumable(entry) && (action.includes('принят на заправку') || action.includes('сдан на заправку'))) return 'refill_start';
  if (isConsumable(entry) && (action.includes('получен с заправки') || action.includes('принят с заправки'))) return 'refill_complete';
  if ((entry.category === 'repair' || entry.consumableType === 'device') &&
      (action.includes('принят в ремонт') || action.includes('создана заявка на ремонт'))) return 'repair';
  if (isConsumable(entry) && action.includes('выдан')) return 'issue';
  return 'other';
}

const entityKey = (entry: RefillLogEntry, kind: JournalEventKind) =>
  `${kind}:${entry.cartridgeId || entry.entityId || entry.printerInventoryNumber}`;

/** Removes duplicate business log rows emitted by two compatible persistence layers within one minute. */
export function businessEvents(entries: RefillLogEntry[], kind: JournalEventKind): RefillLogEntry[] {
  const result: RefillLogEntry[] = [];
  const lastByEntity = new Map<string, number>();
  const sorted = entries
    .filter(entry => journalEventKind(entry) === kind)
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  for (const entry of sorted) {
    const time = new Date(entry.date).getTime();
    if (!Number.isFinite(time)) continue;
    const key = entityKey(entry, kind);
    const previous = lastByEntity.get(key);
    if (previous !== undefined && time - previous >= 0 && time - previous < 60_000) continue;
    lastByEntity.set(key, time);
    result.push(entry);
  }
  return result;
}

export const localDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function startOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - day);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function latestJournalDate(entries: RefillLogEntry[]): Date {
  const times = entries.map(entry => new Date(entry.date).getTime()).filter(Number.isFinite);
  return new Date(times.length ? Math.max(...times) : Date.now());
}

export function buildActivitySeries(entries: RefillLogEntry[], range: ActivityRange): ActivityPoint[] {
  const refills = businessEvents(entries, 'refill_start');
  const issues = businessEvents(entries, 'issue');
  const repairs = businessEvents(entries, 'repair');
  const anchor = latestJournalDate(entries);
  let points: ActivityPoint[] = [];
  let keyForDate: (date: Date) => string;

  if (range === 'weeks') {
    const current = startOfWeek(anchor);
    points = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(current, index);
      return { key: localDateKey(date), label: date.toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit' }).replace('.', ''), refills: 0, issues: 0, repairs: 0 };
    });
    keyForDate = date => localDateKey(date);
  } else if (range === 'months') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    points = Array.from({ length: daysInMonth }, (_, index) => {
      const date = addDays(first, index);
      return { key: localDateKey(date), label: String(date.getDate()), refills: 0, issues: 0, repairs: 0 };
    });
    keyForDate = date => localDateKey(date);
  } else {
    const first = new Date(anchor.getFullYear(), 0, 1);
    points = Array.from({ length: 12 }, (_, index) => {
      const date = addMonths(first, index);
      return { key: `${date.getFullYear()}-${date.getMonth()}`, label: date.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', ''), refills: 0, issues: 0, repairs: 0 };
    });
    keyForDate = date => `${date.getFullYear()}-${date.getMonth()}`;
  }

  const byKey = new Map(points.map(point => [point.key, point]));
  refills.forEach(entry => { const point = byKey.get(keyForDate(new Date(entry.date))); if (point) point.refills++; });
  issues.forEach(entry => { const point = byKey.get(keyForDate(new Date(entry.date))); if (point) point.issues++; });
  repairs.forEach(entry => { const point = byKey.get(keyForDate(new Date(entry.date))); if (point) point.repairs++; });
  return points;
}

export function buildJournalAnalytics(entries: RefillLogEntry[], printers: Printer[]) {
  const printerByInventory = new Map(printers.map(printer => [printer.inventoryNumber, printer]));
  const completed = businessEvents(entries, 'refill_complete');
  const accepted = businessEvents(entries, 'refill_start');
  const repairs = businessEvents(entries, 'repair');
  const issues = businessEvents(entries, 'issue');

  const printerCounts = new Map<string, { inv: string; model: string; count: number }>();
  completed.forEach(entry => {
    const inv = entry.printerInventoryNumber;
    if (!inv) return;
    const current = printerCounts.get(inv);
    if (current) current.count++;
    else printerCounts.set(inv, { inv, model: entry.printerModel || printerByInventory.get(inv)?.model || 'Без наименования', count: 1 });
  });

  const departmentCounts = new Map<string, number>();
  accepted.forEach(entry => {
    const department = entry.department || printerByInventory.get(entry.printerInventoryNumber)?.department || 'Не указано';
    departmentCounts.set(department, (departmentCounts.get(department) ?? 0) + 1);
  });

  const starts = new Map<string, number>();
  const durations: number[] = [];
  [...accepted.map(entry => ({ entry, kind: 'start' as const })), ...issues.map(entry => ({ entry, kind: 'issue' as const }))]
    .sort((a, b) => new Date(a.entry.date).getTime() - new Date(b.entry.date).getTime())
    .forEach(({ entry, kind }) => {
      if (!entry.cartridgeId) return;
      const time = new Date(entry.date).getTime();
      if (kind === 'start') starts.set(entry.cartridgeId, time);
      else {
        const start = starts.get(entry.cartridgeId);
        if (start !== undefined && time >= start) {
          durations.push((time - start) / 86_400_000);
          starts.delete(entry.cartridgeId);
        }
      }
    });

  return {
    completedRefills: completed.length,
    repairs: repairs.length,
    averageRefillDays: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
    measuredCycles: durations.length,
    topPrinters: [...printerCounts.values()].sort((a, b) => b.count - a.count || a.inv.localeCompare(b.inv, 'ru')),
    topDepartments: [...departmentCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru')),
  };
}
