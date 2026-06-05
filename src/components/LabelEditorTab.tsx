
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Save, RotateCcw, Plus, Trash2, ZoomIn, ZoomOut,
  AlignLeft, Info, Copy,
} from 'lucide-react';
import Barcode from 'react-barcode';
import {
  LabelElement,
  LabelTemplate,
  DEFAULT_LABEL_TEMPLATE,
  DEFAULT_LABEL_TSPL_TEMPLATE,
  AppSettings,
} from '../types';
import { StoreType } from '../store';
import { buildTSPLLabel, DOTS_PER_MM, resolveContent, type LabelData } from '../utils/tspl';

/**
 * Screen scale at 96 DPI: 96/25.4 ≈ 3.78 px/mm.
 * Used only to size the white label canvas on screen.
 */
const PX_PER_MM = 3.78;

const TEST_ID = 'C-20240101-TEST1';
const TEST_INV = 'INV-0001';
const TEST_MODEL = 'HP LaserJet 1020';
const TEST_CART_MODEL = 'CF283A';
const TEST_FIO = 'Иванов И.И.';
const TEST_DEPARTMENT = 'Бухгалтерия';
const TEST_PRINTER_TYPE = 'Принтер';
const TEST_COMMISSION_DATE = '01.01.2022';
const TEST_BALANCE_COST = '15000';
const VARIABLE_ID = '{id}';
const VARIABLE_INV = '{inv}';
const VARIABLE_MODEL = '{model}';
const VARIABLE_CART_MODEL = '{cartModel}';

const VARIABLE_TAGS = [
  { tag: '{id}', label: 'ID / код этикетки' },
  { tag: '{inv}', label: 'Инв. № принтера' },
  { tag: '{model}', label: 'Модель принтера' },
  { tag: '{printerModel}', label: 'Модель принтера' },
  { tag: '{cartModel}', label: 'Модель картриджа' },
  { tag: '{fio}', label: 'ФИО мат. ответственного' },
  { tag: '{boss}', label: 'ФИО мат. ответственного' },
  { tag: '{employee}', label: 'Сотрудник' },
  { tag: '{department}', label: 'Подразделение' },
  { tag: '{printerType}', label: 'Тип устройства' },
  { tag: '{commissionDate}', label: 'Дата ввода' },
  { tag: '{balanceCost}', label: 'Балансовая стоимость' },
  { tag: '{consumableType}', label: 'Тип расходника' },
  { tag: '{status}', label: 'Статус расходника' },
  { tag: '{quantity}', label: 'Количество' },
  { tag: '{location}', label: 'Место хранения' },
  { tag: '{description}', label: 'Описание' },
  { tag: '{vendor}', label: 'Модель принтера для новых картриджей' },
  { tag: '{date}', label: 'Дата' },
  { tag: '{fw}', label: 'Метка «прошит» у принтера (слово «Прошит» или пусто)' },
  { tag: '{firmware}', label: 'То же, что {fw}' },
];

type LabelPreviewScenario = 'printer_flashed' | 'printer_plain' | 'cartridge';

function makePreviewLabelData(scenario: LabelPreviewScenario): LabelData {
  return {
    id: TEST_ID,
    inv: TEST_INV,
    printerModel: TEST_MODEL,
    cartModel: TEST_CART_MODEL,
    fio: TEST_FIO,
    boss: TEST_FIO,
    employee: TEST_FIO,
    department: TEST_DEPARTMENT,
    printerType: TEST_PRINTER_TYPE,
    commissionDate: TEST_COMMISSION_DATE,
    balanceCost: TEST_BALANCE_COST,
    consumableType: 'Картридж',
    status: 'На руках',
    quantity: '1',
    location: 'Склад',
    description: 'Описание',
    vendor: TEST_MODEL,
    firmwareFlashed: scenario === 'printer_flashed',
  };
}

const FONT_OPTIONS = [
  { value: '1', label: '1 (5×12)' },
  { value: '2', label: '7×16' },
  { value: '3', label: '3 (10×24)' },
  { value: '4', label: '4 (12×28)' },
  { value: '5', label: '5 (16×32)' },
  { value: '0', label: '0 (8×8)' },
];

function parseTsplToTemplate(tspl: string, fallback: LabelTemplate): LabelTemplate {
  const lines = tspl.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const sizeMatch = lines.find(l => /^SIZE\s+/i.test(l))?.match(/^SIZE\s+([\d.]+)\s*mm,\s*([\d.]+)\s*mm$/i);
  const width = sizeMatch ? Number(sizeMatch[1]) : fallback.width;
  const height = sizeMatch ? Number(sizeMatch[2]) : fallback.height;
  let idx = 0;
  const parsed: LabelElement[] = [];
  lines.forEach(line => {
    const textMatch = line.match(/^TEXT\s+(\d+),(\d+),"([^"]+)",(\d+),(\d+),(\d+),"(.*)"$/i);
    if (textMatch) {
      const scale = Number(textMatch[5]) || 1;
      parsed.push({
        id: `tspl_text_${idx++}`,
        type: 'text',
        x: Number(textMatch[1]),
        y: Number(textMatch[2]),
        width: Math.max(20, (textMatch[7]?.length ?? 1) * 8 * scale),
        height: Math.max(12, 16 * scale),
        textTag: textMatch[3],
        rotation: Number(textMatch[4]) || 0,
        fontScale: scale,
        content: textMatch[7],
      });
      return;
    }
    const barcodeMatch = line.match(/^BARCODE\s+(\d+),(\d+),"([^"]+)",(\d+),(\d+),(\d+),(\d+),(\d+),"(.*)"$/i);
    if (barcodeMatch) {
      parsed.push({
        id: `tspl_barcode_${idx++}`,
        type: 'barcode',
        x: Number(barcodeMatch[1]),
        y: Number(barcodeMatch[2]),
        width: 220,
        height: Number(barcodeMatch[4]) || 60,
        barcodeType: barcodeMatch[3],
        barcodeHeight: Number(barcodeMatch[4]) || 60,
        rotation: Number(barcodeMatch[6]) || 0,
        content: barcodeMatch[9] || '{id}',
      });
      return;
    }
    const qrMatch = line.match(/^QRCODE\s+(\d+),(\d+),M,(\d+),A,(\d+),"(.+)"$/i);
    if (qrMatch) {
      const s = Number(qrMatch[3]) || 3;
      parsed.push({
        id: `tspl_qr_${idx++}`,
        type: 'qrcode',
        x: Number(qrMatch[1]),
        y: Number(qrMatch[2]),
        width: s * 20,
        height: s * 20,
        fontScale: s,
        rotation: Number(qrMatch[4]) || 0,
        content: qrMatch[5] || '{id}',
      });
    }
  });

  const existingByIdx = fallback.elements;
  const elements = parsed.map((el, i) => {
    const old = existingByIdx[i];
    if (!old || old.type !== el.type) return el;
    return {
      ...el,
      id: old.id,
      width: el.width || old.width,
      height: el.height || old.height,
    };
  });

  return {
    width,
    height,
    elements: elements.length > 0 ? elements : fallback.elements,
  };
}

const LabelEditorTab: React.FC<{ store: StoreType }> = ({ store }) => {
  const settings = store.settings;

  const getInitialTemplate = (): LabelTemplate => {
    if (settings.labelTemplate) return settings.labelTemplate;
    return {
      ...DEFAULT_LABEL_TEMPLATE,
      width: settings.labelWidth,
      height: settings.labelHeight,
    };
  };

  const [template, setTemplate] = useState<LabelTemplate>(getInitialTemplate);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; ox: number; oy: number; ow: number; oh: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(2);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [labelPreviewScenario, setLabelPreviewScenario] = useState<LabelPreviewScenario>('printer_flashed');
  const previewLabelData = useMemo(
    () => makePreviewLabelData(labelPreviewScenario),
    [labelPreviewScenario],
  );

  const buildEditorTspl = (nextTemplate: LabelTemplate) =>
    buildTSPLLabel(
      nextTemplate,
      settings,
      {
        id: VARIABLE_ID,
        inv: VARIABLE_INV,
        printerModel: VARIABLE_MODEL,
        cartModel: VARIABLE_CART_MODEL,
        fio: '{fio}',
        boss: '{boss}',
        employee: '{employee}',
        department: '{department}',
        printerType: '{printerType}',
        commissionDate: '{commissionDate}',
        balanceCost: '{balanceCost}',
        consumableType: '{consumableType}',
        status: '{status}',
        quantity: '{quantity}',
        location: '{location}',
        description: '{description}',
        vendor: '{vendor}',
      },
      { ignoreCustomTspl: true },
    );

  const generatedTspl = buildEditorTspl(template);
  const savedTsplPreview = settings.labelTsplTemplate
    ? settings.labelTsplTemplate
    : generatedTspl;
  const [editableTspl, setEditableTspl] = useState(savedTsplPreview);

  /**
   * Canvas dimensions are mm-based (label physical size on screen).
   * Element positions are dot-based (TSC 203 DPI: 8 dots/mm).
   * We use two separate scales so the canvas and elements line up correctly.
   */
  const canvasScale = PX_PER_MM * canvasZoom;              // px per mm  → canvas size
  const dotScale   = (PX_PER_MM / DOTS_PER_MM) * canvasZoom; // px per dot → element pos/size

  const canvasW = template.width  * canvasScale;
  const canvasH = template.height * canvasScale;

  const selectedEl = template.elements.find(e => e.id === selectedId) ?? null;
  const [isTsplEditing, setIsTsplEditing] = useState(false);

  const syncTemplateAndTspl = (updater: (current: LabelTemplate) => LabelTemplate) => {
    setTemplate(current => {
      const next = updater(current);
      setEditableTspl(buildEditorTspl(next));
      setIsTsplEditing(false);
      setSaved(false);
      return next;
    });
  };

  const updateEl = (id: string, patch: Partial<LabelElement>) => {
    syncTemplateAndTspl(t => ({
      ...t,
      elements: t.elements.map(e => e.id === id ? { ...e, ...patch } : e),
    }));
  };

  const addElement = (type: LabelElement['type']) => {
    const id = `el_${Date.now()}`;
    const base: LabelElement = {
      id,
      type,
      x: 10,
      y: 10,
      width: type === 'qrcode' ? 60 : type === 'barcode' ? 200 : 180,
      height: type === 'qrcode' ? 60 : type === 'barcode' ? 60 : 24,
      content: '{id}',
      fontScale: type === 'qrcode' ? 3 : type === 'text' ? 1 : undefined,
      barcodeType: type === 'barcode' ? '128' : undefined,
      barcodeHeight: type === 'barcode' ? 60 : undefined,
      textTag: type === 'text' ? '3' : undefined,
    };
    syncTemplateAndTspl(t => ({ ...t, elements: [...t.elements, base] }));
    setSelectedId(id);
  };

  const deleteEl = (id: string) => {
    syncTemplateAndTspl(t => ({ ...t, elements: t.elements.filter(e => e.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent, elId: string, mode: 'drag' | 'resize') => {
      e.stopPropagation();
      const el = template.elements.find(el => el.id === elId)!;
      if (mode === 'drag') {
        setDragging({ id: elId, ox: e.clientX - el.x * dotScale, oy: e.clientY - el.y * dotScale });
      } else {
        setResizing({ id: elId, ox: e.clientX, oy: e.clientY, ow: el.width, oh: el.height });
      }
      setSelectedId(elId);
    },
    [template.elements, dotScale],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (dragging) {
        const x = Math.max(0, Math.round((e.clientX - dragging.ox) / dotScale));
        const y = Math.max(0, Math.round((e.clientY - dragging.oy) / dotScale));
        updateEl(dragging.id, { x, y });
      }
      if (resizing) {
        const dw = e.clientX - resizing.ox;
        const dh = e.clientY - resizing.oy;
        const w = Math.max(1, Math.round((resizing.ow * dotScale + dw) / dotScale));
        const h = Math.max(1, Math.round((resizing.oh * dotScale + dh) / dotScale));
        updateEl(resizing.id, { width: w, height: h });
      }
    },
    [dragging, resizing, dotScale],
  );

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    setResizing(null);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  useEffect(() => {
    if (!isTsplEditing) {
      setEditableTspl(generatedTspl);
    }
  }, [generatedTspl, isTsplEditing]);

  const handleSave = () => {
    const updated: AppSettings = {
      ...settings,
      labelTemplate: template,
      labelTsplTemplate: editableTspl.trimEnd(),
      labelWidth: template.width,
      labelHeight: template.height,
    };
    store.setSettings(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setTemplate({ ...DEFAULT_LABEL_TEMPLATE, width: 43, height: 15 });
    setSelectedId(null);
    setEditableTspl(DEFAULT_LABEL_TSPL_TEMPLATE);
    setIsTsplEditing(true);
  };

  const renderElPreview = (el: LabelElement) => {
    const content = resolveContent(el.content, previewLabelData);
    const style: React.CSSProperties = {
      position: 'absolute',
      left:   el.x      * dotScale,
      top:    el.y      * dotScale,
      width:  el.width  * dotScale,
      height: el.height * dotScale,
      cursor: 'move',
      userSelect: 'none',
      border: selectedId === el.id ? '2px solid #3b82f6' : '1px dashed #cbd5e1',
      boxSizing: 'border-box',
      overflow: 'hidden',
      backgroundColor: 'rgba(255,255,255,0.9)',
    };

    return (
      <div
        key={el.id}
        style={style}
        onMouseDown={e => handleCanvasMouseDown(e, el.id, 'drag')}
      >
        {el.type === 'text' && (
          <div
            style={{
              fontSize: Math.max(8, (el.fontScale ?? 1) * 7),
              fontFamily: 'monospace',
              fontWeight: 'bold',
              lineHeight: 1.2,
              padding: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {content}
          </div>
        )}
        {el.type === 'barcode' && (
          <div style={{ transform: `scale(${Math.min(1, (el.width * dotScale) / 180)})`, transformOrigin: '0 0' }}>
            <Barcode
              value={content || 'CODE'}
              width={1.2}
              height={el.barcodeHeight ?? 40}
              fontSize={0}
              margin={0}
              displayValue={false}
            />
          </div>
        )}
        {el.type === 'qrcode' && (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#000',
              color: '#fff',
              fontSize: 9,
              fontFamily: 'monospace',
            }}
          >
            QR
          </div>
        )}
        {selectedId === el.id && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 10,
              height: 10,
              backgroundColor: '#3b82f6',
              cursor: 'se-resize',
            }}
            onMouseDown={e => { e.stopPropagation(); handleCanvasMouseDown(e, el.id, 'resize'); }}
          />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 h-full min-h-0 flex flex-col">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
          <AlignLeft size={22} className="text-blue-600" />
          <span>Редактор этикетки</span>
        </h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleSave}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
              saved ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <Save size={14} />
            <span>{saved ? 'Сохранено!' : 'Сохранить'}</span>
          </button>
          <button
            onClick={handleReset}
            className="flex items-center space-x-2 px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            <RotateCcw size={14} />
            <span>Сброс</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 flex-1 min-h-0">
        {/* Left: controls */}
        <div className="space-y-4 min-h-0">
          {/* Canvas size */}
          <div className="bg-white rounded-xl border p-4 space-y-3">
            <h3 className="font-bold text-gray-700 text-sm">Размер наклейки (мм)</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Ширина</label>
                <input
                  type="number"
                  value={template.width}
                  onChange={e => syncTemplateAndTspl(t => ({ ...t, width: +e.target.value || 45 }))}
                  className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Высота</label>
                <input
                  type="number"
                  value={template.height}
                  onChange={e => syncTemplateAndTspl(t => ({ ...t, height: +e.target.value || 25 }))}
                  className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
          </div>

          {/* Add elements */}
          <div className="bg-white rounded-xl border p-4 space-y-2">
            <h3 className="font-bold text-gray-700 text-sm">Добавить элемент</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => addElement('text')} className="flex items-center space-x-1 px-3 py-1.5 bg-gray-100 rounded text-xs font-bold hover:bg-gray-200">
                <Plus size={12} /><span>Текст</span>
              </button>
              <button onClick={() => addElement('barcode')} className="flex items-center space-x-1 px-3 py-1.5 bg-gray-100 rounded text-xs font-bold hover:bg-gray-200">
                <Plus size={12} /><span>Штрих-код</span>
              </button>
              <button onClick={() => addElement('qrcode')} className="flex items-center space-x-1 px-3 py-1.5 bg-gray-100 rounded text-xs font-bold hover:bg-gray-200">
                <Plus size={12} /><span>QR-код</span>
              </button>
            </div>
          </div>

          {/* Element properties */}
          {selectedEl && (
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-gray-700 text-sm">Свойства элемента</h3>
                <button onClick={() => deleteEl(selectedEl.id)} className="text-red-400 hover:text-red-600">
                  <Trash2 size={15} />
                </button>
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Содержимое / Переменная</label>
                <input
                  className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                  value={selectedEl.content}
                  onChange={e => updateEl(selectedEl.id, { content: e.target.value })}
                />
                <div className="flex flex-wrap gap-1 mt-1">
                  {VARIABLE_TAGS.map(({ tag, label }) => (
                    <button
                      key={tag}
                      onClick={() => updateEl(selectedEl.id, { content: tag })}
                      className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 font-mono"
                      title={label}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-gray-400 block mb-0.5">X (dots)</label>
                  <input type="number" className="w-full p-1.5 border rounded focus:ring-1 focus:ring-blue-500 outline-none"
                    value={selectedEl.x}
                    onChange={e => updateEl(selectedEl.id, { x: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="text-gray-400 block mb-0.5">Y (dots)</label>
                  <input type="number" className="w-full p-1.5 border rounded focus:ring-1 focus:ring-blue-500 outline-none"
                    value={selectedEl.y}
                    onChange={e => updateEl(selectedEl.id, { y: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="text-gray-400 block mb-0.5">Ширина (dots)</label>
                  <input type="number" className="w-full p-1.5 border rounded focus:ring-1 focus:ring-blue-500 outline-none"
                    value={selectedEl.width}
                    onChange={e => updateEl(selectedEl.id, { width: Number(e.target.value) || 1 })} />
                </div>
                <div>
                  <label className="text-gray-400 block mb-0.5">Высота (dots)</label>
                  <input type="number" className="w-full p-1.5 border rounded focus:ring-1 focus:ring-blue-500 outline-none"
                    value={selectedEl.height}
                    onChange={e => updateEl(selectedEl.id, { height: Number(e.target.value) || 1 })} />
                </div>
              </div>

              {selectedEl.type === 'text' && (
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Шрифт (TSPL)</label>
                    <select
                      className="w-full p-1.5 border rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                      value={selectedEl.textTag ?? '3'}
                      onChange={e => updateEl(selectedEl.id, { textTag: e.target.value })}
                    >
                      {FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Масштаб (1–4)</label>
                    <div className="flex items-center space-x-2">
                      <button onClick={() => updateEl(selectedEl.id, { fontScale: Math.max(1, (selectedEl.fontScale ?? 1) - 1) })} className="p-1 border rounded hover:bg-gray-50"><ZoomOut size={13} /></button>
                      <span className="text-sm font-bold w-6 text-center">{selectedEl.fontScale ?? 1}</span>
                      <button onClick={() => updateEl(selectedEl.id, { fontScale: Math.min(8, (selectedEl.fontScale ?? 1) + 1) })} className="p-1 border rounded hover:bg-gray-50"><ZoomIn size={13} /></button>
                    </div>
                  </div>
                </div>
              )}

              {selectedEl.type === 'qrcode' && (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Размер модуля QR (1–10)</label>
                  <div className="flex items-center space-x-2">
                    <button onClick={() => updateEl(selectedEl.id, { fontScale: Math.max(1, (selectedEl.fontScale ?? 3) - 1) })} className="p-1 border rounded hover:bg-gray-50"><ZoomOut size={13} /></button>
                    <span className="text-sm font-bold w-6 text-center">{selectedEl.fontScale ?? 3}</span>
                    <button onClick={() => updateEl(selectedEl.id, { fontScale: Math.min(10, (selectedEl.fontScale ?? 3) + 1) })} className="p-1 border rounded hover:bg-gray-50"><ZoomIn size={13} /></button>
                  </div>
                </div>
              )}

              {selectedEl.type === 'barcode' && (
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Тип штрих-кода</label>
                    <select
                      className="w-full p-1.5 border rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                      value={selectedEl.barcodeType ?? '128'}
                      onChange={e => updateEl(selectedEl.id, { barcodeType: e.target.value })}
                    >
                      {['128', '39', 'EAN13', 'EAN8', 'UPC-A', 'CODE93', 'CODABAR', 'ITF14'].map(bt => (
                        <option key={bt} value={bt}>{bt}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Высота штрих-кода (dots)</label>
                    <input type="number" className="w-full p-1.5 border rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                      value={selectedEl.barcodeHeight ?? 60}
                      onChange={e => updateEl(selectedEl.id, { barcodeHeight: +e.target.value || 1 })} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Rotation */}
          <div className="bg-white rounded-xl border p-4 space-y-2">
            <h3 className="font-bold text-gray-700 text-sm">Поворот печати</h3>
            <div className="flex gap-2">
              {([0, 1, 2, 3] as const).map(r => (
                <button
                  key={r}
                  onClick={() => store.setSettings({ ...settings, labelRotation: r })}
                  className={`flex-1 py-1.5 text-xs font-bold rounded border transition-colors ${
                    (settings.labelRotation ?? 0) === r
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {r * 90}°
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border p-4">
            <h3 className="font-bold text-gray-700 text-sm mb-2">Список элементов</h3>
            <div className="space-y-1 max-h-56 overflow-auto">
              {template.elements.map(el => (
                <div
                  key={el.id}
                  onClick={() => setSelectedId(el.id)}
                  className={`flex items-center justify-between p-2 rounded cursor-pointer text-xs transition-colors ${
                    selectedId === el.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <span className={`px-1.5 py-0.5 rounded font-bold ${
                      el.type === 'text' ? 'bg-gray-100 text-gray-700' :
                      el.type === 'barcode' ? 'bg-blue-100 text-blue-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {el.type === 'text' ? 'ТЕКСТ' : el.type === 'barcode' ? 'БАРКОД' : 'QR'}
                    </span>
                    <span className="font-mono text-gray-600">{el.content}</span>
                  </div>
                  <button onClick={e => { e.stopPropagation(); deleteEl(el.id); }} className="text-red-300 hover:text-red-500">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 space-y-1">
            <p className="font-bold flex items-center space-x-1"><Info size={12} /><span>Координаты в dots (точках)</span></p>
            <p>TSC TTP-225: 203 DPI → 1 мм ≈ 8 dots. Этикетка {template.width}×{template.height} мм = {template.width * DOTS_PER_MM}×{template.height * DOTS_PER_MM} dots.</p>
            <p>Верхняя часть этикетки имеет техническую непечатаемую зону. Для надёжной печати начинайте элементы примерно с Y=8..12 dots.</p>
          </div>
        </div>

        {/* Center: canvas */}
        <div className="xl:col-span-2 space-y-4 min-h-0 flex flex-col">
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-gray-400 uppercase font-bold">
                Предпросмотр ({template.width}×{template.height} мм)
              </div>
              <div className="flex items-center space-x-2">
                <div className="flex items-center space-x-1 text-xs text-gray-500 mr-2">
                  <Info size={12} />
                  <span>Синий уголок — изменение размера.</span>
                </div>
                <div className="flex items-center space-x-1 border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setCanvasZoom(z => Math.max(0.5, +(z - 0.5).toFixed(1)))}
                    className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 font-bold"
                  >−</button>
                  <span className="px-2 text-xs font-semibold text-gray-700 min-w-[3rem] text-center">{(canvasZoom * 100).toFixed(0)}%</span>
                  <button
                    onClick={() => setCanvasZoom(z => Math.min(5, +(z + 0.5).toFixed(1)))}
                    className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 font-bold"
                  >+</button>
                </div>
              </div>
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <span className="font-medium shrink-0">Превью {'{fw}'}:</span>
              <select
                value={labelPreviewScenario}
                onChange={e => setLabelPreviewScenario(e.target.value as LabelPreviewScenario)}
                className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white max-w-full"
              >
                <option value="printer_flashed">Принтер, отмечен «прошит»</option>
                <option value="printer_plain">Принтер, без отметки</option>
                <option value="cartridge">Этикетка картриджа (пусто)</option>
              </select>
            </div>

            <div className="overflow-auto rounded border border-gray-200 bg-gray-50 p-2">
              <div
                ref={canvasRef}
                className="relative border-2 border-gray-300 bg-white overflow-hidden"
                style={{ width: canvasW, height: canvasH, flexShrink: 0 }}
                onClick={e => { if (e.target === canvasRef.current) setSelectedId(null); }}
              >
                <div
                  className="absolute left-0 top-0 w-full bg-red-100/60 border-b border-red-200 pointer-events-none"
                  style={{ height: 8 * dotScale }}
                  title="Непечатаемая верхняя зона"
                />
                {template.elements.map(renderElPreview)}
              </div>
            </div>

            <div className="mt-2 text-xs text-gray-400">
              Элементов: {template.elements.length}
              {selectedEl && ` · Выбран: ${selectedEl.type} (${selectedEl.x}dot, ${selectedEl.y}dot) ${selectedEl.width}×${selectedEl.height}dots`}
            </div>
          </div>

          {/* TSPL Preview */}
          <div className="bg-gray-900 rounded-xl p-4 font-mono text-xs text-green-400 overflow-x-auto space-y-2 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between gap-2">
              <div className="text-gray-500 uppercase text-xs">Генерируемый TSPL (тестовые данные)</div>
              <div className="flex items-center gap-2">
                {saved && (
                  <span className="text-green-400 text-[11px] font-sans">
                    Сохранено
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setEditableTspl(DEFAULT_LABEL_TSPL_TEMPLATE);
                    setTemplate(current => parseTsplToTemplate(DEFAULT_LABEL_TSPL_TEMPLATE, current));
                    setIsTsplEditing(true);
                    setSaved(false);
                  }}
                  className="flex items-center space-x-1 px-2 py-1 bg-gray-800 text-gray-300 rounded text-xs hover:bg-gray-700"
                >
                  <RotateCcw size={11} />
                  <span>Восстановить дефолт</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(editableTspl).catch(() => {})}
                  className="flex items-center space-x-1 px-2 py-1 bg-gray-800 text-gray-300 rounded text-xs hover:bg-gray-700"
                >
                  <Copy size={11} />
                  <span>Копировать</span>
                </button>
              </div>
            </div>
            <textarea
              value={editableTspl}
              onChange={e => {
                const next = e.target.value;
                setEditableTspl(next);
                setIsTsplEditing(true);
                setTemplate(current => parseTsplToTemplate(next, current));
                setSaved(false);
              }}
              spellCheck={false}
              className="w-full h-full min-h-56 p-3 bg-gray-950 border border-gray-700 rounded-lg text-green-400 font-mono text-xs leading-relaxed outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <p className="text-gray-500 text-[11px] font-sans">
              Это единственный шаблон этикетки. Что сохранено здесь, то отправляется на печать. Для переменных используйте {`{id}`}, {`{inv}`}, {`{model}`}, {`{cartModel}`}, {`{date}`}, {`{fw}`}/{`{firmware}`} (только для этикетки принтера — «Прошит» если отмечено в карточке; на этикетке картриджа всегда пусто).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LabelEditorTab;
