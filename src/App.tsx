
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
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
import { mergeLedgerWithStore } from './utils/warehouseStoreBridge';

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
import type { WarehouseFocusRequest } from './components/WarehouseInventoryPanel';

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

/** Pierce shadow roots so focus inside web components is detected (Electron quirks). */
function getDeepActiveElement(doc: Document): HTMLElement | null {
  let el = doc.activeElement as HTMLElement | null;
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement as HTMLElement;
  }
  return el;
}

function isEditableHTMLElement(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.hasAttribute('disabled')) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const inp = el as HTMLInputElement;
    const t = inp.type?.toLowerCase() ?? 'text';
    if (['hidden', 'button', 'submit', 'reset', 'file', 'image'].includes(t)) return false;
    return true;
  }
  return false;
}

/** True when the keystroke must not feed the barcode scanner buffer (typing / IME). */
function keyboardEventTargetsEditable(event: KeyboardEvent): boolean {
  if (event.isComposing || event.key === 'Process') return true;
  if (isEditableHTMLElement(getDeepActiveElement(document))) return true;
  const path =
    typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  for (const node of path) {
    if (node instanceof HTMLElement && isEditableHTMLElement(node)) return true;
  }
  return false;
}

const RU_TO_EN_LAYOUT: Record<string, string> = {
  'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y', 'г': 'u', 'ш': 'i', 'щ': 'o', 'з': 'p', 'х': '[', 'ъ': ']',
  'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g', 'р': 'h', 'о': 'j', 'л': 'k', 'д': 'l', 'ж': ';', 'э': "'",
  'я': 'z', 'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n', 'ь': 'm', 'б': ',', 'ю': '.', 'ё': '`',
  'Й': 'Q', 'Ц': 'W', 'У': 'E', 'К': 'R', 'Е': 'T', 'Н': 'Y', 'Г': 'U', 'Ш': 'I', 'Щ': 'O', 'З': 'P', 'Х': '[', 'Ъ': ']',
  'Ф': 'A', 'Ы': 'S', 'В': 'D', 'А': 'F', 'П': 'G', 'Р': 'H', 'О': 'J', 'Л': 'K', 'Д': 'L', 'Ж': ';', 'Э': "'",
  'Я': 'Z', 'Ч': 'X', 'С': 'C', 'М': 'V', 'И': 'B', 'Т': 'N', 'Ь': 'M', 'Б': ',', 'Ю': '.', 'Ё': '`',
};

function normalizeScannerCode(value: string): string {
  return value.split('').map(ch => RU_TO_EN_LAYOUT[ch] ?? ch).join('');
}

const App: React.FC = () => {
  const store = useStore();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [settingsSubTab, setSettingsSubTab] = useState('printer');
  const [showAbout, setShowAbout] = useState(false);
  const [warehouseFocusRequest, setWarehouseFocusRequest] = useState<WarehouseFocusRequest | null>(
    null,
  );
  const scanBufferRef = useRef('');
  const lastScanKeyRef = useRef(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      // If user types in any focused input/control, scanner capture must stay completely silent.
      if (keyboardEventTargetsEditable(event)) return;

      const now = Date.now();
      if (now - lastScanKeyRef.current > 120) {
        scanBufferRef.current = '';
      }
      lastScanKeyRef.current = now;

      if (event.key === 'Enter') {
        const rawScanned = scanBufferRef.current.trim();
        scanBufferRef.current = '';
        if (rawScanned.length >= 2) {
          const scanned = normalizeScannerCode(rawScanned);
          window.dispatchEvent(new CustomEvent('app-scanner-input', { detail: scanned }));
        }
        return;
      }

      if (event.key.length === 1) {
        scanBufferRef.current += event.key;
      }
    };

    // Bubble phase avoids stealing key events from focused controls in edge cases after modal unmount.
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openPrinterSettings = () => {
    setSettingsSubTab('printer');
    setActiveTab('settings');
  };

  const focusWarehouseSection = useCallback((section: WarehouseFocusRequest['section']) => {
    setWarehouseFocusRequest({ section, tick: Date.now() });
  }, []);

  const clearWarehouseFocus = useCallback(() => setWarehouseFocusRequest(null), []);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':      return <Dashboard store={store} onNavigate={setActiveTab} />;
      case 'newcartridges':  return <NewCartridgesTab store={store} />;
      case 'search':         return <SearchTab store={store} />;
      case 'inventory':
        return (
          <InventoryTab
            store={store}
            warehouseFocusRequest={warehouseFocusRequest}
            onWarehouseFocusHandled={clearWarehouseFocus}
          />
        );
      case 'printers':       return <PrintersTab store={store} />;
      case 'repair':         return <RepairTab store={store} />;
      case 'printing':       return <PrintingTab store={store} />;
      case 'refilllog':      return <RefillLogTab store={store} />;
      case 'import':         return <ImportTab store={store} />;
      case 'settings':       return <SettingsTab store={store} initialSubTab={settingsSubTab} />;
      default:               return <Dashboard store={store} onNavigate={setActiveTab} />;
    }
  };

  const mergedWarehouse = useMemo(
    () =>
      mergeLedgerWithStore(
        store.warehouseLedger,
        store.cartridges,
        store.repairs,
        store.printers,
      ),
    [store.warehouseLedger, store.cartridges, store.repairs, store.printers],
  );

  const waiting = mergedWarehouse.filter(i => i.status === 'waiting').length;
  const atRefill = mergedWarehouse.filter(i => i.status === 'at_refill').length;
  const readyToIssue = mergedWarehouse.filter(i => i.status === 'ready').length;
  const repairs = store.repairs.filter(
    r =>
      r.locationStatus !== 'issued' &&
      (r.status === 'in_repair' || r.status === 'waiting'),
  ).length;

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
        <div className="flex flex-col items-end gap-1 shrink-0 min-w-0">
          <div className="flex items-center space-x-3 text-sm flex-wrap justify-end gap-y-1">
            {waiting > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab('inventory');
                  focusWarehouseSection('waiting');
                }}
                className="bg-[#e9dcc0] text-[#3d3420] border border-[#cfc2a3] px-2.5 py-1 rounded-full text-xs font-bold hover:brightness-95 active:brightness-90 cursor-pointer"
                title="Открыть склад: ожидают отправки"
              >
                ⏳ {waiting} ожидают
              </button>
            )}
            {atRefill > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab('inventory');
                  focusWarehouseSection('at_refill');
                }}
                className="bg-purple-400 text-white px-2.5 py-1 rounded-full text-xs font-bold hover:bg-purple-500 active:bg-purple-600 cursor-pointer"
                title="Открыть склад: на заправке"
              >
                🔄 {atRefill} на заправке
              </button>
            )}
            {readyToIssue > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab('inventory');
                  focusWarehouseSection('ready');
                }}
                className="bg-emerald-500 hover:bg-emerald-400 text-white px-2.5 py-1 rounded-full text-xs font-bold cursor-pointer border border-emerald-400/80"
                title="Открыть склад: готовы к выдаче"
              >
                ✓ {readyToIssue} к выдаче
              </button>
            )}
            {repairs > 0 && (
              <button
                type="button"
                onClick={() => {
                  setWarehouseFocusRequest(null);
                  setActiveTab('repair');
                }}
                className="bg-orange-50 text-orange-800 border border-orange-200/90 px-2.5 py-1 rounded-full text-xs font-semibold hover:bg-orange-100/80 active:bg-orange-100 cursor-pointer"
                title="Открыть вкладку ремонта"
              >
                🔧 {repairs} в ремонте
              </button>
            )}
            {store.settings.labelPrinterName ? (
              <button
                type="button"
                onClick={openPrinterSettings}
                className="bg-green-600 hover:bg-green-500 text-white px-2.5 py-1 rounded-full text-xs font-bold"
                title="Открыть настройки принтера"
              >
                🖨 {store.settings.labelPrinterName}
              </button>
            ) : (
              <button
                type="button"
                onClick={openPrinterSettings}
                className="bg-orange-500 hover:bg-orange-400 text-white px-2.5 py-1 rounded-full text-xs font-bold"
                title="Настроить принтер"
              >
                ⚠ Принтер не выбран
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAbout(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded-full text-xs"
              title="О программе"
            >
              <Info size={14} />
            </button>
          </div>
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
        <main
          className={`flex-1 min-h-0 p-5 ${
            activeTab === 'refilllog' || activeTab === 'repair'
              ? 'overflow-hidden flex flex-col'
              : 'overflow-auto'
          }`}
        >
          {activeTab === 'refilllog' || activeTab === 'repair' ? (
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{renderContent()}</div>
          ) : (
            renderContent()
          )}
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
                  <span className="font-semibold whitespace-pre-line text-right">Спиркин В.А.{'\n'}г. Арсеньев</span>
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
