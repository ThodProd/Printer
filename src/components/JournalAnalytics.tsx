import React, { useMemo, useState } from 'react';
import {
  Activity, Building2, CalendarDays, ChevronLeft, ChevronRight,
  Clock3, Droplets, Printer as PrinterIcon, Wrench,
} from 'lucide-react';
import type { Printer, RefillLogEntry } from '../types';
import {
  ActivityRange, buildActivitySeries, buildJournalAnalytics, businessEvents,
  journalEventKind, latestJournalDate, localDateKey,
} from '../utils/logAnalytics';

const RANGE_LABELS: Record<ActivityRange, string> = { weeks: 'Недели', months: 'Месяцы', years: 'Годы' };

function ActivityChart({ entries }: { entries: RefillLogEntry[] }) {
  const [range, setRange] = useState<ActivityRange>('months');
  const points = useMemo(() => buildActivitySeries(entries, range), [entries, range]);
  const width = 760;
  const height = 245;
  const left = 42;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - 16;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(4, ...points.flatMap(point => [point.refills, point.issues, point.repairs]));
  const xFor = (index: number) => left + (plotWidth / Math.max(points.length - 1, 1)) * index;
  const yFor = (value: number) => top + plotHeight - value / maximum * plotHeight;
  const refillLine = points.map((point, index) => `${xFor(index)},${yFor(point.refills)}`).join(' ');
  const issueLine = points.map((point, index) => `${xFor(index)},${yFor(point.issues)}`).join(' ');
  const repairLine = points.map((point, index) => `${xFor(index)},${yFor(point.repairs)}`).join(' ');
  const refillArea = points.length ? `${left},${top + plotHeight} ${refillLine} ${xFor(points.length - 1)},${top + plotHeight}` : '';
  const anchor = latestJournalDate(entries);
  const periodText = range === 'weeks'
    ? `По дням недели · ${anchor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}`
    : range === 'months'
      ? `Каждый день · ${anchor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}`
      : `По месяцам · ${anchor.getFullYear()} год`;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-bold text-slate-800"><Activity size={17} className="text-blue-600" />Динамика обслуживания</div>
          <p className="mt-0.5 text-[11px] text-slate-400">{periodText}</p>
        </div>
        <div className="flex rounded-lg bg-slate-100 p-1 text-[11px] font-semibold">
          {(Object.keys(RANGE_LABELS) as ActivityRange[]).map(value => (
            <button key={value} onClick={() => setRange(value)} className={`rounded-md px-2.5 py-1 transition ${range === value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{RANGE_LABELS[value]}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-blue-500" />Сдача</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Выдача</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-amber-400" />Ремонты</span>
      </div>
      <svg role="img" aria-label="График заправок и ремонтов" className="mt-2 h-auto w-full" viewBox={`0 0 ${width} ${height}`}>
        <defs><linearGradient id="refill-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity="0.24" /><stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" /></linearGradient></defs>
        {[0, 1, 2, 3, 4].map(index => {
          const y = top + (plotHeight / 4) * index;
          const value = Math.round(maximum * (1 - index / 4));
          return <g key={index}><line x1={left} x2={width - 16} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="3 4" /><text x={left - 8} y={y + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{value}</text></g>;
        })}
        {refillArea && <polygon points={refillArea} fill="url(#refill-area)" />}
        <polyline points={refillLine} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={issueLine} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={repairLine} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point, index) => {
          const x = xFor(index);
          const refillY = yFor(point.refills);
          const issueY = yFor(point.issues);
          const repairY = yFor(point.repairs);
          const showAxisLabel = points.length <= 14 || index % 3 === 0 || index === points.length - 1;
          return <g key={point.key}>
            <circle cx={x} cy={refillY} r={point.refills ? 4 : 2} fill="#fff" stroke="#3b82f6" strokeWidth={point.refills ? 2.5 : 1.5}><title>{point.label}: сдач {point.refills}</title></circle>
            <circle cx={x} cy={issueY} r={point.issues ? 4 : 2} fill="#fff" stroke="#10b981" strokeWidth={point.issues ? 2.5 : 1.5}><title>{point.label}: выдач {point.issues}</title></circle>
            <circle cx={x} cy={repairY} r={point.repairs ? 4 : 2} fill="#fff" stroke="#f59e0b" strokeWidth={point.repairs ? 2.5 : 1.5}><title>{point.label}: ремонтов {point.repairs}</title></circle>
            {point.refills > 0 && <text x={x} y={refillY - 8} textAnchor="middle" fontSize="9" fontWeight="700" fill="#2563eb">{point.refills}</text>}
            {point.issues > 0 && <text x={x} y={issueY + (point.issues === point.refills ? 15 : -8)} textAnchor="middle" fontSize="9" fontWeight="700" fill="#059669">{point.issues}</text>}
            {point.repairs > 0 && <text x={x} y={repairY + (point.repairs === point.refills || point.repairs === point.issues ? (point.refills === point.issues ? 27 : 15) : -8)} textAnchor="middle" fontSize="9" fontWeight="700" fill="#d97706">{point.repairs}</text>}
            {showAxisLabel && <text x={x} y={height - 17} textAnchor="middle" fontSize="9" fill="#64748b">{point.label}</text>}
          </g>;
        })}
      </svg>
    </section>
  );
}

function MetricCards({ entries, printers }: { entries: RefillLogEntry[]; printers: Printer[] }) {
  const data = useMemo(() => buildJournalAnalytics(entries, printers), [entries, printers]);
  const average = data.averageRefillDays === null ? '—' : data.averageRefillDays.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const cards = [
    { label: 'Заправок завершено', value: data.completedRefills, note: 'по журналу получения', icon: Droplets, tone: 'bg-blue-50 text-blue-700' },
    { label: 'Ремонтов принято', value: data.repairs, note: 'всего обращений', icon: Wrench, tone: 'bg-amber-50 text-amber-700' },
    { label: 'Среднее время', value: average, suffix: data.averageRefillDays === null ? '' : 'дн.', note: `${data.measuredCycles} полных циклов`, icon: Clock3, tone: 'bg-emerald-50 text-emerald-700' },
    { label: 'Всего событий', value: entries.length, note: 'полный журнал', icon: CalendarDays, tone: 'bg-violet-50 text-violet-700' },
  ];
  return <div className="grid grid-cols-2 gap-3">
    {cards.map(card => <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-xl ${card.tone}`}><card.icon size={16} /></div>
      <div className="flex items-baseline gap-1"><span className="text-2xl font-black tracking-tight text-slate-800">{card.value}</span>{card.suffix && <span className="text-xs font-bold text-slate-500">{card.suffix}</span>}</div>
      <div className="mt-0.5 text-[11px] font-semibold text-slate-600">{card.label}</div>
      <div className="mt-0.5 text-[9px] text-slate-400">{card.note}</div>
    </div>)}
  </div>;
}

function RankingCard({ title, icon, rows, color }: { title: string; icon: React.ReactNode; rows: { key: string; primary: string; secondary?: string; count: number }[]; color: 'blue' | 'violet' }) {
  const maximum = Math.max(1, rows[0]?.count ?? 1);
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">{icon}{title}</div>
    <div className="max-h-[360px] space-y-2.5 overflow-y-auto pr-1.5 journal-ranking-scroll">
      {rows.map((row, index) => <div key={row.key} className="grid grid-cols-[22px_minmax(0,1fr)_34px] items-center gap-2">
        <span className="text-center text-[10px] font-bold text-slate-400">{index + 1}</span>
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[11px] font-bold text-slate-700" title={row.primary}>{row.primary}</span>{row.secondary && <span className="shrink-0 font-mono text-[9px] text-slate-400">{row.secondary}</span>}</div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color === 'blue' ? 'bg-blue-500' : 'bg-violet-500'}`} style={{ width: `${Math.max(4, row.count / maximum * 100)}%` }} /></div>
        </div>
        <span className="text-right text-xs font-black text-slate-600">{row.count}</span>
      </div>)}
      {rows.length === 0 && <div className="py-8 text-center text-xs italic text-slate-400">Пока нет завершённых событий</div>}
    </div>
  </section>;
}

function EventCalendar({ entries }: { entries: RefillLogEntry[] }) {
  const calendarEntries = useMemo(() => [
    ...businessEvents(entries, 'refill_start'),
    ...businessEvents(entries, 'issue'),
    ...businessEvents(entries, 'repair'),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [entries]);
  const latest = useMemo(() => latestJournalDate(calendarEntries), [calendarEntries]);
  const [month, setMonth] = useState(() => new Date(latest.getFullYear(), latest.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(() => localDateKey(latest));
  const byDay = useMemo(() => {
    const map = new Map<string, RefillLogEntry[]>();
    calendarEntries.forEach(entry => {
      const date = new Date(entry.date);
      if (!Number.isFinite(date.getTime())) return;
      const key = localDateKey(date);
      map.set(key, [...(map.get(key) ?? []), entry]);
    });
    map.forEach(list => list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    return map;
  }, [calendarEntries]);
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(start.getDate() - offset);
    return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; });
  }, [month]);
  const selectedEntries = byDay.get(selectedDay) ?? [];
  const moveMonth = (delta: number) => { setMonth(current => new Date(current.getFullYear(), current.getMonth() + delta, 1)); setSelectedDay(''); };

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-2">
    <div className="grid lg:grid-cols-[minmax(430px,1.2fr)_minmax(300px,0.8fr)]">
      <div className="border-b border-slate-100 p-4 lg:border-b-0 lg:border-r">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><CalendarDays size={17} className="text-blue-600" />Календарь событий</div>
          <div className="flex items-center gap-1"><button aria-label="Предыдущий месяц" onClick={() => moveMonth(-1)} className="rounded-lg border p-1.5 text-slate-500 hover:bg-slate-50"><ChevronLeft size={14} /></button><span className="min-w-32 text-center text-xs font-bold capitalize text-slate-700">{month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</span><button aria-label="Следующий месяц" onClick={() => moveMonth(1)} className="rounded-lg border p-1.5 text-slate-500 hover:bg-slate-50"><ChevronRight size={14} /></button></div>
        </div>
        <div className="mb-3 flex flex-wrap gap-3 text-[9px] font-semibold text-slate-500">
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-blue-500" />Сдача</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" />Выдача</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-500" />Ремонт</span>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-bold uppercase text-slate-400">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1">{days.map(date => {
          const key = localDateKey(date); const dayEntries = byDay.get(key) ?? []; const count = dayEntries.length; const kinds = new Set(dayEntries.map(journalEventKind)); const currentMonth = date.getMonth() === month.getMonth(); const selected = key === selectedDay;
          return <button key={key} aria-label={`${date.toLocaleDateString('ru-RU')}: событий ${count}`} onClick={() => setSelectedDay(key)} className={`relative min-h-11 rounded-lg border p-1 text-left transition ${selected ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300' : count ? 'border-slate-200 bg-white hover:border-blue-300' : 'border-transparent hover:bg-slate-50'} ${currentMonth ? 'text-slate-700' : 'text-slate-300'}`}><span className="text-[10px] font-semibold">{date.getDate()}</span>{count > 0 && <><span className="absolute bottom-1 left-1 flex gap-0.5">{kinds.has('refill_start') && <i className="h-1.5 w-1.5 rounded-full bg-blue-500" />}{kinds.has('issue') && <i className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}{kinds.has('repair') && <i className="h-1.5 w-1.5 rounded-full bg-amber-500" />}</span><span className="absolute bottom-1 right-1 rounded-full bg-slate-700 px-1.5 py-0.5 text-[8px] font-bold leading-none text-white">{count}</span></>}</button>;
        })}</div>
      </div>
      <div className="min-h-80 p-4">
        <div className="mb-3 text-sm font-bold text-slate-800">{selectedDay ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Выберите день'}<span className="ml-2 text-[10px] font-normal text-slate-400">{selectedEntries.length ? `${selectedEntries.length} событий` : ''}</span></div>
        <div data-testid="calendar-event-list" className="max-h-[335px] space-y-2 overflow-y-auto pr-1">{selectedEntries.map(entry => {
          const kind = journalEventKind(entry);
          const style = kind === 'refill_start' ? { label: 'Сдача', card: 'border-blue-200 bg-blue-50/60', badge: 'bg-blue-100 text-blue-700' } : kind === 'issue' ? { label: 'Выдача', card: 'border-emerald-200 bg-emerald-50/60', badge: 'bg-emerald-100 text-emerald-700' } : { label: 'Ремонт', card: 'border-amber-200 bg-amber-50/60', badge: 'bg-amber-100 text-amber-700' };
          return <div key={entry.id} className={`rounded-xl border p-2.5 ${style.card}`}><div className="flex items-start justify-between gap-2"><div className="flex min-w-0 items-start gap-2"><span className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold ${style.badge}`}>{style.label}</span><span className="text-[11px] font-semibold leading-4 text-slate-700">{entry.action}</span></div><span className="shrink-0 text-[9px] text-slate-400">{new Date(entry.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span></div><div className="mt-1 flex flex-wrap gap-x-2 text-[9px] text-slate-400"><span className="font-mono">{entry.cartridgeId || entry.entityId || entry.printerInventoryNumber || '—'}</span>{entry.printerInventoryNumber && <span>Инв. {entry.printerInventoryNumber}</span>}{entry.department && <span>{entry.department}</span>}</div></div>;
        })}{selectedDay && selectedEntries.length === 0 && <div className="py-20 text-center text-xs italic text-slate-400">В этот день событий нет</div>}</div>
      </div>
    </div>
  </section>;
}

const JournalAnalytics: React.FC<{ entries: RefillLogEntry[]; printers: Printer[] }> = ({ entries, printers }) => {
  const data = useMemo(() => buildJournalAnalytics(entries, printers), [entries, printers]);
  return <div className="space-y-4">
    <div className="grid gap-4 lg:grid-cols-3"><ActivityChart entries={entries} /><MetricCards entries={entries} printers={printers} /></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <RankingCard title="Топ-10 принтеров по заправкам" icon={<PrinterIcon size={16} className="text-blue-600" />} color="blue" rows={data.topPrinters.map(row => ({ key: row.inv, primary: row.model, secondary: row.inv, count: row.count }))} />
      <RankingCard title="Топ подразделений по сдаче" icon={<Building2 size={16} className="text-violet-600" />} color="violet" rows={data.topDepartments.map(row => ({ key: row.name, primary: row.name, count: row.count }))} />
    </div>
    <div className="grid lg:grid-cols-2"><EventCalendar entries={entries} /></div>
  </div>;
};

export default JournalAnalytics;
