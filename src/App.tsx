
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
} from 'lucide-react';
import { useStore } from './store';

import Dashboard from './components/Dashboard';
import SearchTab from './components/SearchTab';
import InventoryTab from './components/InventoryTab';
import PrintersTab from './components/PrintersTab';
import RepairTab from './components/RepairTab';
import ImportTab from './components/ImportTab';
import PrintingTab from './components/PrintingTab';
import SettingsTab from './components/SettingsTab';
import RefillLogTab from './components/RefillLogTab';
import NewCartridgesTab from './components/NewCartridgesTab';

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
  { id: 'printing',      label: 'Печать этикеток',   icon: <BarcodeIcon size={18} /> },
  { id: 'refilllog',     label: 'Журнал заправок',   icon: <ClipboardList size={18} /> },
];

const BOTTOM_TABS = [
  { id: 'import',        label: 'Импорт',            icon: <Upload size={18} /> },
  { id: 'settings',      label: 'Настройки',         icon: <Settings size={18} /> },
];

const App: React.FC = () => {
  const store = useStore();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showAbout, setShowAbout] = useState(false);
  const scanBufferRef = useRef('');
  const lastScanKeyRef = useRef(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const now = Date.now();
      if (now - lastScanKeyRef.current > 120) {
        scanBufferRef.current = '';
      }
      lastScanKeyRef.current = now;

      if (event.key === 'Enter') {
        const scanned = scanBufferRef.current.trim();
        scanBufferRef.current = '';
        if (scanned.length >= 2) {
          window.dispatchEvent(new CustomEvent('app-scanner-input', { detail: scanned }));
        }
        return;
      }

      if (event.key.length === 1) {
        scanBufferRef.current += event.key;
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':      return <Dashboard store={store} onNavigate={setActiveTab} />;
      case 'newcartridges':  return <NewCartridgesTab store={store} />;
      case 'search':         return <SearchTab store={store} />;
      case 'inventory':      return <InventoryTab store={store} />;
      case 'printers':       return <PrintersTab store={store} />;
      case 'repair':         return <RepairTab store={store} />;
      case 'printing':       return <PrintingTab store={store} />;
      case 'refilllog':      return <RefillLogTab store={store} />;
      case 'import':         return <ImportTab store={store} />;
      case 'settings':       return <SettingsTab store={store} />;
      default:               return <Dashboard store={store} onNavigate={setActiveTab} />;
    }
  };

  const waiting  = store.cartridges.filter(c => c.status === 'waiting').length;
  const atRefill = store.cartridges.filter(c => c.status === 'at_refill').length;
  const repairs  = store.repairs.filter(r => r.status === 'in_repair' || r.status === 'waiting').length;

  const NavButton = ({ tab }: { tab: { id: string; label: string; icon: React.ReactNode } }) => (
    <button
      key={tab.id}
      onClick={() => setActiveTab(tab.id)}
      className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg transition-colors text-sm ${
        activeTab === tab.id
          ? 'bg-blue-50 text-blue-700 font-semibold'
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {tab.icon}
      <span>{tab.label}</span>
    </button>
  );

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-blue-700 text-white shadow-lg px-6 py-3 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <BarcodeIcon size={24} />
          <div>
            <h1 className="text-base font-bold uppercase tracking-wider leading-tight">Cartridge Control</h1>
            <p className="text-xs opacity-60 leading-tight">Система учёта картриджей v1</p>
          </div>
        </div>
        <div className="flex items-center space-x-3 text-sm">
          {waiting > 0 && (
            <div className="bg-yellow-400 text-yellow-900 px-2.5 py-1 rounded-full text-xs font-bold">
              ⏳ {waiting} ожидают
            </div>
          )}
          {atRefill > 0 && (
            <div className="bg-purple-400 text-white px-2.5 py-1 rounded-full text-xs font-bold">
              🔄 {atRefill} на заправке
            </div>
          )}
          {repairs > 0 && (
            <div className="bg-orange-400 text-white px-2.5 py-1 rounded-full text-xs font-bold">
              🔧 {repairs} в ремонте
            </div>
          )}
          {store.settings.labelPrinterName ? (
            <div className="bg-green-600 text-white px-2.5 py-1 rounded-full text-xs font-bold">
              🖨 {store.settings.labelPrinterName}
            </div>
          ) : (
            <div className="bg-orange-500 text-white px-2.5 py-1 rounded-full text-xs font-bold">
              ⚠ Принтер не выбран
            </div>
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

      <div className="flex flex-1 min-h-0 overflow-hidden">
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
                <div className="text-blue-600 text-xs font-mono">Версия 1</div>
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
