
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  Package, Plus, Edit2, X, Search, Download, Upload, Barcode as BarcodeIcon,
  Tag, CheckCircle2, AlertCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { NewCartridge } from '../types';
import { StoreType } from '../store';
import { buildTSPLLabel, getTemplate } from '../utils/tspl';
import { useStickyState } from '../utils/useStickyState';
import { ConfirmModal, AlertModal } from './ConfirmModal';

const EMPTY: Omit<NewCartridge, 'id' | 'registrationDate'> = {
  model: '',
  quantity: 1,
  vendor: '',
  description: '',
  location: '',
};

/** Подсказки с прокруткой вместо нативного datalist (в Electron список может разъезжаться на всю высоту). */
const SuggestionTextInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  required?: boolean;
}> = ({ value, onChange, suggestions, placeholder, required }) => {
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const base = q ? suggestions.filter(s => s.toLowerCase().includes(q)) : suggestions;
    return base.slice(0, 200);
  }, [value, suggestions]);

  return (
    <div className="relative">
      <input
        required={required}
        type="text"
        className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        value={value}
        placeholder={placeholder}
        onChange={e => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
        }}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-[60] mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg"
        >
          {filtered.map(s => (
            <li key={s}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left hover:bg-gray-100"
                onMouseDown={e => {
                  e.preventDefault();
                  onChange(s);
                  setOpen(false);
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const NewCartridgesTab: React.FC<{ store: StoreType }> = ({ store }) => {
  const importInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<NewCartridge | null>(null);
  const [form, setForm] = useState<Omit<NewCartridge, 'id' | 'registrationDate'>>(EMPTY);
  const [search, setSearch] = useStickyState('search_new_cartridges', '');
  const [printStatus, setPrintStatus] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [alertModal, setAlertModal] = useState<{ message: string; variant?: 'info' | 'error' | 'success' } | null>(
    null,
  );

  /** После нативного диалога выбора файла / alert в Electron фокус может «залипать» — возвращаем в поле поиска (как на вкладке Принтеры). */
  const scheduleFocusSearch = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus({ preventScroll: true });
      });
    });
  }, []);

  useEffect(() => {
    const onScan = (event: Event) => {
      setSearch((event as CustomEvent<string>).detail);
    };
    window.addEventListener('app-scanner-input', onScan as EventListener);
    return () => window.removeEventListener('app-scanner-input', onScan as EventListener);
  }, []);

  const printerModelSuggestions = useMemo(() => {
    const seen = new Set<string>();
    store.printers.forEach(p => {
      if (p.model) seen.add(p.model);
    });
    return Array.from(seen).sort();
  }, [store.printers]);

  const cartridgeModelSuggestions = useMemo(() => {
    const seen = new Set<string>();
    store.newCartridges.forEach(c => c.model && seen.add(c.model));
    store.cartridges.forEach(c => c.model && seen.add(c.model));
    return Array.from(seen).sort();
  }, [store.newCartridges, store.cartridges]);

  const locationSuggestions = useMemo(() => {
    const seen = new Set<string>();
    store.newCartridges.forEach(c => c.location && seen.add(c.location));
    return Array.from(seen).sort();
  }, [store.newCartridges]);

  const changeQuantity = (id: string, delta: number) => {
    const item = store.newCartridges.find(c => c.id === id);
    if (!item) return;
    store.updateNewCartridge(id, { quantity: Math.max(0, item.quantity + delta) });
  };

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return store.newCartridges;
    return store.newCartridges.filter(
      c =>
        c.id.toLowerCase().includes(q) ||
        c.model.toLowerCase().includes(q) ||
        (c.vendor ?? '').toLowerCase().includes(q) ||
        (c.location ?? '').toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q),
    );
  }, [store.newCartridges, search]);

  const openAdd = () => {
    setEditItem(null);
    setForm(EMPTY);
    setShowAdd(true);
  };

  const openEdit = (item: NewCartridge) => {
    setEditItem(item);
    setForm({
      model: item.model,
      quantity: item.quantity,
      vendor: item.vendor ?? '',
      description: item.description ?? '',
      location: item.location ?? '',
    });
    setShowAdd(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (editItem) {
      store.updateNewCartridge(editItem.id, {
        model: form.model,
        quantity: form.quantity,
        vendor: form.vendor || undefined,
        description: form.description || undefined,
        location: form.location || undefined,
      });
    } else {
      const id = store.generateNewCartridgeId();
      const newItem: NewCartridge = {
        id,
        model: form.model,
        quantity: form.quantity,
        vendor: form.vendor || undefined,
        description: form.description || undefined,
        location: form.location || undefined,
        registrationDate: new Date().toISOString(),
      };
      store.addNewCartridge(newItem);
    }
    setShowAdd(false);
  };

  const handleDelete = () => {
    if (!editItem) return;
    const idToDelete = editItem.id;
    setConfirmModal({
      message: 'Удалить этот картридж со склада?',
      onConfirm: () => {
        store.removeNewCartridge(idToDelete);
        setShowAdd(false);
        setConfirmModal(null);
        scheduleFocusSearch();
      },
    });
  };

  const handlePrint = async (item: NewCartridge) => {
    if (!store.settings.labelPrinterName) {
      setPrintStatus({ id: item.id, text: 'Принтер не выбран (Настройки)', ok: false });
      return;
    }
    if (!window.electronAPI) {
      setPrintStatus({ id: item.id, text: 'Только в desktop-версии', ok: false });
      return;
    }
    const template = getTemplate(store.settings);
    const tspl = buildTSPLLabel(template, store.settings, {
      id: item.id,
      inv: '',
      cartModel: item.model,
      printerModel: item.vendor ?? '',
      quantity: item.quantity,
      location: item.location ?? '',
      description: item.description ?? '',
      vendor: item.vendor ?? '',
      status: 'Новый на складе',
      consumableType: 'Новый картридж',
    });
    const res = await window.electronAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode);
    setPrintStatus({
      id: item.id,
      text: res.success ? 'Этикетка отправлена!' : (res.error ?? 'Ошибка'),
      ok: res.success,
    });
    setTimeout(() => setPrintStatus(null), 3000);
  };

  const exportToExcel = () => {
    const data = filteredItems.map(c => ({
      'ID': c.id,
      'Модель': c.model,
      'Количество': c.quantity,
      'Модель принтера': c.vendor ?? '',
      'Место хранения': c.location ?? '',
      'Описание': c.description ?? '',
      'Дата регистрации': new Date(c.registrationDate).toLocaleString('ru-RU'),
      'Дата регистрации (ISO)': c.registrationDate,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Новые картриджи');
    XLSX.writeFile(wb, `new_cartridges_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    importInputRef.current?.blur();

    let buf: ArrayBuffer;
    try {
      buf = await file.arrayBuffer();
    } catch {
      setAlertModal({ message: 'Не удалось прочитать файл.', variant: 'error' });
      return;
    }

    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      setAlertModal({ message: 'В файле нет листов.', variant: 'error' });
      return;
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '' });
    const existingIds = new Set(store.newCartridges.map(c => c.id));
    let added = 0;
    let updated = 0;

    for (const row of rows) {
      const model = String(row['Модель'] ?? '').trim();
      if (!model) continue;

      const idRaw = String(row['ID'] ?? '').trim();
      const qtyNum = Number(row['Количество']);
      const quantity = Number.isFinite(qtyNum) && qtyNum > 0 ? Math.floor(qtyNum) : 1;

      const iso = String(row['Дата регистрации (ISO)'] ?? '').trim();
      const registrationDate =
        iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString() : new Date().toISOString();

      const vendor = String(row['Модель принтера'] ?? '').trim() || undefined;
      const location = String(row['Место хранения'] ?? '').trim() || undefined;
      const description = String(row['Описание'] ?? '').trim() || undefined;

      if (idRaw && existingIds.has(idRaw)) {
        store.updateNewCartridge(idRaw, {
          model,
          quantity,
          vendor,
          description,
          location,
        });
        updated++;
        continue;
      }

      const id = idRaw && !existingIds.has(idRaw) ? idRaw : store.generateNewCartridgeId();
      existingIds.add(id);

      store.addNewCartridge({
        id,
        model,
        quantity,
        vendor,
        description,
        location,
        registrationDate,
      });
      added++;
    }

    setAlertModal({
      message: `Импорт завершён: добавлено ${added}, обновлено ${updated}.`,
      variant: 'success',
    });
  };

  const totalQty = filteredItems.reduce((sum, c) => sum + c.quantity, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center space-x-3">
          <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
            <Package size={22} className="text-blue-600" />
            <span>Новые картриджи на складе</span>
          </h2>
          <div className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-bold">
            {filteredItems.length} позиций / {totalQty} шт.
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="flex items-center space-x-2 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 text-gray-600"
          >
            <Upload size={14} />
            <span>Импорт</span>
          </button>
          <button
            type="button"
            onClick={exportToExcel}
            className="flex items-center space-x-2 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 text-gray-600"
          >
            <Download size={14} />
            <span>Excel</span>
          </button>
          <button
            onClick={openAdd}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700"
          >
            <Plus size={16} />
            <span>Добавить</span>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
        <input
          ref={searchInputRef}
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по ID, модели, поставщику..."
          className="w-full pl-9 pr-3 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Print status */}
      {printStatus && (
        <div className={`p-3 rounded-xl flex items-center space-x-2 text-sm font-semibold border ${
          printStatus.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {printStatus.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <span>{printStatus.text}</span>
          <span className="font-mono text-xs opacity-60">({printStatus.id})</span>
        </div>
      )}

      {/* List table */}
      {filteredItems.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-gray-300 bg-gray-50 rounded-xl border-2 border-dashed">
          <Package size={48} className="mb-3" />
          <p className="text-sm">
            {search ? 'Ничего не найдено' : 'Нет картриджей на складе'}
          </p>
          {!search && (
            <button onClick={openAdd} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
              Добавить первый
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">ID</th>
                  <th className="px-4 py-3 font-semibold">Модель</th>
                  <th className="px-4 py-3 font-semibold">Кол-во</th>
                  <th className="px-4 py-3 font-semibold">Модель принтера</th>
                  <th className="px-4 py-3 font-semibold">Место</th>
                  <th className="px-4 py-3 font-semibold">Описание</th>
                  <th className="px-4 py-3 font-semibold">Дата</th>
                  <th className="px-4 py-3 font-semibold text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredItems.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handlePrint(item)}
                        className="font-mono font-bold text-blue-700 hover:underline"
                        title="Напечатать типовую наклейку"
                      >
                        {item.id}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-semibold">{item.model}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => changeQuantity(item.id, -1)}
                          className="h-6 w-6 rounded border text-gray-600 hover:bg-gray-50"
                          title="Убрать один"
                        >
                          −
                        </button>
                        <span className="font-bold min-w-6 text-center">{item.quantity}</span>
                        <button
                          onClick={() => changeQuantity(item.id, 1)}
                          className="h-6 w-6 rounded border text-gray-600 hover:bg-gray-50"
                          title="Добавить один"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{item.vendor || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{item.location || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{item.description || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{new Date(item.registrationDate).toLocaleDateString('ru-RU')}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => handlePrint(item)}
                          className="px-2 py-1 text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 flex items-center space-x-1"
                        >
                          <BarcodeIcon size={12} />
                          <span>Штрих-код</span>
                        </button>
                        <button
                          onClick={() => openEdit(item)}
                          className="px-2 py-1 border rounded text-xs text-gray-500 hover:bg-gray-50"
                        >
                          <Edit2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">{editItem ? 'Редактировать' : 'Добавить картридж'}</h2>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {editItem && (
              <div className="mb-3 flex items-center space-x-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <Tag size={12} className="text-blue-500" />
                <span className="font-mono text-sm font-bold text-blue-700">{editItem.id}</span>
                <button
                  onClick={() => handlePrint(editItem)}
                  className="ml-auto flex items-center space-x-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold hover:bg-blue-200"
                >
                  <BarcodeIcon size={10} />
                  <span>Этикетка</span>
                </button>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Модель *</label>
                <SuggestionTextInput
                  required
                  value={form.model}
                  onChange={v => setForm({ ...form, model: v })}
                  suggestions={cartridgeModelSuggestions}
                  placeholder="CF283A"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Модель принтера</label>
                <SuggestionTextInput
                  value={form.vendor ?? ''}
                  onChange={v => setForm({ ...form, vendor: v })}
                  suggestions={printerModelSuggestions}
                  placeholder="Например: Samsung ProXpress M4020ND"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Место хранения</label>
                <SuggestionTextInput
                  value={form.location ?? ''}
                  onChange={v => setForm({ ...form, location: v })}
                  suggestions={locationSuggestions}
                  placeholder="Стеллаж A-3"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Описание</label>
                <input
                  type="text"
                  placeholder="Совместимый, оригинал..."
                  className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={form.description ?? ''}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Количество *</label>
                <input
                  required
                  type="number"
                  min={1}
                  className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={form.quantity}
                  onChange={e => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })}
                />
              </div>

              <div className="flex space-x-2 pt-1">
                <button type="button" onClick={() => setShowAdd(false)}
                  className="flex-1 py-2.5 border rounded-lg text-sm hover:bg-gray-50">Отмена</button>
                <button type="submit"
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
                  {editItem ? 'Сохранить' : 'Добавить'}
                </button>
              </div>

              {editItem && (
                <button type="button" onClick={handleDelete}
                  className="w-full py-2 border border-red-200 text-red-600 bg-red-50 rounded-lg text-sm hover:bg-red-100">
                  Удалить со склада
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          dangerous
          onConfirm={confirmModal.onConfirm}
          onCancel={() => {
            setConfirmModal(null);
            scheduleFocusSearch();
          }}
        />
      )}
      {alertModal && (
        <AlertModal
          message={alertModal.message}
          variant={alertModal.variant}
          onClose={() => {
            setAlertModal(null);
            scheduleFocusSearch();
          }}
        />
      )}
    </div>
  );
};

export default NewCartridgesTab;
