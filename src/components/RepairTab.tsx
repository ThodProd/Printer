
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

interface NewRepairForm {
  printerInventoryNumber: string;
  reason: string;
  technician: string;
  comment: string;
}

const EMPTY_FORM: NewRepairForm = {
  printerInventoryNumber: '',
  reason: '',
  technician: '',
  comment: '',
};

const RepairTab: React.FC<{ store: StoreType }> = ({ store }) => {
  const [showAdd, setShowAdd] = useState(false);
  const [showFinish, setShowFinish] = useState<RepairEntry | null>(null);
  const [repairDescription, setRepairDescription] = useState('');
  const [newRepair, setNewRepair] = useState<NewRepairForm>(EMPTY_FORM);
  const [searchQuery, setSearchQuery] = useState('');
  const [printerSearch, setPrinterSearch] = useState('');

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
    const repair: RepairEntry = {
      id: Math.random().toString(36).substr(2, 9),
      printerInventoryNumber: newRepair.printerInventoryNumber,
      date: new Date().toISOString(),
      reason: newRepair.reason,
      status: 'in_repair',
      technician: newRepair.technician || undefined,
      comment: newRepair.comment || undefined,
    };
    store.addRepair(repair);
    setNewRepair(EMPTY_FORM);
    setPrinterSearch('');
    setShowAdd(false);
  };

  const handleFinishRepair = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showFinish) return;
    store.updateRepair(showFinish.id, {
      status: 'repaired',
      completionDate: new Date().toISOString(),
      repairDescription: repairDescription || undefined,
    });
    setShowFinish(null);
    setRepairDescription('');
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
                  onClick={() => { setShowFinish(repair); setRepairDescription(''); }}
                  className="flex-1 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center justify-center space-x-2 text-sm font-bold"
                >
                  <CheckCircle2 size={15} />
                  <span>Завершить</span>
                </button>
                <button
                  onClick={() => store.updateRepair(repair.id, { status: repair.status === 'waiting' ? 'in_repair' : 'waiting' })}
                  className="px-3 py-2 border rounded-lg hover:bg-gray-50 text-xs text-gray-500"
                >
                  {repair.status === 'waiting' ? 'Взять в работу' : 'Пауза'}
                </button>
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
                  </tr>
                ))}
                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-gray-400 italic">Нет записей</td>
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
                <label className="text-xs text-gray-500 block mb-1">Принтер (инв. номер) *</label>
                <div className="relative mb-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  <input
                    type="text"
                    placeholder="Введите инв. №, ID или модель..."
                    value={printerSearch}
                    onChange={e => setPrinterSearch(e.target.value)}
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
