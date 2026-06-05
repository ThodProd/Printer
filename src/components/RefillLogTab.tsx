
import React, { useEffect, useState, useMemo } from 'react';
import {
  ClipboardList, Download, Search, BarChart2, MapPin,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { StoreType } from '../store';
import { RefillLogEntry } from '../types';
import { useStickyState } from '../utils/useStickyState';

type LogTab = 'all' | 'cartridges' | 'drums' | 'repair' | 'writeoff' | 'technical';

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
    case 'Заправка': case 'accept': case 'shipment': case 'receive': case 'refill':
      return 'bg-cyan-100 text-cyan-700';
    case 'Выдача': case 'issue':
      return 'bg-green-100 text-green-700';
    case 'Ремонт': case 'repair':
      return 'bg-fuchsia-100 text-fuchsia-700';
    case 'Списание': case 'writeoff': case 'delete': case 'cancel':
      return 'bg-rose-100 text-rose-700';
    case 'Редактирование': case 'replacement':
      return 'bg-orange-100 text-orange-700';
    case 'Создание': case 'system':
      return 'bg-indigo-100 text-indigo-700';
    case 'Системное':
      return 'bg-slate-200 text-slate-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function serviceTypeLabel(type?: RefillLogEntry['serviceType']): string {
  if (!type) return 'Заправка';
  // New Russian types pass through directly
  if (type === 'Заправка' || type === 'Выдача' || type === 'Ремонт' ||
      type === 'Создание' || type === 'Редактирование' || type === 'Списание' || type === 'Системное') {
    return type;
  }
  // Legacy
  switch (type) {
    case 'repair': return 'Ремонт';
    case 'writeoff': return 'Списание';
    case 'accept': return 'Заправка';
    case 'shipment': return 'Заправка';
    case 'receive': return 'Заправка';
    case 'issue': return 'Выдача';
    case 'delete': return 'Списание';
    case 'cancel': return 'Списание';
    case 'replacement': return 'Редактирование';
    case 'system': return 'Системное';
    default: return 'Заправка';
  }
}

/** Returns true if entry is a "technical" record (should be hidden by default). */
function isTechnical(e: RefillLogEntry): boolean {
  if (e.is_technical === true) return true;
  if (e.is_technical === false) return false;
  // Legacy: infer from old serviceType values
  if (e.serviceType === 'system' || e.serviceType === 'replacement' || e.serviceType === 'writeoff' ||
      e.serviceType === 'delete' || e.serviceType === 'cancel') return true;
  return false;
}

function isWriteoff(e: RefillLogEntry): boolean {
  return e.serviceType === 'Списание' || e.serviceType === 'writeoff' || e.serviceType === 'delete' || e.serviceType === 'cancel';
}

function isRepair(e: RefillLogEntry): boolean {
  return e.serviceType === 'Ремонт' || e.serviceType === 'repair';
}

const TAB_LABELS: Record<LogTab, string> = {
  all: 'Все',
  cartridges: 'Картриджи',
  drums: 'Драмы',
  repair: 'Ремонт',
  writeoff: 'Списание',
  technical: 'Технические',
};

const RefillLogTab: React.FC<{ store: StoreType }> = ({ store }) => {
  const [search, setSearch] = useStickyState('search_refill_log', '');
  const [activeTab, setActiveTab] = useState<LogTab>('all');
  const [showTopModal, setShowTopModal] = useState(false);
  const [topSearch, setTopSearch] = useState('');
  const showTech = store.settings.showTechLogs ?? false;

  useEffect(() => {
    const onScan = (event: Event) => {
      setSearch((event as CustomEvent<string>).detail);
    };
    window.addEventListener('app-scanner-input', onScan as EventListener);
    return () => window.removeEventListener('app-scanner-input', onScan as EventListener);
  }, []);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');

  /** Base log from store (sorted newest-first) */
  const baseLog = useMemo((): RefillLogEntry[] =>
    [...store.refillLog].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [store.refillLog],
  );

  /** Entries for the current tab, respecting showTechLogs setting. */
  const tabEntries = useMemo((): RefillLogEntry[] => {
    if (activeTab === 'all') {
      // Shows user-facing events; if showTech ON, also include technical
      return baseLog.filter(e => !isTechnical(e) || showTech);
    }
    if (activeTab === 'cartridges') {
      const base = baseLog.filter(e => e.consumableType === 'cartridge');
      return showTech ? base : base.filter(e => !isTechnical(e));
    }
    if (activeTab === 'drums') {
      const base = baseLog.filter(e => e.consumableType === 'drum');
      return showTech ? base : base.filter(e => !isTechnical(e));
    }
    if (activeTab === 'repair') {
      const base = baseLog.filter(isRepair);
      return showTech ? base : base.filter(e => !isTechnical(e));
    }
    if (activeTab === 'writeoff') {
      // Always includes technical writeoff entries
      return baseLog.filter(isWriteoff);
    }
    if (activeTab === 'technical') {
      // Always shows only technical
      return baseLog.filter(isTechnical);
    }
    return baseLog;
  }, [baseLog, activeTab, showTech]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    baseLog.forEach(e => { if (e.department) set.add(e.department); });
    store.printers.forEach(p => { if (p.department) set.add(p.department); });
    return Array.from(set).sort();
  }, [baseLog, store.printers]);

  const filtered = useMemo(() => {
    return tabEntries.filter(e => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        e.cartridgeId.toLowerCase().includes(q) ||
        e.cartridgeModel.toLowerCase().includes(q) ||
        e.printerInventoryNumber.toLowerCase().includes(q) ||
        e.printerModel.toLowerCase().includes(q) ||
        (e.employee ?? '').toLowerCase().includes(q) ||
        (e.department ?? '').toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q);

      const entryDate = e.date.slice(0, 10);
      const matchFrom = !dateFrom || entryDate >= dateFrom;
      const matchTo = !dateTo || entryDate <= dateTo;
      const matchDept = !filterDepartment || (e.department ?? '') === filterDepartment;

      return matchSearch && matchFrom && matchTo && matchDept;
    });
  }, [tabEntries, search, dateFrom, dateTo, filterDepartment]);

  // Статистика: топ принтеров по числу отправок на заправку (как в журнале)
  const printerStats = useMemo(() => {
    const map = new Map<string, { inv: string; model: string; department: string; count: number }>();
    baseLog
      .filter(
        e =>
          (e.serviceType === 'Заправка' || e.serviceType === 'shipment') &&
          (e.action.includes('отправлен на заправку') ||
            e.action.includes('Картридж отправлен') ||
            e.action.includes('Отправлен на заправку')),
      )
      .forEach(e => {
        const key = e.printerInventoryNumber;
        const existing = map.get(key);
        if (existing) {
          existing.count++;
        } else {
          const printer = store.printers.find(p => p.inventoryNumber === key);
          map.set(key, {
            inv: key,
            model: e.printerModel,
            department: printer?.department ?? e.department ?? '',
            count: 1,
          });
        }
      });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [baseLog, store.printers]);

  const uniqueCartridgeCount = useMemo(
    () => new Set(baseLog.filter(e => e.consumableType === 'cartridge' && !isTechnical(e)).map(e => e.cartridgeId)).size,
    [baseLog],
  );
  const uniqueDrumCount = useMemo(
    () => new Set(baseLog.filter(e => e.consumableType === 'drum' && !isTechnical(e)).map(e => e.cartridgeId)).size,
    [baseLog],
  );

  const exportToExcel = () => {
    const data = filtered.map(e => ({
      'ID записи': e.id,
      Дата: new Date(e.date).toLocaleString('ru-RU'),
      'Дата (ISO)': e.date,
      'ID картриджа/объекта': e.cartridgeId,
      Модель: e.cartridgeModel,
      'Тип (код)': e.consumableType,
      'Тип (как в списке)': normalizedTypeLabel(e),
      'Тип устройства': e.deviceType ?? '',
      'Вид услуги (код)': e.serviceType ?? '',
      'Тип услуги': serviceTypeLabel(e.serviceType),
      Действие: e.action,
      'Инв. № принтера': e.printerInventoryNumber,
      'Модель принтера': e.printerModel,
      Подразделение: e.department ?? '',
      Сотрудник: e.employee ?? '',
      'Техническая запись': isTechnical(e) ? 'Да' : 'Нет',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Журнал');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal_${TAB_LABELS[activeTab]}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
          <ClipboardList size={22} className="text-blue-600" />
          <span>Журнал</span>
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={exportToExcel}
            className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700"
          >
            <Download size={15} />
            <span>Экспорт в Excel</span>
          </button>
        </div>
      </div>

      {/* Компактная сводка + минималистичный топ по подразделениям */}
      <div className="bg-white rounded-lg border border-gray-200 px-2.5 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-tight">
        <div className="inline-flex items-baseline gap-1 shrink-0">
          <span className="font-extrabold text-blue-600 tabular-nums text-sm">{baseLog.filter(e => !isTechnical(e)).length}</span>
          <span className="text-gray-500">записей</span>
        </div>
        <span className="text-gray-200 hidden sm:inline">|</span>
        <div className="inline-flex items-baseline gap-1 shrink-0">
          <span className="font-extrabold text-purple-600 tabular-nums text-sm">{uniqueCartridgeCount}</span>
          <span className="text-gray-500">картр.</span>
        </div>
        <div className="inline-flex items-baseline gap-1 shrink-0">
          <span className="font-extrabold text-orange-600 tabular-nums text-sm">{uniqueDrumCount}</span>
          <span className="text-gray-500">драм</span>
        </div>
        <div className="inline-flex items-baseline gap-1 shrink-0">
          <span className="font-extrabold text-green-600 tabular-nums text-sm">{printerStats.length}</span>
          <span className="text-gray-500">принтеров</span>
        </div>
        {printerStats.length > 0 && (
          <>
            <span className="text-gray-200 hidden md:inline">|</span>
            <div className="inline-flex items-center gap-x-1.5 gap-y-0.5 flex-wrap min-w-0">
              <BarChart2 size={11} className="text-blue-500 shrink-0" />
              {printerStats.slice(0, 3).map((s, idx) => {
                const deptLabel = (s.department || '').trim() || '—';
                return (
                  <span key={s.inv} className="inline-flex items-baseline gap-0.5 text-[10px] text-gray-600">
                    {idx > 0 && <span className="text-gray-200 mx-0.5">·</span>}
                    <span className="font-semibold text-gray-700 truncate max-w-[88px]" title={`${deptLabel} · инв. ${s.inv} · ${s.count} отпр.`}>
                      {deptLabel}
                    </span>
                    <span className="text-blue-600 font-extrabold tabular-nums shrink-0">{s.count}</span>
                  </span>
                );
              })}
              <button
                type="button"
                onClick={() => setShowTopModal(true)}
                className="text-[10px] font-semibold text-blue-600 hover:underline shrink-0 ml-0.5"
              >
                все →
              </button>
            </div>
          </>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b">
        {(Object.entries(TAB_LABELS) as [LogTab, string][]).map(([id, label]) => {
          const tabCount = (() => {
            if (id === 'all') return baseLog.filter(e => !isTechnical(e) || showTech).length;
            if (id === 'cartridges') return baseLog.filter(e => e.consumableType === 'cartridge' && (!isTechnical(e) || showTech)).length;
            if (id === 'drums') return baseLog.filter(e => e.consumableType === 'drum' && (!isTechnical(e) || showTech)).length;
            if (id === 'repair') return baseLog.filter(isRepair).length;
            if (id === 'writeoff') return baseLog.filter(isWriteoff).length;
            if (id === 'technical') return baseLog.filter(isTechnical).length;
            return 0;
          })();
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                activeTab === id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
              {tabCount > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  activeTab === id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {tabCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab description */}
      <div className="text-xs text-gray-400 -mt-3">
        {activeTab === 'all' && (showTech
          ? 'Все записи (пользовательские + технические)'
          : 'Только основные события работы (без технических)')}
        {activeTab === 'cartridges' && (showTech ? 'Все события по картриджам' : 'Основные события по картриджам')}
        {activeTab === 'drums' && (showTech ? 'Все события по драм-картриджам' : 'Основные события по драм-картриджам')}
        {activeTab === 'repair' && 'События ремонта принтеров'}
        {activeTab === 'writeoff' && 'Все события списания (включая технические)'}
        {activeTab === 'technical' && 'Только технические/служебные записи'}
      </div>

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

        <div className="flex items-center space-x-1 text-xs text-gray-600">
          <span>С</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border rounded p-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <span>по</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border rounded p-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>

        {(search || dateFrom || dateTo || filterDepartment) && (
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
                <th className="p-2.5 border-b font-semibold">ID</th>
                <th className="p-2.5 border-b font-semibold">Модель</th>
                <th className="p-2.5 border-b font-semibold">Тип</th>
                <th className="p-2.5 border-b font-semibold">Вид услуги</th>
                <th className="p-2.5 border-b font-semibold">Действие</th>
                <th className="p-2.5 border-b font-semibold">Принтер</th>
                <th className="p-2.5 border-b font-semibold">Подразделение</th>
                <th className="p-2.5 border-b font-semibold">Сотрудник</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-gray-300 italic">Нет записей</td>
                </tr>
              ) : (
                filtered.map(e => (
                  <tr
                    key={e.id}
                    className={`hover:bg-gray-50 ${isTechnical(e) ? 'opacity-70' : ''}`}
                  >
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
                      {isTechnical(e) && (
                        <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold bg-gray-200 text-gray-500">
                          тех.
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 max-w-[200px]">{e.action}</td>
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
              <button type="button" onClick={() => setShowTopModal(false)}>✕</button>
            </div>
            <div className="p-4">
              <input
                value={topSearch}
                onChange={e => setTopSearch(e.target.value)}
                placeholder="Поиск: инв. №, модель или подразделение..."
                className="w-full mb-3 p-2 border rounded-lg text-sm"
              />
              <div className="max-h-[55vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Инв.№</th>
                      <th className="p-2 text-left">Модель</th>
                      <th className="p-2 text-left">Подразделение</th>
                      <th className="p-2 text-left">Заправок</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printerStats
                      .filter(s => {
                        const q = topSearch.toLowerCase();
                        if (!q) return true;
                        return (
                          s.inv.toLowerCase().includes(q) ||
                          s.model.toLowerCase().includes(q) ||
                          (s.department || '').toLowerCase().includes(q)
                        );
                      })
                      .map(s => (
                        <tr key={s.inv} className="border-t">
                          <td className="p-2 font-mono">{s.inv}</td>
                          <td className="p-2">{s.model}</td>
                          <td className="p-2 text-gray-500">{s.department || '—'}</td>
                          <td className="p-2 font-bold">{s.count}</td>
                        </tr>
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
