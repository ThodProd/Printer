
import React, { useEffect, useState, useMemo } from 'react';
import {
  Search, RefreshCw,
  CheckCircle2, AlertCircle, X, Barcode as BarcodeIcon, ChevronRight,
} from 'lucide-react';
import Barcode from 'react-barcode';
import { Cartridge, LabelTemplate, STATUS_LABELS } from '../types';
import { StoreType } from '../store';
import { buildTSPLLabel, DOTS_PER_MM, getTemplate } from '../utils/tspl';
import { useStickyState } from '../utils/useStickyState';

const PREVIEW_DOTS_SCALE = 0.35;

function resolvePreviewContent(
  tpl: string,
  data: {
    id: string;
    inv: string;
    cartModel?: string;
    printerModel?: string;
    fio?: string;
    boss?: string;
    employee?: string;
    department?: string;
    printerType?: string;
    commissionDate?: string;
    balanceCost?: string;
    consumableType?: string;
    status?: string;
    quantity?: string | number;
    location?: string;
    description?: string;
    vendor?: string;
    firmwareFlashed?: boolean;
  },
): string {
  const printerModel = data.printerModel ?? '';
  const fio = data.fio ?? data.boss ?? data.employee ?? '';
  const firmware = data.firmwareFlashed ? 'П' : '';
  return tpl
    .replace(/\{id\}/g, data.id)
    .replace(/\{inv\}/g, data.inv)
    .replace(/\{model\}/g, printerModel)
    .replace(/\{printerModel\}/g, printerModel)
    .replace(/\{cartModel\}/g, data.cartModel ?? '')
    .replace(/\{fio\}/g, fio)
    .replace(/\{boss\}/g, fio)
    .replace(/\{employee\}/g, fio)
    .replace(/\{department\}/g, data.department ?? '')
    .replace(/\{printerType\}/g, data.printerType ?? '')
    .replace(/\{commissionDate\}/g, data.commissionDate ?? '')
    .replace(/\{balanceCost\}/g, data.balanceCost ?? '')
    .replace(/\{consumableType\}/g, data.consumableType ?? '')
    .replace(/\{status\}/g, data.status ?? '')
    .replace(/\{quantity\}/g, String(data.quantity ?? ''))
    .replace(/\{location\}/g, data.location ?? '')
    .replace(/\{description\}/g, data.description ?? '')
    .replace(/\{vendor\}/g, data.vendor ?? '')
    .replace(/\{date\}/g, new Date().toLocaleDateString('ru-RU'))
    .replace(/\{fw\}/g, firmware)
    .replace(/\{firmware\}/g, firmware);
}

/** Render preview from the same template/settings used for printing */
const LabelPreview: React.FC<{
  template: LabelTemplate;
  data: {
    id: string;
    inv: string;
    cartModel?: string;
    printerModel?: string;
    fio?: string;
    boss?: string;
    employee?: string;
    department?: string;
    printerType?: string;
    commissionDate?: string;
    balanceCost?: string;
    consumableType?: string;
    status?: string;
    quantity?: string | number;
    location?: string;
    description?: string;
    vendor?: string;
    firmwareFlashed?: boolean;
  };
}> = ({ template, data }) => {
  const canvasW = Math.max(160, template.width * DOTS_PER_MM * PREVIEW_DOTS_SCALE);
  const canvasH = Math.max(56, template.height * DOTS_PER_MM * PREVIEW_DOTS_SCALE);
  const renderElement = (el: LabelTemplate['elements'][number]) => {
    const content = resolvePreviewContent(el.content, data);
    const style: React.CSSProperties = {
      position: 'absolute',
      left: el.x * PREVIEW_DOTS_SCALE,
      top: el.y * PREVIEW_DOTS_SCALE,
      width: Math.max(8, el.width * PREVIEW_DOTS_SCALE),
      height: Math.max(8, el.height * PREVIEW_DOTS_SCALE),
      overflow: 'hidden',
      pointerEvents: 'none',
    };
    if (el.type === 'barcode') {
      const barcodeHeight = Math.max(8, (el.barcodeHeight ?? el.height ?? 30) * PREVIEW_DOTS_SCALE);
      return (
        <div key={el.id} style={style}>
          <Barcode
            value={content || 'CODE'}
            width={1}
            height={barcodeHeight}
            fontSize={0}
            margin={0}
            displayValue={false}
          />
        </div>
      );
    }
    if (el.type === 'qrcode') {
      return (
        <div key={el.id} style={style} className="bg-black text-white text-[8px] flex items-center justify-center">
          QR
        </div>
      );
    }
    const fontScale = el.fontScale ?? 1;
    return (
      <div
        key={el.id}
        style={style}
        className="text-[9px] font-mono font-semibold whitespace-nowrap text-gray-700"
      >
        <span style={{ fontSize: `${Math.max(8, fontScale * 8)}px` }}>{content || ' '}</span>
      </div>
    );
  };

  return (
    <div
      className="bg-white border-2 border-dashed border-gray-300 relative overflow-hidden"
      style={{ width: canvasW, height: canvasH }}
    >
      {template.elements.map(renderElement)}
    </div>
  );
};

const PrintingTab: React.FC<{ store: StoreType }> = ({ store }) => {
  const [printerSearch, setPrinterSearch] = useStickyState('search_printing', '');
  const [selectedPrinterInv, setSelectedPrinterInv] = useState('');
  const [selectedCartridgeId, setSelectedCartridgeId] = useState('');
  const [printStatus, setPrintStatus] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    const onScan = (event: Event) => {
      setPrinterSearch((event as CustomEvent<string>).detail);
    };
    window.addEventListener('app-scanner-input', onScan as EventListener);
    return () => window.removeEventListener('app-scanner-input', onScan as EventListener);
  }, []);

  const cfg = store.settings;
  const template = getTemplate(cfg);

  const filteredPrinters = useMemo(() => {
    const q = printerSearch.toLowerCase();
    if (!q) return store.printers;
    return store.printers.filter(p =>
      p.inventoryNumber.toLowerCase().includes(q) ||
      p.model.toLowerCase().includes(q) ||
      p.department.toLowerCase().includes(q) ||
      (p.programId ?? '').toLowerCase().includes(q),
    );
  }, [store.printers, printerSearch]);

  const printerCartridges = useMemo(
    () => store.cartridges.filter((c: Cartridge) => c.printerInventoryNumber === selectedPrinterInv && !c.isReplaced),
    [store.cartridges, selectedPrinterInv],
  );
  const selectedCartridge = store.cartridges.find(c => c.id === selectedCartridgeId);
  const selectedPrinter = store.printers.find(p => p.inventoryNumber === selectedPrinterInv);

  const buildData = (cartridge: Cartridge) => {
    const printer = store.printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
    return {
      id: cartridge.id,
      inv: cartridge.printerInventoryNumber,
      cartModel: cartridge.model,
      printerModel: printer?.model ?? '',
      fio: printer?.boss ?? '',
      boss: printer?.boss ?? '',
      department: printer?.department ?? '',
      printerType: printer?.printerType ?? '',
      commissionDate: printer?.commissionDate ?? '',
      balanceCost: printer?.balanceCost ?? '',
      consumableType: cartridge.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
      status: STATUS_LABELS[cartridge.status],
      firmwareFlashed: !!printer?.firmwareFlashed,
    };
  };

  const buildTSPL = (cartridge: Cartridge): string => {
    return buildTSPLLabel(template, cfg, buildData(cartridge));
  };

  const doPrint = async (cartridge: Cartridge) => {
    if (!cfg.labelPrinterName) {
      setPrintStatus({ text: 'Принтер не выбран — укажите в Настройках.', ok: false });
      return;
    }
    if (!window.electronAPI) {
      setPrintStatus({ text: 'Прямая отправка доступна только в desktop-версии (.exe).', ok: false });
      return;
    }
    setPrintStatus(null);
    const tspl = buildTSPL(cartridge);
    const res = await window.electronAPI.rawPrint(cfg.labelPrinterName, tspl, cfg.labelPrintMode);
    if (res.success) {
      setPrintStatus({ text: `Этикетка отправлена на «${cfg.labelPrinterName}»`, ok: true });
    } else {
      setPrintStatus({ text: res.error ?? 'Ошибка отправки', ok: false });
    }
  };

  const handleReprint = () => {
    if (selectedCartridge) doPrint(selectedCartridge);
  };

  const handleReplace = async () => {
    if (!selectedCartridge) return;
    if (!confirm(`Заменить ID ${selectedCartridge.id} на новый? Этикетка печататься не будет.`)) return;
    const newId = store.generateConsumableId(selectedCartridge.consumableType ?? 'cartridge');
    const oldId = selectedCartridge.id;
    store.setCartridges(prev => prev.map(c => c.id === oldId ? {
      ...c,
      id: newId,
      barcode: newId,
      history: [...c.history, {
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        action: `ID заменён: ${oldId} → ${newId}`,
      }],
    } : c));
    store.setBatches(prev => prev.map(batch => ({
      ...batch,
      cartridgeIds: batch.cartridgeIds.map(id => id === oldId ? newId : id),
      items: (batch.items ?? []).map(item => item.kind === 'cartridge' && item.id === oldId ? { ...item, id: newId } : item),
    })));
    store.setRefillLog(prev => prev.map(entry => entry.cartridgeId === oldId ? { ...entry, cartridgeId: newId } : entry));
    setSelectedCartridgeId(newId);
    setPrintStatus({ text: `ID заменён: ${oldId} → ${newId}`, ok: true });
  };

  const handlePrintPrinter = async () => {
    if (!selectedPrinter) return;
    if (!cfg.labelPrinterName) {
      setPrintStatus({ text: 'Принтер не выбран — укажите в Настройках.', ok: false });
      return;
    }
    if (!window.electronAPI) {
      setPrintStatus({ text: 'Прямая отправка доступна только в desktop-версии (.exe).', ok: false });
      return;
    }
    const tspl = buildTSPLLabel(template, cfg, {
      id: selectedPrinter.programId ?? selectedPrinter.inventoryNumber,
      inv: selectedPrinter.inventoryNumber,
      printerModel: selectedPrinter.model,
      fio: selectedPrinter.boss,
      boss: selectedPrinter.boss,
      department: selectedPrinter.department,
      printerType: selectedPrinter.printerType,
      commissionDate: selectedPrinter.commissionDate,
      balanceCost: selectedPrinter.balanceCost,
      firmwareFlashed: !!selectedPrinter.firmwareFlashed,
    });
    const res = await window.electronAPI.rawPrint(cfg.labelPrinterName, tspl, cfg.labelPrintMode);
    setPrintStatus(res.success
      ? { text: `Этикетка принтера отправлена на «${cfg.labelPrinterName}»`, ok: true }
      : { text: res.error ?? 'Ошибка отправки', ok: false });
  };

  const handleReplacePrinterId = () => {
    if (!selectedPrinter) return;
    const oldId = selectedPrinter.programId ?? selectedPrinter.inventoryNumber;
    if (!confirm(`Заменить ID принтера ${oldId} на новый? Этикетка печататься не будет.`)) return;
    const newId = store.generatePrinterId(selectedPrinter.inventoryNumber);
    store.updatePrinter(selectedPrinter.inventoryNumber, { programId: newId });
    setPrintStatus({ text: `ID принтера заменён: ${oldId} → ${newId}`, ok: true });
  };

  return (
    <div className="space-y-5 h-full min-h-0 flex flex-col">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
          <BarcodeIcon size={22} className="text-blue-600" />
          <span>Печать этикеток</span>
        </h2>
        <div className={`text-xs px-3 py-1.5 rounded-lg font-semibold ${
          cfg.labelPrinterName ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
        }`}>
          {cfg.labelPrinterName ? `🖨 ${cfg.labelPrinterName}` : '⚠ Принтер не выбран (Настройки)'}
        </div>
      </div>

      {printStatus && (
        <div className={`p-3 rounded-xl flex items-center justify-between border text-sm font-semibold ${
          printStatus.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          <div className="flex items-center space-x-2">
            {printStatus.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{printStatus.text}</span>
          </div>
          <button onClick={() => setPrintStatus(null)} className="opacity-50 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 flex-1 min-h-0">
        {/* Step 1: Select Printer */}
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <h3 className="font-bold text-sm text-gray-700 flex items-center space-x-2">
            <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full text-xs flex items-center justify-center font-bold">1</span>
            <span>Выберите принтер</span>
          </h3>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
            <input
              type="text"
              placeholder="Поиск по инв. №, модели, ID..."
              value={printerSearch}
              onChange={e => setPrinterSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="max-h-[calc(100vh-320px)] overflow-y-auto space-y-1">
            {filteredPrinters.length === 0 ? (
              <div className="text-gray-300 italic text-xs py-4 text-center">Нет принтеров</div>
            ) : (
              filteredPrinters.map(p => {
                const count = store.cartridges.filter(c => c.printerInventoryNumber === p.inventoryNumber && !c.isReplaced).length;
                return (
                  <button
                    key={p.inventoryNumber}
                    onClick={() => { setSelectedPrinterInv(p.inventoryNumber); setSelectedCartridgeId(''); }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                      selectedPrinterInv === p.inventoryNumber
                        ? 'bg-blue-50 border border-blue-200 text-blue-700'
                        : 'hover:bg-gray-50 border border-transparent text-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold font-mono">{p.inventoryNumber}</div>
                        {p.programId && <div className="text-gray-400 font-mono text-[10px]">ID: {p.programId}</div>}
                        <div className="text-gray-500">{p.model}</div>
                        {p.department && <div className="text-gray-400">{p.department}</div>}
                      </div>
                      <div className="flex items-center space-x-1 text-gray-400">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                          p.printerType === 'mfu' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {p.printerType === 'mfu' ? 'МФУ' : p.printerType === 'printer' ? 'Пр' : p.printerType}
                        </span>
                        <span className="bg-gray-100 px-1 rounded">{count}</span>
                        <ChevronRight size={12} />
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Step 2: Select Cartridge */}
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <h3 className="font-bold text-sm text-gray-700 flex items-center space-x-2">
            <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full text-xs flex items-center justify-center font-bold">2</span>
            <span>Выберите расходник</span>
          </h3>
          {!selectedPrinterInv ? (
            <div className="text-gray-300 italic text-xs py-4 text-center">Сначала выберите принтер</div>
          ) : printerCartridges.length === 0 ? (
            <div className="text-gray-300 italic text-xs py-4 text-center">Нет расходников для этого принтера</div>
          ) : (
            <div className="space-y-1 max-h-[calc(100vh-320px)] overflow-y-auto">
              {printerCartridges.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCartridgeId(c.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                    selectedCartridgeId === c.id
                      ? 'bg-blue-50 border border-blue-200 text-blue-700'
                      : 'hover:bg-gray-50 border border-transparent text-gray-700'
                  }`}
                >
                  <div className="flex items-center space-x-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${c.consumableType === 'drum' ? 'bg-orange-400' : 'bg-blue-400'}`} />
                    <span className="font-mono font-bold">{c.id}</span>
                    {c.consumableType === 'drum' && <span className="text-orange-600 font-bold text-xs">DRUM</span>}
                  </div>
                  <div className="text-gray-500 mt-0.5">{c.model}</div>
                  <div className={`text-xs mt-0.5 font-bold ${
                    c.status === 'on_hand' ? 'text-blue-600' :
                    c.status === 'at_refill' ? 'text-purple-600' :
                    'text-gray-400'
                  }`}>
                    {c.status === 'on_hand' ? 'На руках' :
                     c.status === 'at_refill' ? 'На заправке' :
                     c.status === 'waiting' ? 'Ожидает' :
                     (STATUS_LABELS[c.status] ?? 'Статус неизвестен')}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Step 3: Print */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-4 space-y-3">
            <h3 className="font-bold text-sm text-gray-700 flex items-center space-x-2">
              <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full text-xs flex items-center justify-center font-bold">3</span>
              <span>Действие</span>
            </h3>

            {selectedCartridge ? (
              <div className="space-y-3">
                <div className="p-3 bg-gray-50 rounded-lg text-xs space-y-1 border">
                  <div><span className="text-gray-400">ID:</span> <strong className="font-mono">{selectedCartridge.id}</strong></div>
                  <div><span className="text-gray-400">Принтер:</span> <strong>{selectedCartridge.printerInventoryNumber}</strong></div>
                  <div><span className="text-gray-400">Модель:</span> <strong>{selectedCartridge.model}</strong></div>
                  <div><span className="text-gray-400">Заправок:</span> <strong>{selectedCartridge.refillCount}</strong></div>
                </div>

                <button
                  onClick={handleReprint}
                  className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-bold text-sm flex items-center justify-center space-x-2 hover:bg-blue-700"
                >
                  <BarcodeIcon size={15} />
                  <span>Напечатать этикетку</span>
                </button>

                <button
                  onClick={handleReplace}
                  className="w-full py-2 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg text-xs font-bold flex items-center justify-center space-x-2 hover:bg-orange-100"
                >
                  <RefreshCw size={13} />
                  <span>Заменить ID</span>
                </button>
              </div>
            ) : selectedPrinter ? (
              <div className="space-y-3">
                <div className="p-3 bg-gray-50 rounded-lg text-xs space-y-1 border">
                  <div><span className="text-gray-400">ID:</span> <strong className="font-mono">{selectedPrinter.programId ?? '—'}</strong></div>
                  <div><span className="text-gray-400">Инв. №:</span> <strong>{selectedPrinter.inventoryNumber}</strong></div>
                  <div><span className="text-gray-400">Модель:</span> <strong>{selectedPrinter.model}</strong></div>
                  <div><span className="text-gray-400">Подразделение:</span> <strong>{selectedPrinter.department || '—'}</strong></div>
                </div>

                <button
                  onClick={handlePrintPrinter}
                  className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-bold text-sm flex items-center justify-center space-x-2 hover:bg-blue-700"
                >
                  <BarcodeIcon size={15} />
                  <span>Напечатать этикетку</span>
                </button>

                <button
                  onClick={handleReplacePrinterId}
                  className="w-full py-2 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg text-xs font-bold flex items-center justify-center space-x-2 hover:bg-orange-100"
                >
                  <RefreshCw size={13} />
                  <span>Заменить ID</span>
                </button>
              </div>
            ) : (
              <div className="text-gray-300 italic text-xs py-4 text-center">Выберите принтер или расходник</div>
            )}
          </div>

          {/* Label preview — mirrors the configured template */}
          {selectedCartridge && (
            <div className="bg-white rounded-xl border p-4 flex flex-col items-center space-y-2">
              <div className="text-xs text-gray-400 uppercase font-bold">
                Превью ({cfg.labelWidth}×{cfg.labelHeight} мм)
              </div>
              <LabelPreview template={template} data={buildData(selectedCartridge)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PrintingTab;
