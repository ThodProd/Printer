import { useMemo, useState } from 'react';
import { AlertTriangle, Archive, ArrowRight, Check, Database, Eye, EyeOff, FileDown, FileUp, Plus, RotateCcw, Save, ShieldCheck, SkipForward, Trash2 } from 'lucide-react';
import type { StoreType } from '../store';
import type { Printer } from '../types';
import { columns, Change, Field, ReferenceRowAction, displayValue, same, parseDelimited, parseReference, uniquePrinters } from '../utils/reconcile';

export default function ReconcileTab({ store }: { store: StoreType }) {
  const [source, setSource] = useState<Printer[] | null>(null);
  const [baseline, setBaseline] = useState<Printer[]>([]);
  const [decisions, setDecisions] = useState<Record<string, 'accept' | 'skip'>>({});
  const [rowDecisions, setRowDecisions] = useState<Record<string, 'add' | 'remove' | 'decommission'>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [delimiter, setDelimiter] = useState(';');
  const [hideUnchanged, setHideUnchanged] = useState(false);
  const key = (inv: string, field: string) => JSON.stringify([inv, field]);
  const chooseRow = (inventoryNumber: string, decision: 'add' | 'remove' | 'decommission') => setRowDecisions(current => {
    const next = { ...current };
    if (next[inventoryNumber] === decision) delete next[inventoryNumber];
    else next[inventoryNumber] = decision;
    return next;
  });

  const rows = useMemo(() => {
    if (!source) return [];
    const current = uniquePrinters(baseline);
    const incoming = uniquePrinters(source);
    return [...new Set([...current.keys(), ...incoming.keys()])]
      .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
      .map(inv => ({ inv, old: current.get(inv), next: incoming.get(inv) }));
  }, [source, baseline]);

  const changes = useMemo(() => rows.flatMap(row => row.old && row.next ? columns.flatMap(([field]) =>
    field !== 'inventoryNumber' && !same(row.old![field], row.next![field])
      ? [{ inventoryNumber: row.inv, field: field as Field, before: row.old![field], after: row.next![field] } as Change]
      : []) : []), [rows]);
  const rowChanged = (row: { old?: Printer; next?: Printer }) => !row.old || !row.next || columns.some(([field]) => !same(row.old![field], row.next![field]));
  const unchangedRows = rows.filter(row => !rowChanged(row)).length;
  const visibleRows = useMemo(() => hideUnchanged ? rows.filter(rowChanged) : rows, [rows, hideUnchanged]);
  const accepted = changes.filter(change => decisions[key(change.inventoryNumber, change.field)] === 'accept');
  const skipped = changes.filter(change => decisions[key(change.inventoryNumber, change.field)] === 'skip');
  const rowActions = rows.flatMap<ReferenceRowAction>(row => {
    const decision = rowDecisions[row.inv];
    if (!row.old && row.next && decision === 'add') return [{ kind: 'add', printer: row.next }];
    if (row.old && !row.next && decision === 'remove') return [{ kind: 'remove', inventoryNumber: row.inv, before: row.old }];
    if (row.old && !row.next && decision === 'decommission') return [{ kind: 'decommission', inventoryNumber: row.inv, before: row.old }];
    return [];
  });
  const pending = changes.length - accepted.length - skipped.length + rows.filter(row => (!row.old || !row.next) && !rowDecisions[row.inv]).length;
  const newRows = rows.filter(row => !row.old).length;
  const missingRows = rows.filter(row => !row.next).length;

  const load = async (file?: File) => {
    if (!file) return;
    setBusy(true); setMessage('Чтение и сверка файла…'); setSource(null); setDecisions({}); setRowDecisions({}); setPage(0); setHideUnchanged(false);
    try {
      uniquePrinters(store.printers);
      let data: string[][];
      if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await import('xlsx');
        const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        if (book.SheetNames.length !== 1) throw new Error('Оставьте в файле один лист для сверки.');
        data = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1, raw: false, defval: '', blankrows: false });
        data = data.map(row => Array.from({ length: Math.max(8, row.length) }, (_, index) => String(row[index] ?? '')));
      } else data = parseDelimited(await file.text(), delimiter);
      const parsed = parseReference(data);
      setBaseline(store.printers); setSource(parsed); setMessage(`Загружено строк: ${parsed.length}. Проверьте найденные изменения.`);
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };

  const template = () => {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const text = [columns.map(([, label]) => label), ...store.printers.map(printer => columns.map(([field]) => displayValue(printer[field])))]
      .map(row => row.map(escape).join(delimiter)).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'reference-template.txt'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const save = async () => {
    setBusy(true);
    try {
      const result = await store.saveReferenceChanges(accepted, rowActions);
      const added = rowActions.filter(action => action.kind === 'add').length;
      const removed = rowActions.filter(action => action.kind === 'remove').length;
      const decommissioned = rowActions.filter(action => action.kind === 'decommission').length;
      setSource(null); setDecisions({}); setRowDecisions({});
      setMessage(`Сохранено ячеек: ${accepted.length}. Добавлено: ${added}. Удалено: ${removed}. Списано: ${decommissioned}. Резервная копия: ${result}`);
    } catch (error) { setMessage(`Не сохранено: ${String(error)}`); }
    finally { setBusy(false); }
  };

  const messageTone = message.startsWith('Не сохранено') || message.includes('Error')
    ? 'border-red-200 bg-red-50 text-red-700'
    : message.startsWith('Сохранено') ? 'border-green-200 bg-green-50 text-green-700' : 'border-blue-100 bg-blue-50 text-blue-700';

  return <div className="mx-auto max-w-[1680px] space-y-4">
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600"><Database size={21} /></div>
          <div><h2 className="text-lg font-bold text-gray-900">Сверка исходной базы</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500">Сопоставление по инвентарному номеру. Для новых устройств можно выполнить штатное добавление с ID и картриджем. Отсутствующие в файле устройства можно удалить либо оставить в истории как списанные.</p></div>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5 text-[11px] font-semibold text-green-700"><ShieldCheck size={14} /><span>Резервная копия перед сохранением</span></div>
      </div>
      <div className="grid gap-px bg-gray-100 sm:grid-cols-3">
        {[
          ['1', 'Скачайте шаблон', 'В нём уже есть текущая база'], ['2', 'Внесите изменения', 'Не меняйте инвентарные номера'], ['3', 'Загрузите и проверьте', 'Примите нужные ячейки'],
        ].map(([number, title, hint]) => <div key={number} className="flex gap-2.5 bg-white px-4 py-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">{number}</span><div><div className="text-xs font-bold text-gray-800">{title}</div><div className="mt-0.5 text-[11px] text-gray-400">{hint}</div></div></div>)}
      </div>
      <div className="flex flex-wrap items-center gap-2.5 px-5 py-4">
        <select aria-label="Разделитель" value={delimiter} onChange={event => setDelimiter(event.target.value)} className="h-8 rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-gray-700 outline-none focus:border-blue-400"><option value=";">Разделитель: точка с запятой</option><option value="\t">Разделитель: табуляция</option></select>
        <button disabled={busy} onClick={template} className="ui-compact-button border-gray-200 bg-white text-gray-700 hover:bg-gray-50"><FileDown size={14} /><span>Скачать шаблон с текущими данными</span></button>
        <label className="ui-compact-button cursor-pointer border-blue-600 bg-blue-600 text-white hover:bg-blue-700"><FileUp size={14} /><span>{busy ? 'Загрузка…' : 'Загрузить новую базу'}</span><input type="file" accept=".txt,.csv,.tsv,.xlsx,.xls" disabled={busy} className="sr-only" onChange={event => { void load(event.target.files?.[0]); event.target.value = ''; }} /></label>
        <details className="group w-full min-w-0 basis-full text-[11px] text-gray-500">
          <summary className="ml-auto w-fit cursor-pointer select-none rounded-lg px-2 py-1.5 hover:bg-gray-50 hover:text-gray-700 max-sm:ml-0">Формат и порядок столбцов</summary>
          <div className="mt-2 w-full min-w-0 rounded-xl border border-gray-200 bg-gray-50/70 p-3">
            <div className="grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {columns.map(([, label], index) => <div key={label} className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-100 bg-white px-2 py-1.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[9px] font-bold text-blue-700">{index + 1}</span><span className="min-w-0 break-words leading-4 text-gray-600">{label}</span></div>)}
            </div>
            <p className="mt-2 break-words leading-5 text-gray-500">TXT/CSV в UTF-8 или Excel с одним листом. Ведущие нули храните как текст. Пустая ячейка предлагает очистить поле. Картриджи разделяются запятыми.</p>
          </div>
        </details>
      </div>
    </section>

    {message && <p role="status" className={`rounded-xl border px-3.5 py-2.5 text-xs whitespace-pre-wrap ${messageTone}`}>{message}</p>}

    {source && <>
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ['Текущая база', baseline.length, 'text-gray-800'], ['Загружено', source.length, 'text-blue-700'], ['Изменений', changes.length, 'text-amber-700'], ['Решений', accepted.length + rowActions.length, 'text-green-700'], ['Новых номеров', newRows, 'text-orange-700'], ['Нет в файле', missingRows, 'text-gray-500'],
        ].map(([label, value, color]) => <div key={String(label)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm"><div className={`text-lg font-bold leading-none ${color}`}>{value}</div><div className="mt-1 text-[10px] uppercase tracking-wide text-gray-400">{label}</div></div>)}
      </section>
      <p className="sr-only">Изменений ячеек: {changes.length}. Принято: {accepted.length}.</p>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5"><div><h3 className="text-xs font-bold text-gray-800">Результат сравнения</h3><p className="mt-0.5 text-[10px] text-gray-400">Жёлтые ячейки требуют решения · зелёные будут сохранены · красные удалены · списанные останутся в истории</p></div><div className="flex flex-wrap items-center justify-end gap-1.5 text-[10px]"><button disabled={unchangedRows === 0} onClick={() => { setHideUnchanged(value => !value); setPage(0); }} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-semibold transition disabled:opacity-40 ${hideUnchanged ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>{hideUnchanged ? <Eye size={12} /> : <EyeOff size={12} />}<span>{hideUnchanged ? `Показать без изменений (${unchangedRows})` : `Скрыть без изменений (${unchangedRows})`}</span></button><span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">Ожидают: {pending}</span><span className="rounded-full bg-green-50 px-2 py-1 text-green-700">Решений: {accepted.length + rowActions.length}</span><span className="rounded-full bg-gray-100 px-2 py-1 text-gray-500">Пропущено: {skipped.length}</span></div></div>
        <div className="max-h-[54vh] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur"><tr>{['ИнвНомер', ...columns.filter(([field]) => field !== 'inventoryNumber').map(([, label]) => label)].map(label => <th key={label} className="border-b border-gray-200 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</th>)}</tr></thead>
            <tbody>{visibleRows.slice(page * 50, (page + 1) * 50).map(row => {
              const rowDecision = rowDecisions[row.inv];
              return <tr key={row.inv} className={`group ${rowDecision === 'remove' ? 'bg-red-50/40' : rowDecision === 'decommission' ? 'bg-amber-50/40' : rowDecision === 'add' ? 'bg-green-50/40' : 'hover:bg-blue-50/20'}`}>
              <td className={`sticky left-0 z-[1] min-w-52 border-b border-gray-100 px-3 py-2.5 align-top font-mono font-bold text-gray-800 ${rowDecision === 'remove' ? 'bg-red-50' : rowDecision === 'decommission' ? 'bg-amber-50' : rowDecision === 'add' ? 'bg-green-50' : 'bg-white group-hover:bg-blue-50/70'}`}>
                {row.inv}
                {!row.old && <><span className="mt-1 block w-fit rounded bg-orange-50 px-1.5 py-0.5 font-sans text-[9px] text-orange-700">Нет в базе</span><button disabled={busy} onClick={() => chooseRow(row.inv, 'add')} className={`ui-cell-action mt-2 font-sans ${rowDecision === 'add' ? 'border-green-300 bg-green-100 text-green-800' : 'border-green-200 bg-white text-green-700 hover:bg-green-50'}`}><Plus size={10} />{rowDecision === 'add' ? 'Будет добавлен' : 'Добавить в базу'}</button></>}
                {!row.next && <><span className="mt-1 block w-fit rounded bg-gray-100 px-1.5 py-0.5 font-sans text-[9px] text-gray-500">Нет в файле</span><div className="mt-2 flex flex-col items-start gap-1"><button disabled={busy} onClick={() => chooseRow(row.inv, 'remove')} className={`ui-cell-action font-sans ${rowDecision === 'remove' ? 'border-red-400 bg-red-600 text-white' : 'border-red-200 bg-white text-red-700 hover:bg-red-50'}`}><Trash2 size={10} />{rowDecision === 'remove' ? 'Будет удалён' : 'Удалить из базы'}</button><button disabled={busy} onClick={() => chooseRow(row.inv, 'decommission')} className={`ui-cell-action font-sans ${rowDecision === 'decommission' ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-gray-200 bg-white text-gray-600 hover:bg-amber-50 hover:text-amber-700'}`}><Archive size={10} />{rowDecision === 'decommission' ? 'Будет списан' : 'Пометить списанным'}</button></div></>}
              </td>
              {columns.filter(([field]) => field !== 'inventoryNumber').map(([field]) => {
                const changed = Boolean(row.old && row.next && !same(row.old[field], row.next[field]));
                const decision = decisions[key(row.inv, field)];
                const oldValue = displayValue((row.old ?? row.next)![field]) || '—';
                const nextValue = row.next ? displayValue(row.next[field]) || '(очистить)' : '';
                return <td key={field} className={`min-w-40 border-b border-gray-100 px-3 py-2.5 align-top ${!changed ? 'text-gray-400' : decision === 'accept' ? 'bg-green-50/70' : decision === 'skip' ? 'bg-gray-50 text-gray-400' : 'bg-amber-50/70'}`}>
                  {!changed ? <div className="max-w-56 whitespace-pre-wrap leading-4">{oldValue}</div> : <><div className="max-w-56 whitespace-pre-wrap text-[10px] leading-4 text-gray-400 line-through decoration-gray-300">{oldValue}</div><div className={`my-0.5 flex items-center gap-1 text-[9px] ${decision === 'accept' ? 'text-green-500' : 'text-amber-500'}`}><ArrowRight size={10} /><span>новое значение</span></div><div className={`max-w-56 whitespace-pre-wrap font-semibold leading-4 ${decision === 'accept' ? 'text-green-800' : decision === 'skip' ? 'text-gray-400' : 'text-gray-800'}`}>{nextValue}</div><div className="mt-2 flex gap-1"><button disabled={busy} className={`ui-cell-action ${decision === 'accept' ? 'border-green-300 bg-green-100 text-green-800' : 'border-gray-200 bg-white text-gray-600 hover:border-green-300 hover:text-green-700'}`} onClick={() => setDecisions(current => ({ ...current, [key(row.inv, field)]: 'accept' }))}><Check size={10} />{decision === 'accept' ? 'Принято' : 'Заменить'}</button><button disabled={busy} className={`ui-cell-action ${decision === 'skip' ? 'border-gray-300 bg-gray-200 text-gray-600' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-100'}`} onClick={() => setDecisions(current => ({ ...current, [key(row.inv, field)]: 'skip' }))}><SkipForward size={10} />Пропустить</button></div></>}
                </td>;
              })}
            </tr>;})}</tbody>
          </table>
        </div>
        <div className="flex items-center justify-center gap-2 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500"><button className="ui-page-button" disabled={page === 0} onClick={() => setPage(current => current - 1)}>Назад</button><span>Страница <b className="text-gray-700">{page + 1}</b> из {Math.max(1, Math.ceil(visibleRows.length / 50))}</span><button className="ui-page-button" disabled={(page + 1) * 50 >= visibleRows.length} onClick={() => setPage(current => current + 1)}>Далее</button></div>
      </section>

      <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white/95 p-2.5 shadow-xl backdrop-blur">
        <button disabled={busy || (changes.length === 0 && newRows === 0)} className="ui-compact-button border-gray-200 bg-white text-gray-700 hover:bg-gray-50" title="Принять изменения ячеек и добавление новых устройств. Удаление и списание всегда выбираются вручную." onClick={() => { setDecisions(Object.fromEntries(changes.map(change => [key(change.inventoryNumber, change.field), 'accept']))); setRowDecisions(current => ({ ...current, ...Object.fromEntries(rows.filter(row => !row.old && row.next).map(row => [row.inv, 'add'])) })); }}><Check size={13} /><span>Применить все</span></button>
        <button disabled={busy} className="ui-compact-button border-gray-200 bg-white text-gray-600 hover:bg-gray-50" onClick={() => { setSource(null); setDecisions({}); setRowDecisions({}); setMessage('Сверка отменена. База не изменена.'); }}><RotateCcw size={13} /><span>Отмена</span></button>
        <div className="ml-auto flex items-center gap-3"><span className="hidden text-[10px] text-gray-400 sm:inline">Основная база изменится только после сохранения</span><button disabled={busy || accepted.length + rowActions.length === 0} onClick={() => void save()} className="ui-compact-button border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:border-gray-200 disabled:bg-gray-200 disabled:text-gray-400">{busy ? <RotateCcw className="animate-spin" size={13} /> : <Save size={13} />}<span>{busy ? 'Сохранение…' : `Сохранить (${accepted.length + rowActions.length})`}</span></button></div>
      </div>
    </>}

    {!source && !message && <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 py-8 text-xs text-gray-400"><AlertTriangle size={15} /><span>Загрузите подготовленный файл, чтобы увидеть сравнение</span></div>}
  </div>;
}
