import Pagination, { usePage } from './Pagination';
import { groupBy } from '../utils/indexes';
import { ask, notify } from '../utils/dialogs';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Plus, Printer as PrinterIcon, User, Search, Edit2, X,
  Users, Trash2, RefreshCw,
  Barcode as BarcodeIcon,
  ArrowUpDown, ChevronUp, ChevronDown,
} from 'lucide-react';
import {
  Printer, Cartridge, STATUS_LABELS, STATUS_COLORS, ConsumableType,
  EmployeeRecord, ConsumableColor,
} from '../types';
import { StoreType } from '../store';
import { buildTSPLLabel, getTemplate } from '../utils/tspl';

const EMPTY_PRINTER: Omit<Printer, 'inventoryNumber' | 'programId'> = {
  model: '',
  printerType: 'printer',
  department: '',
  boss: '',
  cartridgeModels: [],
  commissionDate: '',
  balanceCost: '',
};

function PrinterTypeBadge({ type }: { type: string }) {
  if (type === 'mfu') return (
    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">МФУ</span>
  );
  if (type === 'printer') return (
    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">Принтер</span>
  );
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-teal-100 text-teal-700">{type}</span>
  );
}

interface AddCartridgeState {
  printerInv: string;
  consumableType: ConsumableType;
  model: string;
  color?: ConsumableColor;
  printAfter: boolean;
}

const CONSUMABLE_COLORS: Array<{ id: ConsumableColor; label: string; short: string; className: string }> = [
  { id: 'black', label: 'Чёрный', short: 'Ч', className: 'bg-black text-white border-black' },
  { id: 'cyan', label: 'Голубой', short: 'Г', className: 'bg-cyan-500 text-white border-cyan-500' },
  { id: 'magenta', label: 'Пурпурный', short: 'П', className: 'bg-fuchsia-500 text-white border-fuchsia-500' },
  { id: 'yellow', label: 'Жёлтый', short: 'Ж', className: 'bg-yellow-300 text-yellow-900 border-yellow-300' },
];

type PrinterSortKey = 'programId' | 'inventoryNumber' | 'printerType' | 'model' | 'department' | 'boss' | 'employees' | 'consumables';
type PrinterSort = { key: PrinterSortKey | null; direction: 'asc' | 'desc' };
const PRINTER_SORT_STORAGE = 'printer_table_sort';
const printerCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

function initialPrinterSort(): PrinterSort {
  try {
    const saved = JSON.parse(localStorage.getItem(PRINTER_SORT_STORAGE) ?? 'null') as PrinterSort | null;
    const keys: PrinterSortKey[] = ['programId', 'inventoryNumber', 'printerType', 'model', 'department', 'boss', 'employees', 'consumables'];
    if (saved && (saved.key === null || keys.includes(saved.key)) && (saved.direction === 'asc' || saved.direction === 'desc')) return saved;
  } catch { /* keep the unsorted database order */ }
  return { key: null, direction: 'asc' };
}

function ColorDot({ color }: { color?: ConsumableColor }) {
  const cfg = CONSUMABLE_COLORS.find(c => c.id === color);
  if (!cfg) return null;
  return <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-bold ${cfg.className}`}>{cfg.short}</span>;
}

function getConsumableLabel(cartridge: Cartridge, all: Cartridge[]): string {
  const sameType = all.filter(c => c.consumableType === cartridge.consumableType);
  const index = sameType.findIndex(c => c.id === cartridge.id) + 1;
  const base = cartridge.consumableType === 'drum' ? 'Драм' : 'Картридж';
  return `${base} ${Math.max(index, 1)}`;
}

const PrintersTab: React.FC<{ store: StoreType }> = ({ store }) => {
  const [showAddPrinter, setShowAddPrinter] = useState(false);
  const [editPrinter, setEditPrinter] = useState<Printer | null>(null);
  const [newPrinter, setNewPrinter] = useState<Printer>({ inventoryNumber: '', programId: '', ...EMPTY_PRINTER });
  const [cartridgeModelsText, setCartridgeModelsText] = useState('');
  const [customTypeInput, setCustomTypeInput] = useState('');
  const [showCustomType, setShowCustomType] = useState(false);

  const [addCart, setAddCart] = useState<AddCartridgeState | null>(null);
  const pinCode = '000';

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [sort, setSort] = useState<PrinterSort>(initialPrinterSort);
  const [detailsPrinter, setDetailsPrinter] = useState<Printer | null>(null);

  useEffect(() => {
    const onScan = (event: Event) => {
      setSearch((event as CustomEvent<string>).detail);
    };
    window.addEventListener('app-scanner-input', onScan as EventListener);
    return () => window.removeEventListener('app-scanner-input', onScan as EventListener);
  }, []);

  useEffect(() => { localStorage.setItem(PRINTER_SORT_STORAGE, JSON.stringify(sort)); }, [sort]);

  const [showEmployeeModal, setShowEmployeeModal] = useState<string | null>(null);
  const [newEmployee, setNewEmployee] = useState('');

  const [editCartridgeId, setEditCartridgeId] = useState<string | null>(null);
  const [editCartridgeModel, setEditCartridgeModel] = useState('');
  const [editCartridgeColor, setEditCartridgeColor] = useState<ConsumableColor | ''>('');
  const [editPin, setEditPin] = useState('');
  const [cartPrintStatus, setCartPrintStatus] = useState<string | null>(null);

  const [printStatus, setPrintStatus] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  // Gather unique custom types for filter
  const customTypes = useMemo(() => {
    const types = new Set<string>();
    store.printers.forEach(p => {
      if (p.printerType !== 'printer' && p.printerType !== 'mfu') {
        types.add(p.printerType);
      }
    });
    return Array.from(types);
  }, [store.printers]);

  const employeesByPrinter = useMemo(() => groupBy(store.employees, e => e.printerInventoryNumber), [store.employees]);
  const cartridgesByPrinter = useMemo(() => groupBy(store.cartridges, c => c.printerInventoryNumber), [store.cartridges]);
  const filteredPrinters = useMemo(() => {
    const q = search.toLowerCase();
    const result = store.printers.filter(p => {
      const printerCartridges = cartridgesByPrinter.get(p.inventoryNumber) ?? [];
      const matchSearch =
        p.inventoryNumber.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q) ||
        p.boss.toLowerCase().includes(q) ||
        (employeesByPrinter.get(p.inventoryNumber) ?? [])
          .some(e => e.name.toLowerCase().includes(q)) ||
        printerCartridges.some(cartridge => cartridge.id.toLowerCase().includes(q) || cartridge.barcode.toLowerCase().includes(q)) ||
        (p.programId ?? '').toLowerCase().includes(q);
      const matchType = filterType === 'all' || p.printerType === filterType;
      return matchSearch && matchType;
    });
    if (!sort.key) return result;
    const value = (printer: Printer) => {
      if (sort.key === 'employees') return (employeesByPrinter.get(printer.inventoryNumber) ?? []).map(employee => employee.name).join(', ');
      if (sort.key === 'consumables') {
        const items = cartridgesByPrinter.get(printer.inventoryNumber) ?? [];
        return `${String(items.length).padStart(6, '0')} ${items.map(cartridge => cartridge.id).join(', ')}`;
      }
      return String(printer[sort.key as keyof Printer] ?? '');
    };
    return [...result].sort((a, b) => printerCollator.compare(value(a), value(b)) * (sort.direction === 'asc' ? 1 : -1));
  }, [store.printers, employeesByPrinter, cartridgesByPrinter, search, filterType, sort]);

  const toggleSort = (key: PrinterSortKey) => setSort(current => current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: 'asc' });

  const SortableHeader = ({ column, children, right = false }: { column: PrinterSortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`px-4 py-3 font-semibold ${right ? 'text-right' : ''}`} aria-sort={sort.key === column ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => toggleSort(column)} className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-blue-700 ${right ? 'ml-auto' : ''}`} title="Нажмите для сортировки">
        <span>{children}</span>{sort.key !== column ? <ArrowUpDown size={11} className="text-gray-300" /> : sort.direction === 'asc' ? <ChevronUp size={12} className="text-blue-600" /> : <ChevronDown size={12} className="text-blue-600" />}
      </button>
    </th>
  );

  const printerPage = usePage(filteredPrinters);

  const getCartridges = (invNum: string) =>
    (cartridgesByPrinter.get(invNum) ?? []);


  const openAdd = () => {
    setEditPrinter(null);
    setNewPrinter({ inventoryNumber: '', programId: '', ...EMPTY_PRINTER });
    setCartridgeModelsText('');
    setShowCustomType(false);
    setCustomTypeInput('');
    setShowAddPrinter(true);
  };

  const openEdit = (p: Printer) => {
    setEditPrinter(p);
    setNewPrinter({ ...p });
    setCartridgeModelsText(p.cartridgeModels.join(', '));
    const isCustom = p.printerType !== 'printer' && p.printerType !== 'mfu';
    setShowCustomType(isCustom);
    setCustomTypeInput(isCustom ? p.printerType : '');
    setShowAddPrinter(true);
  };

  const handleSavePrinter = (e: React.FormEvent) => {
    e.preventDefault();
    const enteredModels = cartridgeModelsText
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const isNew = !editPrinter;
    const catalogEntry = store.modelCatalog.find(entry => entry.printerModel.trim().toLocaleLowerCase('ru') === newPrinter.model.trim().toLocaleLowerCase('ru'));
    const models = isNew && enteredModels.length === 0 ? (catalogEntry?.cartridgeModels ?? []) : enteredModels;
    const finalType = showCustomType && customTypeInput.trim()
      ? customTypeInput.trim()
      : newPrinter.printerType;
    const printer: Printer = {
      ...newPrinter,
      printerType: finalType,
      cartridgeModels: models,
      drumModels: catalogEntry?.drumModels ?? newPrinter.drumModels ?? [],
      programId: newPrinter.programId || store.generatePrinterId(),
      isDecommissioned: Boolean(newPrinter.isDecommissioned),
      decommissionedAt: newPrinter.isDecommissioned ? (newPrinter.decommissionedAt || new Date().toISOString()) : undefined,
      firmwareFlashed: editPrinter?.firmwareFlashed ? true : Boolean(newPrinter.firmwareFlashed),
    };
    store.addPrinter(printer);

    if (isNew) {
      const cartModel = models[0] ?? '';
      const id = store.generateConsumableId('cartridge');
      const cartridge: Cartridge = {
        id,
        barcode: id,
        model: cartModel,
        consumableType: 'cartridge',
        printerInventoryNumber: printer.inventoryNumber,
        status: 'on_hand',
        refillCount: 0,
        registrationDate: new Date().toISOString(),
        history: [{
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          action: 'Зарегистрирован (Картридж). Выдан пользователю.',
        }],
      };
      store.addCartridge(cartridge);
    }

    setShowAddPrinter(false);
    setEditPrinter(null);
  };

  const handleDeletePrinter = async () => {
    if (!editPrinter) return;
    if (await ask(`Удалить принтер ${editPrinter.inventoryNumber}? Это действие нельзя отменить.`)) {
      store.removePrinter(editPrinter.inventoryNumber);
      setShowAddPrinter(false);
      setEditPrinter(null);
    }
  };

  const openAddCart = (invNum: string) => {
    const existing = getCartridges(invNum);
    const printer = store.printers.find(p => p.inventoryNumber === invNum);
    const defaultModel = printer?.cartridgeModels[0] ?? '';
    setAddCart({
      printerInv: invNum,
      consumableType: 'cartridge',
      model: existing.length === 0 ? defaultModel : (printer?.cartridgeModels[existing.length] ?? defaultModel),
      color: undefined,
      printAfter: store.settings.autoPrintOnRegister,
    });
  };

  const handleAddCartridge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addCart) return;
    const id = store.generateConsumableId(addCart.consumableType);
    const cartridge: Cartridge = {
      id,
      barcode: id,
      model: addCart.model,
      consumableType: addCart.consumableType,
      color: addCart.color,
      printerInventoryNumber: addCart.printerInv,
      status: 'on_hand',
      refillCount: 0,
      registrationDate: new Date().toISOString(),
      history: [{
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        action: `Зарегистрирован (${addCart.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж'}). Выдан пользователю.`,
      }],
    };
    store.addCartridge(cartridge);

    if (addCart.printAfter && store.settings.labelPrinterName && window.desktopAPI) {
      const template = getTemplate(store.settings);
      const printer = store.printers.find(p => p.inventoryNumber === addCart.printerInv);
      const tspl = buildTSPLLabel(template, store.settings, {
        id,
        inv: addCart.printerInv,
        cartModel: addCart.model,
        printerModel: printer?.model ?? '',
        fio: printer?.boss ?? '',
        boss: printer?.boss ?? '',
        department: printer?.department ?? '',
        printerType: printer?.printerType ?? '',
        commissionDate: printer?.commissionDate ?? '',
        balanceCost: printer?.balanceCost ?? '',
        consumableType: addCart.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
        status: STATUS_LABELS.on_hand,
      });
      await window.desktopAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode);
    }

    setAddCart(null);
  };

  const handleEditCartridge = (e: React.FormEvent) => {
    e.preventDefault();
    if (editPin !== pinCode) {
      void notify('Неверный PIN-код');
      return;
    }
    if (!editCartridgeId) return;
    store.updateCartridge(editCartridgeId, { model: editCartridgeModel, color: editCartridgeColor || undefined });
    setEditCartridgeId(null);
    setEditPin('');
    setEditCartridgeColor('');
    setCartPrintStatus(null);
  };

  const handleDeleteCartridge = async () => {
    if (!editCartridgeId) return;
    if (await ask(`Удалить расходник ${editCartridgeId}? Это действие нельзя отменить.`)) {
      store.removeCartridge(editCartridgeId);
      setEditCartridgeId(null);
      setEditPin('');
      setCartPrintStatus(null);
    }
  };

  const handleReplaceCartridge = () => {
    if (!editCartridgeId) return;
    const cart = store.cartridges.find(c => c.id === editCartridgeId);
    if (!cart) return;
    const newId = store.generateConsumableId(cart.consumableType ?? 'cartridge');
    const newCart: Cartridge = {
      ...cart,
      id: newId,
      barcode: newId,
      status: 'on_hand',
      isReplaced: false,
      replacedById: undefined,
      refillCount: 0,
      registrationDate: new Date().toISOString(),
      history: [{
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        action: `Замена. Предыдущий: ${editCartridgeId}`,
      }],
    };
    store.replaceCartridge(editCartridgeId, newCart);
    setEditCartridgeId(newId);
    setEditCartridgeModel(newCart.model);
    setCartPrintStatus(`Создан новый: ${newId}`);
  };

  const handlePrintCartridge = async (cartId?: string) => {
    const id = cartId ?? editCartridgeId;
    if (!id) return;
    const cart = store.cartridges.find(c => c.id === id);
    if (!cart) return;
    if (!store.settings.labelPrinterName) {
      if (cartId) setPrintStatus({ id: cartId, text: 'Принтер не выбран', ok: false });
      else setCartPrintStatus('Принтер не выбран в Настройках');
      return;
    }
    if (!window.desktopAPI) {
      if (cartId) setPrintStatus({ id: cartId, text: 'Только в desktop-версии', ok: false });
      else setCartPrintStatus('Только в desktop-версии');
      return;
    }
    const template = getTemplate(store.settings);
    const printer = store.printers.find(p => p.inventoryNumber === cart.printerInventoryNumber);
    const tspl = buildTSPLLabel(template, store.settings, {
      id: cart.id,
      inv: cart.printerInventoryNumber,
      cartModel: cart.model,
      printerModel: printer?.model ?? '',
      fio: printer?.boss ?? '',
      boss: printer?.boss ?? '',
      department: printer?.department ?? '',
      printerType: printer?.printerType ?? '',
      commissionDate: printer?.commissionDate ?? '',
      balanceCost: printer?.balanceCost ?? '',
      consumableType: cart.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
      status: STATUS_LABELS[cart.status],
    });
    const res = await window.desktopAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode);
    store.recordAction({
      category: 'cartridge', entityId: cart.id, cartridgeId: cart.id, cartridgeModel: cart.model,
      consumableType: cart.consumableType, printerInventoryNumber: cart.printerInventoryNumber,
      action: res.success ? 'Напечатана этикетка расходника' : 'Ошибка печати этикетки расходника', details: res.error,
    });
    if (cartId) {
      setPrintStatus({ id: cartId, text: res.success ? 'Отправлено!' : (res.error ?? 'Ошибка'), ok: res.success });
      setTimeout(() => setPrintStatus(null), 3000);
    } else {
      setCartPrintStatus(res.success ? 'Этикетка отправлена!' : (res.error ?? 'Ошибка печати'));
    }
  };

  const handlePrintPrinter = async (printer: Printer) => {
    if (!store.settings.labelPrinterName) {
      setPrintStatus({ id: printer.inventoryNumber, text: 'Принтер этикеток не выбран', ok: false });
      return;
    }
    if (!window.desktopAPI) {
      setPrintStatus({ id: printer.inventoryNumber, text: 'Только в desktop-версии', ok: false });
      return;
    }
    const template = getTemplate(store.settings);
    const barcodeId = printer.programId ?? printer.inventoryNumber;
    const tspl = buildTSPLLabel(template, store.settings, {
      id: barcodeId,
      inv: printer.inventoryNumber,
      printerModel: printer.model,
      fio: printer.boss,
      boss: printer.boss,
      department: printer.department,
      printerType: printer.printerType,
      commissionDate: printer.commissionDate,
      balanceCost: printer.balanceCost,
      firmwareFlashed: Boolean(printer.firmwareFlashed),
    });
    const res = await window.desktopAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode);
    store.recordAction({
      category: 'printer', entityId: printer.programId ?? printer.inventoryNumber,
      printerInventoryNumber: printer.inventoryNumber, printerModel: printer.model,
      action: res.success ? 'Напечатана этикетка принтера' : 'Ошибка печати этикетки принтера', details: res.error,
    });
    setPrintStatus({
      id: printer.inventoryNumber,
      text: res.success ? 'Этикетка принтера отправлена!' : (res.error ?? 'Ошибка'),
      ok: res.success,
    });
    setTimeout(() => setPrintStatus(null), 3000);
  };

  const handleAddEmployee = () => {
    if (!newEmployee.trim() || !showEmployeeModal) return;
    const record: EmployeeRecord = {
      id: Math.random().toString(36).substr(2, 9),
      name: newEmployee.trim(),
      printerInventoryNumber: showEmployeeModal,
      addedDate: new Date().toISOString(),
    };
    store.addEmployee(record);
    setNewEmployee('');
  };

  const openDetailsFromRow = (event: React.MouseEvent, printer: Printer) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a')) return;
    if (window.getSelection()?.toString()) return;
    setDetailsPrinter(printer);
  };

  const PrintersList = () => (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500">
            <tr>
              <SortableHeader column="programId">ID</SortableHeader>
              <SortableHeader column="inventoryNumber">Инв. №</SortableHeader>
              <SortableHeader column="printerType">Тип</SortableHeader>
              <SortableHeader column="model">Модель</SortableHeader>
              <SortableHeader column="department">Подразделение</SortableHeader>
              <SortableHeader column="boss">Мат. отв.</SortableHeader>
              <SortableHeader column="employees">Сотрудники</SortableHeader>
              <SortableHeader column="consumables">Расходники</SortableHeader>
              <th className="px-4 py-3 font-semibold text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {printerPage.visible.map(p => {
              const carts = getCartridges(p.inventoryNumber);
              const printerEmployees = (employeesByPrinter.get(p.inventoryNumber) ?? []);
              return (
                <tr
                  key={p.inventoryNumber}
                  onClick={event => openDetailsFromRow(event, p)}
                  className={`cursor-pointer ${p.isDecommissioned ? 'bg-amber-50/60 text-gray-500 hover:bg-amber-50' : 'hover:bg-blue-50/50'}`}
                  title="Открыть карточку устройства"
                >
                  <td className="px-4 py-3">
                    {p.programId ? (
                      <button
                        onClick={() => handlePrintPrinter(p)}
                        className="font-mono text-xs text-blue-700 font-bold hover:underline"
                        title="Напечатать типовую наклейку принтера"
                      >
                        {p.programId}
                      </button>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono font-bold">{p.inventoryNumber}{p.isDecommissioned && <span className="ml-2 inline-flex rounded bg-amber-100 px-1.5 py-0.5 font-sans text-[9px] font-bold uppercase tracking-wide text-amber-800">Списан</span>}</td>
                  <td className="px-4 py-3"><PrinterTypeBadge type={p.printerType} /></td>
                  <td className="px-4 py-3 font-semibold"><span className="inline-flex min-w-0 items-center gap-1.5"><span className="truncate">{p.model}</span>{p.firmwareFlashed && <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500 ring-2 ring-red-200" title="Прошит" aria-label="Прошит" />}</span></td>
                  <td className="px-4 py-3 text-gray-600">{p.department || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{p.boss || '—'}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setShowEmployeeModal(p.inventoryNumber)}
                      className="text-left text-xs text-gray-600 hover:text-blue-600"
                      title="Редактировать сотрудников"
                    >
                      {printerEmployees.length > 0 ? printerEmployees.map(e => e.name).join(', ') : 'Добавить'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {carts.slice(0, 3).map(c => (
                        <button key={c.id} onClick={() => handlePrintCartridge(c.id)}
                          className={`ui-mini-pill px-1.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${STATUS_COLORS[c.status]}`}
                          title="Напечатать этикетку расходника">
                          <ColorDot color={c.color} />
                          {getConsumableLabel(c, carts)}
                        </button>
                      ))}
                      {carts.length > 3 && <span className="text-xs text-gray-400">+{carts.length - 3}</span>}
                      {carts.length === 0 && <span className="text-gray-300 text-xs">нет</span>}
                      <button
                        onClick={() => openAddCart(p.inventoryNumber)}
                        className="ui-mini-pill px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100"
                        title="Добавить расходник"
                      >
                        + Добавить
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(p)}
                        className="ui-table-action px-2 py-1 border rounded text-xs text-gray-600 hover:bg-gray-50">
                        Редактировать
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredPrinters.length === 0 && (
              <tr><td colSpan={9} className="p-8 text-center text-gray-300 italic">Нет принтеров</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input data-scanner="true"
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск принтера, ID..."
              className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div className="flex rounded-lg border overflow-hidden text-xs font-semibold">
            {(['all', 'printer', 'mfu', ...customTypes] as string[]).map(t => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`ui-filter-button px-3 py-2 transition-colors ${
                  filterType === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t === 'all' ? 'Все' : t === 'printer' ? 'Принтеры' : t === 'mfu' ? 'МФУ' : t}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={openAdd}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center space-x-2 hover:bg-blue-700 text-sm font-bold"
        >
          <Plus size={16} />
          <span>Добавить</span>
        </button>
      </div>

      <div className="text-sm text-gray-500">
        Всего: <strong>{store.printers.length}</strong>
        {search && <span> · найдено: <strong>{filteredPrinters.length}</strong></span>}
        {' · '}Принтеров: <strong>{store.printers.filter(p => p.printerType === 'printer').length}</strong>
        {' · '}МФУ: <strong>{store.printers.filter(p => p.printerType === 'mfu').length}</strong>
        {customTypes.length > 0 && <span>{' · '}Прочие: <strong>{store.printers.filter(p => p.printerType !== 'printer' && p.printerType !== 'mfu').length}</strong></span>}
      </div>

      {printStatus && (
        <div className={`px-4 py-2 rounded-xl border text-sm font-semibold ${
          printStatus.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {printStatus.text} <span className="font-mono text-xs opacity-60">({printStatus.id})</span>
        </div>
      )}

      <Pagination {...printerPage} />
      <PrintersList />

      {detailsPrinter && (() => {
        const carts = getCartridges(detailsPrinter.inventoryNumber);
        const employees = store.employees.filter(e => e.printerInventoryNumber === detailsPrinter.inventoryNumber);
        return (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
            onMouseDown={e => {
              if (e.target === e.currentTarget) setDetailsPrinter(null);
            }}
          >
            <div data-testid="printer-details" className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl overflow-hidden" onMouseDown={e => e.stopPropagation()}>
              <div className="bg-gradient-to-r from-blue-600 to-cyan-500 text-white p-5 flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-20 w-24 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center">
                    <PrinterIcon size={44} />
                  </div>
                  <div>
                    <div className="text-xs uppercase opacity-75">Карточка устройства</div>
                    <div className="flex items-center gap-2 text-xl font-bold"><span>{detailsPrinter.model}</span>{detailsPrinter.firmwareFlashed && <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-white ring-2 ring-white/50" title="Прошит" aria-label="Прошит" />}</div>
                    <div className="text-sm opacity-90 font-mono">{detailsPrinter.inventoryNumber}</div>
                    {detailsPrinter.isDecommissioned && <div className="mt-1 w-fit rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">Списан</div>}
                    {detailsPrinter.programId && <div className="text-xs opacity-80 font-mono">ID: {detailsPrinter.programId}</div>}
                  </div>
                </div>
                <button aria-label="Закрыть карточку" onClick={() => setDetailsPrinter(null)} className="text-white/80 hover:text-white"><X size={22} /></button>
              </div>

              <div className="p-5 grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-5">
                <div className="space-y-3">
                  <div className="p-3 bg-gray-50 rounded-xl text-sm space-y-2">
                    <div className="flex justify-between gap-3"><span className="text-gray-500">Тип</span><PrinterTypeBadge type={detailsPrinter.printerType} /></div>
                    <div className="flex justify-between gap-3"><span className="text-gray-500">Подразделение</span><strong className="text-right">{detailsPrinter.department || '—'}</strong></div>
                    <div className="flex justify-between gap-3"><span className="text-gray-500">Мат. отв.</span><strong className="text-right">{detailsPrinter.boss || '—'}</strong></div>
                    <div className="flex justify-between gap-3"><span className="text-gray-500">Дата ввода</span><strong>{detailsPrinter.commissionDate || '—'}</strong></div>
                    <div className="flex justify-between gap-3"><span className="text-gray-500">Стоимость</span><strong>{detailsPrinter.balanceCost || '—'}</strong></div>
                    {detailsPrinter.firmwareFlashed && <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-2"><span className="text-gray-500">Прошивка</span><span className="inline-flex items-center gap-1.5 font-semibold text-red-700"><span className="inline-block h-2 w-2 rounded-full bg-red-500 ring-2 ring-red-200" />Прошит</span></div>}
                    <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-gray-200 pt-2">
                      <span><span className="block text-gray-700">Списан</span><span className="block text-[10px] text-gray-400">Останется в базе и истории</span></span>
                      <input type="checkbox" checked={Boolean(detailsPrinter.isDecommissioned)} onChange={event => {
                        const isDecommissioned = event.target.checked;
                        const updates = { isDecommissioned, decommissionedAt: isDecommissioned ? (detailsPrinter.decommissionedAt || new Date().toISOString()) : undefined };
                        store.updatePrinter(detailsPrinter.inventoryNumber, updates);
                        setDetailsPrinter({ ...detailsPrinter, ...updates });
                      }} className="h-4 w-4 accent-amber-600" />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setDetailsPrinter(null); openEdit(detailsPrinter); }} className="ui-table-action flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50 flex items-center justify-center gap-1">
                      <Edit2 size={14} /> Редактировать
                    </button>
                    <button onClick={() => setShowEmployeeModal(detailsPrinter.inventoryNumber)} className="ui-table-action px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">
                      <Users size={15} />
                    </button>
                  </div>
                </div>

                <div className="min-w-0 space-y-4">
                  <div>
                    <div className="text-xs uppercase text-gray-400 font-bold mb-2">Расходники ({carts.length})</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-72 overflow-y-auto pr-1">
                      {carts.map(c => (
                        <div data-testid="printer-consumable" key={c.id} className="p-2 text-xs border rounded-lg bg-white hover:bg-gray-50">
                          <div className="flex items-center justify-between gap-2">
                            <button onClick={() => handlePrintCartridge(c.id)} className="min-w-0 truncate font-mono text-[11px] font-bold text-blue-700 hover:underline flex items-center gap-1">
                              <ColorDot color={c.color} /> {getConsumableLabel(c, carts)}
                            </button>
                            <span className={`ui-mini-pill shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${STATUS_COLORS[c.status]}`}>{STATUS_LABELS[c.status]}</span>
                          </div>
                          <div className="mt-1 truncate text-[11px] text-gray-700" title={c.model || 'Без модели'}>{c.model || 'Без модели'}</div>
                          <div className="mt-0.5 truncate text-[9px] leading-3 text-gray-400" title={`ID расходника: ${c.id}`}>
                            ID: <span className="font-mono text-gray-500">{c.id}</span>
                          </div>
                          <button className="mt-1 text-[10px] text-blue-700 hover:underline" onClick={() => {
                            setDetailsPrinter(null);
                            setEditCartridgeId(c.id);
                            setEditCartridgeModel(c.model);
                            setEditCartridgeColor(c.color ?? '');
                            setEditPin('');
                            setCartPrintStatus(null);
                          }}>Редактировать расходник</button>
                          <div className="text-[10px] leading-4 text-gray-400">{c.consumableType === 'drum' ? 'Драм' : 'Картридж'} · заправок: {c.refillCount}</div>
                        </div>
                      ))}
                      {carts.length === 0 && <div className="text-gray-300 italic text-sm">Нет расходников</div>}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs uppercase text-gray-400 font-bold mb-2">Сотрудники ({employees.length})</div>
                    <div className="flex flex-wrap gap-1">
                      {employees.map(e => <span key={e.id} className="px-2 py-1 bg-gray-100 rounded-full text-xs">{e.name}</span>)}
                      {employees.length === 0 && <span className="text-gray-300 italic text-sm">Нет сотрудников</span>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add/Edit Printer Modal */}
      {showAddPrinter && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">{editPrinter ? 'Редактировать принтер' : 'Добавить устройство'}</h2>
              <button onClick={() => { setShowAddPrinter(false); setEditPrinter(null); }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSavePrinter} className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Тип устройства *</label>
                <div className="flex space-x-2 flex-wrap gap-2">
                  {(['printer', 'mfu'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setNewPrinter({ ...newPrinter, printerType: t });
                        setShowCustomType(false);
                        setCustomTypeInput('');
                      }}
                      className={`ui-filter-button flex-1 py-2 rounded-lg border text-sm font-bold transition-colors ${
                        !showCustomType && newPrinter.printerType === t
                          ? t === 'mfu' ? 'bg-purple-100 border-purple-400 text-purple-700' : 'bg-blue-100 border-blue-400 text-blue-700'
                          : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {t === 'mfu' ? '🖨 МФУ' : '🖨 Принтер'}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowCustomType(!showCustomType)}
                    className={`py-2 px-3 rounded-lg border text-sm font-bold transition-colors ${
                      showCustomType
                        ? 'bg-teal-100 border-teal-400 text-teal-700'
                        : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                    title="Задать свой тип"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {showCustomType && (
                  <input
                    type="text"
                    placeholder="Свой тип (Плоттер, Сканер...)"
                    value={customTypeInput}
                    onChange={e => setCustomTypeInput(e.target.value)}
                    className="mt-2 w-full p-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500 outline-none"
                  />
                )}
              </div>

              {[
                { label: 'Инвентарный номер *', key: 'inventoryNumber', placeholder: 'КБ01384553 или 1013402202600078', required: true, disabled: !!editPrinter },
                { label: 'Марка / Модель *', key: 'model', placeholder: 'HP LaserJet Pro M404dn', required: true },
                { label: 'Подразделение', key: 'department', placeholder: 'Бухгалтерия' },
                { label: 'ФИО Мат. ответственного', key: 'boss', placeholder: 'Иванов И.И.' },
                { label: 'Дата ввода в эксплуатацию', key: 'commissionDate', placeholder: 'дд.мм.гггг' },
                { label: 'Балансовая стоимость (₽)', key: 'balanceCost', placeholder: '15000' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs text-gray-500 block mb-1">{f.label}</label>
                  <input
                    type="text"
                    required={f.required}
                    disabled={f.disabled}
                    placeholder={f.placeholder}
                    className="w-full p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    value={(newPrinter as unknown as Record<string, string>)[f.key] ?? ''}
                    onChange={e => setNewPrinter({ ...newPrinter, [f.key]: e.target.value } as Printer)}
                  />
                </div>
              ))}

              <div>
                <label className="text-xs text-gray-500 block mb-1">Модели картриджей / расходников (через запятую)</label>
                <input
                  placeholder="CF283A, CF283X, ..."
                  className="w-full p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={cartridgeModelsText}
                  onChange={e => setCartridgeModelsText(e.target.value)}
                />
              </div>

              <label className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 ${editPrinter?.firmwareFlashed ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-500' : 'cursor-pointer border-purple-200 bg-purple-50/60 text-gray-800'}`}>
                <input type="checkbox" checked={Boolean(editPrinter?.firmwareFlashed || newPrinter.firmwareFlashed)} disabled={Boolean(editPrinter?.firmwareFlashed)} onChange={event => setNewPrinter({ ...newPrinter, firmwareFlashed: event.target.checked })} className="mt-0.5 h-4 w-4 rounded accent-purple-600" />
                <span><span className="block text-sm font-semibold">Принтер прошит (прошивка выполнена)</span>{editPrinter?.firmwareFlashed && <span className="mt-0.5 block text-[10px] text-gray-400">Отметка уже зафиксирована и защищена от случайного снятия.</span>}</span>
              </label>

              <label className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2.5 ${newPrinter.isDecommissioned ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50/60'}`}>
                <span><span className="block text-sm font-semibold text-gray-700">Списан</span><span className="block text-[10px] text-gray-400">Устройство останется в базе и будет выделено в списке</span></span>
                <input type="checkbox" checked={Boolean(newPrinter.isDecommissioned)} onChange={event => setNewPrinter({ ...newPrinter, isDecommissioned: event.target.checked, decommissionedAt: event.target.checked ? (newPrinter.decommissionedAt || new Date().toISOString()) : undefined })} className="h-4 w-4 accent-amber-600" />
              </label>

              <div className="flex space-x-2 pt-2">
                <button type="button" onClick={() => { setShowAddPrinter(false); setEditPrinter(null); }}
                  className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">Отмена</button>
                <button type="submit"
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
                  {editPrinter ? 'Сохранить' : 'Добавить'}
                </button>
              </div>

              {editPrinter && (
                <button
                  type="button"
                  onClick={handleDeletePrinter}
                  className="w-full py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm hover:bg-red-100 flex items-center justify-center space-x-1"
                >
                  <Trash2 size={14} />
                  <span>Удалить принтер</span>
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Add Cartridge/Drum Modal */}
      {addCart && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold">Новый расходник</h2>
              <button onClick={() => setAddCart(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Принтер: <strong>{addCart.printerInv}</strong>
            </p>
            <form onSubmit={handleAddCartridge} className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Тип расходника *</label>
                <div className="flex space-x-2">
                  {([
                    { v: 'cartridge', label: '🖨 Картридж' },
                    { v: 'drum', label: '⚙ Драм (фотобарабан)' },
                  ] as { v: ConsumableType; label: string }[]).map(({ v, label }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAddCart({ ...addCart, consumableType: v })}
                      className={`ui-filter-button flex-1 py-2 rounded-lg border text-xs font-bold transition-colors ${
                        addCart.consumableType === v
                          ? 'bg-blue-100 border-blue-400 text-blue-700'
                          : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Модель *</label>
                <input
                  required
                  autoFocus
                  list="cart-models-list"
                  placeholder="CF283A"
                  className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={addCart.model}
                  onChange={e => setAddCart({ ...addCart, model: e.target.value })}
                />
                <datalist id="cart-models-list">
                  {(() => {
                    const printer = store.printers.find(p => p.inventoryNumber === addCart.printerInv);
                    return (printer?.cartridgeModels ?? []).map(m => (
                      <option key={m} value={m} />
                    ));
                  })()}
                </datalist>
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Цвет</label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setAddCart({ ...addCart, color: undefined })}
                    className={`ui-mini-pill px-2 py-1 rounded border text-xs ${!addCart.color ? 'bg-gray-800 text-white' : 'bg-white text-gray-500'}`}
                  >
                    —
                  </button>
                  {CONSUMABLE_COLORS.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setAddCart({ ...addCart, color: c.id })}
                      className={`h-8 w-8 rounded-full border text-xs font-bold ${c.className} ${addCart.color === c.id ? 'ring-2 ring-blue-400 ring-offset-2' : ''}`}
                      title={c.label}
                    >
                      {c.short}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="autoPrint"
                  checked={addCart.printAfter}
                  onChange={e => setAddCart({ ...addCart, printAfter: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="autoPrint" className="text-sm text-gray-600">Напечатать этикетку сразу</label>
              </div>

              <div className="flex space-x-2 pt-1">
                <button type="button" onClick={() => setAddCart(null)}
                  className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">Отмена</button>
                <button type="submit"
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Cartridge Model Modal */}
      {editCartridgeId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold">Редактировать расходник</h2>
              <button onClick={() => { setEditCartridgeId(null); setCartPrintStatus(null); }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-1">ID: <strong className="font-mono">{editCartridgeId}</strong></p>

            {cartPrintStatus && (
              <div className="my-2 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold border border-blue-200">
                {cartPrintStatus}
              </div>
            )}

            <form onSubmit={handleEditCartridge} className="space-y-3 mt-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">PIN-код (000)</label>
                <input
                  type="text"
                  maxLength={3}
                  placeholder="000"
                  className="w-full p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono tracking-widest"
                  value={editPin}
                  onChange={e => setEditPin(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Модель</label>
                <input
                  className="w-full p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={editCartridgeModel}
                  onChange={e => setEditCartridgeModel(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Цвет (для цветных принтеров)</label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setEditCartridgeColor('')}
                    className={`ui-mini-pill px-2 py-1 rounded border text-xs ${!editCartridgeColor ? 'bg-gray-800 text-white' : 'bg-white text-gray-500'}`}
                  >
                    —
                  </button>
                  {CONSUMABLE_COLORS.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setEditCartridgeColor(c.id)}
                      className={`h-8 w-8 rounded-full border text-xs font-bold ${c.className} ${editCartridgeColor === c.id ? 'ring-2 ring-blue-400 ring-offset-2' : ''}`}
                      title={c.label}
                    >
                      {c.short}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex space-x-2">
                <button type="button" onClick={() => { setEditCartridgeId(null); setCartPrintStatus(null); }}
                  className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">Отмена</button>
                <button type="submit"
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
                  Сохранить
                </button>
              </div>
            </form>

            <div className="mt-3 space-y-2 border-t pt-3">
              <button
                type="button"
                onClick={() => handlePrintCartridge()}
                className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-bold flex items-center justify-center space-x-2 hover:bg-green-700"
              >
                <BarcodeIcon size={14} />
                <span>Напечатать этикетку</span>
              </button>
              <button
                type="button"
                onClick={handleReplaceCartridge}
                className="w-full py-2 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg text-sm font-bold flex items-center justify-center space-x-2 hover:bg-orange-100"
              >
                <RefreshCw size={14} />
                <span>Заменить (новый ID)</span>
              </button>
              <button
                type="button"
                onClick={handleDeleteCartridge}
                className="w-full py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm hover:bg-red-100 flex items-center justify-center space-x-2"
              >
                <Trash2 size={14} />
                <span>Удалить расходник</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Employee Modal */}
      {showEmployeeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold">Сотрудники</h2>
              <button onClick={() => setShowEmployeeModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-3">Принтер: <strong>{showEmployeeModal}</strong></p>

            <div className="space-y-1 max-h-40 overflow-y-auto mb-3">
              {store.employees.filter(e => e.printerInventoryNumber === showEmployeeModal).map(emp => (
                <div key={emp.id} className="flex justify-between items-center bg-gray-50 rounded px-3 py-1.5 text-sm">
                  <div className="flex items-center space-x-2">
                    <User size={13} className="text-gray-400" />
                    <span>{emp.name}</span>
                  </div>
                  <button onClick={() => store.removeEmployee(emp.id)} className="text-red-400 hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {store.employees.filter(e => e.printerInventoryNumber === showEmployeeModal).length === 0 && (
                <div className="text-gray-300 italic text-xs text-center py-3">Нет сотрудников</div>
              )}
            </div>

            <div className="flex space-x-2">
              <input
                placeholder="ФИО сотрудника"
                className="flex-1 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                value={newEmployee}
                onChange={e => setNewEmployee(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddEmployee())}
              />
              <button
                onClick={handleAddEmployee}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700"
              >
                <Plus size={16} />
              </button>
            </div>
            <button
              onClick={() => setShowEmployeeModal(null)}
              className="mt-3 w-full py-2 border rounded-lg text-sm hover:bg-gray-50"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PrintersTab;
