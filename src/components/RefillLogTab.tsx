
import React, { useEffect, useState, useMemo } from 'react';
import {
  ClipboardList, Download, Search, BarChart2, MapPin,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { StoreType } from '../store';
import { RefillLogEntry } from '../types';
import { useStickyState } from '../utils/useStickyState';

function normalizedTypeLabel(entry: RefillLogEntry): string {
  if (entry.consumableType === 'device') return 'Устройство';
  if (entry.consumableType === 'drum') return 'Драм-картридж';
  return 'Картридж';
}

function typeBadgeClass(entry: RefillLogEntry): string {
  if (entry.consumableType === 'device') return 'bg-violet-100 text-violet-700';
  if (entry.consumableType === 'drum') return 'bg-amber-100 text-amber-700';
  return 'bg-blue-100 text-blue-700';
}

function serviceBadgeClass(type?: RefillLogEntry['serviceType']): string {
  switch (type) {
    case 'accept': return 'bg-cyan-100 text-cyan-700';
    case 'shipment': return 'bg-orange-100 text-orange-700';
    case 'receive': return 'bg-emerald-100 text-emerald-700';
    case 'issue': return 'bg-green-100 text-green-700';
    case 'repair': return 'bg-fuchsia-100 text-fuchsia-700';
    case 'writeoff': return 'bg-rose-100 text-rose-700';
    case 'delete': return 'bg-red-100 text-red-700';
    case 'cancel': return 'bg-slate-200 text-slate-700';
    default: return 'bg-indigo-100 text-indigo-700';
  }
}

const RefillLogTab: React.FC<{ store: StoreType }> = ({ store }) => {
  const [search, setSearch] = useStickyState('search_refill_log', '');
  const [logView, setLogView] = useState<'business' | 'all' | 'writeoff' | 'repairs'>('business');
  const [showTopModal, setShowTopModal] = useState(false);
  const [topSearch, setTopSearch] = useState('');

  useEffect(() => {
    const onScan = (event: Event) => {
      setSearch((event as CustomEvent<string>).detail);
    };
    window.addEventListener('app-scanner-input', onScan as EventListener);
    return () => window.removeEventListener('app-scanner-input', onScan as EventListener);
  }, []);
  const [filterType, setFilterType] = useState<'all' | 'cartridge' | 'drum' | 'device'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');

  const isBusinessAction = (action: string) =>
    action.includes('Принят на склад') ||
    action.includes('Отправлен на заправку') ||
    action.includes('Получен с заправки') ||
    action.includes('Принят с заправки') ||
    action.includes('Выдан пользователю') ||
    action.includes('Заменен на новый') ||
    action.includes('Принят в ремонт') ||
    action.includes('Ремонт:');

  // In normal mode show only business refill/handout events.
  // Technical cartridge history is mixed in only when enabled in settings.
  const allEntries = useMemo((): RefillLogEntry[] => {
    const entries: RefillLogEntry[] = store.refillLog.filter(e => {
      if (!store.settings.showTechLogs) return isBusinessAction(e.action);
      if (logView === 'all') return true;
      if (logView === 'writeoff') return e.serviceType === 'writeoff' || /\b(списан|списание|удален|удалено)\b/i.test(e.action);
      if (logView === 'repairs') return e.serviceType === 'repair';
      return isBusinessAction(e.action);
    });

    if (store.settings.showTechLogs) {
      store.cartridges.forEach(c => {
        const printer = store.printers.find(p => p.inventoryNumber === c.printerInventoryNumber);
        c.history.forEach(h => {
          if (
            h.action.includes('Ожидает отправки') ||
            h.action.includes('На заправке') ||
            h.action.includes('заправк') ||
            h.action.includes('Получен')
          ) {
            const alreadyExists = entries.some(e => e.id === `hist_${h.id}`);
            if (!alreadyExists) {
              entries.push({
                id: `hist_${h.id}`,
                date: h.date,
                cartridgeId: c.id,
                cartridgeModel: c.model,
                consumableType: c.consumableType ?? 'cartridge',
                deviceType: c.consumableType === 'drum' ? 'Драм' : 'Картридж',
                serviceType: 'refill',
                printerInventoryNumber: c.printerInventoryNumber,
                printerModel: printer?.model ?? '',
                department: printer?.department ?? '',
                employee: h.employee,
                action: h.action,
              });
            }
          }
        });
      });
    }

    store.repairs.forEach(r => {
      const printer = store.printers.find(p => p.inventoryNumber === r.printerInventoryNumber);
      entries.push({
        id: `repair_${r.id}`,
        date: r.date,
        cartridgeId: printer?.programId ?? r.printerInventoryNumber,
        cartridgeModel: printer?.model ?? 'Устройство',
        consumableType: 'device',
        deviceType: printer?.printerType ?? 'Устройство',
        serviceType: 'repair',
        printerInventoryNumber: r.printerInventoryNumber,
        printerModel: printer?.model ?? '',
        department: printer?.department ?? '',
        employee: r.technician,
        action: `Ремонт: ${r.reason}${r.status === 'repaired' ? ' (завершён)' : ''}`,
      });
    });

    return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [store.refillLog, store.cartridges, store.printers, store.settings.showTechLogs, store.repairs, logView]);

  // Unique departments list
  const departments = useMemo(() => {
    const set = new Set<string>();
    allEntries.forEach(e => {
      if (e.department) set.add(e.department);
    });
    store.printers.forEach(p => {
      if (p.department) set.add(p.department);
    });
    return Array.from(set).sort();
  }, [allEntries, store.printers]);

  const filtered = useMemo(() => {
    return allEntries.filter(e => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        e.cartridgeId.toLowerCase().includes(q) ||
        e.cartridgeModel.toLowerCase().includes(q) ||
        e.printerInventoryNumber.toLowerCase().includes(q) ||
        e.printerModel.toLowerCase().includes(q) ||
        (e.employee ?? '').toLowerCase().includes(q) ||
        (e.department ?? '').toLowerCase().includes(q);

      const matchType = e.serviceType === 'repair'
        ? (filterType === 'all' || filterType === 'device')
        : (filterType === 'all' || e.consumableType === filterType);

      const entryDate = e.date.slice(0, 10);
      const matchFrom = !dateFrom || entryDate >= dateFrom;
      const matchTo = !dateTo || entryDate <= dateTo;

      const matchDept = !filterDepartment || (e.department ?? '') === filterDepartment;

      return matchSearch && matchType && matchFrom && matchTo && matchDept;
    });
  }, [allEntries, search, filterType, dateFrom, dateTo, filterDepartment]);

  // Stats per printer
  const printerStats = useMemo(() => {
    const map = new Map<string, { inv: string; model: string; department: string; count: number }>();
    allEntries
      .filter(e => e.serviceType === 'refill' && e.action.includes('Отправлен на заправку'))
      .forEach(e => {
      const key = e.printerInventoryNumber;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
      } else {
        const printer = store.printers.find(p => p.inventoryNumber === key);
        map.set(key, { inv: key, model: e.printerModel, department: printer?.department ?? '', count: 1 });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [allEntries, store.printers]);

  const uniqueCartridgeCount = useMemo(
    () => new Set(allEntries.filter(e => e.consumableType === 'cartridge').map(e => e.cartridgeId)).size,
    [allEntries],
  );
  const uniqueDrumCount = useMemo(
    () => new Set(allEntries.filter(e => e.consumableType === 'drum').map(e => e.cartridgeId)).size,
    [allEntries],
  );

  const serviceTypeLabel = (type?: RefillLogEntry['serviceType']) => {
    switch (type) {
      case 'repair': return 'Ремонт';
      case 'writeoff': return 'Списание';
      case 'accept': return 'Прием';
      case 'shipment': return 'Отправка';
      case 'receive': return 'Приемка';
      case 'issue': return 'Выдача';
      case 'delete': return 'Удаление';
      case 'cancel': return 'Отмена';
      default: return 'Заправка';
    }
  };

  const exportToExcel = async () => {
    const data = filtered.map(e => ({
      'Дата': new Date(e.date).toLocaleString('ru-RU'),
      'ID расходника': e.cartridgeId,
      'Модель расходника': e.cartridgeModel,
      'Тип': normalizedTypeLabel(e),
      'Вид услуги': serviceTypeLabel(e.serviceType),
      'Инв. № принтера': e.printerInventoryNumber,
      'Модель принтера': e.printerModel,
      'Подразделение': e.department ?? '',
      'Сотрудник': e.employee ?? '',
      'Действие': e.action,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Журнал заправок');

    const statsData = printerStats.map(s => ({
      'Инв. № принтера': s.inv,
      'Модель принтера': s.model,
      'Подразделение': s.department,
      'Кол-во заправок': s.count,
    }));
    const ws2 = XLSX.utils.json_to_sheet(statsData);
    XLSX.utils.book_append_sheet(wb, ws2, 'Статистика по принтерам');

    downloadBlob(wb);
  };

  const downloadBlob = (wb: XLSX.WorkBook) => {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `refill_log_${filterDepartment ? filterDepartment + '_' : ''}${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-5 overflow-hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
          <ClipboardList size={22} className="text-blue-600" />
          <span>Журнал заправок</span>
        </h2>
        <button
          onClick={exportToExcel}
          className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700"
        >
          <Download size={15} />
          <span>Экспорт в Excel</span>
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{allEntries.length}</div>
          <div className="text-xs text-gray-500 mt-1">Всего записей</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-purple-600">{uniqueCartridgeCount}</div>
          <div className="text-xs text-gray-500 mt-1">Картриджей по факту</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-orange-600">{uniqueDrumCount}</div>
          <div className="text-xs text-gray-500 mt-1">Драм-картриджей по факту</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{printerStats.length}</div>
          <div className="text-xs text-gray-500 mt-1">Принтеров в журнале</div>
        </div>
      </div>

      {/* Top printers */}
      {printerStats.length > 0 && (
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-bold text-gray-700 text-sm mb-3 flex items-center space-x-2">
            <BarChart2 size={15} className="text-blue-600" />
            <span>Топ принтеров по заправкам</span>
          </h3>
          <div className="space-y-1.5">
            {printerStats.slice(0, 3).map(s => {
              const maxCount = printerStats[0].count;
              return (
                <div key={s.inv} className="flex items-center space-x-2 text-sm">
                  <div className="w-44 shrink-0 font-mono font-bold text-gray-700">{s.inv}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full"
                      style={{ width: `${(s.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <div className="w-8 text-right text-xs font-bold text-gray-600">{s.count}</div>
                  <div className="w-36 text-xs text-gray-400 truncate">{s.model}</div>
                  {s.department && (
                    <div className="hidden lg:flex items-center space-x-0.5 text-xs text-gray-400 w-32 truncate">
                      <MapPin size={10} />
                      <span>{s.department}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button onClick={() => setShowTopModal(true)} className="mt-3 text-xs font-semibold text-blue-600 hover:underline">
            Развернуть рейтинг
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {store.settings.showTechLogs && (
          <div className="flex rounded-lg border overflow-hidden text-xs font-semibold">
            {([
              ['business', 'Основной журнал'],
              ['all', 'Все'],
              ['repairs', 'Ремонты'],
              ['writeoff', 'Списания'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setLogView(id)}
                className={`px-3 py-2 ${logView === id ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск..."
            className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {/* Department filter */}
        <div className="flex items-center space-x-1">
          <MapPin size={14} className="text-gray-400" />
          <select
            value={filterDepartment}
            onChange={e => setFilterDepartment(e.target.value)}
            className="border rounded-lg py-2 px-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">Все подразделения</option>
            {departments.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div className="flex rounded-lg border overflow-hidden text-xs font-semibold">
          {(['all', 'cartridge', 'drum', 'device'] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-2 transition-colors ${
                filterType === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'all' ? 'Все' : t === 'cartridge' ? 'Картриджи' : t === 'drum' ? 'Драм' : 'Устройства'}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-1 text-xs text-gray-600">
          <span>С</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border rounded p-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <span>по</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border rounded p-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>

        {(search || filterType !== 'all' || dateFrom || dateTo || filterDepartment) && (
          <div className="text-xs text-gray-500">
            Найдено: <strong>{filtered.length}</strong>
            {filterDepartment && <span className="ml-1 text-blue-600">· {filterDepartment}</span>}
          </div>
        )}
      </div>

      {/* Log table */}
      <div className="bg-white rounded-xl border overflow-hidden flex-1 min-h-0">
        <div className="overflow-auto h-full">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="p-2.5 border-b font-semibold">Дата</th>
                <th className="p-2.5 border-b font-semibold">ID расходника</th>
                <th className="p-2.5 border-b font-semibold">Модель</th>
                <th className="p-2.5 border-b font-semibold">Тип</th>
                <th className="p-2.5 border-b font-semibold">Вид услуги</th>
                <th className="p-2.5 border-b font-semibold">Принтер</th>
                <th className="p-2.5 border-b font-semibold">Подразделение</th>
                <th className="p-2.5 border-b font-semibold">Сотрудник</th>
                <th className="p-2.5 border-b font-semibold">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-gray-300 italic">Нет записей</td>
                </tr>
              ) : (
                filtered.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="p-2.5 text-gray-500 whitespace-nowrap">
                      {new Date(e.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="p-2.5 font-mono font-bold text-gray-700">{e.cartridgeId}</td>
                    <td className="p-2.5">{e.cartridgeModel}</td>
                    <td className="p-2.5">
                      <span className={`px-1.5 py-0.5 rounded font-bold ${typeBadgeClass(e)}`}>
                        {normalizedTypeLabel(e)}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <span className={`px-1.5 py-0.5 rounded font-bold ${serviceBadgeClass(e.serviceType)}`}>
                        {serviceTypeLabel(e.serviceType)}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <div className="font-bold">{e.printerInventoryNumber}</div>
                      <div className="text-gray-400">{e.printerModel}</div>
                    </td>
                    <td className="p-2.5 text-gray-600">
                      {e.department ? (
                        <div className="flex items-center space-x-1">
                          <MapPin size={10} className="text-gray-400" />
                          <span>{e.department}</span>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="p-2.5 text-gray-600">{e.employee || '—'}</td>
                    <td className="p-2.5">{e.action}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {showTopModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onMouseDown={(e) => e.target === e.currentTarget && setShowTopModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold">Рейтинг заправок</h3>
              <button onClick={() => setShowTopModal(false)}>✕</button>
            </div>
            <div className="p-4">
              <input
                value={topSearch}
                onChange={e => setTopSearch(e.target.value)}
                placeholder="Поиск по инвентарному номеру..."
                className="w-full mb-3 p-2 border rounded-lg text-sm"
              />
              <div className="max-h-[55vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr><th className="p-2 text-left">Инв.№</th><th className="p-2 text-left">Модель</th><th className="p-2 text-left">Заправок</th></tr>
                  </thead>
                  <tbody>
                    {printerStats.filter(s => s.inv.toLowerCase().includes(topSearch.toLowerCase())).map(s => (
                      <tr key={s.inv} className="border-t"><td className="p-2 font-mono">{s.inv}</td><td className="p-2">{s.model}</td><td className="p-2 font-bold">{s.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RefillLogTab;
