
import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  History,
  Printer as PrinterIcon,
  Package,
  PackagePlus,
  User,
  Hash,
  MapPin,
  RotateCcw,
  Barcode as BarcodeIcon,
  Tag,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react';
import { Cartridge, Printer, HistoryEntry, STATUS_LABELS, STATUS_COLORS } from '../types';
import { StoreType } from '../store';
import { buildTSPLLabel, getTemplate } from '../utils/tspl';

const SearchTab: React.FC<{ store: StoreType }> = ({ store }) => {
  const [query, setQuery] = useState('');
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(null);
  const [selectedCartridge, setSelectedCartridge] = useState<Cartridge | null>(null);
  const [printStatus, setPrintStatus] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    const onScan = (event: Event) => {
      setQuery((event as CustomEvent<string>).detail);
    };
    window.addEventListener('app-scanner-input', onScan as EventListener);
    return () => window.removeEventListener('app-scanner-input', onScan as EventListener);
  }, []);

  const q = query.toLowerCase();

  const filteredPrinters = useMemo(() => store.printers.filter(
    p =>
      p.inventoryNumber.toLowerCase().includes(q) ||
      p.model.toLowerCase().includes(q) ||
      p.department.toLowerCase().includes(q) ||
      p.boss.toLowerCase().includes(q) ||
      (p.programId ?? '').toLowerCase().includes(q),
  ), [store.printers, q]);

  const filteredCartridges = useMemo(() => store.cartridges.filter(
    c =>
      c.id.toLowerCase().includes(q) ||
      c.model.toLowerCase().includes(q) ||
      c.printerInventoryNumber.toLowerCase().includes(q) ||
      c.barcode.toLowerCase().includes(q),
  ), [store.cartridges, q]);

  const filteredNewCartridges = useMemo(() => store.newCartridges.filter(
    c =>
      c.id.toLowerCase().includes(q) ||
      c.model.toLowerCase().includes(q) ||
      (c.vendor ?? '').toLowerCase().includes(q) ||
      (c.location ?? '').toLowerCase().includes(q) ||
      (c.description ?? '').toLowerCase().includes(q),
  ), [store.newCartridges, q]);

  const getPrinterCartridges = (invNum: string) =>
    store.cartridges.filter((c: Cartridge) => c.printerInventoryNumber === invNum);

  const getLatestRepair = (invNum: string) =>
    store.repairs
      .filter(r => r.printerInventoryNumber === invNum)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

  const handlePrintCartridge = async (cartridge: Cartridge) => {
    if (!store.settings.labelPrinterName) {
      setPrintStatus({ text: 'Принтер этикеток не выбран (Настройки)', ok: false });
      return;
    }
    if (!window.electronAPI) {
      setPrintStatus({ text: 'Только в desktop-версии', ok: false });
      return;
    }
    const template = getTemplate(store.settings);
    const printer = store.printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
    const tspl = buildTSPLLabel(template, store.settings, {
      id: cartridge.id,
      inv: cartridge.printerInventoryNumber,
      cartModel: cartridge.model,
      printerModel: printer?.model ?? '',
      fio: printer?.boss ?? '',
      boss: printer?.boss ?? '',
      department: printer?.department ?? '',
      printerType: printer?.printerType ?? '',
      commissionDate: printer?.commissionDate ?? '',
      balanceCost: printer?.balanceCost ?? '',
      consumableType: cartridge.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
      status: STATUS_LABELS[cartridge.status],
    });
    const res = await window.electronAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode);
    setPrintStatus(res.success
      ? { text: `Этикетка ${cartridge.id} отправлена`, ok: true }
      : { text: res.error ?? 'Ошибка', ok: false }
    );
    setTimeout(() => setPrintStatus(null), 3000);
  };

  const handlePrintPrinter = async (printer: Printer) => {
    if (!store.settings.labelPrinterName) {
      setPrintStatus({ text: 'Принтер этикеток не выбран (Настройки)', ok: false });
      return;
    }
    if (!window.electronAPI) {
      setPrintStatus({ text: 'Только в desktop-версии', ok: false });
      return;
    }
    const template = getTemplate(store.settings);
    const barcodeId = printer.programId ?? printer.inventoryNumber;
    const tspl = buildTSPLLabel(template, store.settings, {
      id: barcodeId,
      inv: printer.inventoryNumber,
      printerModel: printer.model,
      fio: printer.boss,
      boss: printer.boss,
      department: printer.department,
      printerType: printer.printerType,
      commissionDate: printer.commissionDate,
      balanceCost: printer.balanceCost,
    });
    const res = await window.electronAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode);
    setPrintStatus(res.success
      ? { text: `Этикетка принтера ${printer.inventoryNumber} отправлена`, ok: true }
      : { text: res.error ?? 'Ошибка', ok: false }
    );
    setTimeout(() => setPrintStatus(null), 3000);
  };

  return (
    <div className="space-y-5">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Поиск по инв. номеру, ID, модели, сотруднику, подразделению, коду картриджа..."
          className="w-full pl-12 pr-10 py-3 bg-white border border-gray-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <RotateCcw size={16} />
          </button>
        )}
      </div>

      {printStatus && (
        <div className={`p-3 rounded-xl flex items-center justify-between border text-sm font-semibold ${
          printStatus.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          <div className="flex items-center space-x-2">
            {printStatus.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{printStatus.text}</span>
          </div>
          <button onClick={() => setPrintStatus(null)}><X size={14} /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Results list */}
        <div className="space-y-5">
          {/* Printers */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="p-4 border-b bg-gray-50 flex items-center space-x-2 font-bold text-gray-700 text-sm">
              <PrinterIcon size={16} />
              <span>Принтеры ({filteredPrinters.length})</span>
            </div>
            <div className="divide-y max-h-[380px] overflow-auto">
              {filteredPrinters.map(p => {
                const cartCount = getPrinterCartridges(p.inventoryNumber).length;
                return (
                  <button
                    key={p.inventoryNumber}
                    onClick={() => { setSelectedPrinter(p); setSelectedCartridge(null); }}
                    className={`w-full text-left p-4 hover:bg-blue-50 transition-colors ${
                      selectedPrinter?.inventoryNumber === p.inventoryNumber
                        ? 'bg-blue-50 border-l-4 border-blue-500'
                        : ''
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-base">{p.inventoryNumber}</div>
                        {p.programId && (
                          <div className="flex items-center space-x-1 text-xs text-gray-400">
                            <Tag size={10} />
                            <span className="font-mono">{p.programId}</span>
                          </div>
                        )}
                        <div className="text-sm text-gray-600">{p.model}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{p.department}{p.boss ? ` — ${p.boss}` : ''}</div>
                      </div>
                      <div className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full shrink-0 ml-2">
                        {cartCount} картр.
                      </div>
                    </div>
                  </button>
                );
              })}
              {filteredPrinters.length === 0 && (
                <div className="p-6 text-center text-gray-400 italic">Ничего не найдено</div>
              )}
            </div>
          </div>

          {/* Cartridges */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="p-4 border-b bg-gray-50 flex items-center space-x-2 font-bold text-gray-700 text-sm">
              <Package size={16} />
              <span>Картриджи ({filteredCartridges.length})</span>
            </div>
            <div className="divide-y max-h-[380px] overflow-auto">
              {filteredCartridges.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedCartridge(c); setSelectedPrinter(null); }}
                  className={`w-full text-left p-4 hover:bg-blue-50 transition-colors ${
                    selectedCartridge?.id === c.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold font-mono text-sm">{c.id}</div>
                      <div className="text-sm text-gray-600">{c.model}</div>
                      <div className="text-xs text-gray-400 mt-0.5">Принтер: {c.printerInventoryNumber}</div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ml-2 ${STATUS_COLORS[c.status]}`}>
                      {STATUS_LABELS[c.status]}
                    </span>
                  </div>
                </button>
              ))}
              {filteredCartridges.length === 0 && (
                <div className="p-6 text-center text-gray-400 italic">Ничего не найдено</div>
              )}
            </div>
          </div>

          {/* New cartridges */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="p-4 border-b bg-gray-50 flex items-center space-x-2 font-bold text-gray-700 text-sm">
              <PackagePlus size={16} />
              <span>Новые картриджи ({filteredNewCartridges.length})</span>
            </div>
            <div className="divide-y max-h-[280px] overflow-auto">
              {filteredNewCartridges.map(c => (
                <div key={c.id} className="p-4 hover:bg-blue-50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold font-mono text-sm text-blue-700">{c.id}</div>
                      <div className="text-sm text-gray-700 font-semibold">{c.model}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {c.vendor || 'поставщик не указан'} · {c.location || 'место не указано'}
                      </div>
                      {c.description && <div className="text-xs text-gray-500 mt-0.5">{c.description}</div>}
                    </div>
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold shrink-0 ml-2">
                      {c.quantity} шт.
                    </span>
                  </div>
                </div>
              ))}
              {filteredNewCartridges.length === 0 && (
                <div className="p-6 text-center text-gray-400 italic">Ничего не найдено</div>
              )}
            </div>
          </div>
        </div>

        {/* Detail view */}
        <div className="space-y-5">
          {selectedPrinter && (
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="p-6 bg-blue-700 text-white">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-2xl font-bold">{selectedPrinter.inventoryNumber}</h2>
                    {selectedPrinter.programId && (
                      <div className="flex items-center space-x-1 opacity-70 text-xs mt-0.5">
                        <Tag size={11} />
                        <span className="font-mono">ID: {selectedPrinter.programId}</span>
                      </div>
                    )}
                    <p className="opacity-80 text-sm mt-0.5">{selectedPrinter.model}</p>
                  </div>
                  <PrinterIcon size={28} className="opacity-40" />
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-gray-400 text-xs mb-0.5 flex items-center space-x-1"><MapPin size={12} /><span>Подразделение</span></div>
                    <div className="font-semibold">{selectedPrinter.department || '—'}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-xs mb-0.5 flex items-center space-x-1"><Hash size={12} /><span>Мат. ответственный</span></div>
                    <div className="font-semibold">{selectedPrinter.boss || '—'}</div>
                  </div>
                </div>

                {/* Print button for printer */}
                <button
                  onClick={() => handlePrintPrinter(selectedPrinter)}
                  className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-bold flex items-center justify-center space-x-2 hover:bg-blue-700"
                >
                  <BarcodeIcon size={14} />
                  <span>Напечатать штрих-код принтера</span>
                </button>

                {/* Last repair */}
                {(() => {
                  const r = getLatestRepair(selectedPrinter.inventoryNumber);
                  if (!r) return null;
                  return (
                    <div className="p-3 bg-orange-50 border border-orange-100 rounded-lg text-sm">
                      <div className="text-xs text-orange-500 font-bold uppercase mb-0.5">Последний ремонт</div>
                      <div className="text-orange-800">{r.reason}</div>
                      <div className="text-xs text-orange-400 mt-0.5">
                        {new Date(r.date).toLocaleDateString('ru-RU')} — {r.status === 'repaired' ? 'Завершён' : 'В работе'}
                      </div>
                    </div>
                  );
                })()}

                <div className="border-t pt-3">
                  <h3 className="font-bold text-gray-600 text-xs uppercase mb-2">Картриджи принтера</h3>
                  <div className="space-y-2">
                    {getPrinterCartridges(selectedPrinter.inventoryNumber).map(c => (
                      <div
                        key={c.id}
                        className="flex justify-between items-center p-2.5 bg-gray-50 rounded-lg"
                      >
                        <div
                          className="flex-1 cursor-pointer hover:text-blue-600"
                          onClick={() => setSelectedCartridge(c)}
                        >
                          <span className="font-mono font-bold text-blue-600 text-sm">{c.id}</span>
                          <span className="ml-2 text-xs text-gray-500">{c.model}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${STATUS_COLORS[c.status]}`}>
                            {STATUS_LABELS[c.status]}
                          </span>
                          <button
                            onClick={() => handlePrintCartridge(c)}
                            title="Напечатать этикетку"
                            className="p-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                          >
                            <BarcodeIcon size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {getPrinterCartridges(selectedPrinter.inventoryNumber).length === 0 && (
                      <div className="text-xs text-gray-400 italic">Нет картриджей</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedCartridge && (
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="p-6 bg-green-600 text-white">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-xl font-bold font-mono">{selectedCartridge.id}</h2>
                    <p className="opacity-80 text-sm mt-0.5">{selectedCartridge.model}</p>
                  </div>
                  <Package size={28} className="opacity-40" />
                </div>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                  <div>
                    <div className="text-gray-400 text-xs">Принтер</div>
                    <div className="font-bold">{selectedCartridge.printerInventoryNumber}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-xs">Статус</div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${STATUS_COLORS[selectedCartridge.status]}`}>
                      {STATUS_LABELS[selectedCartridge.status]}
                    </span>
                  </div>
                  <div>
                    <div className="text-gray-400 text-xs">Заправок</div>
                    <div className="font-bold">{selectedCartridge.refillCount}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 text-xs">Зарегистрирован</div>
                    <div className="font-semibold text-xs">
                      {new Date(selectedCartridge.registrationDate).toLocaleDateString('ru-RU')}
                    </div>
                  </div>
                </div>

                {/* Print button for cartridge */}
                <button
                  onClick={() => handlePrintCartridge(selectedCartridge)}
                  className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-bold flex items-center justify-center space-x-2 hover:bg-green-700 mb-4"
                >
                  <BarcodeIcon size={14} />
                  <span>Напечатать этикетку расходника</span>
                </button>

                {selectedCartridge.isReplaced && (
                  <div className="mb-3 p-2 bg-gray-100 text-gray-500 rounded-lg text-xs italic">
                    Картридж заменён{selectedCartridge.replacedById ? ` → ${selectedCartridge.replacedById}` : ''}
                  </div>
                )}

                <h3 className="font-bold text-gray-600 text-xs uppercase mb-3 flex items-center space-x-1">
                  <History size={13} />
                  <span>История операций</span>
                </h3>
                <div className="space-y-3 max-h-[400px] overflow-auto">
                  {selectedCartridge.history.slice().reverse().map((entry: HistoryEntry) => (
                    <div key={entry.id} className="relative pl-5 pb-3 border-l-2 border-gray-100 last:border-0 last:pb-0">
                      <div className="absolute left-[-7px] top-1 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white" />
                      <div className="text-[11px] text-gray-400">{new Date(entry.date).toLocaleString('ru-RU')}</div>
                      <div className="font-semibold text-sm text-gray-800">{entry.action}</div>
                      {entry.employee && (
                        <div className="text-xs text-gray-500 flex items-center space-x-1 mt-0.5">
                          <User size={11} />
                          <span>{entry.employee}</span>
                        </div>
                      )}
                      {entry.comment && (
                        <div className="text-xs text-gray-500 italic mt-0.5">"{entry.comment}"</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!selectedPrinter && !selectedCartridge && (
            <div className="h-64 flex flex-col items-center justify-center text-gray-300 bg-gray-50 rounded-xl border-2 border-dashed">
              <Search size={40} className="mb-3" />
              <p className="text-sm">Выберите объект для просмотра</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchTab;
