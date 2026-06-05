import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Package,
  Truck,
  CheckSquare,
  Download,
  Calendar,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Plus,
  Database,
  Info,
  UserCheck,
  RotateCcw,
  AlertTriangle,
  Edit3,
  Trash2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { RefillBatchItem } from '../types';
import type {
  WarehouseItem,
  WarehouseBatchItem,
  WarehouseShipmentBatch,
} from '../types/warehouseLedger';
import { StoreType } from '../store';
import {
  mergeLedgerWithStore,
  nextShipmentBatchId,
  buildLegacyRefillBatch,
  newAuditEntry,
} from '../utils/warehouseStoreBridge';
import {
  warehouseBatchInfoRow,
  warehouseItemsToExcelRows,
  warehouseShipmentBatchToExcelRows,
} from '../utils/excelWarehouseExport';

/** Устройства сверху, под ними картриджи/драмы с тем же parentDeviceId; остальное в исходном порядке. */
function sortStockRowsForDisplay<T extends { id: string; type: string; parentDeviceId?: string }>(
  rows: T[],
): T[] {
  const devices = rows.filter(i => i.type === 'Устройство');
  const used = new Set<string>();
  const out: T[] = [];

  for (const d of devices) {
    if (used.has(d.id)) continue;
    used.add(d.id);
    out.push(d);
    const kids = rows
      .filter(i => i.parentDeviceId === d.id && !used.has(i.id))
      .sort((a, b) => a.id.localeCompare(b.id, 'ru'));
    for (const k of kids) {
      used.add(k.id);
      out.push(k);
    }
  }
  for (const i of rows) {
    if (!used.has(i.id)) {
      used.add(i.id);
      out.push(i);
    }
  }
  return out;
}

/** Подпись «кто отправил» + комментарий к отправке в скобках (если был). */
function formatBatchSenderWithNotes(batch: WarehouseShipmentBatch): string {
  const note = batch.notes?.trim();
  return note ? `${batch.sender} (${note})` : batch.sender;
}

/** Тип позиции на складе — окраска как у типа устройства во вкладке «Принтеры» (МФУ/Принтер/прочее). */
function WarehouseItemTypeBadge({ type }: { type: string }) {
  if (type === 'Устройство') {
    return (
      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-purple-100 text-purple-700">Устройство</span>
    );
  }
  if (type === 'Картридж') {
    return (
      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-100 text-blue-700">Картридж</span>
    );
  }
  if (type === 'Драм-картридж') {
    return (
      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-800">Драм-картридж</span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-teal-100 text-teal-700">{type}</span>
  );
}

/** Для устройств «0 заправок» не показываем — в колонке прочерк. */
function warehouseRefillCell(
  item: WarehouseItem,
  variant: 'muted' | 'ready',
): React.ReactNode {
  const n = item.refillCount ?? 0;
  if (item.type === 'Устройство' && n === 0) {
    return <span className="text-slate-400">—</span>;
  }
  if (variant === 'ready') {
    return <span className="font-bold font-mono text-emerald-600">{n}</span>;
  }
  return n;
}

const warehouseTableClasses = 'w-full text-left text-xs border border-slate-200 border-collapse';
const warehouseThClasses = 'px-2 py-1.5 font-semibold text-left border-b border-slate-200 bg-gray-50 text-slate-600';
const warehouseTdClasses = 'px-2 py-1.5 border-b border-slate-200 align-middle';

export type WarehouseFocusSection = 'waiting' | 'at_refill' | 'ready';

export type WarehouseFocusRequest = { section: WarehouseFocusSection; tick: number };

type WarehouseInventoryPanelProps = {
  store: StoreType;
  focusRequest?: WarehouseFocusRequest | null;
  onFocusRequestHandled?: () => void;
};

const HIGHLIGHT_RING = ['ring-2', 'ring-blue-400', 'ring-offset-2', 'rounded-xl'] as const;

const WarehouseInventoryPanel: React.FC<WarehouseInventoryPanelProps> = ({
  store,
  focusRequest,
  onFocusRequestHandled,
}) => {
  const { warehouseLedger, setWarehouseLedger } = store;

  const items = useMemo(
    () => mergeLedgerWithStore(warehouseLedger, store.cartridges, store.repairs, store.printers),
    [warehouseLedger, store.cartridges, store.repairs, store.printers],
  );

  const batches = warehouseLedger.shipmentBatches;
  const logs = warehouseLedger.auditLogs;

  const updateMergedItems = useCallback(
    (fn: (m: WarehouseItem[]) => WarehouseItem[]) => {
      setWarehouseLedger(prev => {
        const merged = mergeLedgerWithStore(prev, store.cartridges, store.repairs, store.printers);
        return { ...prev, items: fn(merged) };
      });
    },
    [setWarehouseLedger, store.cartridges, store.repairs, store.printers],
  );

  const patchShipmentBatches = useCallback(
    (fn: (b: WarehouseShipmentBatch[]) => WarehouseShipmentBatch[]) => {
      setWarehouseLedger(prev => ({ ...prev, shipmentBatches: fn(prev.shipmentBatches) }));
    },
    [setWarehouseLedger],
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWaitingIds, setSelectedWaitingIds] = useState<Set<string>>(new Set());
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('warehouse_expanded_batches');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  // --- Редактирование ячеек "на лету" ---
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'submittedBy' | 'whoPickedUp' | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // --- Формы и диалоги ---
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendSender, setSendSender] = useState('Спиркин');
  const [sendNotes, setSendNotes] = useState('');

  const [showIssueDialog, setShowIssueDialog] = useState<{ itemId: string; batchId?: string } | null>(null);
  const [issueRecipient, setIssueRecipient] = useState('');

  const [showReplaceDialog, setShowReplaceDialog] = useState<{ oldItemId: string; batchId: string } | null>(null);
  const [replacementModel, setReplacementModel] = useState('');

  type CompletionDialogItem = {
    batchId: string;
    itemId: string;
    printerInv: string;
    printerModel: string;
  };

  const [showCompletionDialog, setShowCompletionDialog] = useState<CompletionDialogItem | null>(null);
  const [completionQueue, setCompletionQueue] = useState<CompletionDialogItem[]>([]);
  const [completionSolution, setCompletionSolution] = useState('');
  const [bulkReceiveBatchId, setBulkReceiveBatchId] = useState<string | null>(null);
  const [bulkDeviceTotal, setBulkDeviceTotal] = useState(0);

  // --- Форма быстрого приема на склад ---
  const [newType, setNewType] = useState<'Устройство' | 'Картридж' | 'Драм-картридж'>('Картридж');
  const [newModel, setNewModel] = useState('');
  const [newInv, setNewInv] = useState('');
  const [newPrinterModel, setNewPrinterModel] = useState('');
  const [newDept, setNewDept] = useState('');
  const [newSubmitted, setNewSubmitted] = useState('');
  const [newParentId, setNewParentId] = useState('');

  useEffect(() => {
    const onScan = (event: Event) => {
      setSearchQuery((event as CustomEvent<string>).detail);
    };
    window.addEventListener('app-scanner-input', onScan as EventListener);
    return () => window.removeEventListener('app-scanner-input', onScan as EventListener);
  }, []);

  const addLog = (action: string, details: string, type: 'info' | 'success' | 'warning' | 'danger' = 'info', user = 'Администратор') => {
    const newEntry = newAuditEntry(action, details, type, user);
    setWarehouseLedger(prev => ({ ...prev, auditLogs: [newEntry, ...prev.auditLogs] }));
  };

  // --- Сброс базы ---
  const handleResetData = () => {
    if (window.confirm(
      'Очистить реестр вкладки «Склад» (позиции, все партии и журнал)? Принтеры и расходники из основной базы не удаляются; позиции на приёмной снова подтянутся из статусов.',
    )) {
      setWarehouseLedger(prev => ({
        ...prev,
        items: [],
        shipmentBatches: [],
        auditLogs: [],
      }));
      setSelectedWaitingIds(new Set());
      setExpandedBatchIds(new Set());
      addLog('Сброс реестра склада', 'Очищены данные вкладки «Склад». При необходимости повторите синхронизацию из приёмной.', 'warning');
    }
  };

  // --- Сохранение быстрого редактирования ячейки ---
  const handleSaveCellEdit = (itemId: string, field: 'submittedBy' | 'whoPickedUp') => {
    const updatedVal = editingValue.trim();
    if (!updatedVal) {
      setEditingItemId(null);
      return;
    }

    const cart = store.cartridges.find(c => c.id === itemId);
    const row = items.find(i => i.id === itemId);
    if (field === 'submittedBy') {
      if (cart) store.updateCartridge(itemId, { lastSubmittedBy: updatedVal });
      if (row?.repairId) store.updateRepair(row.repairId, { technician: updatedVal });
    }

    const childIdsForDevice =
      field === 'whoPickedUp' && row?.type === 'Устройство'
        ? items.filter(i => i.parentDeviceId === itemId).map(i => i.id)
        : [];

    // 1. Обновляем глобальный склад
    updateMergedItems(prev =>
      prev.map(i => {
        if (i.id === itemId || childIdsForDevice.includes(i.id)) {
          return { ...i, [field]: updatedVal };
        }
        return i;
      }),
    );

    // 2. Обновляем снимки во всех партиях, чтобы история не расходилась
    patchShipmentBatches(prev =>
      prev.map(b => {
        const updatedItems = b.items.map(item => {
          if (item.id === itemId || childIdsForDevice.includes(item.id)) {
            return { ...item, [field]: updatedVal };
          }
          return item;
        });
        return { ...b, items: updatedItems };
      }),
    );

    addLog(
      'Редактирование ячейки',
      childIdsForDevice.length > 0 && field === 'whoPickedUp'
        ? `Поле «${field}» для устройства ${itemId} и связанных расходников (${childIdsForDevice.length} шт.) изменено на «${updatedVal}».`
        : `Поле "${field}" для элемента ${itemId} изменено на "${updatedVal}". Все привязанные снимки в партиях обновлены автоматически.`,
      'info',
    );

    setEditingItemId(null);
    setEditingField(null);
  };

  const handleRegisterIntake = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newModel) {
      alert('Пожалуйста, укажите модель!');
      return;
    }

    if (newType === 'Устройство') {
      alert(
        'Устройство примите через «Приёмная панель» (создаётся заявка на ремонт). Здесь отображаются уже принятые позиции.',
      );
      return;
    }

    const invRaw = (newInv || '').trim() || '—';
    const consumableType = newType === 'Драм-картридж' ? 'drum' as const : 'cartridge' as const;
    const slot = store.allocateConsumableSlot(invRaw, consumableType);
    const id = store.generateConsumableId(consumableType, invRaw === '—' ? undefined : invRaw, slot);
    const printer = store.printers.find(p => p.inventoryNumber === invRaw);
    const submitted = (newSubmitted || 'Не указан').trim();

    const cart = {
      id,
      barcode: id,
      model: newModel,
      consumableType,
      printerInventoryNumber: invRaw,
      status: 'waiting' as const,
      history: [],
      refillCount: 0,
      registrationDate: new Date().toISOString(),
      lastSubmittedBy: submitted,
      consumableSlot: slot,
    };
    store.addCartridge(cart);
    addLog(
      'Регистрация на склад',
      `Принят расходник ${newModel} (ID: ${id}). Сдал: ${submitted} (${newDept || printer?.department || 'Общий отдел'})`,
      'info',
    );

    setNewModel('');
    setNewInv('');
    setNewPrinterModel('');
    setNewDept('');
    setNewSubmitted('');
    setNewParentId('');
  };

  // Автогенерация тестовых данных
  const handleQuickFill = (type: 'Устройство' | 'Картридж') => {
    setNewModel(type === 'Устройство' ? 'Canon FC-228' : 'Canon C-EXV 42');
    setNewInv('11668');
    setNewPrinterModel('Canon FC-228');
    setNewDept('ОП11');
    setNewSubmitted('Савельев');
  };

  // --- ОТПРАВКА ПАРТИИ (Спиркин) ---
  const handleConfirmSendBatch = () => {
    const waitingList = items.filter(i => i.status === 'waiting');
    const baseSelected =
      selectedWaitingIds.size > 0
        ? waitingList.filter(i => selectedWaitingIds.has(i.id))
        : waitingList;

    const idSet = new Set(baseSelected.map(i => i.id));
    for (const row of baseSelected) {
      if (row.type === 'Устройство') {
        for (const w of waitingList) {
          if (w.parentDeviceId === row.id) idSet.add(w.id);
        }
      }
    }
    const itemsToShip = waitingList.filter(i => idSet.has(i.id));

    if (itemsToShip.length === 0) {
      alert('Нет элементов, готовых к отправке!');
      return;
    }

    const batchId = nextShipmentBatchId(batches);

    const snapshotItems: WarehouseBatchItem[] = itemsToShip.map(item => ({
      id: item.id,
      type: item.type,
      model: item.model,
      printerInventoryNumber: item.printerInventoryNumber,
      printerModel: item.printerModel,
      department: item.department,
      submittedBy: item.submittedBy,
      refillCount: item.refillCount,
      status: 'at_refill',
      parentDeviceId: item.parentDeviceId,
      repairId: item.repairId,
    }));

    const newBatch: WarehouseShipmentBatch = {
      id: batchId,
      dateSent: new Date().toISOString(),
      sender: sendSender || 'Спиркин',
      notes: sendNotes || undefined,
      status: 'sent',
      items: snapshotItems,
    };

    const legacyCartridgeIds: string[] = [];
    const legacyItems: RefillBatchItem[] = [];
    const senderName = sendSender?.trim();

    for (const item of itemsToShip) {
      if (item.type === 'Устройство') {
        const repair = item.repairId
          ? store.repairs.find(r => r.id === item.repairId)
          : store.repairs.find(
              r =>
                r.printerInventoryNumber === item.printerInventoryNumber &&
                (r.status === 'waiting' || r.status === 'in_repair'),
            );
        const printer = store.printers.find(
          p => p.inventoryNumber === item.printerInventoryNumber || p.programId === item.id,
        );
        if (repair) {
          legacyItems.push({
            kind: 'printer',
            id: item.id,
            printerInventoryNumber: repair.printerInventoryNumber,
            repairId: repair.id,
          });
          store.updateRepair(repair.id, { status: 'in_repair', locationStatus: 'at_refill' });
          store.addRefillLog({
            id: Math.random().toString(36).substring(2, 11),
            date: new Date().toISOString(),
            cartridgeId: printer?.programId ?? repair.printerInventoryNumber,
            cartridgeModel: printer?.model ?? 'Устройство',
            consumableType: 'device',
            deviceType: printer?.printerType ?? 'Устройство',
            serviceType: 'Ремонт',
            printerInventoryNumber: repair.printerInventoryNumber,
            printerModel: printer?.model ?? '',
            department: printer?.department ?? '',
            employee: senderName || undefined,
            action: senderName
              ? `Принтер отправлен в ремонт (${senderName}). Партия ${batchId}`
              : `Принтер отправлен в ремонт. Партия ${batchId}`,
            is_technical: false,
          });
        }
      } else {
        const c = store.cartridges.find(x => x.id === item.id);
        if (c) {
          legacyCartridgeIds.push(item.id);
          legacyItems.push({
            kind: 'cartridge',
            id: item.id,
            printerInventoryNumber: item.printerInventoryNumber,
          });
          const printer = store.printers.find(p => p.inventoryNumber === c.printerInventoryNumber);
          store.updateCartridgeStatus(
            item.id,
            'at_refill',
            `Отправлен на заправку. Партия ${batchId}`,
            senderName || undefined,
          );
          store.addRefillLog({
            id: Math.random().toString(36).substring(2, 11),
            date: new Date().toISOString(),
            cartridgeId: c.id,
            cartridgeModel: c.model,
            consumableType: c.consumableType ?? 'cartridge',
            deviceType: c.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
            serviceType: 'Заправка',
            printerInventoryNumber: c.printerInventoryNumber,
            printerModel: printer?.model ?? '',
            department: printer?.department ?? '',
            employee: senderName || undefined,
            action: senderName
              ? `Картридж отправлен на заправку (${senderName}). Партия ${batchId}`
              : `Картридж отправлен на заправку. Партия ${batchId}`,
            is_technical: false,
          });
        }
      }
    }

    const legacy = buildLegacyRefillBatch(batchId, sendSender, sendNotes, legacyCartridgeIds, legacyItems);
    store.setBatches(prev => [...prev, legacy]);

    updateMergedItems(prev =>
      prev.map(i => {
        const match = itemsToShip.find(x => x.id === i.id);
        if (match) {
          return { ...i, status: 'at_refill', currentBatchId: batchId };
        }
        return i;
      }),
    );

    patchShipmentBatches(prev => [...prev, newBatch]);
    setSelectedWaitingIds(new Set());
    setShowSendDialog(false);
    setSendNotes('');
    setExpandedBatchIds(prev => new Set(prev).add(batchId));

    addLog(
      'Отправка в ремонт/заправку',
      `Партия ${batchId} отправлена заправщику. Отправил: ${newBatch.sender}. Позиций: ${snapshotItems.length} шт.`,
      'success',
      newBatch.sender,
    );
  };

  const executeReceivePrinter = (batchId: string, itemId: string, solution: string) => {
    const batchSnap = batches.find(b => b.id === batchId);
    const line = batchSnap?.items.find(i => i.id === itemId);
    if (!line || line.type !== 'Устройство' || !line.repairId) return;

    const repair = store.repairs.find(r => r.id === line.repairId);
    const printer = store.printers.find(p => p.inventoryNumber === line.printerInventoryNumber);
    if (repair) {
      store.updateRepair(repair.id, {
        status: 'repaired',
        completionDate: new Date().toISOString(),
        repairDescription: solution.trim() || 'Принят с заправки',
        locationStatus: 'ready',
      });
      store.cartridges
        .filter(c => c.linkedRepairId === repair.id && c.status === 'at_refill')
        .forEach(c => {
          store.updateCartridgeStatus(
            c.id,
            'received_from_refill',
            `Получен с заправки вместе с принтером. Партия ${batchId}`,
          );
        });
      if (printer) {
        store.updatePrinter(printer.inventoryNumber, { refillCount: (printer.refillCount ?? 0) + 1 });
      }
      store.addRefillLog({
        id: Math.random().toString(36).substring(2, 11),
        date: new Date().toISOString(),
        cartridgeId: printer?.programId ?? line.printerInventoryNumber,
        cartridgeModel: printer?.model ?? 'Устройство',
        consumableType: 'device',
        deviceType: printer?.printerType ?? 'Устройство',
        serviceType: 'Ремонт',
        printerInventoryNumber: line.printerInventoryNumber,
        printerModel: printer?.model ?? '',
        department: printer?.department ?? '',
        employee: printer?.boss,
        action: `Принтер получен с ремонта. Решение: ${solution}`,
        is_technical: false,
      });
    }

    const childSnapshotIds = batchSnap
      ? batchSnap.items.filter(i => i.parentDeviceId === itemId && i.status === 'at_refill').map(i => i.id)
      : [];

    patchShipmentBatches(prev =>
      prev.map(b => {
        if (b.id !== batchId) return b;
        const updated = b.items.map(item => {
          if (item.status !== 'at_refill') return item;
          if (item.id === itemId) {
            return { ...item, status: 'ready' as const, refillCount: item.refillCount + 1 };
          }
          if (item.parentDeviceId === itemId) {
            return { ...item, status: 'ready' as const, refillCount: item.refillCount + 1 };
          }
          return item;
        });
        const hasAtRefill = updated.some(i => i.status === 'at_refill');
        return {
          ...b,
          status: hasAtRefill ? b.status : ('received' as const),
          dateReceived: hasAtRefill ? b.dateReceived : new Date().toISOString(),
          items: updated,
        };
      }),
    );

    updateMergedItems(prev =>
      prev.map(i => {
        if (i.status !== 'at_refill') return i;
        if (i.id === itemId || childSnapshotIds.includes(i.id)) {
          return { ...i, status: 'ready', refillCount: i.refillCount + 1 };
        }
        return i;
      }),
    );

    if (batchSnap) {
      const simulatedItems = batchSnap.items.map(item => {
        if (item.status !== 'at_refill') return item;
        if (item.id === itemId) {
          return { ...item, status: 'ready' as const, refillCount: item.refillCount + 1 };
        }
        if (item.parentDeviceId === itemId) {
          return { ...item, status: 'ready' as const, refillCount: item.refillCount + 1 };
        }
        return item;
      });
      const hasAtRefill = simulatedItems.some(i => i.status === 'at_refill');
      store.setWarehouseLedger(prev => {
        return {
          ...prev,
          items: prev.items.map(item => {
            if (item.id === itemId || childSnapshotIds.includes(item.id)) {
              return { ...item, status: 'ready' as const, refillCount: item.refillCount + 1 };
            }
            return item;
          }),
          shipmentBatches: prev.shipmentBatches.map(b => {
            if (b.id !== batchId) return b;
            return {
              ...b,
              status: hasAtRefill ? b.status : ('received' as const),
              dateReceived: hasAtRefill ? b.dateReceived : new Date().toISOString(),
              items: simulatedItems,
            };
          }),
        };
      });

      const hasAtRefillLegacy = simulatedItems.some(i => i.status === 'at_refill');
      store.setBatches(pb =>
        pb.map(b => (b.id === batchId ? { ...b, status: hasAtRefillLegacy ? 'sent' : 'received' } : b)),
      );
    }

    addLog('Получен с ремонта/заправки', `Устройство ${itemId} принято с ремонта. Решение: ${solution}`);
  };

  const receiveCartridgeFromBatch = (batchId: string, itemId: string) => {
    const batchSnap = batches.find(b => b.id === batchId);
    const cartridge = store.cartridges.find(c => c.id === itemId);
    store.updateCartridgeStatus(itemId, 'received_from_refill', `Получен с заправки. Партия ${batchId}`);
    if (cartridge) {
      const printer = store.printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
      store.addRefillLog({
        id: Math.random().toString(36).substring(2, 11),
        date: new Date().toISOString(),
        cartridgeId: cartridge.id,
        cartridgeModel: cartridge.model,
        consumableType: cartridge.consumableType ?? 'cartridge',
        deviceType: cartridge.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
        serviceType: 'Заправка',
        printerInventoryNumber: cartridge.printerInventoryNumber,
        printerModel: printer?.model ?? '',
        department: printer?.department ?? '',
        employee: printer?.boss,
        action: `Картридж получен с заправки. Партия ${batchId}`,
        is_technical: false,
      });
    }

    patchShipmentBatches(prev =>
      prev.map(b => {
        if (b.id !== batchId) return b;
        const updated = b.items.map(item => {
          if (item.status !== 'at_refill') return item;
          if (item.id === itemId) {
            return { ...item, status: 'ready' as const, refillCount: item.refillCount + 1 };
          }
          return item;
        });
        const hasAtRefill = updated.some(i => i.status === 'at_refill');
        return {
          ...b,
          status: hasAtRefill ? b.status : ('received' as const),
          dateReceived: hasAtRefill ? b.dateReceived : new Date().toISOString(),
          items: updated,
        };
      }),
    );

    updateMergedItems(prev =>
      prev.map(i => {
        if (i.status !== 'at_refill') return i;
        if (i.id === itemId) {
          return { ...i, status: 'ready', refillCount: i.refillCount + 1 };
        }
        return i;
      }),
    );

    if (batchSnap) {
      const simulatedItems = batchSnap.items.map(item => {
        if (item.status !== 'at_refill') return item;
        if (item.id === itemId) {
          return { ...item, status: 'ready' as const, refillCount: item.refillCount + 1 };
        }
        return item;
      });
      const hasAtRefillLegacy = simulatedItems.some(i => i.status === 'at_refill');
      store.setBatches(pb =>
        pb.map(b => (b.id === batchId ? { ...b, status: hasAtRefillLegacy ? 'sent' : 'received' } : b)),
      );
    }
  };

  const cancelCompletionFlow = () => {
    setShowCompletionDialog(null);
    setCompletionQueue([]);
    setCompletionSolution('');
    setBulkReceiveBatchId(null);
    setBulkDeviceTotal(0);
  };

  const confirmCompletionFlow = () => {
    if (!showCompletionDialog || !completionSolution.trim()) return;
    executeReceivePrinter(
      showCompletionDialog.batchId,
      showCompletionDialog.itemId,
      completionSolution,
    );
    setCompletionSolution('');

    if (completionQueue.length > 0) {
      const [next, ...rest] = completionQueue;
      setCompletionQueue(rest);
      setShowCompletionDialog(next);
      return;
    }

    setShowCompletionDialog(null);
    if (bulkReceiveBatchId) {
      addLog(
        'Получение партии',
        `Все элементы партии ${bulkReceiveBatchId} успешно приняты с заправки и переведены в статус "Готов к выдаче".`,
        'success',
      );
      setBulkReceiveBatchId(null);
      setBulkDeviceTotal(0);
    }
  };

  // --- ПРИЕМКА С ЗАПРАВКИ ---
  const handleReceiveItem = (batchId: string, itemId: string) => {
    const batchSnap = batches.find(b => b.id === batchId);
    const line = batchSnap?.items.find(i => i.id === itemId);

    if (line?.type === 'Устройство' && line.repairId) {
      const printer = store.printers.find(p => p.inventoryNumber === line.printerInventoryNumber);
      setCompletionQueue([]);
      setBulkReceiveBatchId(null);
      setBulkDeviceTotal(0);
      setShowCompletionDialog({
        batchId,
        itemId,
        printerInv: line.printerInventoryNumber,
        printerModel: printer?.model ?? 'Устройство',
      });
      return;
    }

    receiveCartridgeFromBatch(batchId, itemId);
    addLog(
      'Прием элемента',
      `Элемент ${itemId} успешно получен с заправки и готов к выдаче. Количество заправок увеличилось.`,
      'info',
    );
  };

  const handleReceiveFullBatch = (batchId: string) => {
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return;

    const atRefill = batch.items.filter(i => i.status === 'at_refill');
    const devices = atRefill.filter(i => i.type === 'Устройство' && i.repairId);
    const deviceIds = new Set(devices.map(d => d.id));

    const standaloneCartridges = atRefill.filter(
      i => i.type !== 'Устройство' && (!i.parentDeviceId || !deviceIds.has(i.parentDeviceId)),
    );

    for (const line of standaloneCartridges) {
      receiveCartridgeFromBatch(batchId, line.id);
    }

    if (devices.length === 0) {
      addLog(
        'Получение партии',
        `Все элементы партии ${batchId} успешно приняты с заправки и переведены в статус "Готов к выдаче".`,
        'success',
      );
      return;
    }

    const deviceDialogs: CompletionDialogItem[] = devices.map(line => {
      const printer = store.printers.find(p => p.inventoryNumber === line.printerInventoryNumber);
      return {
        batchId,
        itemId: line.id,
        printerInv: line.printerInventoryNumber,
        printerModel: printer?.model ?? 'Устройство',
      };
    });

    setBulkReceiveBatchId(batchId);
    setBulkDeviceTotal(deviceDialogs.length);
    setCompletionQueue(deviceDialogs.slice(1));
    setCompletionSolution('');
    setShowCompletionDialog(deviceDialogs[0]);
  };

  // --- ВЫДАЧА НА РУКИ (Кто забрал?) ---
  const handleIssueItem = () => {
    if (!showIssueDialog) return;
    const { itemId, batchId } = showIssueDialog;
    const recipient = issueRecipient.trim() || 'Сотрудник';

    const row = items.find(i => i.id === itemId);
    const effectiveBatchId = batchId || row?.currentBatchId || '';

    const childIds =
      row?.type === 'Устройство'
        ? items.filter(i => i.parentDeviceId === itemId && i.status === 'ready').map(i => i.id)
        : [];
    const idsToIssue = [...new Set([itemId, ...childIds])];

    if (row?.type === 'Устройство' && row.repairId) {
      store.finishIssuePrinterBundleFromBatch(
        row.printerInventoryNumber,
        row.repairId,
        effectiveBatchId,
        recipient,
      );
    } else {
      store.finishIssueCartridgeFromBatch(itemId, effectiveBatchId || '—', recipient);
    }

    store.applyWarehouseIssueSnapshotFromDashboard(idsToIssue, recipient);

    addLog(
      'Выдача со склада',
      `Элемент ${itemId} выдан сотруднику ${recipient}.` +
        (childIds.length > 0
          ? ` Связанные расходники (${childIds.length} шт.) выданы вместе с принтером с тем же получателем.`
          : ''),
      'success',
    );

    setShowIssueDialog(null);
    setIssueRecipient('');
  };

  // --- ЗАМЕНА СЛОМАННОГО НА НОВЫЙ ---
  const handleReplaceItem = () => {
    if (!showReplaceDialog) return;
    const { oldItemId, batchId } = showReplaceDialog;

    const oldCart = store.cartridges.find(c => c.id === oldItemId);
    if (!oldCart) {
      alert('Расходник не найден в основной базе — замена только для зарегистрированных картриджей.');
      return;
    }
    const inv = oldCart.printerInventoryNumber;
    const consumableType = oldCart.consumableType ?? 'cartridge';
    const slot = store.allocateConsumableSlot(inv, consumableType);
    const newId = store.generateConsumableId(consumableType, inv || undefined, slot);
    const modelStr = replacementModel.trim() || 'Совместимый картридж (Новый)';

    const newCart = {
      ...oldCart,
      id: newId,
      barcode: newId,
      model: modelStr,
      consumableSlot: slot,
      status: 'received_from_refill' as const,
      refillCount: 0,
      registrationDate: new Date().toISOString(),
      isReplaced: false,
      replacedById: undefined,
      history: [
        ...oldCart.history,
        {
          id: Math.random().toString(36).substring(2, 11),
          date: new Date().toISOString(),
          action: `Заменён на новый вместо ${oldItemId}. Партия ${batchId}`,
        },
      ],
    };

    store.replaceCartridge(oldItemId, newCart, `Списан при замене на ${newId}. Партия ${batchId}`);
    store.setBatches(prev =>
      prev.map(batch => ({
        ...batch,
        cartridgeIds: (batch.cartridgeIds ?? []).map(id => (id === oldItemId ? newId : id)),
        items: (batch.items ?? []).map(item =>
          item.kind === 'cartridge' && item.id === oldItemId ? { ...item, id: newId } : item,
        ),
      })),
    );
    store.setEmployees(prev =>
      prev.map(e => (e.cartridgeId === oldItemId ? { ...e, cartridgeId: newId } : e)),
    );

    patchShipmentBatches(prev => prev.map(b => {
      if (b.id !== batchId) return b;
      const oldItemInfo = b.items.find(i => i.id === oldItemId);
      if (!oldItemInfo) return b;

      const updated = b.items.map(item => {
        if (item.id === oldItemId) {
          return { ...item, status: 'replaced' as const, replacementId: newId };
        }
        return item;
      });

      const replacedTypeLabel: WarehouseBatchItem['type'] =
        consumableType === 'drum' ? 'Драм-картридж' : 'Картридж';

      const newItemSnapshot: WarehouseBatchItem = {
        id: newId,
        type: replacedTypeLabel,
        model: modelStr,
        printerInventoryNumber: oldItemInfo.printerInventoryNumber,
        printerModel: oldItemInfo.printerModel,
        department: oldItemInfo.department,
        submittedBy: oldItemInfo.submittedBy,
        refillCount: 0,
        status: 'ready',
        parentDeviceId: oldItemInfo.parentDeviceId,
        fromReplacement: true,
      };

      return { ...b, items: [...updated, newItemSnapshot] };
    }));

    const oldRegItem = items.find(i => i.id === oldItemId);
    const regTypeLabel: WarehouseItem['type'] =
      consumableType === 'drum' ? 'Драм-картридж' : 'Картридж';

    const newRegItem: WarehouseItem = {
      id: newId,
      type: regTypeLabel,
      model: modelStr,
      printerInventoryNumber: oldRegItem?.printerInventoryNumber || '—',
      printerModel: oldRegItem?.printerModel || '—',
      department: oldRegItem?.department || '—',
      submittedBy: oldRegItem?.submittedBy || '—',
      refillCount: 0,
      status: 'ready',
      registrationDate: new Date().toISOString(),
      currentBatchId: batchId,
      parentDeviceId: oldRegItem?.parentDeviceId,
    };

    updateMergedItems(prev => {
      const filtered = prev.filter(i => i.id !== oldItemId);
      return [...filtered, newRegItem];
    });

    const printer = store.printers.find(p => p.inventoryNumber === newCart.printerInventoryNumber);
    store.addRefillLog({
      id: Math.random().toString(36).substring(2, 11),
      date: new Date().toISOString(),
      cartridgeId: oldItemId,
      cartridgeModel: oldCart.model,
      consumableType: oldCart.consumableType ?? 'cartridge',
      deviceType: oldCart.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
      serviceType: 'Списание',
      printerInventoryNumber: oldCart.printerInventoryNumber,
      printerModel: printer?.model ?? '',
      department: printer?.department ?? '',
      employee: printer?.boss,
      action: `Расходник списан при замене на ${newId} (${modelStr}). Партия ${batchId}`,
      is_technical: false,
    });
    store.addRefillLog({
      id: Math.random().toString(36).substring(2, 11),
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
      action: `Новый расходник ${newId} при замене в партии ${batchId} (было: ${oldItemId})`,
      is_technical: true,
    });

    addLog(
      'Замена расходника',
      `В партии ${batchId} списан изношенный картридж ${oldItemId}. Вместо него выдан НОВЫЙ ${newId} (${modelStr}). Первоначальный сдавший сотрудник сохранен.`,
      'warning'
    );

    setShowReplaceDialog(null);
    setReplacementModel('');
  };

  // --- ОТМЕНА ОТПРАВКИ ПАРТИИ ---
  const handleCancelBatch = (batchId: string) => {
    if (!window.confirm(`Вы уверены, что хотите отменить отправку партии ${batchId}?`)) return;

    const batch = batches.find(b => b.id === batchId);
    if (!batch) return;

    for (const line of batch.items) {
      if (line.type === 'Устройство' && line.repairId) {
        store.updateRepair(line.repairId, { status: 'waiting', locationStatus: 'waiting', completionDate: undefined });
      } else if (store.cartridges.some(c => c.id === line.id)) {
        store.updateCartridgeStatus(line.id, 'waiting', `Отмена партии ${batchId}`);
      }
    }

    store.setBatches(prev => prev.filter(b => b.id !== batchId));

    patchShipmentBatches(prev =>
      prev.map(b => (b.id === batchId ? { ...b, status: 'cancelled' as const } : b)),
    );

    const bItemIds = batch.items.map(i => i.id);
    updateMergedItems(prev =>
      prev.map(i => {
        if (bItemIds.includes(i.id)) {
          return { ...i, status: 'waiting', currentBatchId: undefined };
        }
        return i;
      }),
    );

    addLog(
      'Отмена партии',
      `Партия ${batchId} отменена (сохранена в истории отправок). Позиции возвращены в ожидание.`,
      'warning'
    );
  };

  const handleDeleteShipmentBatchRecord = (batchId: string) => {
    if (!window.confirm(`Удалить запись партии ${batchId} из списка истории? Данные о расходниках в основной базе не меняются.`)) return;
    patchShipmentBatches(prev => prev.filter(b => b.id !== batchId));
    addLog('Удаление из истории', `Партия ${batchId} удалена из списка на вкладке «Склад».`, 'warning');
  };

  // --- ОТМЕНА ПРИЕМА (Удаление неотправленного элемента) ---
  const handleCancelIntake = (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    if (item.parentDeviceId) return;

    if (item.type === 'Устройство' && item.repairId) {
      const childWaitingIds = items
        .filter(i => i.parentDeviceId === itemId && i.status === 'waiting')
        .map(i => i.id);
      childWaitingIds.forEach(cid => {
        const cc = store.cartridges.find(x => x.id === cid);
        if (cc?.status === 'waiting') store.cancelWaitingCartridgeIntake(cid);
      });
      store.cancelWaitingRepairIntake(item.repairId);
      updateMergedItems(prev =>
        prev.filter(i => i.id !== itemId && i.parentDeviceId !== itemId && !childWaitingIds.includes(i.id)),
      );
      setSelectedWaitingIds(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        childWaitingIds.forEach(id => next.delete(id));
        return next;
      });
      addLog(
        'Отмена приема',
        `Заявка ремонта и устройство с инв. ${item.printerInventoryNumber} сняты со склада; привязанные расходники возвращены на руки.`,
        'warning',
      );
      return;
    }

    const c = store.cartridges.find(x => x.id === itemId);
    if (c?.status === 'waiting') {
      store.cancelWaitingCartridgeIntake(itemId);
    }

    updateMergedItems(prev => prev.filter(i => i.id !== itemId));
    setSelectedWaitingIds(prev => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });

    addLog(
      'Отмена приема',
      `Прием элемента ${item.model} (ID: ${item.id}) отменен; расходник возвращён на руки, если был в основной базе.`,
      'warning'
    );
  };

  // Отрисовка стрелки вложенности
  const renderNestingArrow = () => (
    <span className="text-slate-400 mr-2 font-mono text-xs font-bold">↳</span>
  );

  // --- ЭКСПОРТ EXCEL ---
  const handleExportItemsExcel = (data: WarehouseItem[], fileName: string) => {
    const rows = warehouseItemsToExcelRows(data);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Склад');
    XLSX.writeFile(wb, `${fileName}_${new Date().toLocaleDateString('ru-RU').replace(/\./g, '-')}.xlsx`);
  };

  const handleExportBatchExcel = (batch: WarehouseShipmentBatch) => {
    const rows = warehouseShipmentBatchToExcelRows(batch);
    const info = warehouseBatchInfoRow(batch);

    const wb = XLSX.utils.book_new();
    const wsItems = XLSX.utils.json_to_sheet(rows);
    const wsInfo = XLSX.utils.json_to_sheet(info);
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Информация о партии');
    XLSX.utils.book_append_sheet(wb, wsItems, 'Содержимое');
    XLSX.writeFile(wb, `Партия_${batch.id}_Отчет.xlsx`);
  };

  // --- ФИЛЬТРЫ И ГРУППИРОВКА ---
  const filteredActiveItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return items;
    return items.filter(i =>
      i.id.toLowerCase().includes(q) ||
      i.model.toLowerCase().includes(q) ||
      i.printerInventoryNumber.toLowerCase().includes(q) ||
      i.printerModel.toLowerCase().includes(q) ||
      i.department.toLowerCase().includes(q) ||
      i.submittedBy.toLowerCase().includes(q) ||
      (i.whoPickedUp && i.whoPickedUp.toLowerCase().includes(q))
    );
  }, [items, searchQuery]);

  const filteredBatches = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return batches;
    return batches.filter(b =>
      b.id.toLowerCase().includes(q) ||
      b.sender.toLowerCase().includes(q) ||
      (b.notes && b.notes.toLowerCase().includes(q)) ||
      b.items.some(item =>
        item.id.toLowerCase().includes(q) ||
        item.model.toLowerCase().includes(q) ||
        item.submittedBy.toLowerCase().includes(q) ||
        (item.whoPickedUp && item.whoPickedUp.toLowerCase().includes(q))
      )
    );
  }, [batches, searchQuery]);

  const waitingItems = filteredActiveItems.filter(i => i.status === 'waiting');
  const waitingItemsOrdered = useMemo(() => sortStockRowsForDisplay(waitingItems), [waitingItems]);
  /** Только строки, которые можно включать в отправку (без привязанных к принтеру картриджей — едут вместе с устройством). */
  const waitingItemsShippable = useMemo(
    () => waitingItems.filter(i => !i.parentDeviceId),
    [waitingItems],
  );

  useEffect(() => {
    setSelectedWaitingIds(prev => {
      const allowed = new Set(waitingItemsShippable.map(i => i.id));
      const next = new Set([...prev].filter(id => allowed.has(id)));
      if (next.size === prev.size && [...prev].every(id => next.has(id))) return prev;
      return next;
    });
  }, [waitingItemsShippable]);

  const readyItems = filteredActiveItems.filter(i => i.status === 'ready');
  /** В «Готовы к выдаче» — только корневые позиции: устройства и отдельные расходники; картриджи «с принтером» скрыты (они в партиях/истории с тем же «кто забрал»). */
  const readyItemsRoot = useMemo(() => readyItems.filter(i => !i.parentDeviceId), [readyItems]);
  const readyItemsOrdered = useMemo(() => sortStockRowsForDisplay(readyItemsRoot), [readyItemsRoot]);
  const sentBatches = filteredBatches.filter(b => b.status === 'sent');
  const receivedBatches = filteredBatches.filter(b => b.status === 'received');
  const closedBatches = filteredBatches.filter(b => b.status === 'closed');
  const cancelledBatches = filteredBatches.filter(b => b.status === 'cancelled');
  /** Отправленные партии с уже принятыми позициями — показываем в истории параллельно с блоком «На заправке». */
  const partialSentBatches = useMemo(
    () =>
      filteredBatches.filter(
        b =>
          b.status === 'sent' &&
          b.items.some(i => i.status === 'ready' || i.status === 'issued' || i.status === 'replaced'),
      ),
    [filteredBatches],
  );

  const historyBatchesMerged = useMemo(() => {
    const arr = [...partialSentBatches, ...receivedBatches, ...closedBatches, ...cancelledBatches];
    arr.sort((a, b) => new Date(b.dateSent).getTime() - new Date(a.dateSent).getTime());
    return arr;
  }, [partialSentBatches, receivedBatches, closedBatches, cancelledBatches]);

  /** ID позиций, уже входящих в активную (отправленную) партию — остальные at_refill показываем отдельно (старые данные / сбой). */
  const idsInOpenShipment = useMemo(() => {
    const s = new Set<string>();
    for (const b of batches) {
      if (b.status !== 'sent') continue;
      for (const it of b.items) s.add(it.id);
    }
    return s;
  }, [batches]);

  const atRefillOrphanItems = useMemo(
    () =>
      filteredActiveItems.filter(
        i => i.status === 'at_refill' && !idsInOpenShipment.has(i.id),
      ),
    [filteredActiveItems, idsInOpenShipment],
  );

  useEffect(() => {
    if (!focusRequest) return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        let el: HTMLElement | null = null;
        if (focusRequest.section === 'waiting') {
          el = document.getElementById('warehouse-section-waiting');
        } else if (focusRequest.section === 'ready') {
          el = document.getElementById('warehouse-section-ready');
        } else {
          el =
            sentBatches.length > 0
              ? document.getElementById('warehouse-section-batches')
              : atRefillOrphanItems.length > 0
                ? document.getElementById('warehouse-section-orphan')
                : document.getElementById('warehouse-section-batches');
        }
        if (!el) {
          onFocusRequestHandled?.();
          return;
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        el.classList.add(...HIGHLIGHT_RING);
        window.setTimeout(() => {
          el?.classList.remove(...HIGHLIGHT_RING);
          onFocusRequestHandled?.();
        }, 2400);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [focusRequest, sentBatches.length, atRefillOrphanItems.length, onFocusRequestHandled]);

  const toggleBatchExpansion = (id: string) => {
    setExpandedBatchIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem('warehouse_expanded_batches', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  /** Вкладка встроена в main с bg-gray-50 — только светлая тема как в остальном приложении */
  const darkMode = false;

  return (
    <div className="w-full text-gray-800 space-y-4">
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Фильтр: код, модель, инв. №, сдал, забрал…"
          className="w-full pl-10 pr-9 py-2.5 border border-gray-200 rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Очистить"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="space-y-6 w-full min-w-0">
        <div className="space-y-8">
              
              {/* === Ожидают отправки === */}
              <div
                id="warehouse-section-waiting"
                className={`rounded-xl border overflow-hidden shadow-sm ${
                  darkMode ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className={`px-4 py-2.5 border-b flex flex-wrap gap-3 justify-between items-center ${
                  darkMode
                    ? 'bg-yellow-950/20 border-slate-800'
                    : 'bg-[#f3ead4] border-[#dccfb0]'
                }`}>
                  <div
                    className={`flex items-center space-x-2 font-extrabold uppercase text-xs tracking-wider ${
                      darkMode ? 'text-amber-200' : 'text-[#5c4a32]'
                    }`}
                  >
                    <Package size={16} className={darkMode ? '' : 'text-[#8a744a]'} />
                    <span>Ожидают отправки ({waitingItems.length})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleExportItemsExcel(waitingItems, 'Ожидают_отправки')}
                      className={`px-1.5 py-0.5 border rounded text-[10px] font-medium flex items-center gap-0.5 ${
                        darkMode
                          ? 'border-slate-700 text-slate-400 hover:bg-slate-800'
                          : 'border-[#c9bc9a] text-[#5c4a32] bg-white/60 hover:bg-white/90'
                      }`}
                    >
                      <Download size={11} />
                      <span>Excel</span>
                    </button>
                    <button
                      onClick={() => setShowSendDialog(true)}
                      disabled={waitingItems.length === 0}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-extrabold flex items-center gap-1.5 shadow transition-all disabled:opacity-50"
                    >
                      <Truck size={13} />
                      <span>Отправить {selectedWaitingIds.size > 0 ? `(${selectedWaitingIds.size})` : '(все)'}</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className={warehouseTableClasses}>
                    <thead>
                      <tr className={darkMode ? 'bg-slate-900/60 text-slate-400' : ''}>
                        <th className={`${warehouseThClasses} text-center w-10`}>
                          <input
                            type="checkbox"
                            title="Отметить только позиции, которые можно отправить отдельно (к принтеру привязанные картриджи едут вместе с принтером)"
                            checked={
                              selectedWaitingIds.size === waitingItemsShippable.length &&
                              waitingItemsShippable.length > 0
                            }
                            onChange={() => {
                              if (selectedWaitingIds.size === waitingItemsShippable.length)
                                setSelectedWaitingIds(new Set());
                              else
                                setSelectedWaitingIds(new Set(waitingItemsShippable.map(i => i.id)));
                            }}
                            className="rounded border-slate-300 bg-transparent text-slate-600 focus:ring-slate-400 focus:ring-offset-0"
                          />
                        </th>
                        <th className={warehouseThClasses}>Код</th>
                        <th className={warehouseThClasses}>Тип</th>
                        <th className={warehouseThClasses}>Модель</th>
                        <th className={warehouseThClasses}>Инвентарный номер</th>
                        <th className={warehouseThClasses}>Модель принтера</th>
                        <th className={warehouseThClasses}>Подразделение</th>
                        <th className={`${warehouseThClasses} text-blue-700`}>Кто сдал</th>
                        <th className={`${warehouseThClasses} text-center`}>Заправок</th>
                        <th className={warehouseThClasses}>Дата приёма</th>
                        <th className={`${warehouseThClasses} text-right`}>Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {waitingItems.length === 0 ? (
                        <tr>
                          <td colSpan={11} className={`${warehouseTdClasses} py-6 text-center text-slate-400 italic`}>Склад пуст</td>
                        </tr>
                      ) : (
                        waitingItemsOrdered.map(item => {
                          const isChild = !!item.parentDeviceId;
                          return (
                          <tr key={item.id} className="hover:bg-slate-50/90 dark:hover:bg-slate-900/40">
                            <td className={`${warehouseTdClasses} text-center`}>
                              {isChild ? (
                                <span
                                  className="text-slate-300 text-sm select-none"
                                  title="Отправляется вместе с принтером — отдельно не выбирается"
                                >
                                  —
                                </span>
                              ) : (
                              <input
                                type="checkbox"
                                checked={selectedWaitingIds.has(item.id)}
                                onChange={() => {
                                  setSelectedWaitingIds(prev => {
                                    const next = new Set(prev);
                                    if (next.has(item.id)) next.delete(item.id);
                                    else next.add(item.id);
                                    return next;
                                  });
                                }}
                                className="rounded border-slate-300 bg-transparent text-slate-600 focus:ring-slate-400 focus:ring-offset-0"
                              />
                              )}
                            </td>
                            <td className={`${warehouseTdClasses} font-mono font-bold text-blue-700`}>
                              <div className="flex items-center gap-1">
                                {isChild && renderNestingArrow()}
                                <span>{item.id}</span>
                              </div>
                            </td>
                            <td className={warehouseTdClasses}>
                              <WarehouseItemTypeBadge type={item.type} />
                            </td>
                            <td className={`${warehouseTdClasses} font-medium`}>{item.model}</td>
                            <td className={`${warehouseTdClasses} font-mono`}>{item.printerInventoryNumber}</td>
                            <td className={`${warehouseTdClasses} text-slate-500 italic`}>{item.printerModel}</td>
                            <td className={`${warehouseTdClasses} text-slate-500`}>{item.department}</td>
                            <td className={warehouseTdClasses}>
                              {editingItemId === item.id && editingField === 'submittedBy' ? (
                                <input
                                  type="text"
                                  value={editingValue}
                                  onChange={e => setEditingValue(e.target.value)}
                                  onBlur={() => handleSaveCellEdit(item.id, 'submittedBy')}
                                  onKeyDown={e => e.key === 'Enter' && handleSaveCellEdit(item.id, 'submittedBy')}
                                  className="border rounded px-1.5 py-0.5 w-24 bg-slate-100 dark:bg-slate-800 font-bold"
                                  autoFocus
                                />
                              ) : (
                                <span
                                  className="font-bold cursor-pointer border-b border-dashed border-slate-300 text-slate-800 dark:text-slate-200 hover:text-blue-700"
                                  onDoubleClick={() => {
                                    setEditingItemId(item.id);
                                    setEditingField('submittedBy');
                                    setEditingValue(item.submittedBy);
                                  }}
                                  title="Двойной клик для изменения"
                                >
                                  {item.submittedBy}
                                </span>
                              )}
                            </td>
                            <td className={`${warehouseTdClasses} text-center`}>
                              {warehouseRefillCell(item, 'muted')}
                            </td>
                            <td className={`${warehouseTdClasses} text-slate-500`}>
                              {new Date(item.registrationDate).toLocaleDateString('ru-RU')}
                            </td>
                            <td className={`${warehouseTdClasses} text-right`}>
                              {!isChild ? (
                              <button
                                onClick={() => handleCancelIntake(item.id)}
                                className="px-2 py-1 text-[10px] font-semibold border border-red-200/90 text-red-700/90 bg-red-50/40 dark:border-red-900/25 dark:text-red-300 rounded hover:bg-red-50/80 dark:hover:bg-red-950/20"
                              >
                                Отменить
                              </button>
                              ) : (
                                <span className="text-slate-300 text-lg leading-none">—</span>
                              )}
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {atRefillOrphanItems.length > 0 && (
                <div
                  id="warehouse-section-orphan"
                  className="rounded-xl border border-amber-200 bg-amber-50/40 overflow-hidden shadow-sm"
                >
                  <div className="px-5 py-3 border-b border-amber-200 bg-amber-50 flex flex-wrap gap-3 items-center justify-between">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-2 text-amber-900 font-extrabold uppercase text-xs tracking-wider">
                        <AlertTriangle size={16} />
                        <span>На заправке, но не в активной партии ({atRefillOrphanItems.length})</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleExportItemsExcel(atRefillOrphanItems, 'На_заправке_вне_партии')}
                        className="px-1.5 py-0.5 border border-amber-200/90 bg-white/80 rounded text-[10px] font-medium text-amber-800/90 hover:bg-amber-100 flex items-center gap-0.5"
                      >
                        <Download size={11} />
                        Excel
                      </button>
                    </div>
                    <p className="text-[11px] text-amber-800 max-w-xl">
                      Обычно позиции видны в блоке «Партии» после «Отправить». Если сюда что-то попало из старых данных — оформите повторную отправку или исправьте статус в основной базе.
                    </p>
                  </div>
                  <div className="overflow-x-auto bg-white">
                    <table className={warehouseTableClasses}>
                      <thead>
                        <tr>
                          <th className={`${warehouseThClasses} bg-amber-50`}>Код</th>
                          <th className={`${warehouseThClasses} bg-amber-50`}>Тип</th>
                          <th className={`${warehouseThClasses} bg-amber-50`}>Модель</th>
                          <th className={`${warehouseThClasses} bg-amber-50`}>Инв.</th>
                          <th className={`${warehouseThClasses} bg-amber-50`}>Кто сдал</th>
                        </tr>
                      </thead>
                      <tbody>
                        {atRefillOrphanItems.map(item => (
                          <tr key={item.id} className="hover:bg-amber-50/50">
                            <td className={`${warehouseTdClasses} font-mono font-bold text-blue-800`}>{item.id}</td>
                            <td className={warehouseTdClasses}><WarehouseItemTypeBadge type={item.type} /></td>
                            <td className={warehouseTdClasses}>{item.model}</td>
                            <td className={`${warehouseTdClasses} font-mono`}>{item.printerInventoryNumber}</td>
                            <td className={warehouseTdClasses}>{item.submittedBy}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* === На заправке — партии === */}
              <div
                id="warehouse-section-batches"
                className={`rounded-xl border overflow-hidden shadow-sm ${
                  darkMode ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className={`px-5 py-3 border-b flex items-center space-x-2 ${
                  darkMode ? 'bg-blue-950/20 border-slate-800' : 'bg-slate-50 border-slate-200'
                }`}>
                  <Truck size={16} className="text-blue-500" />
                  <span className="text-blue-500 font-extrabold uppercase text-xs tracking-wider">На заправке — партии ({sentBatches.length})</span>
                </div>
                <div className="p-4 space-y-3">
                  {sentBatches.length === 0 ? (
                    <div className="py-4 text-center text-slate-400 italic">Нет активных партий</div>
                  ) : (
                    sentBatches.map(batch => {
                      const isExpanded = expandedBatchIds.has(batch.id);
                      return (
                        <div key={batch.id} className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                          <div className="flex flex-wrap gap-4 justify-between items-center px-4 py-3 bg-slate-50 dark:bg-slate-900/40">
                            <div>
                              <div className="font-extrabold text-blue-600 font-mono text-sm">{batch.id}</div>
                              <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-x-3">
                                <span>Дата: {new Date(batch.dateSent).toLocaleDateString('ru-RU')}</span>
                                <span>• Отправил: <strong className="text-slate-700 dark:text-slate-300">{formatBatchSenderWithNotes(batch)}</strong></span>
                                <span>• Позиций: <strong>{batch.items.length} шт.</strong></span>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleExportBatchExcel(batch)}
                                className="p-1 border border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded"
                                title="Экспорт в Excel"
                              >
                                <Download size={12} />
                              </button>
                              <button
                                onClick={() => toggleBatchExpansion(batch.id)}
                                className="px-2.5 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1"
                              >
                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                <span>{isExpanded ? 'Скрыть' : 'Раскрыть'}</span>
                              </button>
                              {store.settings.enableEventEditing && (
                              <button
                                onClick={() => handleCancelBatch(batch.id)}
                                className="px-2.5 py-1.5 border border-red-200/90 text-red-700/90 bg-red-50/35 hover:bg-red-50/80 dark:border-red-900/35 dark:text-red-300 rounded-lg text-xs font-semibold"
                              >
                                Отменить
                              </button>
                              )}
                              <button
                                onClick={() => handleReceiveFullBatch(batch.id)}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs rounded-lg shadow-sm"
                              >
                                Принять всё
                              </button>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t border-slate-200 dark:border-slate-800 overflow-x-auto text-xs p-2">
                              <table className={warehouseTableClasses}>
                                <thead>
                                  <tr>
                                    <th className={warehouseThClasses}>ID</th>
                                    <th className={warehouseThClasses}>Тип</th>
                                    <th className={warehouseThClasses}>Модель</th>
                                    <th className={warehouseThClasses}>Принтер (Инв)</th>
                                    <th className={warehouseThClasses}>Подразделение</th>
                                    <th className={`${warehouseThClasses} text-blue-700`}>Кто сдал</th>
                                    <th className={warehouseThClasses}>Статус</th>
                                    <th className={`${warehouseThClasses} text-right`}>Действия</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sortStockRowsForDisplay(batch.items).map(item => {
                                    const isChild = !!item.parentDeviceId;
                                    const printer = store.printers.find(
                                      p =>
                                        p.inventoryNumber === item.printerInventoryNumber ||
                                        p.programId === item.id,
                                    );
                                    const canReceiveLine =
                                      item.status === 'at_refill' &&
                                      (item.type === 'Устройство' ||
                                        (!isChild && (item.type === 'Картридж' || item.type === 'Драм-картридж')));
                                    return (
                                      <tr
                                        key={item.id}
                                        className="hover:bg-slate-50/80"
                                      >
                                        <td className={`${warehouseTdClasses} font-mono font-bold`}>
                                          <div className="flex items-center">
                                            {isChild && renderNestingArrow()}
                                            <span className="text-slate-800">{item.id}</span>
                                          </div>
                                        </td>
                                        <td className={warehouseTdClasses}>
                                          <WarehouseItemTypeBadge type={item.type} />
                                        </td>
                                        <td className={`${warehouseTdClasses} text-slate-700 dark:text-slate-300`}>
                                          <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                            <span>{item.model}</span>
                                            {item.status === 'replaced' && (
                                              <span className="text-[9px] font-extrabold text-red-600">Списан</span>
                                            )}
                                            {item.fromReplacement && (
                                              <span className="text-[9px] font-extrabold text-amber-600">Новый</span>
                                            )}
                                          </span>
                                        </td>
                                        <td className={`${warehouseTdClasses} font-mono`}>{item.printerInventoryNumber}</td>
                                        <td className={`${warehouseTdClasses} text-slate-500`}>{item.department}</td>
                                        <td className={`${warehouseTdClasses} text-slate-800 font-bold`}>{item.submittedBy}</td>
                                        <td className={warehouseTdClasses}>
                                          {item.status === 'at_refill' && (
                                            <span className="text-amber-800 font-bold text-[10px] whitespace-nowrap">
                                              На заправке
                                            </span>
                                          )}
                                          {item.status === 'ready' && (
                                            <span className="text-emerald-700 font-bold text-[10px] whitespace-nowrap">
                                              Принят → к выдаче
                                            </span>
                                          )}
                                          {item.status === 'issued' && (
                                            <span className="text-slate-600 text-[10px]">
                                              Выдан
                                              {item.whoPickedUp ? ` · ${item.whoPickedUp}` : ''}
                                            </span>
                                          )}
                                          {item.status === 'replaced' && (
                                            <span className="text-red-700 font-bold text-[10px]">Заменён</span>
                                          )}
                                        </td>
                                        <td className={`${warehouseTdClasses} text-right`}>
                                          <div className="flex flex-wrap justify-end items-center gap-1.5">
                                            {item.type === 'Устройство' && (
                                              <>
                                                {printer && !printer.firmwareFlashed && (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      store.updatePrinter(item.printerInventoryNumber, {
                                                        firmwareFlashed: true,
                                                      })
                                                    }
                                                    className="px-2 py-1 text-[10px] font-bold border border-purple-200 text-purple-900 bg-purple-50 hover:bg-purple-100 rounded"
                                                  >
                                                    Прошит
                                                  </button>
                                                )}
                                                {printer && printer.firmwareFlashed && store.settings.enableEventEditing && (
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      if (
                                                        window.confirm(
                                                          'Снять отметку «прошит»? На этикетках переменная {fw} перестанет печататься.',
                                                        )
                                                      ) {
                                                        store.updatePrinter(item.printerInventoryNumber, {
                                                          firmwareFlashed: false,
                                                        });
                                                      }
                                                    }}
                                                    className="px-2 py-1 text-[10px] font-bold border border-amber-200 text-amber-900 bg-amber-50 hover:bg-amber-100 rounded"
                                                  >
                                                    Снять «прошит»
                                                  </button>
                                                )}
                                                {printer && printer.firmwareFlashed && !store.settings.enableEventEditing && (
                                                  <span
                                                    className="inline-flex items-center justify-center shrink-0 h-7 min-w-[1.25rem]"
                                                    title="Прошит"
                                                    aria-label="Прошит"
                                                  >
                                                    <span className="block w-1.5 h-1.5 rounded-full bg-red-500 ring-2 ring-red-200" />
                                                  </span>
                                                )}
                                              </>
                                            )}
                                            {(item.type === 'Картридж' || item.type === 'Драм-картридж') &&
                                              !item.fromReplacement &&
                                              item.status === 'at_refill' && (
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setReplacementModel(item.model);
                                                  setShowReplaceDialog({ oldItemId: item.id, batchId: batch.id });
                                                }}
                                                className="px-2 py-1 text-[10px] font-bold border border-blue-200 text-blue-700 hover:bg-blue-50 rounded"
                                              >
                                                Замена новым
                                              </button>
                                            )}
                                            {isChild && item.status === 'at_refill' && (
                                              <span className="text-slate-300 text-lg leading-none select-none">—</span>
                                            )}
                                            {canReceiveLine && (
                                              <button
                                                type="button"
                                                onClick={() => handleReceiveItem(batch.id, item.id)}
                                                className="px-2.5 py-1 text-[10px] font-semibold bg-emerald-500/90 hover:bg-emerald-500 text-white rounded border border-emerald-600/15 shadow-sm"
                                              >
                                                Принять
                                              </button>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* === Готовы к выдаче === */}
              <div
                id="warehouse-section-ready"
                className={`rounded-xl border overflow-hidden shadow-sm ${
                  darkMode ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div className={`px-5 py-3 border-b flex flex-wrap gap-3 justify-between items-center ${
                  darkMode ? 'bg-emerald-950/20 border-slate-800' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="flex items-center space-x-2 text-emerald-600 font-extrabold uppercase text-xs tracking-wider">
                    <CheckSquare size={16} />
                    <span>Готовы к выдаче ({readyItemsRoot.length})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleExportItemsExcel(readyItemsRoot, 'Готовы_к_выдаче')}
                    className="px-1.5 py-0.5 border border-slate-200/90 dark:border-slate-700 rounded text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-0.5"
                  >
                    <Download size={11} />
                    <span>Excel</span>
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className={warehouseTableClasses}>
                    <thead>
                      <tr>
                        <th className={warehouseThClasses}>Код</th>
                        <th className={warehouseThClasses}>Тип</th>
                        <th className={warehouseThClasses}>Модель</th>
                        <th className={warehouseThClasses}>Принтер (Инв.)</th>
                        <th className={warehouseThClasses}>Модель принтера</th>
                        <th className={warehouseThClasses}>Подразделение</th>
                        <th className={`${warehouseThClasses} text-blue-700`}>Кто сдал</th>
                        <th className={`${warehouseThClasses} text-center`}>Заправок</th>
                        <th className={`${warehouseThClasses} text-emerald-600`}>Статус</th>
                        <th className={`${warehouseThClasses} text-right`}>Выдача</th>
                      </tr>
                    </thead>
                    <tbody>
                      {readyItemsRoot.length === 0 ? (
                        <tr>
                          <td colSpan={10} className={`${warehouseTdClasses} py-6 text-center text-slate-400 italic`}>
                            Нет готовых к выдаче элементов
                          </td>
                        </tr>
                      ) : (
                        readyItemsOrdered.map(item => {
                          const isChild = !!item.parentDeviceId;
                          return (
                            <tr key={item.id} className="hover:bg-slate-50/90">
                              <td className={`${warehouseTdClasses} font-mono font-bold`}>
                                <div className="flex items-center">
                                  {isChild && renderNestingArrow()}
                                  <span className="text-emerald-700 font-mono">{item.id}</span>
                                </div>
                              </td>
                              <td className={warehouseTdClasses}>
                                <WarehouseItemTypeBadge type={item.type} />
                              </td>
                              <td className={`${warehouseTdClasses} font-medium`}>{item.model}</td>
                              <td className={`${warehouseTdClasses} font-mono`}>{item.printerInventoryNumber}</td>
                              <td className={`${warehouseTdClasses} text-slate-500 italic`}>{item.printerModel}</td>
                              <td className={`${warehouseTdClasses} text-slate-500`}>{item.department}</td>
                              <td className={`${warehouseTdClasses} text-slate-800 font-bold`}>{item.submittedBy}</td>
                              <td className={`${warehouseTdClasses} text-center`}>
                                {warehouseRefillCell(item, 'ready')}
                              </td>
                              <td className={warehouseTdClasses}>
                                <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 px-2 py-0.5 rounded-full text-[10px] font-bold">
                                  Готов к выдаче
                                </span>
                              </td>
                              <td className={`${warehouseTdClasses} text-right`}>
                                <button
                                  onClick={() => {
                                    setIssueRecipient(item.submittedBy);
                                    setShowIssueDialog({ itemId: item.id });
                                  }}
                                  className="px-3 py-1.5 bg-emerald-600/92 hover:bg-emerald-600 text-white text-[11px] font-semibold rounded-lg shadow-sm border border-emerald-700/10"
                                >
                                  Выдать
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* === Закрытые партии === */}
              <div className={`rounded-xl border overflow-hidden shadow-sm ${
                darkMode ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-200'
              }`}>
                <div className={`px-5 py-3 border-b flex items-center justify-between ${
                  darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="flex items-center space-x-2 text-slate-500 dark:text-slate-400 font-normal uppercase text-xs tracking-wider">
                    <Calendar size={16} />
                    <span>Закрытые / история ({historyBatchesMerged.length})</span>
                  </div>
                </div>

                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {historyBatchesMerged.map(batch => {
                    const isExpanded = expandedBatchIds.has(batch.id);
                    return (
                      <div key={batch.id} className="text-xs">
                        <div className="px-5 py-3 flex flex-wrap gap-4 justify-between items-center bg-slate-50/50 dark:bg-slate-900/10">
                          <div>
                            <span className="font-medium text-slate-600 dark:text-slate-300 text-sm font-mono">{batch.id}</span>
                            <span className="ml-2 text-slate-500">отправил:{' '}<span className="text-slate-600 dark:text-slate-300">{formatBatchSenderWithNotes(batch)}</span></span>
                            <span className="ml-3 text-slate-400">{new Date(batch.dateSent).toLocaleDateString('ru-RU')}</span>
                            <span className="ml-3 text-slate-400">{batch.items.length} шт.</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => handleExportBatchExcel(batch)}
                              className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                              title="Excel"
                            >
                              <Download size={12} />
                            </button>
                            <button
                              onClick={() => toggleBatchExpansion(batch.id)}
                              className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-white"
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                            {store.settings.enableEventEditing && (
                              <button
                                type="button"
                                onClick={() => handleDeleteShipmentBatchRecord(batch.id)}
                                className="p-1 text-red-500 hover:text-red-700 dark:hover:text-red-400 rounded"
                                title="Удалить запись партии из истории"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                            <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 rounded-full font-normal text-[10px]">
                              {batch.status === 'closed'
                                ? 'ПОЛУЧЕНО / ЗАКРЫТО'
                                : batch.status === 'cancelled'
                                  ? 'ОТМЕНЕНА'
                                  : batch.status === 'sent'
                                    ? 'ПРИЁМ В ПРОЦЕССЕ'
                                    : 'ПОЛУЧЕНО НА СКЛАД'}
                            </span>
                          </div>
                        </div>

                        {/* Фиксация ПОЛУЧЕНО в стиле вашего примера */}
                        {isExpanded && (
                          <div className="px-5 pb-4 pt-1 bg-white dark:bg-slate-950 overflow-x-auto">
                            <div className="text-[10px] font-normal text-slate-500 mb-2 uppercase tracking-wider">
                              {batch.status === 'sent'
                                ? 'Партия на заправке — ниже видна каждая строка (принято / ещё нет)'
                                : 'Раздел: ПОЛУЧЕНО'}
                            </div>
                            <table className={warehouseTableClasses}>
                              <thead>
                                <tr>
                                  <th className={warehouseThClasses}>ID</th>
                                  <th className={warehouseThClasses}>Инв. №</th>
                                  <th className={warehouseThClasses}>Тип</th>
                                  <th className={warehouseThClasses}>Модель</th>
                                  <th className={warehouseThClasses}>Модель принтера</th>
                                  <th className={warehouseThClasses}>Кто сдал</th>
                                  <th className={warehouseThClasses}>Статус</th>
                                  <th className={`${warehouseThClasses} text-slate-500 font-medium`}>Кто забрал</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sortStockRowsForDisplay(batch.items).map(item => {
                                  const isChild = !!item.parentDeviceId;
                                  return (
                                    <tr
                                      key={item.id}
                                      className="hover:bg-slate-50/60"
                                    >
                                      <td className={`${warehouseTdClasses} font-mono text-slate-600`}>
                                        <div className="flex items-center">
                                          {isChild && renderNestingArrow()}
                                          <span className="text-slate-600 pl-1">{item.id}</span>
                                        </div>
                                      </td>
                                      <td className={`${warehouseTdClasses} font-mono text-slate-500`}>{item.printerInventoryNumber}</td>
                                      <td className={warehouseTdClasses}>
                                        <WarehouseItemTypeBadge type={item.type} />
                                      </td>
                                      <td className={`${warehouseTdClasses} text-slate-600`}>{item.model}</td>
                                      <td className={`${warehouseTdClasses} text-slate-500 italic`}>{item.printerModel}</td>
                                      <td className={`${warehouseTdClasses} text-slate-600`}>{item.submittedBy}</td>
                                      <td className={warehouseTdClasses}>
                                        {item.status === 'issued' ? (
                                          <span className="text-slate-600">Выдан</span>
                                        ) : item.status === 'replaced' ? (
                                          <span className="text-orange-600/90">Заменён (ID: {item.replacementId})</span>
                                        ) : item.status === 'at_refill' ? (
                                          <span className="text-amber-700/90">На заправке (ожидает приёмки)</span>
                                        ) : item.status === 'ready' ? (
                                          <span className="text-emerald-700/90">Принят с заправки, к выдаче</span>
                                        ) : (
                                          <span className="text-slate-400">—</span>
                                        )}
                                      </td>
                                      <td className={warehouseTdClasses}>
                                        {item.status === 'issued' ? (
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-slate-600">{item.whoPickedUp}</span>
                                            {store.settings.enableEventEditing &&
                                              (editingItemId === item.id && editingField === 'whoPickedUp' ? (
                                              <input
                                                type="text"
                                                value={editingValue}
                                                onChange={e => setEditingValue(e.target.value)}
                                                onBlur={() => handleSaveCellEdit(item.id, 'whoPickedUp')}
                                                onKeyDown={e => e.key === 'Enter' && handleSaveCellEdit(item.id, 'whoPickedUp')}
                                                className="border rounded px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 w-24 text-sm text-slate-700"
                                                autoFocus
                                              />
                                            ) : (
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setEditingItemId(item.id);
                                                  setEditingField('whoPickedUp');
                                                  setEditingValue(item.whoPickedUp || '');
                                                }}
                                                className="text-[10px] text-slate-400 hover:text-slate-700 flex items-center gap-0.5"
                                                title="Редактировать получателя"
                                              >
                                                <Edit3 size={11} />
                                              </button>
                                            ))}
                                          </div>
                                        ) : item.status === 'replaced' ? (
                                          <span className="text-slate-300 text-lg leading-none">—</span>
                                        ) : item.status === 'at_refill' ? (
                                          <span className="text-slate-400 text-[10px]">—</span>
                                        ) : item.status === 'ready' ? (
                                          <button
                                            onClick={() => {
                                              setIssueRecipient(item.submittedBy);
                                              setShowIssueDialog({ itemId: item.id, batchId: batch.id });
                                            }}
                                            className="px-2 py-0.5 bg-slate-100 text-slate-700 font-medium rounded hover:bg-slate-200 text-[10px]"
                                          >
                                            Выдать на руки
                                          </button>
                                        ) : (
                                          <span className="text-slate-300 text-lg leading-none">—</span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
      </div>

      {/* ========================================================= */}
      {/* ДИАЛОГОВЫЕ ОКНА (Портативные модалки)                     */}
      {/* ========================================================= */}

      {/* 1. ОТПРАВИТЬ НА ЗАПРАВКУ */}
      {showSendDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-gray-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Truck className="text-blue-600" />
                Отправить партию на заправку
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Выбрано к отправке:{' '}
                <strong className="text-blue-700">
                  {selectedWaitingIds.size > 0 ? selectedWaitingIds.size : waitingItems.length} позиций
                </strong>
              </p>
            </div>

            <div className="space-y-3.5 text-xs text-gray-700">
              <div>
                <label className="text-gray-600 block mb-1 font-bold">ФИО сотрудника, отправляющего партию</label>
                <input
                  type="text"
                  value={sendSender}
                  onChange={e => setSendSender(e.target.value)}
                  placeholder="Фамилия (например: Спиркин)"
                  className="w-full border border-gray-200 rounded-lg p-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-bold bg-white"
                />
              </div>

              <div>
                <label className="text-gray-600 block mb-1 font-bold">Примечания / Инструкции заправщику</label>
                <textarea
                  value={sendNotes}
                  onChange={e => setSendNotes(e.target.value)}
                  placeholder="Например: Срочно заправить до пятницы, картридж Canon DR-228 заменить если фотобарабан изношен..."
                  className="w-full border border-gray-200 rounded-lg p-2.5 text-gray-900 placeholder-gray-400 h-20 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2 text-xs">
              <button
                onClick={() => setShowSendDialog(false)}
                className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-lg transition-all"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmSendBatch}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition-all"
              >
                Подтвердить отправку
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. ВЫДАТЬ РАСХОДНИК НА РУКИ (Кто забрал?) */}
      {showIssueDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-gray-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <UserCheck className="text-blue-600" />
                Выдача расходных материалов
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Элемент ID: <strong className="text-blue-700 font-mono">{showIssueDialog.itemId}</strong> подготовлен к выдаче.
              </p>
            </div>

            <div className="space-y-3.5 text-xs text-gray-700">
              <div>
                <label className="text-gray-600 block mb-1 font-bold">Кто забрал (ФИО полностью)</label>
                <input
                  type="text"
                  value={issueRecipient}
                  onChange={e => setIssueRecipient(e.target.value)}
                  placeholder="Введите ФИО (например: Попов)"
                  className="w-full border border-gray-200 rounded-lg p-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-bold bg-white"
                  autoFocus
                />
              </div>

              <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                <p className="text-[10px] text-gray-600">
                  <strong>Связанные объекты:</strong> Если вы выдаете Устройство (принтер), все связанные с ним картриджи на складе со статусом &quot;Готов к выдаче&quot; будут автоматически выданы этому же сотруднику, чтобы сэкономить Ваше время.
                </p>
              </div>
            </div>

            <div className="flex gap-3 pt-2 text-xs">
              <button
                onClick={() => {
                  setShowIssueDialog(null);
                  setIssueRecipient('');
                }}
                className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-lg transition-all"
              >
                Отмена
              </button>
              <button
                onClick={handleIssueItem}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition-all"
              >
                Зарегистрировать выдачу
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. ЗАМЕНА НА НОВЫЙ */}
      {showReplaceDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-gray-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <RefreshCw className="text-orange-500" />
                Списание и замена на новый
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Картридж <strong className="text-gray-900 font-mono">{showReplaceDialog.oldItemId}</strong> пришел в негодность на заправке. Он будет списан в партии {showReplaceDialog.batchId} и заменен новым.
              </p>
            </div>

            <div className="space-y-3.5 text-xs text-gray-700">
              <div>
                <label className="text-gray-600 block mb-1 font-bold">Модель НОВОГО совместимого картриджа</label>
                <input
                  type="text"
                  value={replacementModel}
                  onChange={e => setReplacementModel(e.target.value)}
                  placeholder="Например: NV Print Canon FC-228"
                  className="w-full border border-gray-200 rounded-lg p-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-bold bg-white"
                  autoFocus
                />
              </div>

              <p className="text-[10px] text-gray-500">
                Новый расходник получит уникальный сгенерированный ID, статус &quot;Готов к выдаче&quot; и сохранит изначального владельца сдавшего картридж сотрудника.
              </p>
            </div>

            <div className="flex gap-3 pt-2 text-xs">
              <button
                onClick={() => {
                  setShowReplaceDialog(null);
                  setReplacementModel('');
                }}
                className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-lg transition-all"
              >
                Отмена
              </button>
              <button
                onClick={handleReplaceItem}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition-all"
              >
                Подтвердить замену
              </button>
            </div>
          </div>
        </div>
      )}

      {showCompletionDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-gray-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                Решение по ремонту / Выполненные работы
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Для приема принтера с ремонта, введите выполненные работы (решение).
              </p>
              {bulkDeviceTotal > 1 && (
                <p className="text-xs text-amber-700 mt-1 font-semibold">
                  Устройство {bulkDeviceTotal - completionQueue.length} из {bulkDeviceTotal}
                </p>
              )}
            </div>

            <div className="text-sm bg-gray-50 p-3 rounded-lg border">
              <div className="font-bold text-gray-800">{showCompletionDialog.printerInv}</div>
              <div className="text-xs text-gray-500 mt-0.5">{showCompletionDialog.printerModel}</div>
            </div>

            <div className="space-y-3.5 text-xs text-gray-700">
              <div>
                <label className="text-gray-600 block mb-1 font-bold">Выполненные работы *</label>
                <textarea
                  required
                  rows={3}
                  value={completionSolution}
                  onChange={e => setCompletionSolution(e.target.value)}
                  placeholder="Например: Замена термопленки, чистка ролика захвата"
                  className="w-full border border-gray-200 rounded-lg p-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium bg-white"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2 text-xs">
              <button
                onClick={cancelCompletionFlow}
                className="flex-1 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-lg transition-all"
              >
                Отмена
              </button>
              <button
                onClick={confirmCompletionFlow}
                disabled={!completionSolution.trim()}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow-sm transition-all"
              >
                Принять
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default WarehouseInventoryPanel;
