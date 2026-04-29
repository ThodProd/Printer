
import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  Settings, Printer as PrinterIcon, Scan, Sliders, RefreshCw,
  Barcode as BarcodeIcon, CheckCircle2, AlertCircle, Volume2, VolumeX,
  Save, RotateCcw, Info, Wifi, PenLine,
  Trash2, MemoryStick,
} from 'lucide-react';
import { AppSettings, DEFAULT_SETTINGS, STATUS_LABELS } from '../types';
import { StoreType } from '../store';
import { buildMemoryResetTSPL } from '../utils/tspl';
import LabelEditorTab from './LabelEditorTab';

async function sendTSPL(
  printerName: string,
  tspl: string,
  mode?: 'raw' | 'driver',
): Promise<{ success: boolean; error?: string }> {
  if (!printerName) return { success: false, error: 'Принтер не выбран. Укажите принтер в настройках.' };
  if (window.electronAPI) return window.electronAPI.rawPrint(printerName, tspl, mode);
  return { success: false, error: 'Отправка доступна только в desktop-версии (Electron).' };
}

const SUB_TABS = [
  { id: 'printer',     label: 'Принтер',          icon: <PrinterIcon size={15} /> },
  { id: 'labeleditor', label: 'Редактор этикетки', icon: <PenLine size={15} /> },
  { id: 'scanner',     label: 'Сканер',             icon: <Scan size={15} /> },
  { id: 'app',         label: 'Приложение',         icon: <Sliders size={15} /> },
];

function buildBorderTestLabel(settings: AppSettings): string {
  const widthDots = Math.round(settings.labelWidth * 8);
  const heightDots = Math.round(settings.labelHeight * 8);
  const margin = 8;
  const textX = Math.max(margin + 4, Math.round(widthDots / 2) - 28);
  const textY = Math.max(margin + 4, Math.round(heightDots / 2) - 14);
  return [
    'CLS',
    `SIZE ${settings.labelWidth} mm, ${settings.labelHeight} mm`,
    settings.labelType === 'blackmark'
      ? `BLINE ${settings.labelGap} mm, 0 mm`
      : `GAP ${settings.labelGap} mm, 0 mm`,
    `DENSITY ${settings.labelDensity}`,
    `SPEED ${settings.labelSpeed}`,
    `DIRECTION ${settings.labelRotation ?? 0},0`,
    'REFERENCE 0,0',
    `BOX ${margin},${margin},${Math.max(margin + 1, widthDots - margin)},${Math.max(margin + 1, heightDots - margin)},3`,
    `TEXT ${textX},${textY},"4",0,2,2,"TEST"`,
    'PRINT 1,1',
    'CLS',
    'INITIALPRINTER',
  ].join('\r\n');
}

const SettingsTab: React.FC<{ store: StoreType; initialSubTab?: string }> = ({ store, initialSubTab = 'printer' }) => {
  const [subTab, setSubTab] = useState(initialSubTab);
  const [cfg, setCfg] = useState<AppSettings>({ ...store.settings });
  const [saved, setSaved] = useState(false);

  const [availablePrinters, setAvailablePrinters] = useState<string[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [pingStatus, setPingStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [pinging, setPinging] = useState(false);

  const [printStatus, setPrintStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [driverStatus, setDriverStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [resettingMemory, setResettingMemory] = useState(false);

  const [scanTestInput, setScanTestInput] = useState('');
  const [lastScan, setLastScan] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);

  const isElectron = !!window.electronAPI;

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const refreshPrinters = async () => {
    if (!isElectron) return;
    setLoadingPrinters(true);
    try {
      const list = await window.electronAPI!.getPrinters();
      setAvailablePrinters(list);
    } finally {
      setLoadingPrinters(false);
    }
  };

  const handlePingPrinter = async () => {
    if (!cfg.labelPrinterName) {
      setPingStatus({ text: 'Введите имя принтера', ok: false });
      return;
    }
    if (!window.electronAPI?.pingPrinter) {
      setPingStatus({ text: 'Ping доступен только в desktop-версии (.exe)', ok: false });
      return;
    }
    setPinging(true);
    setPingStatus(null);
    try {
      const res = await window.electronAPI.pingPrinter(cfg.labelPrinterName);
      setPingStatus({ text: res.message, ok: res.ok });
    } finally {
      setPinging(false);
    }
  };

  const handleSaveSettings = () => {
    store.setSettings({
      ...store.settings,
      labelPrinterName: cfg.labelPrinterName,
      labelWidth: cfg.labelWidth,
      labelHeight: cfg.labelHeight,
      labelDensity: cfg.labelDensity,
      labelSpeed: cfg.labelSpeed,
      labelGap: cfg.labelGap,
      labelType: cfg.labelType,
      labelRotation: cfg.labelRotation,
      labelPrintMode: cfg.labelPrintMode,
      autoPrintOnRegister: cfg.autoPrintOnRegister,
      showPreviewBeforePrint: cfg.showPreviewBeforePrint,
      soundNotification: cfg.soundNotification,
      showTechLogs: cfg.showTechLogs,
      enableEventEditing: cfg.enableEventEditing,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleResetSettings = () => {
    setCfg({ ...DEFAULT_SETTINGS });
  };

  const doSend = async (tspl: string) => {
    setPrintStatus(null);
    const res = await sendTSPL(cfg.labelPrinterName, tspl, cfg.labelPrintMode);
    setPrintStatus(
      res.success
        ? { text: 'Отправлено на принтер!', ok: true }
        : { text: res.error ?? 'Ошибка отправки', ok: false },
    );
  };

  const handleGapDetect   = () => doSend('GAPDETECT\r\n');
  const handleBlineDetect = () => doSend('BLINEDETECT\r\n');
  const handleBorderTest = () => doSend(buildBorderTestLabel(cfg));

  const handleResetPrinterMemory = async () => {
    if (!cfg.labelPrinterName) {
      setDriverStatus({ text: 'Укажите принтер перед сбросом памяти', ok: false });
      return;
    }
    setResettingMemory(true);
    setDriverStatus(null);
    try {
      const res = await sendTSPL(cfg.labelPrinterName, buildMemoryResetTSPL(), cfg.labelPrintMode);
      setDriverStatus(
        res.success
          ? { text: 'Память принтера сброшена (INITIALPRINTER)', ok: true }
          : { text: res.error ?? 'Ошибка сброса', ok: false },
      );
    } finally {
      setResettingMemory(false);
    }
  };

  const handleOpenDataFolder = async () => {
    if (!window.electronAPI?.getDataFolder || !window.electronAPI?.openFolder) return;
    const folder = await window.electronAPI.getDataFolder();
    await window.electronAPI.openFolder(folder);
  };

  const handleExportFullDatabase = () => {
    const printersSheet = store.printers.map(p => ({
      'ID': p.programId ?? '',
      'Инв. №': p.inventoryNumber,
      'Модель': p.model,
      'Тип': p.printerType,
      'Подразделение': p.department,
      'Мат. ответственный': p.boss,
      'Дата ввода': p.commissionDate,
      'Стоимость': p.balanceCost,
      'Модели расходников': p.cartridgeModels.join(', '),
    }));
    const cartridgesSheet = store.cartridges.map(c => {
      const printer = store.printers.find(p => p.inventoryNumber === c.printerInventoryNumber);
      return {
        'ID': c.id,
        'Штрихкод': c.barcode,
        'Модель': c.model,
        'Тип': c.consumableType === 'drum' ? 'Драм' : 'Картридж',
        'Цвет': c.color ?? '',
        'Статус': STATUS_LABELS[c.status] ?? c.status,
        'Заправок': c.refillCount,
        'Принтер (инв.)': c.printerInventoryNumber,
        'Принтер (модель)': printer?.model ?? '',
        'Подразделение': printer?.department ?? '',
        'Кто сдал': c.lastSubmittedBy ?? '',
        'Дата регистрации': new Date(c.registrationDate).toLocaleDateString('ru-RU'),
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(printersSheet), 'Принтеры');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cartridgesSheet), 'Расходники');
    XLSX.writeFile(wb, `database_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleExportJsonBackup = async () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      printers: store.printers,
      cartridges: store.cartridges,
      repairs: store.repairs,
      batches: store.batches,
      refillLog: store.refillLog,
      warehouses: {
        waiting: store.cartridges.filter(c => c.status === 'waiting'),
        atRefill: store.cartridges.filter(c => c.status === 'at_refill'),
        ready: store.cartridges.filter(c => c.status === 'received_from_refill' || c.status === 'ready'),
      },
    };
    if (window.electronAPI?.exportJsonBackup) {
      const res = await window.electronAPI.exportJsonBackup(payload);
      if (!res.success) alert(`Ошибка экспорта JSON: ${res.error ?? 'неизвестно'}`);
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `database_export_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearSavedUiHints = () => {
    try {
      const keysToRemove = [
        'inventory_sender_list',
      ];
      keysToRemove.forEach(key => localStorage.removeItem(key));

      const dynamicKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('search_')) {
          dynamicKeys.push(key);
        }
      }
      dynamicKeys.forEach(key => localStorage.removeItem(key));
    } catch {
      // ignore storage errors
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-3">
        <Settings size={22} className="text-blue-600" />
        <h2 className="text-xl font-bold text-gray-800">Настройки</h2>
        {isElectron && (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">Desktop</span>
        )}
      </div>

      {/* Sub-tab bar */}
      <div className="flex flex-wrap gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              subTab === t.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* === PRINTER TAB === */}
      {subTab === 'printer' && (
        <div className="max-w-2xl">
          <div className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
            <h3 className="font-bold text-gray-700 flex items-center space-x-2">
              <PrinterIcon size={17} className="text-blue-600" />
              <span>Принтер этикеток (TSC)</span>
            </h3>

            {isElectron ? (
              <div className="space-y-2">
                <label className="text-xs text-gray-500 uppercase font-bold">Выбрать из системы</label>
                <div className="flex space-x-2">
                  <select
                    className="flex-1 p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    value={cfg.labelPrinterName}
                    onChange={e => setCfg({ ...cfg, labelPrinterName: e.target.value })}
                  >
                    <option value="">— выберите принтер —</option>
                    {availablePrinters.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <button onClick={refreshPrinters} disabled={loadingPrinters}
                    className="px-3 py-2 border rounded-lg hover:bg-gray-50 flex items-center space-x-1 text-sm disabled:opacity-50">
                    <RefreshCw size={14} className={loadingPrinters ? 'animate-spin' : ''} />
                    <span>Обновить</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 flex items-start space-x-2">
                <Info size={15} className="mt-0.5 shrink-0" />
                <span>Выбор из системы доступен только в .exe версии. Введите имя вручную.</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-gray-500 uppercase font-bold">Имя принтера (вручную)</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={cfg.labelPrinterName}
                  onChange={e => setCfg({ ...cfg, labelPrinterName: e.target.value })}
                  placeholder="TSC TTP-225 (RAW)"
                  className="flex-1 p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
                {isElectron && (
                  <button
                    onClick={handlePingPrinter}
                    disabled={pinging}
                    title="Проверить соединение с принтером"
                    className="px-3 py-2 border rounded-lg hover:bg-gray-50 flex items-center space-x-1 text-sm disabled:opacity-50"
                  >
                    <Wifi size={14} className={pinging ? 'animate-pulse text-blue-500' : ''} />
                    <span>Пинг</span>
                  </button>
                )}
              </div>
            </div>

            {pingStatus && (
              <div className={`p-2 rounded-lg flex items-center space-x-2 text-xs font-semibold ${
                pingStatus.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {pingStatus.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                <span>{pingStatus.text}</span>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs text-gray-500 uppercase font-bold">Режим отправки печати</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'raw', title: 'RAW-драйвер', hint: 'Generic/Text Only или TSC RAW' },
                  { id: 'driver', title: 'Драйвер Windows', hint: 'Запасной способ через print.exe' },
                ] as const).map(mode => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setCfg({ ...cfg, labelPrintMode: mode.id })}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      (cfg.labelPrintMode ?? 'raw') === mode.id
                        ? 'bg-blue-50 border-blue-300 text-blue-800'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <div className="text-sm font-bold">{mode.title}</div>
                    <div className="text-[11px] opacity-70">{mode.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Printer memory reset */}
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
              <h4 className="font-bold text-orange-800 text-sm flex items-center space-x-2">
                <MemoryStick size={15} />
                <span>Сброс памяти принтера</span>
              </h4>
              <p className="text-xs text-orange-700">
                Отправляет INITIALPRINTER — очищает RAM, удаляет AUTO.BAS и шаблоны,
                сбрасывает мусор. Выполните если принтер печатает старые данные.
              </p>
              {driverStatus && (
                <div className={`p-2 rounded flex items-center space-x-2 text-xs font-semibold ${
                  driverStatus.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {driverStatus.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  <span>{driverStatus.text}</span>
                </div>
              )}
              <button
                onClick={handleResetPrinterMemory}
                disabled={resettingMemory || !isElectron || !cfg.labelPrinterName}
                className="flex items-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-bold hover:bg-orange-700 disabled:opacity-50"
              >
                <Trash2 size={14} className={resettingMemory ? 'animate-pulse' : ''} />
                <span>{resettingMemory ? 'Сбрасываем...' : 'Сбросить память принтера'}</span>
              </button>
            </div>

            <hr />

            <h3 className="font-bold text-gray-700 flex items-center space-x-2 text-sm">
              <Sliders size={16} className="text-blue-600" />
              <span>Параметры TSPL</span>
            </h3>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Ширина (мм)', key: 'labelWidth', min: 10, max: 200 },
                { label: 'Высота (мм)', key: 'labelHeight', min: 5, max: 200 },
                { label: 'Плотность (0–15)', key: 'labelDensity', min: 0, max: 15 },
                { label: 'Скорость (1–6)', key: 'labelSpeed', min: 1, max: 6 },
                { label: 'Промежуток (мм)', key: 'labelGap', min: 0, max: 10 },
              ].map(({ label, key, min, max }) => (
                <div key={key}>
                  <label className="text-xs text-gray-400 block mb-1">{label}</label>
                  <input
                    type="number" min={min} max={max}
                    value={(cfg as unknown as Record<string, number>)[key]}
                    onChange={e => setCfg({ ...cfg, [key]: parseInt(e.target.value) || min } as AppSettings)}
                    className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
              ))}

              <div>
                <label className="text-xs text-gray-400 block mb-1">Тип меток</label>
                <select
                  value={cfg.labelType}
                  onChange={e => setCfg({ ...cfg, labelType: e.target.value as AppSettings['labelType'] })}
                  className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                >
                  <option value="gap">GAP (просвет)</option>
                  <option value="blackmark">Black Mark</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">Поворот печати</label>
              <div className="flex gap-2">
                {([0, 1, 2, 3] as const).map(r => (
                  <button key={r} type="button"
                    onClick={() => setCfg({ ...cfg, labelRotation: r })}
                    className={`flex-1 py-1.5 text-xs font-bold rounded border ${
                      (cfg.labelRotation ?? 0) === r ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}>
                    {r * 90}°
                  </button>
                ))}
              </div>
            </div>

            <div className="flex space-x-3">
              <button onClick={handleSaveSettings}
                className={`flex-1 py-2.5 rounded-lg font-bold flex items-center justify-center space-x-2 transition-all ${
                  saved ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}>
                {saved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                <span>{saved ? 'Сохранено!' : 'Сохранить настройки'}</span>
              </button>
              <button onClick={handleResetSettings}
                className="px-4 py-2.5 border rounded-lg hover:bg-gray-50 flex items-center space-x-2 text-sm text-gray-600">
                <RotateCcw size={14} />
                <span>Сброс</span>
              </button>
            </div>

            {printStatus && (
              <div className={`p-3 rounded-lg flex items-center space-x-2 text-sm font-semibold ${
                printStatus.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {printStatus.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <span>{printStatus.text}</span>
              </div>
            )}

            <div className="bg-white rounded-xl border p-4 space-y-2">
              <h4 className="font-bold text-gray-700 text-sm">Калибровка и тест</h4>
              <div className="flex flex-wrap gap-2">
                <button onClick={handleGapDetect} className="px-3 py-2 border rounded-lg text-xs hover:bg-gray-50 text-gray-700">GAP калибровка</button>
                <button onClick={handleBlineDetect} className="px-3 py-2 border rounded-lg text-xs hover:bg-gray-50 text-gray-700">BM калибровка</button>
                <button onClick={handleBorderTest} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 flex items-center space-x-1">
                  <BarcodeIcon size={12} />
                  <span>Тест квадрата</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === LABEL EDITOR TAB === */}
      {subTab === 'labeleditor' && (
        <LabelEditorTab store={store} />
      )}

      {/* === SCANNER TAB === */}
      {subTab === 'scanner' && (
        <div className="max-w-xl space-y-5">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start space-x-3">
            <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 space-y-1">
              <p className="font-bold">Сканер работает в режиме клавиатуры (HID Keyboard).</p>
              <p>Убедитесь, что фокус находится в поле ввода на экране «Приём/Выдача». Программа автоматически обнаружит сканирование при нажатии Enter.</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border p-5 space-y-3">
            <h3 className="font-bold text-gray-700 flex items-center space-x-2 text-sm">
              <Scan size={16} className="text-blue-600" />
              <span>Тест сканирования</span>
            </h3>
            <input
              ref={scanInputRef}
              type="text"
              value={scanTestInput}
              onChange={e => setScanTestInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = scanTestInput.trim().split('').map(ch => ({
                    й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i', щ: 'o', з: 'p',
                    ф: 'a', ы: 's', в: 'd', а: 'f', п: 'g', р: 'h', о: 'j', л: 'k', д: 'l',
                    я: 'z', ч: 'x', с: 'c', м: 'v', и: 'b', т: 'n', ь: 'm',
                    Й: 'Q', Ц: 'W', У: 'E', К: 'R', Е: 'T', Н: 'Y', Г: 'U', Ш: 'I', Щ: 'O', З: 'P',
                    Ф: 'A', Ы: 'S', В: 'D', А: 'F', П: 'G', Р: 'H', О: 'J', Л: 'K', Д: 'L',
                    Я: 'Z', Ч: 'X', С: 'C', М: 'V', И: 'B', Т: 'N', Ь: 'M',
                  } as Record<string, string>)[ch] ?? ch).join('');
                  if (val) setLastScan(val);
                  setScanTestInput('');
                  e.preventDefault();
                }
              }}
              placeholder="⚡ Наведите курсор и сканируйте..."
              className="w-full p-4 text-xl text-center tracking-widest border-2 border-blue-300 rounded-xl focus:border-blue-500 outline-none font-mono"
              autoComplete="off"
            />
            {lastScan && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs text-green-600 uppercase font-bold mb-0.5">Последний скан:</div>
                  <div className="text-xl font-mono font-bold text-green-800">{lastScan}</div>
                </div>
                <CheckCircle2 size={28} className="text-green-500" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* === APP SETTINGS TAB === */}
      {subTab === 'app' && (
        <div className="max-w-lg space-y-5">
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <h3 className="font-bold text-gray-700 flex items-center space-x-2 text-sm">
              <Sliders size={16} className="text-blue-600" />
              <span>Настройки приложения</span>
            </h3>

            {[
              { key: 'autoPrintOnRegister', label: 'Авто-печать при регистрации расходника', hint: 'Этикетка печатается сразу после создания' },
              { key: 'showPreviewBeforePrint', label: 'Показывать предпросмотр перед печатью', hint: 'Открывает окно подтверждения с превью' },
              { key: 'soundNotification', label: 'Звук после успешного сканирования', hint: 'Короткий сигнал при обработке штрих-кода' },
              { key: 'showTechLogs', label: 'Технические записи в журнале', hint: 'Показывать все системные события в журнале заправок' },
              { key: 'enableEventEditing', label: 'Разрешить редактирование/отмену событий', hint: 'Удаление партий, отмена статусов и других операций' },
            ].map(({ key, label, hint }) => {
              const val = (cfg as unknown as Record<string, boolean>)[key];
              return (
                <div key={key}
                  className={`flex items-start justify-between p-3 rounded-xl border cursor-pointer transition-all ${val ? 'border-blue-200 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'}`}
                  onClick={() => setCfg({ ...cfg, [key]: !val } as AppSettings)}>
                  <div className="flex-1 pr-4">
                    <div className="font-semibold text-gray-700 text-sm">{label}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{hint}</div>
                  </div>
                  <div className="flex items-center space-x-1 mt-0.5">
                    {key === 'soundNotification' && (val ? <Volume2 size={15} className="text-blue-600" /> : <VolumeX size={15} className="text-gray-400" />)}
                    <div className={`w-11 h-6 rounded-full transition-colors relative ${val ? 'bg-blue-600' : 'bg-gray-200'}`}>
                      <div className="bg-white rounded-full shadow absolute top-0.5 transition-all" style={{ width: 18, height: 18, top: 3, left: val ? 20 : 3 }} />
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="flex space-x-3 pt-1">
              <button onClick={handleSaveSettings}
                className={`flex-1 py-2.5 rounded-lg font-bold flex items-center justify-center space-x-2 transition-all ${saved ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                {saved ? <CheckCircle2 size={16} /> : <Save size={16} />}
                <span>{saved ? 'Сохранено!' : 'Сохранить'}</span>
              </button>
              <button onClick={handleResetSettings}
                className="px-4 border rounded-lg hover:bg-gray-50 text-sm text-gray-600 flex items-center space-x-1">
                <RotateCcw size={13} /><span>Сброс</span>
              </button>
            </div>
          </div>

          {/* Data management */}
          <div className="bg-white rounded-xl border p-5 space-y-3">
            <h3 className="font-bold text-gray-700 text-sm">Данные приложения</h3>
            <div className="text-sm text-gray-600 space-y-1">
              <div>Принтеров: <strong>{store.printers.length}</strong></div>
              <div>Расходников: <strong>{store.cartridges.length}</strong></div>
              <div>Ремонтов: <strong>{store.repairs.length}</strong></div>
              <div>Партий: <strong>{store.batches.length}</strong></div>
              <div>Сотрудников: <strong>{store.employees.length}</strong></div>
              <div>Новых картриджей: <strong>{store.newCartridges.length}</strong></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleOpenDataFolder}
                disabled={!isElectron}
                className="px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm hover:bg-blue-100 font-semibold disabled:opacity-50"
              >
                Открыть папку Data
              </button>
              <button
                onClick={handleExportFullDatabase}
                className="px-4 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-sm hover:bg-green-100 font-semibold"
              >
                Выгрузить всю базу в Excel
              </button>
              <button
                onClick={handleExportJsonBackup}
                className="px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-sm hover:bg-indigo-100 font-semibold"
              >
                Экспорт JSON (backup)
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm('Очистить ВСЕ данные? Это необратимо!')) return;
                  try {
                    await store.wipeAllPersistedData();
                    clearSavedUiHints();
                    window.location.reload();
                  } catch (e) {
                    alert(e instanceof Error ? e.message : 'Не удалось очистить данные');
                  }
                }}
                className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm hover:bg-red-100 font-semibold"
              >
                Очистить все данные
              </button>
            </div>
            <div className="text-xs text-gray-400">
              Основная база: <span className="font-mono">Data/database.json</span> рядом с программой.
            </div>
          </div>

          {/* About */}
          <div className="bg-blue-50 rounded-xl border border-blue-100 p-5 space-y-2">
            <h3 className="font-bold text-blue-800 text-sm">О программе</h3>
            <div className="text-sm text-blue-700 space-y-1">
              <div><strong>Cartridge Control</strong> — система учёта картриджей</div>
              <div>Версия: <strong>1</strong></div>
              <div>Создатель: <strong>Спиркин В.А.</strong></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsTab;
