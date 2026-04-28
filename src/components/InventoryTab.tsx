
import React, { useEffect, useMemo, useState } from 'react';
import {
  Package,
  Truck,
  CheckSquare,
  Download,
  Calendar,
  Search,
  X,
  Send,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Cartridge, RefillBatch, STATUS_LABELS, STATUS_COLORS } from '../types';
import { StoreType } from '../store';
import { buildTSPLLabel, getTemplate } from '../utils/tspl';

function exportCartridgesToExcel(data: Cartridge[], fileName: string) {
  const rows = data.map(c => ({
    'Код': c.id,
    'Модель': c.model,
    'Принтер (Инв.)': c.printerInventoryNumber,
    'Статус': STATUS_LABELS[c.status],
    'Заправок': c.refillCount,
    'Дата регистрации': new Date(c.registrationDate).toLocaleDateString('ru-RU'),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Склад');
  XLSX.writeFile(wb, `${fileName}_${new Date().toLocaleDateString('ru-RU').replace(/\./g, '-')}.xlsx`);
}

function exportBatchToExcel(batch: RefillBatch, cartridges: Cartridge[]) {
  const rows = cartridges.map(c => ({
    'ID': c.id,
    'Модель': c.model,
    'Принтер': c.printerInventoryNumber,
    'Заправок': c.refillCount,
    'Статус': STATUS_LABELS[c.status],
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, batch.id);
  const info = [{ Партия: batch.id, Дата: new Date(batch.date).toLocaleDateString('ru-RU'), Компания: batch.company ?? '', Примечания: batch.notes ?? '' }];
  const ws2 = XLSX.utils.json_to_sheet(info);
  XLSX.utils.book_append_sheet(wb, ws2, 'Инфо');
  XLSX.writeFile(wb, `batch_${batch.id}_${new Date().toLocaleDateString('ru-RU').replace(/\./g, '-')}.xlsx`);
}

interface SendBatchDialogProps {
  cartridges: Cartridge[];
  onConfirm: (company: string, notes: string) => void;
  onCancel: () => void;
}

const SendBatchDialog: React.FC<SendBatchDialogProps> = ({ cartridges, onConfirm, onCancel }) => {
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
        <h2 className="text-lg font-bold mb-1">Отправить на заправку</h2>
        <p className="text-sm text-gray-500 mb-4">Выбрано: <strong>{cartridges.length} шт.</strong></p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Компания-заправщик</label>
            <input
              value={company}
              onChange={e => setCompany(e.target.value)}
              placeholder="ООО «Картридж-Сервис»"
              className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Примечания</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Дополнительно..."
              className="w-full p-2.5 border rounded-lg text-sm h-20 resize-none focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>
        <div className="flex space-x-3 mt-4">
          <button onClick={onCancel} className="flex-1 py-2.5 border rounded-lg text-sm hover:bg-gray-50">Отмена</button>
          <button onClick={() => onConfirm(company, notes)}
            className="flex-1 py-2.5 bg-yellow-600 text-white rounded-lg text-sm font-bold hover:bg-yellow-700 flex items-center justify-center space-x-2">
            <Send size={15} />
            <span>Отправить</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const InventoryTab: React.FC<{ store: StoreType }> = ({ store }) => {
  const [search, setSearch] = useState('');
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [selectedWaiting, setSelectedWaiting] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onScan = (event: Event) => {
      setSearch((event as CustomEvent<string>).detail);
    };
    window.addEventListener('app-scanner-input', onScan as EventListener);
    return () => window.removeEventListener('app-scanner-input', onScan as EventListener);
  }, []);

  const waiting = useMemo(() => store.cartridges.filter(c => c.status === 'waiting'), [store.cartridges]);
  const received = useMemo(
    () => store.cartridges.filter(c => c.status === 'received_from_refill' || c.status === 'ready'),
    [store.cartridges],
  );
  const sentBatches = useMemo(() => store.batches.filter(b => b.status === 'sent'), [store.batches]);
  const receivedBatches = useMemo(() => store.batches.filter(b => b.status === 'received'), [store.batches]);

  const q = search.toLowerCase();
  const filterCarts = (list: Cartridge[]) =>
    list.filter(
      c =>
        c.id.toLowerCase().includes(q) ||
        c.model.toLowerCase().includes(q) ||
        c.printerInventoryNumber.toLowerCase().includes(q),
    );

  const toggleBatch = (id: string) => {
    setExpandedBatches(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedWaiting(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const toggleSelectAll = () => {
    setSelectedWaiting(prev =>
      prev.size === waiting.length ? new Set() : new Set(waiting.map(c => c.id)),
    );
  };

  const handleSendToRefill = (company: string, notes: string) => {
    const toSend = selectedWaiting.size > 0
      ? waiting.filter(c => selectedWaiting.has(c.id))
      : waiting;

    if (toSend.length === 0) return;

    const year = new Date().getFullYear();
    const seq = store.batches.length + 1;
    const batchId = `REFILL-${year}-${String(seq).padStart(3, '0')}`;

    const newBatch: RefillBatch = {
      id: batchId,
      date: new Date().toISOString(),
      cartridgeIds: toSend.map(c => c.id),
      status: 'sent',
      company: company || undefined,
      notes: notes || undefined,
    };

    store.setBatches(prev => [...prev, newBatch]);
    toSend.forEach(c => {
      store.updateCartridgeStatus(c.id, 'at_refill', `Отправлен на заправку. Партия ${batchId}`);
      const printer = store.printers.find(p => p.inventoryNumber === c.printerInventoryNumber);
      store.addRefillLog({
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        cartridgeId: c.id,
        cartridgeModel: c.model,
        consumableType: c.consumableType ?? 'cartridge',
        printerInventoryNumber: c.printerInventoryNumber,
        printerModel: printer?.model ?? '',
        department: printer?.department ?? '',
        action: company
          ? `Отправлен на заправку (${company}). Партия ${batchId}`
          : `Отправлен на заправку. Партия ${batchId}`,
      });
    });
    setSelectedWaiting(new Set());
    setShowSendDialog(false);
  };

  const handleReceiveFromRefill = (batchId: string) => {
    const batch = store.batches.find(b => b.id === batchId);
    if (!batch) return;
    batch.cartridgeIds.forEach(id => {
      const cartridge = store.cartridges.find(c => c.id === id);
      store.updateCartridgeStatus(id, 'received_from_refill', `Получен с заправки. Партия ${batchId}`);
      if (cartridge) {
        const printer = store.printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
        store.addRefillLog({
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          cartridgeId: cartridge.id,
          cartridgeModel: cartridge.model,
          consumableType: cartridge.consumableType ?? 'cartridge',
          printerInventoryNumber: cartridge.printerInventoryNumber,
          printerModel: printer?.model ?? '',
          department: printer?.department ?? '',
          action: `Получен с заправки. Партия ${batchId}`,
        });
      }
    });
    store.setBatches(prev =>
      prev.map(b => (b.id === batchId ? { ...b, status: 'received' as const } : b)),
    );
  };

  const getBatchCartridges = (batch: RefillBatch) =>
    store.cartridges.filter(c => batch.cartridgeIds.includes(c.id));

  const getPrinter = (inv: string) => store.printers.find(p => p.inventoryNumber === inv);

  const handlePrintCartridge = async (c: Cartridge) => {
    if (!store.settings.labelPrinterName || !window.electronAPI) return;
    const printer = getPrinter(c.printerInventoryNumber);
    const tspl = buildTSPLLabel(getTemplate(store.settings), store.settings, {
      id: c.id,
      inv: c.printerInventoryNumber,
      cartModel: c.model,
      printerModel: printer?.model ?? '',
      fio: printer?.boss ?? '',
      boss: printer?.boss ?? '',
      department: printer?.department ?? '',
      printerType: printer?.printerType ?? '',
      commissionDate: printer?.commissionDate ?? '',
      balanceCost: printer?.balanceCost ?? '',
      consumableType: c.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
      status: STATUS_LABELS[c.status],
    });
    await window.electronAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode);
  };

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Фильтр по коду, модели, принтеру..."
          className="w-full pl-9 pr-8 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
            <X size={14} />
          </button>
        )}
      </div>

      {/* === Ожидают отправки === */}
      <section className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="bg-yellow-50 px-5 py-3.5 border-b border-yellow-100 flex flex-wrap gap-3 justify-between items-center">
          <div className="flex items-center space-x-2 text-yellow-800 font-bold uppercase text-sm">
            <Package size={18} />
            <span>Ожидают отправки ({waiting.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCartridgesToExcel(waiting, 'waiting_refill')}
              className="px-3 py-1.5 bg-white border border-yellow-200 text-yellow-700 rounded-lg hover:bg-yellow-50 flex items-center space-x-1 text-xs font-semibold"
            >
              <Download size={13} />
              <span>Excel</span>
            </button>
            <button
              onClick={() => setShowSendDialog(true)}
              disabled={waiting.length === 0}
              className="px-3 py-1.5 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 flex items-center space-x-1 text-xs font-bold"
            >
              <Truck size={13} />
              <span>Отправить на заправку {selectedWaiting.size > 0 ? `(${selectedWaiting.size})` : `(все)`}</span>
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-400 border-b bg-gray-50/50">
                <th className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={selectedWaiting.size === waiting.length && waiting.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-2.5 font-semibold">Код</th>
                <th className="px-4 py-2.5 font-semibold">Модель</th>
                <th className="px-4 py-2.5 font-semibold">Принтер (Инв.)</th>
                <th className="px-4 py-2.5 font-semibold">Подразделение</th>
                <th className="px-4 py-2.5 font-semibold">Кто сдал</th>
                <th className="px-4 py-2.5 font-semibold">Заправок</th>
                <th className="px-4 py-2.5 font-semibold">Дата приёма</th>
              </tr>
            </thead>
            <tbody>
              {filterCarts(waiting).map(c => {
                const printer = getPrinter(c.printerInventoryNumber);
                return (
                <tr key={c.id} className="border-b last:border-0 hover:bg-yellow-50/40">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedWaiting.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => handlePrintCartridge(c)} className="font-mono font-bold text-yellow-700 hover:underline" title="Напечатать типовую наклейку">
                      {c.id}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">{c.model}</td>
                  <td className="px-4 py-2.5">{c.printerInventoryNumber}</td>
                  <td className="px-4 py-2.5 text-gray-600">{printer?.department || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{c.lastSubmittedBy || '—'}</td>
                  <td className="px-4 py-2.5 text-center">{c.refillCount}</td>
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                    {new Date(c.history[c.history.length - 1]?.date ?? c.registrationDate).toLocaleDateString('ru-RU')}
                  </td>
                </tr>
              );})}
              {filterCarts(waiting).length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400 italic">Склад пуст</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* === На заправке — партии === */}
      <section className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="bg-blue-50 px-5 py-3.5 border-b border-blue-100 flex items-center space-x-2 text-blue-800 font-bold uppercase text-sm">
          <Truck size={18} />
          <span>На заправке — партии ({sentBatches.length})</span>
        </div>
        <div className="p-4 space-y-3">
          {sentBatches.length === 0 && (
            <div className="py-8 text-center text-gray-400 italic">Нет активных партий</div>
          )}
          {sentBatches.map(batch => {
            const carts = getBatchCartridges(batch);
            const expanded = expandedBatches.has(batch.id);
            return (
              <div key={batch.id} className="border border-blue-200 rounded-xl overflow-hidden">
                <div className="flex justify-between items-center px-4 py-3 bg-blue-50/50">
                  <div>
                    <div className="font-bold text-blue-700">{batch.id}</div>
                    <div className="text-xs text-gray-500 flex items-center space-x-1 mt-0.5">
                      <Calendar size={12} />
                      <span>{new Date(batch.date).toLocaleDateString('ru-RU')}</span>
                      {batch.company && <span>· {batch.company}</span>}
                    </div>
                    <div className="text-xs text-gray-500">Картриджей: {carts.length} шт.</div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {/* Export batch to Excel */}
                    <button
                      onClick={() => exportBatchToExcel(batch, carts)}
                      title="Экспорт партии в Excel"
                      className="p-1.5 border rounded-lg hover:bg-gray-100 text-gray-500"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      onClick={() => toggleBatch(batch.id)}
                      className="p-1.5 border rounded-lg hover:bg-blue-100 text-blue-600"
                    >
                      {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <button
                      onClick={() => handleReceiveFromRefill(batch.id)}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 flex items-center space-x-1"
                    >
                      <CheckSquare size={14} />
                      <span>Принять всё</span>
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div className="border-t">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-4 py-2 text-left font-semibold">Код</th>
                          <th className="px-4 py-2 text-left font-semibold">Модель</th>
                          <th className="px-4 py-2 text-left font-semibold">Принтер</th>
                          <th className="px-4 py-2 text-left font-semibold">Подразделение</th>
                          <th className="px-4 py-2 text-left font-semibold">Кто сдал</th>
                          <th className="px-4 py-2 text-left font-semibold">Статус</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {carts.map(c => {
                          const printer = getPrinter(c.printerInventoryNumber);
                          return (
                          <tr key={c.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2">
                              <button onClick={() => handlePrintCartridge(c)} className="font-mono font-bold hover:underline" title="Напечатать типовую наклейку">
                                {c.id}
                              </button>
                            </td>
                            <td className="px-4 py-2">{c.model}</td>
                            <td className="px-4 py-2">{c.printerInventoryNumber}</td>
                            <td className="px-4 py-2">{printer?.department || '—'}</td>
                            <td className="px-4 py-2">{c.lastSubmittedBy || '—'}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[c.status]}`}>
                                {STATUS_LABELS[c.status]}
                              </span>
                            </td>
                          </tr>
                        );})}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* === Готовы к выдаче === */}
      <section className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="bg-green-50 px-5 py-3.5 border-b border-green-100 flex justify-between items-center">
          <div className="flex items-center space-x-2 text-green-800 font-bold uppercase text-sm">
            <CheckSquare size={18} />
            <span>Готовы к выдаче ({received.length})</span>
          </div>
          <button
            onClick={() => exportCartridgesToExcel(received, 'ready_to_handout')}
            className="px-3 py-1.5 bg-white border border-green-200 text-green-700 rounded-lg hover:bg-green-50 flex items-center space-x-1 text-xs font-semibold"
          >
            <Download size={13} />
            <span>Excel</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-400 border-b bg-gray-50/50">
                <th className="px-4 py-2.5 font-semibold">Код</th>
                <th className="px-4 py-2.5 font-semibold">Модель</th>
                <th className="px-4 py-2.5 font-semibold">Принтер (Инв.)</th>
                <th className="px-4 py-2.5 font-semibold">Подразделение</th>
                <th className="px-4 py-2.5 font-semibold">Кто сдал</th>
                <th className="px-4 py-2.5 font-semibold">Заправок</th>
                <th className="px-4 py-2.5 font-semibold">Статус</th>
              </tr>
            </thead>
            <tbody>
              {filterCarts(received).map(c => {
                const printer = getPrinter(c.printerInventoryNumber);
                return (
                <tr key={c.id} className="border-b last:border-0 hover:bg-green-50/30">
                  <td className="px-4 py-2.5">
                    <button onClick={() => handlePrintCartridge(c)} className="font-mono font-bold text-green-700 hover:underline" title="Напечатать типовую наклейку">
                      {c.id}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">{c.model}</td>
                  <td className="px-4 py-2.5">{c.printerInventoryNumber}</td>
                  <td className="px-4 py-2.5 text-gray-600">{printer?.department || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{c.lastSubmittedBy || '—'}</td>
                  <td className="px-4 py-2.5 text-center">{c.refillCount}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${STATUS_COLORS[c.status]}`}>
                      {STATUS_LABELS[c.status]}
                    </span>
                  </td>
                </tr>
              );})}
              {filterCarts(received).length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-gray-400 italic">Нет готовых картриджей</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* История закрытых партий */}
      {receivedBatches.length > 0 && (
        <section className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="bg-gray-50 px-5 py-3.5 border-b flex items-center space-x-2 text-gray-600 font-bold uppercase text-sm">
            <Calendar size={18} />
            <span>Закрытые партии ({receivedBatches.length})</span>
          </div>
          <div className="divide-y">
            {receivedBatches.slice().reverse().map(batch => (
              <div key={batch.id} className="px-5 py-3 flex justify-between items-center text-sm">
                <div>
                  <span className="font-bold text-gray-700">{batch.id}</span>
                  {batch.company && <span className="ml-2 text-gray-500 text-xs">{batch.company}</span>}
                </div>
                <div className="flex items-center space-x-4 text-xs text-gray-400">
                  <span>{new Date(batch.date).toLocaleDateString('ru-RU')}</span>
                  <span>{batch.cartridgeIds.length} шт.</span>
                  <button
                    onClick={() => exportBatchToExcel(batch, getBatchCartridges(batch))}
                    title="Экспорт в Excel"
                    className="p-1 hover:text-gray-600"
                  >
                    <Download size={12} />
                  </button>
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold">ПОЛУЧЕНО</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {showSendDialog && (
        <SendBatchDialog
          cartridges={selectedWaiting.size > 0 ? waiting.filter(c => selectedWaiting.has(c.id)) : waiting}
          onConfirm={handleSendToRefill}
          onCancel={() => setShowSendDialog(false)}
        />
      )}
    </div>
  );
};

export default InventoryTab;
