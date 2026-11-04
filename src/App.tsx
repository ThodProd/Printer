import ReconcileTab from './components/ReconcileTab';
import { flushSync } from 'react-dom';
import { scannerKey } from './utils/scanner';

import React, { useEffect, useRef, useState } from 'react';
import {
  Search,
  Printer as PrinterIcon,
  Package,
  Wrench,
  Upload,
  ArrowRightLeft,
  Barcode as BarcodeIcon,
  Settings,
  ClipboardList,
  PackagePlus,
  Info,
  X,
  BookOpen,
} from 'lucide-react';
import { useStore } from './store';

import Dashboard from './components/Dashboard';
import SearchTab from './components/SearchTab';
import InventoryTab from './components/InventoryTab';
import PrintersTab from './components/PrintersTab';
import RepairTab from './components/RepairTab';
import ImportTab from './components/ImportTab';
import SettingsTab from './components/SettingsTab';
import RefillLogTab from './components/RefillLogTab';
import NewCartridgesTab from './components/NewCartridgesTab';
import ModelCatalogTab from './components/ModelCatalogTab';

/** Main navigation tabs in order */
const MAIN_TABS = [
  { id: 'dashboard',     label: 'Приём / Выдача',   icon: <ArrowRightLeft size={18} /> },
  { id: 'search',        label: 'Поиск / История',   icon: <Search size={18} /> },
  { id: 'printers',      label: 'Принтеры',          icon: <PrinterIcon size={18} /> },
  { id: 'inventory',     label: 'Склады',            icon: <Package size={18} /> },
];

const SECONDARY_TABS = [
  { id: 'newcartridges', label: 'Новые картриджи',  icon: <PackagePlus size={18} /> },
  { id: 'repair',        label: 'Ремонт',            icon: <Wrench size={18} /> },
  { id: 'refilllog',     label: 'Журнал действий',   icon: <ClipboardList size={18} /> },
];
const MODEL_CATALOG_TAB = { id: 'modelcatalog', label: 'Модели расходников', icon: <BookOpen size={18} /> };

const BOTTOM_TABS = [
  { id: 'reconcile', label: 'Сверка базы', icon: <ClipboardList size={18} /> },
  { id: 'import',        label: 'Импорт',            icon: <Upload size={18} /> },
  { id: 'settings',      label: 'Настройки',         icon: <Settings size={18} /> },
];

const App: React.FC = () => {
  const store = useStore();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showAbout, setShowAbout] = useState(false);
  const [inventoryAttention, setInventoryAttention] = useState<'waiting' | 'refill' | 'ready' | ''>('');
  const scanBufferRef = useRef('');
  const lastScanKeyRef = useRef(0);
  const scanStartRef = useRef(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      if (['Shift', 'CapsLock'].includes(event.key)) return;
      if (document.querySelector('dialog[open]')) return;
      const target = event.target as HTMLElement;
      // Editing names, notes or forms must never trigger a search or move focus.
      if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)
          && !target.hasAttribute('data-scanner')) return;

      const now = Date.now();
      if (now - lastScanKeyRef.current > 120) {
        scanBufferRef.current = '';
        scanStartRef.current = now;
      }
      lastScanKeyRef.current = now;

      if (event.key === 'Enter') {
        const scanned = scanBufferRef.current.trim();
        scanBufferRef.current = '';
        if (scanned.length >= 3 && (now - scanStartRef.current) / scanned.length <= 45) {
          flushSync(() => window.dispatchEvent(new CustomEvent('app-scanner-input', { detail: scanned })));
        }
        return;
      }

      if (event.key.length === 1) {
        if (!scanBufferRef.current) scanStartRef.current = now;
        scanBufferRef.current += scannerKey(event);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':      return <Dashboard store={store} onNavigate={setActiveTab} />;
      case 'newcartridges':  return <NewCartridgesTab store={store} />;
      case 'modelcatalog':   return <ModelCatalogTab store={store} />;
      case 'search':         return <SearchTab store={store} />;
      case 'inventory':      return <InventoryTab store={store} attention={inventoryAttention} />;
      case 'printers':       return <PrintersTab store={store} />;
      case 'repair':         return <RepairTab store={store} />;
      case 'refilllog':      return <RefillLogTab store={store} />;
      case 'reconcile': return <ReconcileTab store={store} />;
      case 'import':         return <ImportTab store={store} />;
      case 'settings':       return <SettingsTab store={store} />;
      default:               return <Dashboard store={store} onNavigate={setActiveTab} />;
    }
  };

  const waiting  = store.cartridges.filter(c => c.status === 'waiting').length;
  const atRefill = store.cartridges.filter(c => c.status === 'at_refill').length;
  const readyToIssue = store.cartridges.filter(c => c.status === 'received_from_refill' || c.status === 'ready').length;
  const repairs  = store.repairs.filter(r => r.status === 'in_repair' || r.status === 'waiting').length;
  const openIndicator = (tab: string, warehouse?: 'waiting' | 'refill' | 'ready') => {
    setActiveTab(tab);
    if (tab === 'inventory' && warehouse) {
      setInventoryAttention(warehouse);
      window.setTimeout(() => setInventoryAttention(current => current === warehouse ? '' : current), 1800);
    }
  };

  const NavButton = ({ tab }: { tab: { id: string; label: string; icon: React.ReactNode } }) => (
    <button
      key={tab.id}
      onClick={() => { setActiveTab(tab.id); setInventoryAttention(''); }}
      className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg transition-colors text-sm ${
        activeTab === tab.id
          ? 'bg-blue-50 text-blue-700 font-semibold'
          : 'text-gray-600 hover:bg-gray-100'
      } ${tab.id === 'modelcatalog' ? 'text-[12px] whitespace-nowrap' : ''}`}
    >
      {tab.icon}
      <span className="whitespace-nowrap">{tab.label}</span>
    </button>
  );

  if (!store.hydrated) return <div className="p-8" role="status">{store.databaseError ? `База не загружена: ${store.databaseError}. Перезапустите приложение после проверки файла Data/database.json. Сохранение отключено, исходный файл не изменён.` : 'Загрузка базы…'}</div>;

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {store.databaseBusy && <div className="fixed inset-0 z-[100] bg-white/80 flex items-center justify-center" role="status">Сохранение базы и резервной копии…</div>}
      {store.databaseError && <div className="bg-red-50 text-red-700 p-3" role="alert">Ошибка сохранения: {store.databaseError}</div>}
      {/* Header */}
      <header inert={store.databaseBusy} className="bg-blue-700 text-white shadow-lg px-6 py-3 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <BarcodeIcon size={24} />
          <div>
            <h1 className="text-base font-bold uppercase tracking-wider leading-tight">Cartridge Control</h1>
            <p className="text-xs opacity-60 leading-tight">Система учёта картриджей v1.1.18</p>
          </div>
        </div>
        <div className="flex items-center space-x-3 text-sm">
          {waiting > 0 && (
            <button onClick={() => openIndicator('inventory', 'waiting')} className="bg-yellow-400 text-yellow-900 px-2.5 py-1 rounded-full text-xs font-bold transition hover:bg-yellow-300 hover:shadow-md" title="Открыть склад ожидающих отправки">
              {waiting} ожидают
            </button>
          )}
          {atRefill > 0 && (
            <button onClick={() => openIndicator('inventory', 'refill')} className="bg-purple-400 text-white px-2.5 py-1 rounded-full text-xs font-bold transition hover:bg-purple-300 hover:shadow-md" title="Открыть партии на заправке">
              {atRefill} на заправке
            </button>
          )}
          {readyToIssue > 0 && (
            <button onClick={() => openIndicator('inventory', 'ready')} className="bg-emerald-500 text-white px-2.5 py-1 rounded-full text-xs font-bold transition hover:bg-emerald-400 hover:shadow-md" title="Открыть склад готовых к выдаче">
              {readyToIssue} готовы к выдаче
            </button>
          )}
          {repairs > 0 && (
            <button onClick={() => openIndicator('repair')} className="bg-orange-400 text-white px-2.5 py-1 rounded-full text-xs font-bold transition hover:bg-orange-300 hover:shadow-md" title="Открыть ремонт">
              {repairs} в ремонте
            </button>
          )}
          {store.settings.labelPrinterName ? (
            <button onClick={() => openIndicator('settings')} className="max-w-52 truncate bg-green-600 text-white px-2.5 py-1 rounded-full text-xs font-bold transition hover:bg-green-500 hover:shadow-md" title="Открыть настройки принтера этикеток">
              {store.settings.labelPrinterName}
            </button>
          ) : (
            <button onClick={() => openIndicator('settings')} className="bg-orange-500 text-white px-2.5 py-1 rounded-full text-xs font-bold transition hover:bg-orange-400 hover:shadow-md" title="Выбрать принтер этикеток">
              Принтер не выбран
            </button>
          )}
          <button
            onClick={() => setShowAbout(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded-full text-xs"
            title="О программе"
          >
            <Info size={14} />
          </button>
        </div>
      </header>

      <div inert={store.databaseBusy} className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-52 bg-white border-r border-gray-200 flex flex-col shrink-0 min-h-0">
          <div className="p-2 space-y-0.5 flex-1 min-h-0 overflow-auto">
            {MAIN_TABS.map(tab => <NavButton key={tab.id} tab={tab} />)}

            {/* Separator */}
            <div className="my-1.5 border-t border-gray-200" />

            {SECONDARY_TABS.map(tab => <NavButton key={tab.id} tab={tab} />)}
          </div>

          {/* Bottom pinned tabs */}
          <div className="p-2 border-t border-gray-200 space-y-0.5 shrink-0">
            <NavButton tab={MODEL_CATALOG_TAB} />
            <div className="my-1.5 border-t border-gray-200" />
            {BOTTOM_TABS.map(tab => <NavButton key={tab.id} tab={tab} />)}
          </div>

          <div className="p-3 border-t border-gray-100 bg-gray-50 text-xs text-gray-400 space-y-0.5 shrink-0">
            <div>🆕 {store.newCartridges.length} новых</div>
            <div>📦 {store.cartridges.length} расходников</div>
            <div>🖨 {store.printers.length} принтеров</div>
            <div>📋 {store.batches.length} партий</div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-5">
          {renderContent()}
        </main>
      </div>

      {/* About Modal */}
      {showAbout && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold flex items-center space-x-2">
                <BarcodeIcon size={20} className="text-blue-600" />
                <span>О программе</span>
              </h2>
              <button onClick={() => setShowAbout(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3 text-sm text-gray-700">
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-2">
                <div className="font-bold text-blue-800 text-base">Cartridge Control</div>
                <div className="text-blue-700 text-xs">Система учёта картриджей и принтеров</div>
                <div className="text-blue-600 text-xs font-mono">Версия 1.1.18</div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-gray-500">Создатель:</span>
                  <span className="font-semibold">Спиркин В.А.</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Принтеров:</span>
                  <span className="font-semibold">{store.printers.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Расходников:</span>
                  <span className="font-semibold">{store.cartridges.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Новых картриджей:</span>
                  <span className="font-semibold">{store.newCartridges.length}</span>
                </div>
              </div>
              <div className="text-xs text-gray-400 text-center pt-2 border-t">
                Данные хранятся локально на этом устройстве
              </div>
            </div>
            <button
              onClick={() => setShowAbout(false)}
              className="mt-4 w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
