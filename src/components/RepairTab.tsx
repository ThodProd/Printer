
import React, { useEffect, useState, useMemo } from 'react';
import {
  Wrench,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  History as HistoryIcon,
  X,
  AlertTriangle,
  User,
} from 'lucide-react';
import { RepairEntry } from '../types';
import { StoreType } from '../store';
import { useStickyState } from '../utils/useStickyState';

interface NewRepairForm {
  printerInventoryNumber: string;
  reason: string;
  technician: string;
  comment: string;
  includeCartridges: boolean;
  selectedCartridgeIds: string[];
}

const EMPTY_FORM: NewRepairForm = {
  printerInventoryNumber: '',
  reason: '',
  technician: '',
  comment: '',
  includeCartridges: false,
  selectedCartridgeIds: [],
};

const RepairTab: React.FC<{ store: StoreType }> = ({ store }) => {
  const [showAdd, setShowAdd] = useState(false);
  const [showFinish, setShowFinish] = useState<RepairEntry | null>(null);
  const [repairDescription, setRepairDescription] = useState('');
  const [firmwareOnComplete, setFirmwareOnComplete] = useState(false);
  const [newRepair, setNewRepair] = useState<NewRepairForm>(EMPTY_FORM);
  const [editRepair, setEditRepair] = useState<RepairEntry | null>(null);
  const [searchQuery, setSearchQuery] = useStickyState('search_repair_history', '');
  const [printerSearch, setPrinterSearch] = useStickyState('search_repair_select', '');

  useEffect(() => {
    const onScan = (event: Event) => {
      setSearchQuery((event as CustomEvent<string>).detail);
    };
    window.addEventListener('app-scanner-input', onScan as EventListener);
    return () => window.removeEventListener('app-scanner-input', onScan as EventListener);
  }, []);

  const active = store.repairs.filter(r => r.status === 'in_repair' || r.status === 'waiting');
  const history = store.repairs.filter(r => r.status === 'repaired');

  const getPrinterLabel = (invNum: string) => {
    const p = store.printers.find(p => p.inventoryNumber === invNum);
    return p ? `${invNum} — ${p.model}` : invNum;
  };

  const filteredHistory = history.filter(r =>
    r.printerInventoryNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    getPrinterLabel(r.printerInventoryNumber).toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.reason.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Searchable printer list for the add-repair form
  const filteredPrintersForRepair = useMemo(() => {
    const q = printerSearch.toLowerCase();
    if (!q) return store.printers;
    return store.printers.filter(p =>
      p.inventoryNumber.toLowerCase().includes(q) ||
      p.model.toLowerCase().includes(q) ||
      (p.programId ?? '').toLowerCase().includes(q),
    );
  }, [store.printers, printerSearch]);

  const handleAddRepair = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepair.printerInventoryNumber) {
      alert('Выберите принтер');
      return;
    }
    const resolvedPrinter = store.printers.find(p =>
      p.inventoryNumber === newRepair.printerInventoryNumber ||
      (p.programId ?? '').toLowerCase() === newRepair.printerInventoryNumber.toLowerCase(),
    );
    if (!resolvedPrinter) {
      alert('Принтер не найден по инвентарному номеру или ID');
      return;
    }
    const exists = store.repairs.some(r =>
      r.printerInventoryNumber === resolvedPrinter.inventoryNumber &&
      (r.status === 'in_repair' || r.status === 'waiting'),
    );
    if (exists) {
      alert('Этот принтер уже находится в активном ремонте');
      return;
    }
    const repair: RepairEntry = {
      id: Math.random().toString(36).substr(2, 9),
      printerInventoryNumber: resolvedPrinter.inventoryNumber,
      date: new Date().toISOString(),
      reason: newRepair.reason,
      status: 'in_repair',
      locationStatus: 'at_refill',
      technician: newRepair.technician || undefined,
      comment: newRepair.comment || undefined,
    };
    store.addRepair(repair);
    if (newRepair.includeCartridges) {
      store.cartridges
        .filter(c => newRepair.selectedCartridgeIds.includes(c.id))
        .forEach(c => {
          if (c.status === 'on_hand') {
            store.updateCartridgeStatus(
              c.id,
              'waiting',
              'Принят на склад вместе с принтером',
              newRepair.technician || undefined,
              newRepair.technician || undefined,
            );
            store.updateCartridge(c.id, { linkedRepairId: repair.id });
          }
        });
    }
    setNewRepair(EMPTY_FORM);
    setPrinterSearch('');
    setShowAdd(false);
  };

  const handleFinishRepair = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showFinish) return;
    const inv = showFinish.printerInventoryNumber;
    const printerRow = store.printers.find(p => p.inventoryNumber === inv);
    store.updateRepair(showFinish.id, {
      status: 'repaired',
      locationStatus: 'ready',
      completionDate: new Date().toISOString(),
      repairDescription: repairDescription || undefined,
    });
    if (firmwareOnComplete && !printerRow?.firmwareFlashed) {
      store.updatePrinter(inv, { firmwareFlashed: true });
    }
    setShowFinish(null);
    setRepairDescription('');
    setFirmwareOnComplete(false);
  };

  const statusTag = (status: RepairEntry['status']) => {
    switch (status) {
      case 'waiting':   return <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-bold rounded">ОЖИДАЕТ</span>;
      case 'in_repair': return <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-bold rounded">В РЕМОНТЕ</span>;
      case 'repaired':  return <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded">ЗАВЕРШЁН</span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
          <Wrench size={24} className="text-blue-600" />
          <span>Ремонт принтеров</span>
        </h2>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center space-x-2 hover:bg-blue-700 transition-colors text-sm font-bold"
        >
          <Plus size={18} />
          <span>Сдать в ремонт</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active repairs */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-2">
            <Clock size={16} />
            <span>Активные ({active.length})</span>
          </h3>

          {active.length === 0 && (
            <div className="py-12 text-center text-gray-400 italic bg-gray-50 rounded-xl border-2 border-dashed">
              Нет активных заявок
            </div>
          )}

          {active.map(repair => (
            <div
              key={repair.id}
              className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-t border-r border-b border-orange-400"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-bold text-lg">{repair.printerInventoryNumber}</div>
                  <div className="text-xs font-mono text-gray-400">
                    ID: {store.printers.find(p => p.inventoryNumber === repair.printerInventoryNumber)?.programId ?? '—'}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {getPrinterLabel(repair.printerInventoryNumber).split('—')[1]?.trim()}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Принят: {new Date(repair.date).toLocaleDateString('ru-RU')}
                  </div>
                </div>
                {statusTag(repair.status)}
              </div>

              <div className="mb-2">
                <div className="text-xs text-gray-400 uppercase font-bold mb-0.5">Причина:</div>
                <div className="text-gray-700 text-sm">{repair.reason}</div>
              </div>
              <div className="mb-2 text-xs text-gray-500">
                Статус размещения:{' '}
                <span className="font-semibold">
                  {repair.locationStatus === 'ready'
                    ? 'Готов к выдаче'
                    : repair.locationStatus === 'at_refill'
                      ? 'На заправке'
                      : 'Ожидает отправки'}
                </span>
              </div>

              {repair.technician && (
                <div className="flex items-center space-x-1 text-xs text-gray-500 mb-2">
                  <User size={12} />
                  <span>Чей принтер: {repair.technician}</span>
                </div>
              )}

              {repair.comment && (
                <div className="p-2 bg-gray-50 rounded-lg text-xs text-gray-600 italic mb-3">
                  "{repair.comment}"
                </div>
              )}

              <div className="flex space-x-2">
                <button
                  onClick={() => { setShowFinish(repair); setRepairDescription(''); setFirmwareOnComplete(false); }}
                  className="flex-1 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center justify-center space-x-2 text-sm font-bold"
                >
                  <CheckCircle2 size={15} />
                  <span>Завершить</span>
                </button>
                <button
                  onClick={() => setEditRepair(repair)}
                  className="px-3 py-2 border rounded-lg hover:bg-gray-50 text-xs text-gray-500"
                >
                  Редактировать
                </button>
                {store.settings.enableEventEditing && (
                  <button
                    onClick={() => {
                      store.setRepairs(prev => prev.filter(r => r.id !== repair.id));
                      const printer = store.printers.find(p => p.inventoryNumber === repair.printerInventoryNumber);
                      if (printer) {
                        store.updatePrinter(printer.inventoryNumber, { repairCount: Math.max(0, (printer.repairCount ?? 0) - 1) });
                      }
                    }}
                    className="px-3 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 text-xs"
                  >
                    Удалить событие
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* History */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-2">
            <HistoryIcon size={16} />
            <span>История ({history.length})</span>
          </h3>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск по инв. номеру..."
              className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="p-3 font-bold text-xs">Дата</th>
                  <th className="p-3 font-bold text-xs">Принтер</th>
                  <th className="p-3 font-bold text-xs">Проблема</th>
                  <th className="p-3 font-bold text-xs">Решение</th>
                  {store.settings.enableEventEditing && <th className="p-3 font-bold text-xs">Действия</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredHistory.slice().reverse().map(repair => (
                  <tr key={repair.id} className="hover:bg-gray-50">
                    <td className="p-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(repair.date).toLocaleDateString('ru-RU')}
                      {repair.completionDate && (
                        <div className="text-gray-400">→ {new Date(repair.completionDate).toLocaleDateString('ru-RU')}</div>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="font-bold">{repair.printerInventoryNumber}</div>
                      <div className="text-xs text-gray-400">{getPrinterLabel(repair.printerInventoryNumber).split('—')[1]?.trim() || '—'}</div>
                    </td>
                    <td className="p-3 text-gray-600 max-w-[150px] truncate">{repair.reason}</td>
                    <td className="p-3 text-gray-500 max-w-[150px] truncate italic text-xs">
                      {repair.repairDescription ?? '—'}
                    </td>
                    {store.settings.enableEventEditing && (
                      <td className="p-3">
                        <button
                          onClick={() => {
                            store.setRepairs(prev => prev.filter(r => r.id !== repair.id));
                            const printer = store.printers.find(p => p.inventoryNumber === repair.printerInventoryNumber);
                            if (printer) {
                              store.updatePrinter(printer.inventoryNumber, { repairCount: Math.max(0, (printer.repairCount ?? 0) - 1) });
                            }
                            store.addRefillLog({
                              id: Math.random().toString(36).substr(2, 9),
                              date: new Date().toISOString(),
                              cartridgeId: printer?.programId ?? repair.printerInventoryNumber,
                              cartridgeModel: printer?.model ?? 'Устройство',
                              consumableType: 'device',
                              deviceType: printer?.printerType ?? 'Устройство',
                              serviceType: 'cancel',
                              printerInventoryNumber: repair.printerInventoryNumber,
                              printerModel: printer?.model ?? '',
                              department: printer?.department ?? '',
                              action: `Удалено событие ремонта: ${repair.reason}`,
                            });
                          }}
                          className="px-2 py-1 border border-red-200 text-red-600 rounded text-xs hover:bg-red-50"
                        >
                          Удалить
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={store.settings.enableEventEditing ? 5 : 4} className="p-8 text-center text-gray-400 italic">Нет записей</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add repair modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Принять в ремонт</h2>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleAddRepair} className="space-y-4">
              {/* Searchable printer selection */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Принтер (инв. номер или ID) *</label>
                <div className="relative mb-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  <input
                    type="text"
                    placeholder="Введите инв. №, ID или модель..."
                    value={printerSearch}
                    onChange={e => {
                      const val = e.target.value;
                      setPrinterSearch(val);
                      const exact = store.printers.find(p =>
                        p.inventoryNumber.toLowerCase() === val.toLowerCase() ||
                        (p.programId ?? '').toLowerCase() === val.toLowerCase(),
                      );
                      if (exact) {
                        setNewRepair({
                          ...newRepair,
                          printerInventoryNumber: exact.inventoryNumber,
                          technician: newRepair.technician || exact.boss || '',
                          selectedCartridgeIds: store.cartridges
                            .filter(c => c.printerInventoryNumber === exact.inventoryNumber && !c.isReplaced)
                            .map(c => c.id),
                        });
                        setPrinterSearch('');
                      }
                    }}
                    className="w-full pl-9 p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                {newRepair.printerInventoryNumber && (
                  <div className="mb-1 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 font-semibold flex items-center justify-between">
                    <span>{getPrinterLabel(newRepair.printerInventoryNumber)}</span>
                    <button type="button" onClick={() => setNewRepair({ ...newRepair, printerInventoryNumber: '' })} className="text-blue-400 hover:text-blue-600">
                      <X size={14} />
                    </button>
                  </div>
                )}
                {!newRepair.printerInventoryNumber && (
                  <div className="border rounded-lg max-h-40 overflow-y-auto">
                    {filteredPrintersForRepair.length === 0 ? (
                      <div className="p-3 text-center text-gray-400 text-xs italic">Нет принтеров</div>
                    ) : (
                      filteredPrintersForRepair.map(p => (
                        <button
                          key={p.inventoryNumber}
                          type="button"
                          onClick={() => {
                            setNewRepair({
                              ...newRepair,
                              printerInventoryNumber: p.inventoryNumber,
                              technician: newRepair.technician || p.boss || '',
                              selectedCartridgeIds: store.cartridges
                                .filter(c => c.printerInventoryNumber === p.inventoryNumber && !c.isReplaced)
                                .map(c => c.id),
                            });
                            setPrinterSearch('');
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b last:border-0 transition-colors"
                        >
                          <div className="font-bold">{p.inventoryNumber}</div>
                          <div className="text-xs text-gray-500">{p.model}</div>
                          {p.programId && <div className="text-xs text-gray-400 font-mono">ID: {p.programId}</div>}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Описание неисправности *</label>
                <textarea
                  required
                  placeholder="Опишите проблему подробно..."
                  className="w-full p-2.5 border rounded-lg text-sm h-24 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  value={newRepair.reason}
                  onChange={e => setNewRepair({ ...newRepair, reason: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Чей принтер</label>
                <input
                  placeholder="ФИО владельца/мат. ответственного"
                  className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={newRepair.technician}
                  onChange={e => setNewRepair({ ...newRepair, technician: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Комментарий</label>
                <input
                  placeholder="Дополнительно (необязательно)"
                  className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={newRepair.comment}
                  onChange={e => setNewRepair({ ...newRepair, comment: e.target.value })}
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={newRepair.includeCartridges}
                  onChange={e => setNewRepair({ ...newRepair, includeCartridges: e.target.checked })}
                />
                <span>Добавить картриджи принтера в ожидание отправки</span>
              </label>
              {newRepair.includeCartridges && newRepair.printerInventoryNumber && (
                <div className="border rounded-lg max-h-32 overflow-y-auto p-2 space-y-1">
                  {store.cartridges
                    .filter(c => c.printerInventoryNumber === newRepair.printerInventoryNumber && !c.isReplaced)
                    .map(c => (
                      <label key={c.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={newRepair.selectedCartridgeIds.includes(c.id)}
                          onChange={() => setNewRepair({
                            ...newRepair,
                            selectedCartridgeIds: newRepair.selectedCartridgeIds.includes(c.id)
                              ? newRepair.selectedCartridgeIds.filter(id => id !== c.id)
                              : [...newRepair.selectedCartridgeIds, c.id],
                          })}
                        />
                        <span className="font-mono">{c.id}</span>
                        <span>{c.model}</span>
                      </label>
                    ))}
                </div>
              )}
              <div className="flex space-x-2 pt-2">
                <button type="button" onClick={() => setShowAdd(false)}
                  className="flex-1 py-2.5 border rounded-lg text-sm hover:bg-gray-50">Отмена</button>
                <button type="submit"
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">Оформить</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editRepair && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Редактировать ремонт</h2>
              <button onClick={() => setEditRepair(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Причина</label>
                <textarea
                  className="w-full p-2.5 border rounded-lg text-sm h-20"
                  value={editRepair.reason}
                  onChange={e => setEditRepair({ ...editRepair, reason: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Кто сдал</label>
                <input
                  className="w-full p-2.5 border rounded-lg text-sm"
                  value={editRepair.technician ?? ''}
                  onChange={e => setEditRepair({ ...editRepair, technician: e.target.value })}
                />
              </div>
              <button
                onClick={() => {
                  store.updateRepair(editRepair.id, { reason: editRepair.reason, technician: editRepair.technician });
                  setEditRepair(null);
                }}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finish repair modal */}
      {showFinish && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Завершить ремонт</h2>
              <button onClick={() => setShowFinish(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm">
              <div className="font-bold">{showFinish.printerInventoryNumber}</div>
              <div className="text-gray-500 mt-0.5">{showFinish.reason}</div>
            </div>
            <form onSubmit={handleFinishRepair} className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Что было сделано / Решение</label>
                <textarea
                  placeholder="Опишите выполненные работы..."
                  className="w-full p-2.5 border rounded-lg text-sm h-24 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  value={repairDescription}
                  onChange={e => setRepairDescription(e.target.value)}
                />
              </div>
              {(() => {
                const p = store.printers.find(x => x.inventoryNumber === showFinish.printerInventoryNumber);
                const already = !!p?.firmwareFlashed;
                return (
                  <label
                    className={`flex items-start gap-2 text-sm rounded-lg border p-3 ${
                      already ? 'bg-gray-50 border-gray-200 text-gray-500' : 'border-purple-100 bg-purple-50/50 text-gray-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-gray-300 shrink-0"
                      checked={already ? false : firmwareOnComplete}
                      disabled={already}
                      onChange={e => setFirmwareOnComplete(e.target.checked)}
                    />
                    <span>
                      Выполнена прошивка принтера
                      {already && (
                        <span className="block text-xs text-gray-400 mt-0.5">Уже отмечен как прошитый — повторно нельзя</span>
                      )}
                    </span>
                  </label>
                );
              })()}
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center space-x-2 text-sm text-green-700">
                <AlertTriangle size={16} />
                <span>Дата завершения будет установлена автоматически.</span>
              </div>
              <div className="flex space-x-2">
                <button type="button" onClick={() => setShowFinish(null)}
                  className="flex-1 py-2.5 border rounded-lg text-sm hover:bg-gray-50">Отмена</button>
                <button type="submit"
                  className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 flex items-center justify-center space-x-2">
                  <CheckCircle2 size={16} />
                  <span>Завершить</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RepairTab;
