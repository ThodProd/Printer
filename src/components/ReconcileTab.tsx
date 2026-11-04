import { useMemo, useState } from 'react';
import { AlertTriangle, Archive, ArrowRight, Check, Database, Eye, EyeOff, FileSpreadsheet, FileText, FileUp, Plus, RotateCcw, Save, ShieldCheck, SkipForward, Trash2, X } from 'lucide-react';
import type { StoreType } from '../store';
import type { Printer } from '../types';
import { columns, Change, Field, ReferenceRowAction, displayFieldValue, same, parseDelimited, parseReference, uniquePrinters } from '../utils/reconcile';

export default function ReconcileTab({ store }: { store: StoreType }) {
  const [source, setSource] = useState<Printer[] | null>(null);
  const [baseline, setBaseline] = useState<Printer[]>([]);
  const [decisions, setDecisions] = useState<Record<string, 'accept' | 'skip'>>({});
  const [rowDecisions, setRowDecisions] = useState<Record<string, 'add' | 'remove' | 'decommission'>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [delimiter, setDelimiter] = useState(';');
  const [fileScope, setFileScope] = useState<'partial' | 'full'>('partial');
  const [showUploadDialog, setShowUploadDialog] = useState(false);
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
    const inventories = fileScope === 'full' ? [...new Set([...current.keys(), ...incoming.keys()])] : [...incoming.keys()];
    return inventories
      .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
      .map(inv => ({ inv, old: current.get(inv), next: incoming.get(inv) }))
      .filter(row => row.next || !row.old?.isDecommissioned);
  }, [source, baseline, fileScope]);

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

  const load = async (file?: File, scope: 'partial' | 'full' = fileScope) => {
    if (!file) return;
    setFileScope(scope); setBusy(true); setMessage('Чтение и сверка файла…'); setSource(null); setDecisions({}); setRowDecisions({}); setPage(0); setHideUnchanged(false);
    try {
      uniquePrinters(store.printers);
      let data: string[][];
      if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await import('xlsx');
        const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        if (book.SheetNames.length !== 1) throw new Error('Оставьте в файле один лист для сверки.');
        data = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1, raw: false, defval: '', blankrows: false });
        data = data.map(row => Array.from({ length: Math.max(columns.length, row.length) }, (_, index) => String(row[index] ?? '')));
      } else data = parseDelimited(await file.text(), delimiter);
      const parsed = parseReference(data);
      const current = uniquePrinters(store.printers);
      const incoming = uniquePrinters(parsed);
      const automaticWriteOffs = scope === 'full'
        ? Object.fromEntries(store.printers.filter(printer => !printer.isDecommissioned && !incoming.has(printer.inventoryNumber)).map(printer => [printer.inventoryNumber, 'decommission' as const]))
        : {};
      const automaticAdditions = Object.fromEntries(parsed.filter(printer => !current.has(printer.inventoryNumber)).map(printer => [printer.inventoryNumber, 'add' as const]));
      setBaseline(store.printers); setSource(parsed); setRowDecisions({ ...automaticWriteOffs, ...automaticAdditions });
      const writeOffCount = Object.keys(automaticWriteOffs).length;
      const additionCount = Object.keys(automaticAdditions).length;
      setMessage(`Загружено строк: ${parsed.length}. Проверьте найденные изменения.${additionCount ? ` Новых устройств к добавлению: ${additionCount}.` : ''}${writeOffCount ? ` Отсутствуют в файле и будут списаны: ${writeOffCount}.` : ''}`);
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };

  const templateRows = () => [
    columns.map(([, label]) => label),
    ...store.printers.map(printer => columns.map(([field]) => displayFieldValue(field, printer[field]))),
  ];

  const downloadTextTemplate = () => {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const text = templateRows().map(row => row.map(escape).join(delimiter)).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Шаблон-сверки-базы.txt'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadExcelTemplate = async () => {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet(templateRows());
    sheet['!cols'] = columns.map(([field]) => ({ wch: field === 'boss' || field === 'department' || field === 'model' ? 28 : 17 }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Шаблон сверки');
    XLSX.writeFile(book, 'Шаблон-сверки-базы.xlsx');
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
      <div className="grid gap-px bg-gray-100 lg:grid-cols-3">
        <div className="flex gap-2.5 bg-white px-4 py-3.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">1</span>
          <div className="min-w-0 flex-1"><div className="text-sm font-bold text-gray-800">Скачайте шаблон заполнения</div><div className="mt-1 text-[13px] leading-5 text-gray-600">Скачайте Excel- или TXT-шаблон. В нём уже есть обязательная первая строка с правильными названиями столбцов и данные текущей базы.</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button disabled={busy} onClick={downloadTextTemplate} className="ui-compact-button border-gray-200 bg-white text-gray-700 hover:bg-gray-50"><FileText size={13} /><span>Текстовый шаблон</span></button>
              <button disabled={busy} onClick={() => void downloadExcelTemplate()} className="ui-compact-button border-green-200 bg-green-50 text-green-700 hover:bg-green-100"><FileSpreadsheet size={13} /><span>Excel-шаблон</span></button>
              <select aria-label="Разделитель текстового шаблона" value={delimiter} onChange={event => setDelimiter(event.target.value)} className="h-7 rounded-lg border border-gray-200 bg-white px-2 text-[10px] text-gray-600 outline-none focus:border-blue-400"><option value=";">TXT: точка с запятой</option><option value="\t">TXT: табуляция</option></select>
            </div>
          </div>
        </div>
        <div className="flex gap-2.5 bg-white px-4 py-3.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">2</span><div><div className="text-sm font-bold text-gray-800">Внесите данные</div><div className="mt-1 text-[13px] leading-5 text-gray-600">Первую строку с названиями столбцов обязательно сохраните. Сами столбцы можно переставлять в любом порядке — программа найдёт данные по их названиям. Строки принтеров также можно располагать в любом порядке. Один принтер — одна строка; можно подготовить всю базу или только нужную часть. В TXT используйте выбранный разделитель.</div></div></div>
        <div className="flex gap-2.5 bg-white px-4 py-3.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">3</span><div className="min-w-0 flex-1"><div className="text-sm font-bold text-gray-800">Загрузите и проверьте</div><div className="mt-1 text-[13px] leading-5 text-gray-600">Нажмите «Выбрать файл базы», укажите режим: часть базы или база целиком. После загрузки проверьте найденные изменения и только затем примените нужные.</div><button type="button" disabled={busy} onClick={() => setShowUploadDialog(true)} className="ui-compact-button mt-2 border-blue-600 bg-blue-600 text-white hover:bg-blue-700"><FileUp size={13} /><span>{busy ? 'Загрузка…' : 'Выбрать файл базы'}</span></button></div></div>
      </div>
      <div className="flex flex-wrap items-center gap-2.5 px-5 py-3">
        <details className="group w-full min-w-0 basis-full text-[11px] text-gray-500">
          <summary className="ml-auto w-fit cursor-pointer select-none rounded-lg px-2 py-1.5 hover:bg-gray-50 hover:text-gray-700 max-sm:ml-0">Формат и порядок столбцов</summary>
          <div className="mt-2 w-full min-w-0 rounded-xl border border-gray-200 bg-gray-50/70 p-3">
            <div className="grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {columns.map(([, label], index) => <div key={label} className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-100 bg-white px-2 py-1.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[9px] font-bold text-blue-700">{index + 1}</span><span className="min-w-0 break-words leading-4 text-gray-600">{label}</span></div>)}
            </div>
            <p className="mt-2 break-words text-[13px] leading-5 text-gray-600">Первая строка с названиями столбцов обязательна. Столбцы и строки принтеров можно располагать в любом порядке: программа сопоставляет столбцы по названиям, а устройства — по инвентарным номерам. TXT/CSV должен быть в UTF-8, Excel — с одним листом. Ведущие нули храните как текст. Пустая ячейка предлагает очистить поле. Тип устройства указывается по-русски: «Принтер» или «МФУ». Модели картриджей заполнять не нужно — программа сохраняет их у существующих устройств и автоматически подбирает для новых.</p>
          </div>
        </details>
      </div>
    </section>

    {showUploadDialog && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onMouseDown={event => { if (event.target === event.currentTarget) setShowUploadDialog(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="reconcile-upload-title" className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4"><div><h3 id="reconcile-upload-title" className="text-lg font-bold text-slate-900">Как загрузить базу?</h3><p className="mt-1 text-xs text-slate-500">Выберите, какую часть базы содержит подготовленный файл.</p></div><button type="button" aria-label="Закрыть окно загрузки" onClick={() => setShowUploadDialog(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={17} /></button></div>
        <div className="p-5">
          <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
            <button type="button" aria-pressed={fileScope === 'partial'} onClick={() => setFileScope('partial')} className={`rounded-lg px-3 py-2.5 text-center text-[13px] font-bold transition ${fileScope === 'partial' ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-100' : 'text-slate-500 hover:text-slate-800'}`}>Загрузка части базы</button>
            <button type="button" aria-pressed={fileScope === 'full'} onClick={() => setFileScope('full')} className={`rounded-lg px-3 py-2.5 text-center text-[13px] font-bold transition ${fileScope === 'full' ? 'bg-white text-amber-700 shadow-sm ring-1 ring-amber-100' : 'text-slate-500 hover:text-slate-800'}`}>База целиком</button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className={`rounded-xl border p-3 text-[11px] leading-5 transition ${fileScope === 'partial' ? 'border-blue-200 bg-blue-50/70 text-blue-800' : 'border-slate-100 bg-slate-50 text-slate-400'}`}><div className="mb-1 flex items-center gap-1.5 text-xs font-bold"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-100 text-blue-700">!</span>Безопасно для части</div>Отсутствующие в файле принтеры не изменятся и не будут предложены к списанию.</div>
            <div className={`rounded-xl border p-3 text-[11px] leading-5 transition ${fileScope === 'full' ? 'border-amber-200 bg-amber-50/80 text-amber-900' : 'border-slate-100 bg-slate-50 text-slate-400'}`}><div className="mb-1 flex items-center gap-1.5 text-xs font-bold"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-amber-700">!</span>Проверка всей базы</div>Инвентарные номера, которых нет в файле, будут отмечены как списанные.</div>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-[11px] leading-5 text-violet-800">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-200 font-black text-violet-800">!</span>
            <span><strong>Для всех файлов:</strong> первая строка с названиями столбцов обязательна. Столбцы и строки принтеров можно располагать в любом порядке; для TXT/CSV также используйте выбранный разделитель.</span>
          </div>
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[11px] leading-5 text-emerald-800">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-200 font-black text-emerald-800">!</span>
            <span><strong>Для обоих режимов:</strong> неизвестные инвентарные номера будут определены как новые устройства и отмечены для добавления. ID принтера и расходник программа создаст автоматически после общего сохранения.</span>
          </div>
          <div className="mt-5 flex flex-col items-center">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"><FileUp size={15} /><span>Загрузить файл</span><input data-testid="reconcile-file-input" type="file" accept=".txt,.csv,.tsv,.xlsx,.xls" className="sr-only" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; setShowUploadDialog(false); void load(file, fileScope); }} /></label>
            <span className="mt-1.5 text-[11px] font-medium text-slate-500">Excel или TXT / CSV</span>
          </div>
        </div>
      </section>
    </div>}

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
                {!row.old && <><span className="mt-1 block w-fit rounded bg-orange-50 px-1.5 py-0.5 font-sans text-[9px] text-orange-700">Нет в базе</span><button disabled={busy} aria-pressed={rowDecision === 'add'} onClick={() => chooseRow(row.inv, 'add')} className={`ui-cell-action mt-2 font-sans ${rowDecision === 'add' ? 'border-green-500 bg-green-600 text-white shadow-sm ring-2 ring-green-200' : 'border-green-200 bg-white text-green-700 hover:bg-green-50'}`}>{rowDecision === 'add' ? <Check size={11} /> : <Plus size={10} />}<span>Добавить в базу</span>{rowDecision === 'add' && <span className="ml-1 rounded bg-white/20 px-1 text-[8px] uppercase">выбрано</span>}</button></>}
                {!row.next && <><span className="mt-1 block w-fit rounded bg-gray-100 px-1.5 py-0.5 font-sans text-[9px] text-gray-500">Нет в файле</span><div className="mt-2 flex flex-col items-start gap-1"><button disabled={busy} aria-pressed={rowDecision === 'remove'} onClick={() => chooseRow(row.inv, 'remove')} className={`ui-cell-action font-sans ${rowDecision === 'remove' ? 'border-red-600 bg-red-600 text-white shadow-sm ring-2 ring-red-200' : 'border-red-200 bg-white text-red-700 hover:bg-red-50'}`}>{rowDecision === 'remove' ? <Check size={11} /> : <Trash2 size={10} />}<span>Удалить из базы</span>{rowDecision === 'remove' && <span className="ml-1 rounded bg-white/20 px-1 text-[8px] uppercase">выбрано</span>}</button><button disabled={busy} aria-pressed={rowDecision === 'decommission'} onClick={() => chooseRow(row.inv, 'decommission')} className={`ui-cell-action font-sans ${rowDecision === 'decommission' ? 'border-amber-500 bg-amber-400 text-amber-950 shadow-sm ring-2 ring-amber-200' : 'border-gray-200 bg-white text-gray-600 hover:bg-amber-50 hover:text-amber-700'}`}>{rowDecision === 'decommission' ? <Check size={11} /> : <Archive size={10} />}<span>Пометить списанным</span>{rowDecision === 'decommission' && <span className="ml-1 rounded bg-white/30 px-1 text-[8px] uppercase">выбрано</span>}</button></div></>}
              </td>
              {columns.filter(([field]) => field !== 'inventoryNumber').map(([field]) => {
                const changed = Boolean(row.old && row.next && !same(row.old[field], row.next[field]));
                const decision = decisions[key(row.inv, field)];
                const oldValue = displayFieldValue(field, (row.old ?? row.next)![field]) || '—';
                const nextValue = row.next ? displayFieldValue(field, row.next[field]) || '(очистить)' : '';
                return <td key={field} className={`min-w-40 border-b border-gray-100 px-3 py-2.5 align-top ${!changed ? 'text-gray-400' : decision === 'accept' ? 'bg-green-50/70' : decision === 'skip' ? 'bg-gray-50 text-gray-400' : 'bg-amber-50/70'}`}>
                  {!changed ? <div className="max-w-56 whitespace-pre-wrap leading-4">{oldValue}</div> : <><div className="max-w-56 whitespace-pre-wrap text-[10px] leading-4 text-gray-400 line-through decoration-gray-300">{oldValue}</div><div className={`my-0.5 flex items-center gap-1 text-[9px] ${decision === 'accept' ? 'text-green-500' : 'text-amber-500'}`}><ArrowRight size={10} /><span>новое значение</span></div><div className={`max-w-56 whitespace-pre-wrap font-semibold leading-4 ${decision === 'accept' ? 'text-green-800' : decision === 'skip' ? 'text-gray-400' : 'text-gray-800'}`}>{nextValue}</div><div className="mt-2 flex gap-1"><button disabled={busy} aria-pressed={decision === 'accept'} className={`ui-cell-action ${decision === 'accept' ? 'border-green-500 bg-green-600 text-white shadow-sm ring-2 ring-green-200' : 'border-gray-200 bg-white text-gray-600 hover:border-green-300 hover:text-green-700'}`} onClick={() => setDecisions(current => ({ ...current, [key(row.inv, field)]: 'accept' }))}><Check size={10} />Заменить{decision === 'accept' && <span className="ml-0.5 text-[8px] uppercase">✓</span>}</button><button disabled={busy} aria-pressed={decision === 'skip'} className={`ui-cell-action ${decision === 'skip' ? 'border-slate-500 bg-slate-600 text-white shadow-sm ring-2 ring-slate-200' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-100'}`} onClick={() => setDecisions(current => ({ ...current, [key(row.inv, field)]: 'skip' }))}>{decision === 'skip' ? <Check size={10} /> : <SkipForward size={10} />}Пропустить{decision === 'skip' && <span className="ml-0.5 text-[8px] uppercase">✓</span>}</button></div>{decision && <div className={`mt-1 text-[9px] font-bold uppercase tracking-wide ${decision === 'accept' ? 'text-green-700' : 'text-slate-600'}`}>Выбрано: {decision === 'accept' ? 'заменить' : 'пропустить'}</div>}</>}
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
