import { useMemo, useState } from 'react';
import { BookOpen, Box, Plus, Save, Search, Trash2, X } from 'lucide-react';
import type { StoreType } from '../store';
import type { PrinterModelMapping } from '../types';
import { ask } from '../utils/dialogs';

const emptyMapping = (): PrinterModelMapping => ({ printerModel: '', cartridgeModels: [], drumModels: [] });
const key = (value: string) => value.trim().toLocaleLowerCase('ru');

function ModelTags({ label, tone, values, onChange }: { label: string; tone: 'blue' | 'violet'; values: string[]; onChange: (values: string[]) => void }) {
  const [input, setInput] = useState('');
  const add = () => {
    const additions = input.split(',').map(value => value.trim()).filter(Boolean);
    if (!additions.length) return;
    onChange([...new Set([...values, ...additions])]);
    setInput('');
  };
  const colors = tone === 'blue' ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-violet-200 bg-violet-50 text-violet-800';
  return <div>
    <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</label>
    <div className="min-h-20 rounded-xl border border-gray-200 bg-gray-50/60 p-2">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {values.map(value => <span key={value} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${colors}`}><span>{value}</span><button type="button" aria-label={`Удалить ${value}`} onClick={() => onChange(values.filter(item => item !== value))} className="opacity-50 hover:opacity-100"><X size={11} /></button></span>)}
        {values.length === 0 && <span className="px-1 py-1 text-[11px] italic text-gray-400">Пока ничего не указано</span>}
      </div>
      <div className="flex gap-1.5">
        <input value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} placeholder="Введите модель и нажмите Enter" className="h-8 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs outline-none focus:border-blue-400" />
        <button type="button" onClick={add} className="ui-compact-button h-8 border-gray-200 bg-white text-gray-600 hover:bg-gray-50"><Plus size={13} />Добавить</button>
      </div>
    </div>
  </div>;
}

export default function ModelCatalogTab({ store }: { store: StoreType }) {
  const [search, setSearch] = useState('');
  const [originalModel, setOriginalModel] = useState<string | null>(store.modelCatalog[0]?.printerModel ?? null);
  const initial = store.modelCatalog[0] ?? emptyMapping();
  const [draft, setDraft] = useState<PrinterModelMapping>({ ...initial, cartridgeModels: [...initial.cartridgeModels], drumModels: [...initial.drumModels] });
  const [message, setMessage] = useState('');

  const filtered = useMemo(() => {
    const query = key(search);
    return store.modelCatalog.filter(entry => !query || [entry.printerModel, ...entry.cartridgeModels, ...entry.drumModels].some(value => key(value).includes(query)));
  }, [store.modelCatalog, search]);
  const linkedPrinters = store.printers.filter(printer => originalModel && key(printer.model) === key(originalModel)).length;

  const select = (entry: PrinterModelMapping) => {
    setOriginalModel(entry.printerModel);
    setDraft({ ...entry, cartridgeModels: [...entry.cartridgeModels], drumModels: [...entry.drumModels] });
    setMessage('');
  };
  const create = () => { setOriginalModel(null); setDraft(emptyMapping()); setMessage('Новая модель будет добавлена в справочник.'); };
  const save = () => {
    try {
      store.upsertModelMapping(originalModel, draft);
      setOriginalModel(draft.printerModel.trim());
      setDraft(current => ({ ...current, printerModel: current.printerModel.trim() }));
      setMessage(`Сохранено. Совместимые расходники обновлены${linkedPrinters ? ` у ${linkedPrinters} принтеров` : ''}.`);
    } catch (error) { setMessage(String(error)); }
  };
  const remove = async () => {
    if (!originalModel || !await ask(`Удалить модель «${originalModel}» из справочника? Сами принтеры и расходники удалены не будут.`)) return;
    store.removeModelMapping(originalModel);
    const next = store.modelCatalog.find(entry => key(entry.printerModel) !== key(originalModel));
    if (next) select(next); else create();
    setMessage('Модель удалена только из справочника. Устройства и их история сохранены.');
  };

  return <div className="mx-auto max-w-[1500px] space-y-4">
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-blue-50 p-2.5 text-blue-600"><BookOpen size={20} /></span><div><h2 className="text-base font-bold text-gray-900">Модели расходников</h2><p className="mt-0.5 text-[11px] text-gray-500">Справочник совместимости моделей принтеров, картриджей и драм-картриджей</p></div></div>
        <div className="flex gap-2"><span className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-500"><b className="text-gray-800">{store.modelCatalog.length}</b> моделей</span><button onClick={create} className="ui-compact-button border-blue-600 bg-blue-600 text-white hover:bg-blue-700"><Plus size={14} />Новая модель</button></div>
      </div>
    </section>

    <div className="grid min-h-[65vh] gap-4 lg:grid-cols-[330px_minmax(0,1fr)]">
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-3"><div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input data-scanner="true" value={search} onChange={event => setSearch(event.target.value)} placeholder="Принтер или расходник…" className="h-9 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-xs outline-none focus:border-blue-400" /></div></div>
        <div className="max-h-[62vh] overflow-y-auto p-2">
          {filtered.map(entry => <button key={entry.printerModel} onClick={() => select(entry)} className={`mb-1 w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${originalModel && key(originalModel) === key(entry.printerModel) ? 'border-blue-200 bg-blue-50' : 'border-transparent hover:bg-gray-50'}`}><div className="truncate text-xs font-bold text-gray-800">{entry.printerModel}</div><div className="mt-1 flex gap-2 text-[10px] text-gray-400"><span>{entry.cartridgeModels.length} картр.</span><span>{entry.drumModels.length} драм.</span><span>{store.printers.filter(printer => key(printer.model) === key(entry.printerModel)).length} устройств</span></div></button>)}
          {filtered.length === 0 && <div className="py-12 text-center text-xs italic text-gray-400">Ничего не найдено</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Карточка совместимости</div><h3 className="mt-1 text-lg font-bold text-gray-900">{originalModel ? draft.printerModel : 'Новая модель принтера'}</h3>{originalModel && <p className="mt-1 text-[11px] text-gray-400">Изменение применяется к {linkedPrinters} существующим устройствам этой модели, без изменения их ID и истории.</p>}</div>{originalModel && <button onClick={() => void remove()} className="ui-compact-button border-red-200 bg-white text-red-600 hover:bg-red-50"><Trash2 size={13} />Удалить из справочника</button>}</div>
        <div className="space-y-4">
          <div><label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-gray-500">Модель принтера</label><div className="relative"><Box size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={draft.printerModel} onChange={event => setDraft(current => ({ ...current, printerModel: event.target.value }))} placeholder="Например: HP LaserJet Pro M404dn" className="h-10 w-full rounded-xl border border-gray-200 pl-9 pr-3 text-sm font-semibold outline-none focus:border-blue-400" /></div></div>
          <div className="grid gap-4 xl:grid-cols-2"><ModelTags label="Картриджи" tone="blue" values={draft.cartridgeModels} onChange={values => setDraft(current => ({ ...current, cartridgeModels: values }))} /><ModelTags label="Драм-картриджи" tone="violet" values={draft.drumModels} onChange={values => setDraft(current => ({ ...current, drumModels: values }))} /></div>
          {message && <div role="status" className={`rounded-xl border px-3 py-2 text-xs ${message.startsWith('Error') ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-100 bg-blue-50 text-blue-700'}`}>{message}</div>}
          <div className="flex justify-end border-t border-gray-100 pt-4"><button onClick={save} className="ui-compact-button border-blue-600 bg-blue-600 text-white hover:bg-blue-700"><Save size={14} />Сохранить справочник</button></div>
        </div>
      </section>
    </div>
  </div>;
}
