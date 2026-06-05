
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  Plus, Printer as PrinterIcon, User, MapPin, Search, Edit2, Wrench, X, Hash,
  ChevronDown, ChevronUp, Calendar, DollarSign, Users, Trash2, RefreshCw,
  Barcode as BarcodeIcon, Tag,
} from 'lucide-react';
import {
  Printer, Cartridge, STATUS_LABELS, STATUS_COLORS, ConsumableType,
  EmployeeRecord, ConsumableColor,
  CartridgeStatus,
} from '../types';
import { StoreType } from '../store';
import { buildTSPLLabel, cleanInventoryNumber, getTemplate } from '../utils/tspl';
import { useStickyState } from '../utils/useStickyState';
import { mergeLedgerWithStore } from '../utils/warehouseStoreBridge';
import { ConfirmModal, AlertModal } from './ConfirmModal';

const EMPTY_PRINTER: Omit<Printer, 'inventoryNumber' | 'programId'> = {
  model: '',
  printerType: 'printer',
  department: '',
  boss: '',
  cartridgeModels: [],
  commissionDate: '',
  balanceCost: '',
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function uniqNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map(v => v.trim()).filter(Boolean)));
}

function sortByPrefixMatch(values: string[], input: string, limit = 12): string[] {
  const q = normalizeText(input);
  const sorted = uniqNonEmpty(values).sort((a, b) => {
    const an = normalizeText(a);
    const bn = normalizeText(b);
    const aPrefix = q.length > 0 && an.startsWith(q);
    const bPrefix = q.length > 0 && bn.startsWith(q);
    if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
    const aContains = q.length > 0 && an.includes(q);
    const bContains = q.length > 0 && bn.includes(q);
    if (aContains !== bContains) return aContains ? -1 : 1;
    return a.localeCompare(b, 'ru-RU');
  });
  return sorted.slice(0, limit);
}

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
  fromWarehouse?: boolean;
}

const CONSUMABLE_COLORS: Array<{ id: ConsumableColor; label: string; short: string; className: string }> = [
  { id: 'black', label: 'Чёрный', short: 'Ч', className: 'bg-black text-white border-black' },
  { id: 'cyan', label: 'Голубой', short: 'Г', className: 'bg-cyan-500 text-white border-cyan-500' },
  { id: 'magenta', label: 'Пурпурный', short: 'П', className: 'bg-fuchsia-500 text-white border-fuchsia-500' },
  { id: 'yellow', label: 'Жёлтый', short: 'Ж', className: 'bg-yellow-300 text-yellow-900 border-yellow-300' },
];

function ColorDot({ color }: { color?: ConsumableColor }) {
  const cfg = CONSUMABLE_COLORS.find(c => c.id === color);
  if (!cfg) return null;
  return <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-bold ${cfg.className}`}>{cfg.short}</span>;
}

function getConsumableLabel(cartridge: Cartridge, all: Cartridge[]): string {
  const sameType = all.filter(c => c.consumableType === cartridge.consumableType);
  const fromSlot = cartridge.consumableSlot;
  const index =
    fromSlot != null && Number.isFinite(fromSlot)
      ? fromSlot
      : sameType.findIndex(c => c.id === cartridge.id) + 1;
  const base = cartridge.consumableType === 'drum' ? 'Драм' : 'Картридж';
  return `${base} ${Math.max(index, 1)}`;
}

const PrintersTab: React.FC<{ store: StoreType }> = ({ store }) => {
  type SortKey =
    | 'programId'
    | 'inventoryNumber'
    | 'printerType'
    | 'model'
    | 'department'
    | 'boss'
    | 'employeesCount'
    | 'cartridgesCount';
  const [showAddPrinter, setShowAddPrinter] = useState(false);
  const [editPrinter, setEditPrinter] = useState<Printer | null>(null);
  const [newPrinter, setNewPrinter] = useState<Printer>({ inventoryNumber: '', programId: '', ...EMPTY_PRINTER });
  const [cartridgeModelsText, setCartridgeModelsText] = useState('');
  const [cartridgeModelsTouched, setCartridgeModelsTouched] = useState(false);
  const [customTypeInput, setCustomTypeInput] = useState('');
  const [showCustomType, setShowCustomType] = useState(false);

  const [addCart, setAddCart] = useState<AddCartridgeState | null>(null);
  const pinCode = '000';

  const [search, setSearch] = useStickyState('search_printers', '');
  const printersSearchRef = useRef<HTMLInputElement>(null);

  /** После закрытия модалки фокус мог остаться на размонтированном input — клавиатура «молчит» до перезапуска (Electron/Chromium). */
  const scheduleFocusPrintersSearch = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        printersSearchRef.current?.focus({ preventScroll: true });
      });
    });
  };
  const [filterType, setFilterType] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsPrinter, setDetailsPrinter] = useState<Printer | null>(null);

  useEffect(() => {
    const onScan = (event: Event) => {
      setSearch((event as CustomEvent<string>).detail);
    };
    window.addEventListener('app-scanner-input', onScan as EventListener);
    return () => window.removeEventListener('app-scanner-input', onScan as EventListener);
  }, []);

  const [showEmployeeModal, setShowEmployeeModal] = useState<string | null>(null);
  const [newEmployee, setNewEmployee] = useState('');

  const [editCartridgeId, setEditCartridgeId] = useState<string | null>(null);
  const [editCartridgeModel, setEditCartridgeModel] = useState('');
  const [editCartridgeColor, setEditCartridgeColor] = useState<ConsumableColor | ''>('');
  const [editPin, setEditPin] = useState('');
  const [cartPrintStatus, setCartPrintStatus] = useState<string | null>(null);

  /** Редактирование модели и «Списан» прямо в карточке принтера (без PIN) */
  const [detailsCartEditor, setDetailsCartEditor] = useState<{
    id: string;
    model: string;
    writtenOff: boolean;
  } | null>(null);

  const [printStatus, setPrintStatus] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('inventoryNumber');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const showCards = (store.settings.printersViewMode ?? 'list') === 'cards';

  const [confirmModal, setConfirmModal] = useState<{
    message: string;
    onConfirm: () => void;
    dangerous?: boolean;
  } | null>(null);
  const [alertModal, setAlertModal] = useState<{
    message: string;
    variant?: 'info' | 'error' | 'success';
  } | null>(null);

  const modelOptions = useMemo(
    () => uniqNonEmpty(store.printers.map(p => p.model)),
    [store.printers],
  );
  const departmentOptions = useMemo(
    () => uniqNonEmpty(store.printers.map(p => p.department)),
    [store.printers],
  );
  const bossOptions = useMemo(
    () => uniqNonEmpty(store.printers.map(p => p.boss)),
    [store.printers],
  );
  const allConsumableModelOptions = useMemo(
    () => uniqNonEmpty([
      ...store.cartridges.map(c => c.model),
      ...store.printers.flatMap(p => p.cartridgeModels ?? []),
    ]),
    [store.cartridges, store.printers],
  );

  const suggestedConsumablesByPrinterModel = useMemo(() => {
    const modelQuery = normalizeText(newPrinter.model);
    if (!modelQuery) return [];
    const matchedPrinters = store.printers.filter(p => {
      const m = normalizeText(p.model);
      return m === modelQuery || m.startsWith(modelQuery) || modelQuery.startsWith(m);
    });
    const counts = new Map<string, number>();
    matchedPrinters.forEach(p => {
      (p.cartridgeModels ?? []).forEach(model => {
        const key = model.trim();
        if (!key) return;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'ru-RU'))
      .map(([name]) => name);
  }, [newPrinter.model, store.printers]);

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

  function getCartridges(invNum: string) {
    const n = cleanInventoryNumber(invNum);
    return store.cartridges.filter(
      (c: Cartridge) => cleanInventoryNumber(c.printerInventoryNumber) === n,
    );
  }

  const filteredPrinters = useMemo(() => {
    return store.printers.filter(p => {
      const q = search.toLowerCase();
      const matchSearch =
        (p.inventoryNumber ?? '').toLowerCase().includes(q) ||
        (p.model ?? '').toLowerCase().includes(q) ||
        (p.department ?? '').toLowerCase().includes(q) ||
        (p.boss ?? '').toLowerCase().includes(q) ||
        getCartridges(p.inventoryNumber).some(c =>
          (c.id ?? '').toLowerCase().includes(q) ||
          (c.model ?? '').toLowerCase().includes(q) ||
          (c.barcode ?? '').toLowerCase().includes(q),
        ) ||
        store.employees
          .filter(e => e.printerInventoryNumber === p.inventoryNumber)
          .some(e => (e.name ?? '').toLowerCase().includes(q)) ||
        (p.programId ?? '').toLowerCase().includes(q);
      const matchType = filterType === 'all' || p.printerType === filterType;
      return matchSearch && matchType;
    });
  }, [store.printers, store.employees, search, filterType]);

  const sortedFilteredPrinters = useMemo(() => {
    const collator = new Intl.Collator('ru-RU', { numeric: true, sensitivity: 'base' });
    const valueFor = (p: Printer): string | number => {
      switch (sortKey) {
        case 'programId': return p.programId ?? '';
        case 'inventoryNumber': return p.inventoryNumber ?? '';
        case 'printerType': return p.printerType ?? '';
        case 'model': return p.model ?? '';
        case 'department': return p.department ?? '';
        case 'boss': return p.boss ?? '';
        case 'employeesCount':
          return store.employees.filter(e => e.printerInventoryNumber === p.inventoryNumber).length;
        case 'cartridgesCount':
          return getCartridges(p.inventoryNumber).length;
      }
    };
    return [...filteredPrinters].sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      const base = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : collator.compare(String(av), String(bv));
      if (base !== 0) return sortDir === 'asc' ? base : -base;
      return collator.compare(a.inventoryNumber, b.inventoryNumber);
    });
  }, [filteredPrinters, sortKey, sortDir, store.employees, store.cartridges]);

  const highlightedDisposedIds = useMemo(() => {
    const ids = new Set<string>();
    store.refillLog.forEach(entry => {
      const raw = entry.action ?? '';
      const action = raw.toLowerCase();
      // Строка про регистрацию НОВОГО id после замены — cartridgeId в журнале новый, не списание
      if (/замен[её]н на новый/i.test(raw)) return;
      if (
        entry.serviceType === 'writeoff' ||
        entry.serviceType === 'replacement' ||
        entry.serviceType === 'Списание' ||
        entry.serviceType === 'Редактирование' && action.includes('замен') ||
        action.includes('списан') ||
        action.includes('замен')
      ) {
        ids.add(entry.cartridgeId);
      }
    });
    return ids;
  }, [store.refillLog]);

  /** Как на вкладке «Склады»: тот же merge реестра и БД — бейджи не «залипают» на старом статусе картриджа. */
  const mergedWarehouseItems = useMemo(
    () =>
      mergeLedgerWithStore(
        store.warehouseLedger,
        store.cartridges,
        store.repairs,
        store.printers,
      ),
    [store.warehouseLedger, store.cartridges, store.repairs, store.printers],
  );

  const cartridgeDisplayStatus = useCallback(
    (c: Cartridge): CartridgeStatus => {
      const row = mergedWarehouseItems.find(
        m => m.id === c.id && (m.type === 'Картридж' || m.type === 'Драм-картридж'),
      );
      if (!row) return c.status;
      switch (row.status) {
        case 'waiting':
          return 'waiting';
        case 'at_refill':
          return 'at_refill';
        case 'ready':
          return c.status === 'received_from_refill' ? 'received_from_refill' : 'ready';
        case 'issued':
          return 'on_hand';
        default:
          return c.status;
      }
    },
    [mergedWarehouseItems],
  );

  /** Списан/заменён по статусу; подсветка по журналу не перекрывает «Готов к выдаче» и др. рабочие статусы. */
  const isDisposedLike = (c: Cartridge) => {
    if (c.status === 'disposed' || c.status === 'replaced') return true;
    if (
      c.status === 'on_hand' ||
      c.status === 'received_from_refill' ||
      c.status === 'ready' ||
      c.status === 'waiting' ||
      c.status === 'at_refill'
    ) {
      return false;
    }
    return highlightedDisposedIds.has(c.id);
  };

  const printers = sortedFilteredPrinters.filter(p => p.printerType === 'printer');
  const mfus = sortedFilteredPrinters.filter(p => p.printerType === 'mfu');
  const others = sortedFilteredPrinters.filter(p => p.printerType !== 'printer' && p.printerType !== 'mfu');

  const repairCount = (invNum: string) =>
    store.repairs.filter(r => r.printerInventoryNumber === invNum && r.status !== 'repaired').length;

  const openAdd = () => {
    setEditPrinter(null);
    setNewPrinter({ inventoryNumber: '', programId: '', ...EMPTY_PRINTER });
    setCartridgeModelsText('');
    setCartridgeModelsTouched(false);
    setShowCustomType(false);
    setCustomTypeInput('');
    setShowAddPrinter(true);
  };

  const openEdit = (p: Printer) => {
    setEditPrinter(p);
    setNewPrinter({ ...p });
    setCartridgeModelsText(p.cartridgeModels.join(', '));
    setCartridgeModelsTouched(true);
    const isCustom = p.printerType !== 'printer' && p.printerType !== 'mfu';
    setShowCustomType(isCustom);
    setCustomTypeInput(isCustom ? p.printerType : '');
    setShowAddPrinter(true);
  };

  useEffect(() => {
    if (!showAddPrinter || !!editPrinter) return;
    if (cartridgeModelsTouched) return;
    if (!newPrinter.model.trim()) return;
    if (suggestedConsumablesByPrinterModel.length === 0) return;
    setCartridgeModelsText(suggestedConsumablesByPrinterModel.join(', '));
  }, [
    showAddPrinter,
    editPrinter,
    cartridgeModelsTouched,
    newPrinter.model,
    suggestedConsumablesByPrinterModel,
  ]);

  const handleSavePrinter = (e: React.FormEvent) => {
    e.preventDefault();
    const models = cartridgeModelsText
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const finalType = showCustomType && customTypeInput.trim()
      ? customTypeInput.trim()
      : newPrinter.printerType;
    const canClearFirmware = store.settings.enableEventEditing;
    const firmwareLocked = !!editPrinter?.firmwareFlashed && !canClearFirmware;
    const printer: Printer = {
      ...newPrinter,
      printerType: finalType,
      cartridgeModels: models,
      programId: newPrinter.programId || store.generatePrinterId(newPrinter.inventoryNumber),
      firmwareFlashed: editPrinter
        ? (firmwareLocked ? true : !!newPrinter.firmwareFlashed)
        : !!newPrinter.firmwareFlashed,
    };
    const isNew = !editPrinter;
    if (!isNew && editPrinter) {
      const changes: string[] = [];
      if (editPrinter.model !== printer.model) changes.push(`модель: ${editPrinter.model} → ${printer.model}`);
      if (editPrinter.department !== printer.department) changes.push(`подразделение: ${editPrinter.department || '—'} → ${printer.department || '—'}`);
      if (editPrinter.boss !== printer.boss) changes.push(`мат.отв.: ${editPrinter.boss || '—'} → ${printer.boss || '—'}`);
      if (editPrinter.balanceCost !== printer.balanceCost) changes.push(`стоимость: ${editPrinter.balanceCost || '—'} → ${printer.balanceCost || '—'}`);
      if (changes.length > 0) {
        store.addRefillLog({
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          cartridgeId: printer.programId ?? printer.inventoryNumber,
          cartridgeModel: printer.model,
          consumableType: 'device',
          deviceType: printer.printerType,
          serviceType: 'Редактирование',
          printerInventoryNumber: printer.inventoryNumber,
          printerModel: printer.model,
          department: printer.department,
          employee: printer.boss,
          action: `Принтер отредактирован: ${changes.join('; ')}`,
          is_technical: true,
        });
      }
    }
    store.addPrinter(printer);

    if (isNew) {
      const cartModel = models[0] ?? '';
      const slot = store.allocateConsumableSlot(printer.inventoryNumber, 'cartridge', printer);
      const id = store.generateConsumableId('cartridge', printer.inventoryNumber, slot);
      const cartridge: Cartridge = {
        id,
        barcode: id,
        model: cartModel,
        consumableType: 'cartridge',
        consumableSlot: slot,
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

  const handleDeletePrinter = () => {
    if (!editPrinter) return;
    setConfirmModal({
      message: `Удалить принтер ${editPrinter.inventoryNumber}? Это действие нельзя отменить.`,
      dangerous: true,
      onConfirm: () => {
        store.removePrinter(editPrinter.inventoryNumber);
        setShowAddPrinter(false);
        setEditPrinter(null);
        setConfirmModal(null);
        scheduleFocusPrintersSearch();
      },
    });
  };

  const openAddCart = (invNum: string) => {
    const existing = getCartridges(invNum);
    const printer = store.printers.find(p => p.inventoryNumber === invNum);
    const printerModels = printer?.cartridgeModels ?? [];

    const warehouseItems = store.newCartridges.filter(c => c.quantity > 0);
    const sortedWarehouseItems = [...warehouseItems].sort((a, b) => {
      const aMatch = printerModels.some(m => m.toLowerCase() === a.model.toLowerCase());
      const bMatch = printerModels.some(m => m.toLowerCase() === b.model.toLowerCase());
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return a.model.localeCompare(b.model);
    });

    const defaultModelFromWarehouse = sortedWarehouseItems[0]?.model ?? '';
    const defaultModelFree = existing.length === 0 ? (printerModels[0] ?? '') : (printerModels[existing.length] ?? (printerModels[0] ?? ''));

    setAddCart({
      printerInv: invNum,
      consumableType: 'cartridge',
      model: defaultModelFromWarehouse || defaultModelFree,
      color: undefined,
      printAfter: store.settings.autoPrintOnRegister,
      fromWarehouse: warehouseItems.length > 0, // default to true if we actually have stock
    });
  };

  const handleAddCartridge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addCart) return;
    const slot = store.allocateConsumableSlot(addCart.printerInv, addCart.consumableType);
    const id = store.generateConsumableId(addCart.consumableType, addCart.printerInv, slot);
    const isAutoPrint = addCart.printAfter && store.settings.labelPrinterName && !!window.electronAPI;
    const cartridge: Cartridge = {
      id,
      barcode: id,
      model: addCart.model,
      consumableType: addCart.consumableType,
      color: addCart.color,
      consumableSlot: slot,
      printerInventoryNumber: addCart.printerInv,
      status: 'on_hand',
      refillCount: 0,
      registrationDate: new Date().toISOString(),
      history: [{
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        action: `Зарегистрирован (${addCart.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж'}). Выдан пользователю.`,
      }],
      labelPrinted: isAutoPrint,
    };
    store.addCartridge(cartridge);

    if (addCart.fromWarehouse) {
      const warehouseItem = store.newCartridges.find(
        c => c.model.toLowerCase() === addCart.model.toLowerCase() && c.quantity > 0,
      );
      if (warehouseItem) {
        store.updateNewCartridge(warehouseItem.id, {
          quantity: Math.max(0, warehouseItem.quantity - 1),
        });
      }
    }

    if (addCart.printAfter && store.settings.labelPrinterName && window.electronAPI) {
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
      await window.electronAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode);
    }

    setAddCart(null);
  };

  const handleEditCartridge = (e: React.FormEvent) => {
    e.preventDefault();
    if (editPin !== pinCode) {
      setAlertModal({ message: 'Неверный PIN-код', variant: 'error' });
      return;
    }
    if (!editCartridgeId) return;
    const prevCart = store.cartridges.find(c => c.id === editCartridgeId);
    store.updateCartridge(editCartridgeId, { model: editCartridgeModel, color: editCartridgeColor || undefined });
    if (prevCart && prevCart.model !== editCartridgeModel) {
      const printer = store.printers.find(p => p.inventoryNumber === prevCart.printerInventoryNumber);
      store.addRefillLog({
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        cartridgeId: editCartridgeId,
        cartridgeModel: editCartridgeModel,
        consumableType: prevCart.consumableType ?? 'cartridge',
        deviceType: prevCart.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
        serviceType: 'Редактирование',
        printerInventoryNumber: prevCart.printerInventoryNumber,
        printerModel: printer?.model ?? '',
        department: printer?.department ?? '',
        employee: printer?.boss,
        action: `Расходник отредактирован: модель ${prevCart.model} → ${editCartridgeModel}`,
        is_technical: true,
      });
    }
    setEditCartridgeId(null);
    setEditPin('');
    setEditCartridgeColor('');
    setCartPrintStatus(null);
    scheduleFocusPrintersSearch();
  };

  const handleDeleteCartridge = () => {
    if (!editCartridgeId) return;
    const idToDelete = editCartridgeId;
    setConfirmModal({
      message: `Удалить расходник ${idToDelete}? Это действие нельзя отменить.`,
      dangerous: true,
      onConfirm: () => {
        store.removeCartridge(idToDelete);
        setEditCartridgeId(null);
        setEditPin('');
        setCartPrintStatus(null);
        setConfirmModal(null);
        scheduleFocusPrintersSearch();
      },
    });
  };

  const handleSaveDetailsCartEdit = () => {
    if (!detailsCartEditor || !detailsPrinter) return;
    const c = store.cartridges.find(x => x.id === detailsCartEditor.id);
    if (!c) {
      setDetailsCartEditor(null);
      return;
    }
    const modelTrim = detailsCartEditor.model.trim();
    if (modelTrim !== c.model) {
      store.updateCartridge(c.id, { model: modelTrim });
    }
    const wasDisposedLike = isDisposedLike(c);
    const wantDisposed = detailsCartEditor.writtenOff;
    const printer = store.printers.find(p => p.inventoryNumber === c.printerInventoryNumber);

    if (wantDisposed && !wasDisposedLike) {
      store.updateCartridgeStatus(c.id, 'disposed', 'Отмечен как списан в карточке принтера');
      store.addRefillLog({
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        cartridgeId: c.id,
        cartridgeModel: modelTrim || c.model,
        consumableType: c.consumableType ?? 'cartridge',
        deviceType: c.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
        serviceType: 'Списание',
        printerInventoryNumber: c.printerInventoryNumber,
        printerModel: printer?.model ?? '',
        department: printer?.department ?? '',
        employee: printer?.boss,
        action: 'Расходник отмечен как списан в карточке принтера',
        is_technical: false,
      });
    } else if (!wantDisposed && c.status === 'disposed' && !c.isReplaced) {
      store.updateCartridgeStatus(c.id, 'on_hand', 'Снята отметка списания в карточке принтера');
      store.setRefillLog(prev =>
        prev.filter(
          e =>
            !(
              e.cartridgeId === c.id &&
              (e.serviceType === 'writeoff' || e.serviceType === 'Списание') &&
              e.action === 'Расходник отмечен как списан в карточке принтера'
            ),
        ),
      );
    }

    setDetailsCartEditor(null);
  };

  const handleDisposeCartridgeFromCard = (cartridge: Cartridge) => {
    setConfirmModal({
      message: `Списать и удалить ${cartridge.id}?`,
      dangerous: true,
      onConfirm: () => {
        setConfirmModal(null);
        store.updateCartridgeStatus(cartridge.id, 'disposed', 'Списан вручную из карточки принтера');
        const printer = store.printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
        store.addRefillLog({
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          cartridgeId: cartridge.id,
          cartridgeModel: cartridge.model,
          consumableType: cartridge.consumableType ?? 'cartridge',
          deviceType: cartridge.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
          serviceType: 'Списание',
          printerInventoryNumber: cartridge.printerInventoryNumber,
          printerModel: printer?.model ?? '',
          department: printer?.department ?? '',
          employee: printer?.boss,
          action: 'Расходник списан и удалён из карточки принтера',
          is_technical: false,
        });
        store.removeCartridge(cartridge.id);
        scheduleFocusPrintersSearch();
      },
    });
  };

  const handleReplaceCartridge = () => {
    if (!editCartridgeId) return;
    const cart = store.cartridges.find(c => c.id === editCartridgeId);
    if (!cart) return;
    const slot = store.allocateConsumableSlot(cart.printerInventoryNumber, cart.consumableType ?? 'cartridge');
    const newId = store.generateConsumableId(cart.consumableType ?? 'cartridge', cart.printerInventoryNumber, slot);
    const newCart: Cartridge = {
      ...cart,
      id: newId,
      barcode: newId,
      consumableSlot: slot,
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
    store.replaceCartridge(editCartridgeId, newCart, `Списан при замене на ${newId}`);
    const printer = store.printers.find(p => p.inventoryNumber === cart.printerInventoryNumber);
    store.addRefillLog({
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString(),
      cartridgeId: editCartridgeId,
      cartridgeModel: cart.model,
      consumableType: cart.consumableType ?? 'cartridge',
      deviceType: cart.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
      serviceType: 'Списание',
      printerInventoryNumber: cart.printerInventoryNumber,
      printerModel: printer?.model ?? '',
      department: printer?.department ?? '',
      employee: printer?.boss,
      action: `Расходник списан при замене на ${newId} (${newCart.model})`,
      is_technical: false,
    });
    store.addRefillLog({
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString(),
      cartridgeId: newId,
      cartridgeModel: newCart.model,
      consumableType: newCart.consumableType ?? 'cartridge',
      deviceType: newCart.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
      serviceType: 'Создание',
      printerInventoryNumber: newCart.printerInventoryNumber,
      printerModel: printer?.model ?? '',
      department: printer?.department ?? '',
      employee: printer?.boss,
      action: `Новый расходник ${newId} при замене ${editCartridgeId}`,
      is_technical: true,
    });
    setEditCartridgeId(newId);
    setEditCartridgeModel(newCart.model);
    setCartPrintStatus(`Создан новый: ${newId}`);
  };

  const handlePrintCartridge = async (cartId?: string) => {
    const id = cartId ?? editCartridgeId;
    if (!id) return;
    const cart = store.cartridges.find(c => c.id === id);
    if (!cart) return;

    const proceedPrint = async () => {
      if (!store.settings.labelPrinterName) {
        if (cartId) setPrintStatus({ id: cartId, text: 'Принтер не выбран', ok: false });
        else setCartPrintStatus('Принтер не выбран в Настройках');
        return;
      }
      if (!window.electronAPI) {
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
        status: STATUS_LABELS[cartridgeDisplayStatus(cart)],
      });
      const res = await window.electronAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode);
      if (res.success) {
        store.updateCartridge(cart.id, { labelPrinted: true });
      }
      if (cartId) {
        setPrintStatus({ id: cartId, text: res.success ? 'Отправлено!' : (res.error ?? 'Ошибка'), ok: res.success });
        setTimeout(() => setPrintStatus(null), 3000);
      } else {
        setCartPrintStatus(res.success ? 'Этикетка отправлена!' : (res.error ?? 'Ошибка печати'));
      }
    };

    if (cart.labelPrinted) {
      setConfirmModal({
        message: `Внимание! Этикетка на данный расходник (${cart.id}) уже была напечатана. Вы уверены, что хотите напечатать её повторно?`,
        onConfirm: () => {
          setConfirmModal(null);
          proceedPrint();
        },
      });
    } else {
      await proceedPrint();
    }
  };

  const handlePrintPrinter = async (printer: Printer) => {
    if (!store.settings.labelPrinterName) {
      setPrintStatus({ id: printer.inventoryNumber, text: 'Принтер этикеток не выбран', ok: false });
      return;
    }
    if (!window.electronAPI) {
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
      firmwareFlashed: !!printer.firmwareFlashed,
    });
    const res = await window.electronAPI.rawPrint(store.settings.labelPrinterName, tspl, store.settings.labelPrintMode);
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

  const PrinterCard = ({ printer }: { printer: Printer }) => {
    const carts = getCartridges(printer.inventoryNumber);
    const inRepair = repairCount(printer.inventoryNumber);
    const isExpanded = expandedId === printer.inventoryNumber;
    const printerEmployees = store.employees.filter(e => e.printerInventoryNumber === printer.inventoryNumber);

    return (
      <div className={`bg-white rounded-xl shadow-sm border flex flex-col ${
        printer.printerType === 'mfu' ? 'border-purple-100' : 'border-gray-100'
      }`}>
        <div className="p-4">
          {/* Header */}
          <div className="flex items-start space-x-3 mb-3">
            <div className={`p-2 rounded-lg shrink-0 ${printer.printerType === 'mfu' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
              <PrinterIcon size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm leading-tight flex items-start gap-1.5 min-w-0">
                <span className="break-words">{printer.model}</span>
                {printer.firmwareFlashed && (
                  <span
                    className="shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-red-500 ring-2 ring-red-200"
                    title="Прошит"
                    aria-label="Прошит"
                  />
                )}
              </div>
              <div className="flex items-center space-x-2 mt-0.5 flex-wrap gap-1">
                <span className="font-bold text-sm text-gray-600">{printer.inventoryNumber}</span>
                <PrinterTypeBadge type={printer.printerType} />
              </div>
              {/* Program ID badge */}
              {printer.programId && (
                <div className="flex items-center space-x-1 mt-1">
                  <Tag size={10} className="text-gray-400" />
                  <span className="text-xs font-mono text-gray-400">ID: {printer.programId}</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1 text-xs text-gray-600">
            {printer.department && (
              <div className="flex items-center space-x-1.5">
                <MapPin size={12} className="text-gray-400 shrink-0" />
                <span>{printer.department}</span>
              </div>
            )}
            {printer.boss && (
              <div className="flex items-center space-x-1.5">
                <Hash size={12} className="text-gray-400 shrink-0" />
                <span className="font-medium">{printer.boss}</span>
              </div>
            )}
            {printer.commissionDate && (
              <div className="flex items-center space-x-1.5">
                <Calendar size={12} className="text-gray-400 shrink-0" />
                <span>{printer.commissionDate}</span>
              </div>
            )}
            {printer.balanceCost && (
              <div className="flex items-center space-x-1.5">
                <DollarSign size={12} className="text-gray-400 shrink-0" />
                <span>{printer.balanceCost} ₽</span>
              </div>
            )}
          </div>

          {inRepair > 0 && (
            <div className="mt-2 px-2 py-1 bg-orange-50 text-orange-700 text-xs rounded font-semibold flex items-center space-x-1">
              <Wrench size={11} />
              <span>{inRepair} в ремонте</span>
            </div>
          )}

          {/* Print buttons row for printer itself */}
          <div className="mt-3 flex space-x-1">
            <button
              onClick={() => handlePrintPrinter(printer)}
              title="Напечатать штрих-код принтера"
              className="flex-1 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold hover:bg-blue-100 flex items-center justify-center space-x-1"
            >
              <BarcodeIcon size={12} />
              <span>Штрих-код принтера</span>
            </button>
          </div>
        </div>

        {/* Consumables section */}
        <div className="border-t px-4 pb-1 pt-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-gray-400 uppercase">
              Расходники ({carts.length})
            </span>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setExpandedId(isExpanded ? null : printer.inventoryNumber)}
                className="text-gray-400 hover:text-gray-600"
              >
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              <button
                onClick={() => openAddCart(printer.inventoryNumber)}
                className="text-blue-600 hover:text-blue-700 text-xs font-bold flex items-center space-x-0.5"
              >
                <Plus size={12} />
                <span>Добавить</span>
              </button>
            </div>
          </div>

          {isExpanded && (
            <div className="space-y-1 mb-2 max-h-48 overflow-y-auto">
              {carts.length === 0 ? (
                <div className="text-xs text-gray-300 italic py-2 text-center">Нет расходников</div>
              ) : (
                carts.map(c => (
                  <div key={c.id} className="flex justify-between items-center text-xs p-1.5 bg-gray-50 rounded">
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.consumableType === 'drum' ? 'bg-orange-400' : 'bg-blue-400'}`} />
                      <ColorDot color={c.color} />
                      <button
                        onClick={() => handlePrintCartridge(c.id)}
                        className="font-mono font-bold text-gray-700 truncate hover:text-blue-600 hover:underline"
                        title="Напечатать этикетку расходника"
                      >
                        {getConsumableLabel(c, carts)}
                      </button>
                      <span className="text-gray-400 truncate">{c.model}</span>
                      {c.consumableType === 'drum' && (
                        <span className="text-orange-600 font-bold shrink-0">DRUM</span>
                      )}
                    </div>
                    <div className="flex items-center space-x-1 shrink-0">
                      <span className={`px-1.5 py-0.5 rounded-full font-bold ${isDisposedLike(c) ? 'bg-red-100 text-red-700' : STATUS_COLORS[cartridgeDisplayStatus(c)]}`} style={{ fontSize: '10px' }}>
                        {STATUS_LABELS[cartridgeDisplayStatus(c)]}
                      </span>
                      {/* Print barcode button for cartridge */}
                      <button
                        onClick={() => handlePrintCartridge(c.id)}
                        title="Напечатать штрих-код"
                        className="p-0.5 text-blue-400 hover:text-blue-600"
                      >
                        <BarcodeIcon size={12} />
                      </button>
                      <button
                        onClick={() => {
                          setEditCartridgeId(c.id);
                          setEditCartridgeModel(c.model);
                          setEditCartridgeColor(c.color ?? '');
                          setEditPin('');
                          setCartPrintStatus(null);
                        }}
                        className="text-gray-300 hover:text-blue-500 ml-1"
                      >
                        <Edit2 size={11} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {!isExpanded && carts.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {carts.slice(0, 2).map(c => (
                <button
                  key={c.id}
                  onClick={() => handlePrintCartridge(c.id)}
                  className={`text-xs px-1.5 py-0.5 rounded-full font-bold hover:ring-2 hover:ring-blue-200 ${isDisposedLike(c) ? 'bg-red-100 text-red-700' : STATUS_COLORS[cartridgeDisplayStatus(c)]}`}
                  title="Напечатать этикетку расходника"
                >
                  <ColorDot color={c.color} />
                  {getConsumableLabel(c, carts)}
                </button>
              ))}
              {carts.length > 2 && (
                <span className="text-xs text-gray-400">+{carts.length - 2}</span>
              )}
            </div>
          )}
        </div>

        {/* Employees */}
        {printerEmployees.length > 0 && (
          <div className="border-t px-4 py-2">
            <div className="text-xs text-gray-400 font-bold uppercase mb-1">Сотрудники</div>
            <div className="flex flex-wrap gap-1">
              {printerEmployees.map(emp => (
                <div key={emp.id} className="flex items-center space-x-1 bg-gray-100 rounded px-2 py-0.5 text-xs">
                  <User size={10} />
                  <span>{emp.name}</span>
                  <button onClick={() => store.removeEmployee(emp.id)} className="text-red-300 hover:text-red-500">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-4 pb-3 pt-2 flex space-x-2">
          <button
            onClick={() => openEdit(printer)}
            className="flex-1 py-1.5 border rounded text-xs text-gray-600 hover:bg-gray-50 flex items-center justify-center space-x-1"
          >
            <Edit2 size={11} />
            <span>Редактировать</span>
          </button>
          <button
            onClick={() => setShowEmployeeModal(printer.inventoryNumber)}
            className="py-1.5 px-3 border rounded text-xs text-gray-600 hover:bg-gray-50 flex items-center space-x-1"
          >
            <Users size={11} />
          </button>
        </div>
      </div>
    );
  };

  const Section = ({ title, items, color }: { title: string; items: Printer[]; color: string }) => (
    <div className="space-y-3">
      <div className={`flex items-center space-x-2 text-sm font-bold ${color} py-1 border-b`}>
        <PrinterIcon size={16} />
        <span>{title}</span>
        <span className="ml-1 bg-gray-200 text-gray-600 rounded-full px-2 py-0.5 text-xs font-normal">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="text-gray-300 italic text-sm py-4 text-center">Нет записей</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map(p => <PrinterCard key={p.inventoryNumber} printer={p} />)}
        </div>
      )}
    </div>
  );

  const PrintersList = () => (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-500">
            <tr>
              {([
                ['programId', 'ID'],
                ['inventoryNumber', 'Инв. №'],
                ['printerType', 'Тип'],
                ['model', 'Модель'],
                ['department', 'Подразделение'],
                ['boss', 'Мат. отв.'],
                ['employeesCount', 'Сотрудники'],
                ['cartridgesCount', 'Расходники'],
              ] as [SortKey, string][]).map(([key, label]) => (
                <th key={key} className="px-4 py-3 font-semibold">
                  <button
                    type="button"
                    onClick={() => {
                      if (sortKey === key) setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
                      else {
                        setSortKey(key);
                        setSortDir('asc');
                      }
                    }}
                    className="inline-flex items-center gap-1 hover:text-gray-700"
                    title={`Сортировать по: ${label}`}
                  >
                    <span>{label}</span>
                    {sortKey === key ? (
                      sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                    ) : (
                      <span className="text-gray-300">↕</span>
                    )}
                  </button>
                </th>
              ))}
              <th className="px-4 py-3 font-semibold text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sortedFilteredPrinters.map(p => {
              const carts = getCartridges(p.inventoryNumber);
              const printerEmployees = store.employees.filter(e => e.printerInventoryNumber === p.inventoryNumber);
              return (
                <tr
                  key={p.inventoryNumber}
                  onClick={event => openDetailsFromRow(event, p)}
                  className="hover:bg-blue-50/50 cursor-pointer"
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
                  <td className="px-4 py-3 font-mono font-bold">{p.inventoryNumber}</td>
                  <td className="px-4 py-3"><PrinterTypeBadge type={p.printerType} /></td>
                  <td className="px-4 py-3 font-semibold">
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      <span>{p.model}</span>
                      {p.firmwareFlashed && (
                        <span
                          className="shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-red-500 ring-2 ring-red-200"
                          title="Прошит"
                          aria-label="Прошит"
                        />
                      )}
                    </span>
                  </td>
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
                      {carts.slice(0, 3).map(c => {
                        const isDisposed = isDisposedLike(c);
                        return (
                          <button key={c.id} onClick={() => handlePrintCartridge(c.id)}
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${isDisposed ? 'bg-red-100 text-red-700' : STATUS_COLORS[cartridgeDisplayStatus(c)]}`}
                            title="Напечатать этикетку расходника">
                            <ColorDot color={c.color} />
                            {getConsumableLabel(c, carts)}
                          </button>
                        );
                      })}
                      {carts.length > 3 && <span className="text-xs text-gray-400">+{carts.length - 3}</span>}
                      {carts.length === 0 && <span className="text-gray-300 text-xs">нет</span>}
                      <button
                        onClick={() => openAddCart(p.inventoryNumber)}
                        className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100"
                        title="Добавить расходник"
                      >
                        + Добавить
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(p)}
                        className="px-2 py-1 border rounded text-xs text-gray-600 hover:bg-gray-50">
                        Редактировать
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {sortedFilteredPrinters.length === 0 && (
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
            <input
              ref={printersSearchRef}
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
                className={`px-3 py-2 transition-colors ${
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

      <label className="inline-flex items-center space-x-2 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={showCards}
          onChange={e => store.setSettings({ ...store.settings, printersViewMode: e.target.checked ? 'cards' : 'list' })}
          className="rounded"
        />
        <span>Показывать карточками</span>
      </label>

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

      {showCards ? (
        <>
          {(filterType === 'all' || filterType === 'printer') && printers.length > 0 && (
            <Section title="Принтеры" items={printers} color="text-blue-700" />
          )}
          {(filterType === 'all' || filterType === 'mfu') && mfus.length > 0 && (
            <Section title="МФУ" items={mfus} color="text-purple-700" />
          )}
          {others.length > 0 && (
            <Section title="Прочие устройства" items={others} color="text-teal-700" />
          )}
          {filteredPrinters.length === 0 && (
            <div className="text-gray-300 italic text-sm py-8 text-center">Нет принтеров</div>
          )}
        </>
      ) : (
        <PrintersList />
      )}

      {detailsPrinter && (() => {
        const carts = getCartridges(detailsPrinter.inventoryNumber);
        const employees = store.employees.filter(e => e.printerInventoryNumber === detailsPrinter.inventoryNumber);
        return (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
            onMouseDown={e => {
              if (e.target === e.currentTarget) {
                setDetailsPrinter(null);
                setDetailsCartEditor(null);
              }
            }}
          >
            <div className="bg-white rounded-2xl max-w-5xl w-full shadow-2xl overflow-hidden" onMouseDown={e => e.stopPropagation()}>
              <div className="bg-gradient-to-r from-blue-600 to-cyan-500 text-white p-5 flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-20 w-24 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center">
                    <PrinterIcon size={44} />
                  </div>
                  <div>
                    <div className="text-xs uppercase opacity-75">Карточка устройства</div>
                    <div className="text-xl font-bold flex items-center gap-2 flex-wrap">
                      <span className="break-words">{detailsPrinter.model}</span>
                      {detailsPrinter.firmwareFlashed && (
                        <span
                          className="shrink-0 inline-block w-2 h-2 rounded-full bg-white ring-2 ring-white/50"
                          title="Прошит"
                          aria-label="Прошит"
                        />
                      )}
                    </div>
                    <div className="text-sm opacity-90 font-mono">{detailsPrinter.inventoryNumber}</div>
                    {detailsPrinter.programId && <div className="text-xs opacity-80 font-mono">ID: {detailsPrinter.programId}</div>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setDetailsPrinter(null); setDetailsCartEditor(null); }}
                  className="text-white/80 hover:text-white"
                >
                  <X size={22} />
                </button>
              </div>

              {detailsCartEditor && (
                <datalist id="detail-cart-edit-models">
                  {uniqNonEmpty([...(detailsPrinter.cartridgeModels ?? []), ...allConsumableModelOptions]).map(m => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}

              <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-1 space-y-3">
                  <div className="p-3 bg-gray-50 rounded-xl text-sm space-y-2">
                    <div className="flex justify-between gap-3"><span className="text-gray-500">Тип</span><PrinterTypeBadge type={detailsPrinter.printerType} /></div>
                    <div className="flex justify-between gap-3"><span className="text-gray-500">Подразделение</span><strong className="text-right">{detailsPrinter.department || '—'}</strong></div>
                    <div className="flex justify-between gap-3"><span className="text-gray-500">Мат. отв.</span><strong className="text-right">{detailsPrinter.boss || '—'}</strong></div>
                    <div className="flex justify-between gap-3"><span className="text-gray-500">Дата ввода</span><strong>{detailsPrinter.commissionDate || '—'}</strong></div>
                    <div className="flex justify-between gap-3"><span className="text-gray-500">Стоимость</span><strong>{detailsPrinter.balanceCost || '—'}</strong></div>
                    {detailsPrinter.firmwareFlashed && (
                      <div className="flex justify-between gap-3 items-center pt-1 border-t border-gray-200">
                        <span className="text-gray-500">Прошивка</span>
                        <span
                          className="inline-block w-2 h-2 rounded-full bg-red-500 ring-2 ring-red-200"
                          title="Прошит"
                          aria-label="Прошит"
                        />
                      </div>
                    )}
                  </div>
                  {detailsPrinter.firmwareFlashed && store.settings.enableEventEditing && (
                    <button
                      type="button"
                      onClick={() => {
                        const snap = detailsPrinter;
                        setConfirmModal({
                          message: 'Снять отметку «прошит» у этого принтера? На этикетках переменная {fw} перестанет печататься.',
                          onConfirm: () => {
                            store.updatePrinter(snap.inventoryNumber, { firmwareFlashed: false });
                            setDetailsPrinter({ ...snap, firmwareFlashed: false });
                            setConfirmModal(null);
                            scheduleFocusPrintersSearch();
                          },
                        });
                      }}
                      className="w-full py-2 border border-amber-200 bg-amber-50 text-amber-900 rounded-lg text-sm font-semibold hover:bg-amber-100 flex items-center justify-center gap-2"
                    >
                      <RefreshCw size={14} />
                      Снять отметку прошивки
                    </button>
                  )}
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => { setDetailsCartEditor(null); setDetailsPrinter(null); openEdit(detailsPrinter); }}
                      className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50 flex items-center justify-center gap-1"
                    >
                      <Edit2 size={14} /> Редактировать
                    </button>
                    <button onClick={() => openAddCart(detailsPrinter.inventoryNumber)} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50 flex items-center justify-center gap-1">
                      <Plus size={14} /> Добавить картридж
                    </button>
                    <button onClick={() => setShowEmployeeModal(detailsPrinter.inventoryNumber)} className="py-2 border rounded-lg text-sm hover:bg-gray-50 flex items-center justify-center gap-1">
                      <Users size={15} /> Сотрудники
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-2 space-y-4">
                  <div>
                    <div className="text-xs uppercase text-gray-400 font-bold mb-2">Расходники ({carts.length})</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                      {carts.map(c => (
                        <div key={c.id} className="p-3 border rounded-xl bg-white hover:bg-gray-50">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => handlePrintCartridge(c.id)}
                              className="font-mono font-bold text-blue-700 hover:underline flex items-center gap-1"
                            >
                              <ColorDot color={c.color} /> {getConsumableLabel(c, carts)}
                            </button>
                            <div className="flex items-center gap-0.5">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isDisposedLike(c) ? 'bg-red-100 text-red-700' : STATUS_COLORS[cartridgeDisplayStatus(c)]}`}>{STATUS_LABELS[cartridgeDisplayStatus(c)]}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setDetailsCartEditor({
                                    id: c.id,
                                    model: c.model,
                                    writtenOff: isDisposedLike(c),
                                  });
                                }}
                                className="h-5 w-5 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 flex items-center justify-center"
                                title="Редактировать модель и списание"
                              >
                                <Edit2 size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDisposeCartridgeFromCard(c)}
                                className="h-5 w-5 rounded border border-red-200 text-red-600 hover:bg-red-50 text-[10px] font-bold"
                                title="Списать и удалить"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <div className="text-[10px] font-mono text-gray-400">ID: {c.id}</div>
                            <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer select-none" title="Этикетка напечатана">
                              <input
                                type="checkbox"
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-3 w-3 cursor-pointer"
                                checked={!!c.labelPrinted}
                                onChange={e => {
                                  store.updateCartridge(c.id, { labelPrinted: e.target.checked });
                                }}
                              />
                              <span>Этикетка напечатана</span>
                            </label>
                          </div>
                          {detailsCartEditor?.id === c.id ? (
                            <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
                              <label className="text-[10px] text-gray-500 block">Модель</label>
                              <input
                                className="w-full p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                value={detailsCartEditor.model}
                                onChange={e => setDetailsCartEditor({ ...detailsCartEditor, model: e.target.value })}
                                list="detail-cart-edit-models"
                              />
                              <label className={`flex items-center gap-2 text-xs text-gray-700 select-none ${c.isReplaced ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
                                <input
                                  type="checkbox"
                                  className="rounded border-gray-300"
                                  checked={detailsCartEditor.writtenOff}
                                  disabled={!!c.isReplaced}
                                  onChange={e => setDetailsCartEditor({ ...detailsCartEditor, writtenOff: e.target.checked })}
                                />
                                Списан
                              </label>
                              {c.isReplaced && (
                                <p className="text-[10px] text-amber-700 leading-snug">
                                  Заменён на новый — галочку «Списан» нельзя снять здесь; модель можно поправить.
                                </p>
                              )}
                              <div className="flex gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setDetailsCartEditor(null)}
                                  className="flex-1 py-1.5 border rounded-lg text-xs hover:bg-gray-50"
                                >
                                  Отмена
                                </button>
                                <button
                                  type="button"
                                  onClick={handleSaveDetailsCartEdit}
                                  className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700"
                                >
                                  Сохранить
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="text-sm text-gray-700 mt-1">{c.model || 'Без модели'}</div>
                              <div className="text-xs text-gray-400">{c.consumableType === 'drum' ? 'Драм' : 'Картридж'} · заправок: {c.refillCount}</div>
                            </>
                          )}
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
                      className={`flex-1 py-2 rounded-lg border text-sm font-bold transition-colors ${
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
                    list={
                      f.key === 'model'
                        ? 'printer-model-options'
                        : f.key === 'department'
                          ? 'printer-department-options'
                          : f.key === 'boss'
                            ? 'printer-boss-options'
                            : undefined
                    }
                    className="w-full p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    value={(newPrinter as unknown as Record<string, string>)[f.key] ?? ''}
                    onChange={e => setNewPrinter({ ...newPrinter, [f.key]: e.target.value } as Printer)}
                  />
                </div>
              ))}

              <datalist id="printer-model-options">
                {sortByPrefixMatch(modelOptions, newPrinter.model).map(v => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              <datalist id="printer-department-options">
                {sortByPrefixMatch(departmentOptions, newPrinter.department).map(v => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              <datalist id="printer-boss-options">
                {sortByPrefixMatch(bossOptions, newPrinter.boss).map(v => (
                  <option key={v} value={v} />
                ))}
              </datalist>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Модели картриджей / расходников (через запятую)</label>
                <input
                  placeholder="CF283A, CF283X, ..."
                  list="printer-consumable-model-options"
                  className="w-full p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={cartridgeModelsText}
                  onChange={e => {
                    setCartridgeModelsTouched(true);
                    setCartridgeModelsText(e.target.value);
                  }}
                />
                <datalist id="printer-consumable-model-options">
                  {sortByPrefixMatch(
                    suggestedConsumablesByPrinterModel.length > 0
                      ? [...suggestedConsumablesByPrinterModel, ...allConsumableModelOptions]
                      : allConsumableModelOptions,
                    cartridgeModelsText.split(',').pop() ?? '',
                    20,
                  ).map(v => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </div>

              <label
                className={`flex items-start gap-2 text-sm rounded-lg border p-3 ${
                  !!editPrinter?.firmwareFlashed && !store.settings.enableEventEditing
                    ? 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed'
                    : 'border-purple-100 bg-purple-50/50 text-gray-800 cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-gray-300 shrink-0"
                  checked={
                    (!!editPrinter?.firmwareFlashed && !store.settings.enableEventEditing) ||
                    !!newPrinter.firmwareFlashed
                  }
                  disabled={!!editPrinter?.firmwareFlashed && !store.settings.enableEventEditing}
                  onChange={e => setNewPrinter({ ...newPrinter, firmwareFlashed: e.target.checked })}
                />
                <span>
                  Принтер прошит (прошивка выполнена)
                  {!!editPrinter?.firmwareFlashed && !store.settings.enableEventEditing && (
                    <span className="block text-xs text-gray-400 mt-0.5">
                      Снять отметку можно только при включённой настройке «Разрешить редактирование/отмену событий» (Настройки → Приложение).
                    </span>
                  )}
                  {!!editPrinter?.firmwareFlashed && store.settings.enableEventEditing && (
                    <span className="block text-xs text-gray-500 mt-0.5">
                      Можно снять галочку здесь, кнопкой в карточке устройства или сняв отметку перед сохранением.
                    </span>
                  )}
                </span>
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
                      className={`flex-1 py-2 rounded-lg border text-xs font-bold transition-colors ${
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
                {addCart.fromWarehouse ? (
                  (() => {
                    const printer = store.printers.find(p => p.inventoryNumber === addCart.printerInv);
                    const printerModels = printer?.cartridgeModels ?? [];
                    const warehouseItems = store.newCartridges.filter(c => c.quantity > 0);
                    const sortedWarehouseItems = [...warehouseItems].sort((a, b) => {
                      const aMatch = printerModels.some(m => m.toLowerCase() === a.model.toLowerCase());
                      const bMatch = printerModels.some(m => m.toLowerCase() === b.model.toLowerCase());
                      if (aMatch && !bMatch) return -1;
                      if (!aMatch && bMatch) return 1;
                      return a.model.localeCompare(b.model);
                    });

                    return (
                      <select
                        required
                        className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium"
                        value={addCart.model}
                        onChange={e => setAddCart({ ...addCart, model: e.target.value })}
                      >
                        <option value="">-- Выберите модель со склада --</option>
                        {sortedWarehouseItems.map(item => {
                          const isRelevant = printerModels.some(m => m.toLowerCase() === item.model.toLowerCase());
                          return (
                            <option key={item.id} value={item.model}>
                              {item.model} {isRelevant ? '★' : ''} (доступно: {item.quantity} шт.)
                            </option>
                          );
                        })}
                      </select>
                    );
                  })()
                ) : (
                  <>
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
                  </>
                )}
              </div>

              <div className="flex items-center space-x-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                <input
                  type="checkbox"
                  id="fromWarehouseCheckbox"
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
                  checked={!!addCart.fromWarehouse}
                  onChange={e => {
                    const checked = e.target.checked;
                    const printer = store.printers.find(p => p.inventoryNumber === addCart.printerInv);
                    const printerModels = printer?.cartridgeModels ?? [];
                    let nextModel = '';

                    if (checked) {
                      const warehouseItems = store.newCartridges.filter(c => c.quantity > 0);
                      const sortedWarehouseItems = [...warehouseItems].sort((a, b) => {
                        const aMatch = printerModels.some(m => m.toLowerCase() === a.model.toLowerCase());
                        const bMatch = printerModels.some(m => m.toLowerCase() === b.model.toLowerCase());
                        if (aMatch && !bMatch) return -1;
                        if (!aMatch && bMatch) return 1;
                        return a.model.localeCompare(b.model);
                      });
                      nextModel = sortedWarehouseItems[0]?.model ?? '';
                    } else {
                      nextModel = printerModels[0] ?? '';
                    }

                    setAddCart({
                      ...addCart,
                      fromWarehouse: checked,
                      model: nextModel,
                    });
                  }}
                />
                <label htmlFor="fromWarehouseCheckbox" className="text-xs text-gray-700 cursor-pointer select-none font-semibold">
                  со склада
                </label>
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Цвет</label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setAddCart({ ...addCart, color: undefined })}
                    className={`px-2 py-1 rounded border text-xs ${!addCart.color ? 'bg-gray-800 text-white' : 'bg-white text-gray-500'}`}
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
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onMouseDown={e => {
            if (e.target !== e.currentTarget) return;
            setEditCartridgeId(null);
            setEditPin('');
            setCartPrintStatus(null);
            scheduleFocusPrintersSearch();
          }}
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl" onMouseDown={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold">Редактировать расходник</h2>
              <button
                type="button"
                onClick={() => { setEditCartridgeId(null); setCartPrintStatus(null); scheduleFocusPrintersSearch(); }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
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
                    className={`px-2 py-1 rounded border text-xs ${!editCartridgeColor ? 'bg-gray-800 text-white' : 'bg-white text-gray-500'}`}
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
                <button
                  type="button"
                  onClick={() => { setEditCartridgeId(null); setCartPrintStatus(null); scheduleFocusPrintersSearch(); }}
                  className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50"
                >
                  Отмена
                </button>
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

      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          dangerous={confirmModal.dangerous}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => { setConfirmModal(null); scheduleFocusPrintersSearch(); }}
        />
      )}
      {alertModal && (
        <AlertModal
          message={alertModal.message}
          variant={alertModal.variant}
          onClose={() => { setAlertModal(null); scheduleFocusPrintersSearch(); }}
        />
      )}
    </div>
  );
};

export default PrintersTab;
