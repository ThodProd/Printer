
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
  const [formError, setFormError] = useState<string | null>(null);

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

  const getPrinterDept = (invNum: string) =>
    store.printers.find(p => p.inventoryNumber === invNum)?.department?.trim() || '';

  const filteredHistory = history.filter(r => {
    const q = searchQuery.toLowerCase();
    const dept = getPrinterDept(r.printerInventoryNumber).toLowerCase();
    return (
      r.printerInventoryNumber.toLowerCase().includes(q) ||
      getPrinterLabel(r.printerInventoryNumber).toLowerCase().includes(q) ||
      r.reason.toLowerCase().includes(q) ||
      dept.includes(q)
    );
  });

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
    setFormError(null);
    if (!newRepair.printerInventoryNumber) {
      setFormError('Выберите принтер');
      return;
    }
    const resolvedPrinter = store.printers.find(p =>
      p.inventoryNumber === newRepair.printerInventoryNumber ||
      (p.programId ?? '').toLowerCase() === newRepair.printerInventoryNumber.toLowerCase(),
    );
    if (!resolvedPrinter) {
      setFormError('Принтер не найден по инвентарному номеру или ID');
      return;
    }
    const exists = store.repairs.some(r =>
      r.printerInventoryNumber === resolvedPrinter.inventoryNumber &&
      (r.status === 'in_repair' || r.status === 'waiting'),
    );
    if (exists) {
      setFormError('Этот принтер уже находится в активном ремонте');
      return;
    }
    const repair: RepairEntry = {
      id: Math.random().toString(36).substr(2, 9),
      printerInventoryNumber: resolvedPrinter.inventoryNumber,
      date: new Date().toISOString(),
      reason: newRepair.reason,
      status: 'in_repair',
      /** Сначала «ожидает отправки» — тогда устройство видно на складе вместе с картриджами; после отправки партии станет at_refill. */
      locationStatus: 'waiting',
      technician: newRepair.technician || undefined,
      comment: newRepair.comment || undefined,
    };
    store.addRepair(repair);
    if (newRepair.includeCartridges) {
      store.cartridges
        .filter(c => newRepair.selectedCartridgeIds.includes(c.id))
        .forEach(c => {
          if (c.printerInventoryNumber !== resolvedPrinter.inventoryNumber) return;
          if (c.status === 'on_hand') {
            store.updateCartridgeStatus(
              c.id,
              'waiting',
              'Принят на склад вместе с принтером',
              newRepair.technician || undefined,
              newRepair.technician || undefined,
            );
            store.updateCartridge(c.id, { linkedRepairId: repair.id });
          } else if (c.status === 'waiting') {
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
    const repairId = showFinish.id;

    store.updateRepair(repairId, {
      status: 'repaired',
      locationStatus: 'ready',
      completionDate: new Date().toISOString(),
      repairDescription: repairDescription || undefined,
    });
    if (firmwareOnComplete && !printerRow?.firmwareFlashed) {
      store.updatePrinter(inv, { firmwareFlashed: true });
    }

    const linked = store.cartridges.filter(c => c.linkedRepairId === repairId);
    const linkedIds = new Set(linked.map(c => c.id));
    const printer = store.printers.find(p => p.inventoryNumber === inv);
    const deviceWarehouseId = printer?.programId ?? inv;

    linked.forEach(c => {
      if (c.status === 'waiting' || c.status === 'at_refill') {
        store.updateCartridgeStatus(
          c.id,
          'ready',
          'Ремонт завершён — готов к выдаче вместе с принтером',
        );
      }
    });

    store.setWarehouseLedger(prev => ({
      ...prev,
      shipmentBatches: prev.shipmentBatches.map(b => {
        const items = b.items.map(item => {
          if (item.status !== 'at_refill') return item;
          if (linkedIds.has(item.id)) {
            return { ...item, status: 'ready' as const };
          }
          if (
            item.type === 'Устройство' &&
            item.repairId === repairId &&
            (item.id === deviceWarehouseId || item.printerInventoryNumber === inv)
          ) {
            return { ...item, status: 'ready' as const };
          }
          return item;
        });
        const hasAtRefill = items.some(i => i.status === 'at_refill');
        const now = new Date().toISOString();
        return {
          ...b,
          items,
          ...(b.status === 'sent' && !hasAtRefill
            ? { status: 'received' as const, dateReceived: b.dateReceived ?? now }
            : {}),
        };
      }),
    }));

    setShowFinish(null);
    setRepairDescription('');
    setFirmwareOnComplete(false);
  };

  const statusTag = (status: RepairEntry['status']) => {
    switch (status) {
      case 'waiting':
        return (
          <span className="px-2 py-0.5 bg-slate-50 text-slate-600 text-[10px] font-semibold rounded-md border border-slate-200/90">
            Ожидает
          </span>
        );
      case 'in_repair':
        return (
          <span className="px-2 py-0.5 bg-orange-50 text-orange-800 text-[10px] font-semibold rounded-md border border-orange-100">
            В ремонте
          </span>
        );
      case 'repaired':
        return (
          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 text-[10px] font-semibold rounded-md border border-emerald-100">
            Завершён
          </span>
        );
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="flex flex-wrap justify-between items-center gap-3 shrink-0">
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <Wrench size={22} className="text-blue-600" />
          <span>Ремонт принтеров</span>
          <span className="text-xs font-medium text-gray-400 font-normal">
            активных {active.length} · в истории {history.length}
          </span>
        </h2>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-blue-600 text-white px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition-colors text-sm font-semibold shadow-sm"
        >
          <Plus size={17} />
          <span>Сдать в ремонт</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Активные */}
        <div className="min-h-0 flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-gray-500 flex items-center gap-1.5 shrink-0">
            <Clock size={14} className="text-orange-500/90" />
            Активные заявки
            <span className="text-gray-300">·</span>
            <span className="font-bold text-gray-600">{active.length}</span>
          </h3>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-0.5">
            {active.length === 0 && (
              <div className="py-10 text-center text-gray-400 text-sm bg-gradient-to-b from-gray-50/80 to-white rounded-xl border border-dashed border-gray-200">
                Нет активных заявок
              </div>
            )}

            {active.map(repair => {
              const p = store.printers.find(pr => pr.inventoryNumber === repair.printerInventoryNumber);
              const dept = getPrinterDept(repair.printerInventoryNumber);
              return (
                <article
                  key={repair.id}
                  className="rounded-xl border border-orange-100/90 bg-gradient-to-br from-orange-50/35 via-white to-white p-3.5 shadow-sm hover:shadow transition-shadow"
                >
                  <div className="flex flex-wrap justify-between gap-2 mb-2">
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-bold text-gray-900 text-sm leading-tight">
                        {repair.printerInventoryNumber}
                        {p?.model && (
                          <span className="font-normal text-gray-500"> · {p.model}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-400 font-mono">
                        {p?.programId ? `ID ${p.programId}` : '—'}
                        {dept && (
                          <span className="text-gray-500 font-sans not-italic ml-1">· {dept}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        Принят {new Date(repair.date).toLocaleDateString('ru-RU')}
                      </div>
                    </div>
                    <div className="shrink-0 self-start">{statusTag(repair.status)}</div>
                  </div>

                  <div className="text-xs text-gray-600 mb-1.5">
                    <span className="text-gray-400 font-medium">Неисправность: </span>
                    {repair.reason}
                  </div>
                  <div className="text-[11px] text-gray-500 mb-1.5">
                    Размещение:{' '}
                    <span className="text-gray-700 font-medium">
                      {repair.locationStatus === 'ready'
                        ? 'Готов к выдаче'
                        : repair.locationStatus === 'at_refill'
                          ? 'На заправке'
                          : 'Ожидает отправки'}
                    </span>
                  </div>

                  {repair.technician && (
                    <div className="flex items-center gap-1 text-[11px] text-gray-500 mb-2">
                      <User size={12} className="shrink-0 opacity-70" />
                      <span>{repair.technician}</span>
                    </div>
                  )}

                  {repair.comment && (
                    <div className="p-2 bg-white/70 rounded-lg border border-gray-100 text-[11px] text-gray-600 italic mb-2.5">
                      «{repair.comment}»
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowFinish(repair);
                        setRepairDescription('');
                        setFirmwareOnComplete(false);
                      }}
                      className="flex-1 min-w-[120px] py-2 px-3 bg-emerald-600/90 hover:bg-emerald-600 text-white rounded-lg flex items-center justify-center gap-1.5 text-xs font-semibold shadow-sm border border-emerald-700/10"
                    >
                      <CheckCircle2 size={14} />
                      Завершить
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditRepair(repair)}
                      className="px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50/80 text-[11px] font-medium text-gray-600 bg-white"
                    >
                      Изменить
                    </button>
                    {store.settings.enableEventEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          store.setRepairs(prev => prev.filter(r => r.id !== repair.id));
                          const printer = store.printers.find(pr2 => pr2.inventoryNumber === repair.printerInventoryNumber);
                          if (printer) {
                            store.updatePrinter(printer.inventoryNumber, {
                              repairCount: Math.max(0, (printer.repairCount ?? 0) - 1),
                            });
                          }
                        }}
                        className="px-3 py-2 border border-rose-200/90 text-rose-700/90 bg-rose-50/30 rounded-lg hover:bg-rose-50/70 text-[11px] font-medium"
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        {/* История */}
        <div className="min-h-0 flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-gray-500 flex items-center gap-1.5 shrink-0">
            <HistoryIcon size={14} className="text-blue-500/90" />
            История завершённых
            <span className="text-gray-300">·</span>
            <span className="font-bold text-gray-600">{history.length}</span>
          </h3>

          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск: инв., модель, причина…"
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300 outline-none bg-white"
            />
          </div>

          <div className="flex-1 min-h-0 rounded-xl border border-gray-200/90 bg-white shadow-sm overflow-hidden flex flex-col">
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50/90 border-b border-gray-100 sticky top-0 z-[1]">
                  <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                    <th className="px-2.5 py-2 font-semibold">Дата</th>
                    <th className="px-2.5 py-2 font-semibold">Принтер</th>
                    <th className="px-2.5 py-2 font-semibold">Проблема</th>
                    <th className="px-2.5 py-2 font-semibold">Решение</th>
                    {store.settings.enableEventEditing && (
                      <th className="px-2.5 py-2 font-semibold text-right">Дейст.</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredHistory
                    .slice()
                    .reverse()
                    .map(repair => {
                      const printer = store.printers.find(pr => pr.inventoryNumber === repair.printerInventoryNumber);
                      const dept = printer?.department?.trim();
                      return (
                        <tr key={repair.id} className="hover:bg-blue-50/20">
                          <td className="px-2.5 py-2 text-gray-500 whitespace-nowrap align-top">
                            {new Date(repair.date).toLocaleDateString('ru-RU')}
                            {repair.completionDate && (
                              <div className="text-gray-400 text-[10px]">
                                → {new Date(repair.completionDate).toLocaleDateString('ru-RU')}
                              </div>
                            )}
                          </td>
                          <td className="px-2.5 py-2 align-top">
                            <div className="font-semibold text-gray-800">{repair.printerInventoryNumber}</div>
                            <div className="text-[10px] text-gray-500 leading-snug">
                              {getPrinterLabel(repair.printerInventoryNumber).split('—')[1]?.trim() || printer?.model || '—'}
                            </div>
                            {dept && <div className="text-[10px] text-gray-400 mt-0.5">{dept}</div>}
                          </td>
                          <td className="px-2.5 py-2 text-gray-600 max-w-[140px] align-top">
                            <span className="line-clamp-2">{repair.reason}</span>
                          </td>
                          <td className="px-2.5 py-2 text-gray-500 max-w-[130px] align-top italic text-[11px]">
                            <span className="line-clamp-2">{repair.repairDescription ?? '—'}</span>
                          </td>
                          {store.settings.enableEventEditing && (
                            <td className="px-2.5 py-2 text-right align-top whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => {
                                  store.setRepairs(prev => prev.filter(r => r.id !== repair.id));
                                  const pr = store.printers.find(p => p.inventoryNumber === repair.printerInventoryNumber);
                                  if (pr) {
                                    store.updatePrinter(pr.inventoryNumber, {
                                      repairCount: Math.max(0, (pr.repairCount ?? 0) - 1),
                                    });
                                  }
                                  store.addRefillLog({
                                    id: Math.random().toString(36).substr(2, 9),
                                    date: new Date().toISOString(),
                                    cartridgeId: pr?.programId ?? repair.printerInventoryNumber,
                                    cartridgeModel: pr?.model ?? 'Устройство',
                                    consumableType: 'device',
                                    deviceType: pr?.printerType ?? 'Устройство',
                                    serviceType: 'Списание',
                                    printerInventoryNumber: repair.printerInventoryNumber,
                                    printerModel: pr?.model ?? '',
                                    department: pr?.department ?? '',
                                    employee: pr?.boss,
                                    action: `Запись ремонта удалена: ${repair.reason}`,
                                    is_technical: true,
                                  });
                                }}
                                className="px-2 py-1 border border-rose-200/90 text-rose-700/90 rounded-md text-[10px] font-medium hover:bg-rose-50/60"
                              >
                                Удалить
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  {filteredHistory.length === 0 && (
                    <tr>
                      <td
                        colSpan={store.settings.enableEventEditing ? 5 : 4}
                        className="p-8 text-center text-gray-400 text-sm italic"
                      >
                        Нет записей
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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
              {formError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {formError}
                </p>
              )}
              <div className="flex space-x-2 pt-2">
                <button type="button" onClick={() => { setShowAdd(false); setFormError(null); }}
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
              <div className="p-2.5 bg-emerald-50/60 border border-emerald-100 rounded-lg flex items-start gap-2 text-xs text-emerald-900/90">
                <AlertTriangle size={15} className="shrink-0 text-emerald-700/80 mt-0.5" />
                <span>Дата завершения подставится автоматически.</span>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowFinish(null)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50/80 bg-white">
                  Отмена
                </button>
                <button type="submit"
                  className="flex-1 py-2.5 bg-emerald-600/90 hover:bg-emerald-600 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2 border border-emerald-700/10 shadow-sm">
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
