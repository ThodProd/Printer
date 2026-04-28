
import React, { useEffect, useState, useMemo } from 'react';
import {
  ClipboardList, Download, Search, BarChart2, MapPin,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { StoreType } from '../store';
import { RefillLogEntry } from '../types';

const RefillLogTab: React.FC<{ store: StoreType }> = ({ store }) => {
  const [search, setSearch] = useState('');

  useEffect(() => {
    const onScan = (event: Event) => {
      setSearch((event as CustomEvent<string>).detail);
    };
    window.addEventListener('app-scanner-input', onScan as EventListener);
    return () => window.removeEventListener('app-scanner-input', onScan as EventListener);
  }, []);
  const [filterType, setFilterType] = useState<'all' | 'cartridge' | 'drum'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');

  const isBusinessAction = (action: string) =>
    action.includes('Принят на склад') ||
    action.includes('Отправлен на заправку') ||
    action.includes('Получен с заправки') ||
    action.includes('Принят с заправки') ||
    action.includes('Выдан пользователю');

  // In normal mode show only business refill/handout events.
  // Technical cartridge history is mixed in only when enabled in settings.
  const allEntries = useMemo((): RefillLogEntry[] => {
    const entries: RefillLogEntry[] = store.refillLog.filter(e =>
      store.settings.showTechLogs || isBusinessAction(e.action),
    );

    if (!store.settings.showTechLogs) {
      return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

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

    return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [store.refillLog, store.cartridges, store.printers, store.settings.showTechLogs]);

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

      const matchType = filterType === 'all' || e.consumableType === filterType;

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
    allEntries.forEach(e => {
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

  const exportToExcel = async () => {
    const data = filtered.map(e => ({
      'Дата': new Date(e.date).toLocaleString('ru-RU'),
      'ID расходника': e.cartridgeId,
      'Модель расходника': e.cartridgeModel,
      'Тип': e.consumableType === 'drum' ? 'Драм' : 'Картридж',
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
    <div className="space-y-5">
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
            {printerStats.slice(0, 10).map(s => {
              const maxCount = printerStats[0].count;
              return (
                <div key={s.inv} className="flex items-center space-x-2 text-sm">
                  <div className="w-28 shrink-0 font-mono font-bold text-gray-700 truncate">{s.inv}</div>
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
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
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
          {(['all', 'cartridge', 'drum'] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-2 transition-colors ${
                filterType === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'all' ? 'Все' : t === 'cartridge' ? 'Картриджи' : 'Драм'}
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
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-auto max-h-[500px]">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="p-2.5 border-b font-semibold">Дата</th>
                <th className="p-2.5 border-b font-semibold">ID расходника</th>
                <th className="p-2.5 border-b font-semibold">Модель</th>
                <th className="p-2.5 border-b font-semibold">Тип</th>
                <th className="p-2.5 border-b font-semibold">Принтер</th>
                <th className="p-2.5 border-b font-semibold">Подразделение</th>
                <th className="p-2.5 border-b font-semibold">Сотрудник</th>
                <th className="p-2.5 border-b font-semibold">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-300 italic">Нет записей</td>
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
                      <span className={`px-1.5 py-0.5 rounded font-bold ${e.consumableType === 'drum' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                        {e.consumableType === 'drum' ? 'Драм' : 'Картридж'}
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
    </div>
  );
};

export default RefillLogTab;
