
import React, { useEffect, useMemo, useState } from 'react';
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
  Microchip,
  Send,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  Cartridge,
  RefillBatch,
  RefillBatchItem,
  RefillLogEntry,
  STATUS_LABELS,
  STATUS_COLORS,
} from '../types';
import { StoreType } from '../store';
import { useStickyState } from '../utils/useStickyState';

function exportCartridgesToExcel(
  data: Cartridge[],
  fileName: string,
  resolvePrinterModel?: (printerInv: string) => string | undefined,
) {
  const rows = data.map(c => ({
    'Код': c.id,
    'Модель': c.model,
    'Принтер (Инв.)': c.printerInventoryNumber,
    'Модель принтера': (resolvePrinterModel?.(c.printerInventoryNumber)?.trim() || '—'),
    'Статус': STATUS_LABELS[c.status],
    'Заправок': c.refillCount,
    'Дата регистрации': new Date(c.registrationDate).toLocaleDateString('ru-RU'),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Склад');
  XLSX.writeFile(wb, `${fileName}_${new Date().toLocaleDateString('ru-RU').replace(/\./g, '-')}.xlsx`);
}

function exportBatchToExcel(batch: RefillBatch, cartridges: Cartridge[]) {
  const rows = cartridges.map(c => ({
    'ID': c.id,
    'Модель': c.model,
    'Принтер': c.printerInventoryNumber,
    'Модель принтера': (c as any)._printerModel ?? '',
    'Подразделение': (c as any)._department ?? '',
    'Кто сдал': c.lastSubmittedBy ?? '',
    'Заправок': c.refillCount,
    'Статус': STATUS_LABELS[c.status],
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, batch.id);
  const info = [{ Партия: batch.id, Дата: new Date(batch.date).toLocaleDateString('ru-RU'), Компания: batch.company ?? '', Примечания: batch.notes ?? '' }];
  const ws2 = XLSX.utils.json_to_sheet(info);
  XLSX.utils.book_append_sheet(wb, ws2, 'Инфо');
  XLSX.writeFile(wb, `batch_${batch.id}_${new Date().toLocaleDateString('ru-RU').replace(/\./g, '-')}.xlsx`);
}

/** Выдача на руки: в истории action часто «На руках», текст «Выдан…» в comment. */
function historyEntryIsHandout(h: { action: string; comment?: string }): boolean {
  const a = h.action ?? '';
  const cm = h.comment ?? '';
  return (
    a.includes('Выдан пользователю') ||
    a.includes('Выдан вместе с принтером') ||
    cm.includes('Выдан пользователю') ||
    cm.includes('Выдан вместе с принтером')
  );
}

function findCartridgeHandoutName(c: Cartridge, refillLog: RefillLogEntry[]): string | undefined {
  const fromHist = c.history
    .slice()
    .reverse()
    .find(historyEntryIsHandout);
  if (fromHist?.employee?.trim()) return fromHist.employee.trim();
  const fromLog = refillLog
    .slice()
    .reverse()
    .find(
      e =>
        e.cartridgeId === c.id &&
        e.consumableType !== 'device' &&
        (e.serviceType === 'issue' || e.serviceType === 'Выдача' || /\bВыдан\b/i.test(e.action)),
    );
  if (fromLog?.employee?.trim()) return fromLog.employee.trim();
  return undefined;
}

/** Кто забрал устройство — только фактическая выдача. По дате: в журнале смешаны prepend/append, порядок массива ненадёжен. */
function findDeviceHandoutName(
  printerInventoryNumber: string,
  programId: string | undefined,
  refillLog: RefillLogEntry[],
): string | undefined {
  const matches = refillLog.filter(e => {
    if (e.consumableType !== 'device') return false;
    const a = (e.action ?? '').toLowerCase();
    if (!a.includes('выдан')) return false;
    if (e.printerInventoryNumber === printerInventoryNumber) return true;
    if (programId && e.cartridgeId === programId) return true;
    return false;
  });
  if (matches.length === 0) return undefined;
  matches.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
  return matches[0]?.employee?.trim() || undefined;
}

/** Подпись к отправке — в UI в скобках после ФИО: «Иванов (расшифровка подписи)». */
function batchSenderDisplay(batch: Pick<RefillBatch, 'company' | 'notes'>): string | null {
  const c = batch.company?.trim();
  const n = batch.notes?.trim();
  if (c && n) return `${c} (${n})`;
  if (c) return c;
  if (n) return `(${n})`;
  return null;
}

function getBatchItems(batch: RefillBatch): RefillBatchItem[] {
  if (batch.items && batch.items.length > 0) return batch.items;
  return batch.cartridgeIds.map(id => ({
    kind: 'cartridge' as const,
    id,
    printerInventoryNumber: '',
  }));
}

function consumableTypeLabel(c: Cartridge): string {
  return c.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж';
}

function typeBadgeClassByLabel(label: string): string {
  if (label === 'Устройство') return 'bg-violet-100 text-violet-700';
  if (label === 'Драм-картридж') return 'bg-amber-100 text-amber-700';
  return 'bg-blue-100 text-blue-700';
}

function deviceStatusBadge(label: string): string {
  if (label === 'Готов к выдаче') return 'bg-green-100 text-green-700';
  if (label === 'В ремонте' || label === 'На заправке') return 'bg-orange-100 text-orange-700';
  return 'bg-slate-100 text-slate-700';
}

interface SendBatchDialogProps {
  cartridges: Cartridge[];
  deviceCount: number;
  employeeSuggestions: string[];
  onRemoveSuggestion: (name: string) => void;
  onConfirm: (employee: string, notes: string) => void;
  onCancel: () => void;
}

const SendBatchDialog: React.FC<SendBatchDialogProps> = ({ cartridges, deviceCount, employeeSuggestions, onRemoveSuggestion, onConfirm, onCancel }) => {
  const [employee, setEmployee] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
        <h2 className="text-lg font-bold mb-1">Отправить на заправку</h2>
        <p className="text-sm text-gray-500 mb-4">
          Выбрано: <strong>{cartridges.length}</strong> расходников
          {deviceCount > 0 && <> и <strong>{deviceCount}</strong> устройств</>}
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Сотрудник, кто отправил</label>
            <input
              value={employee}
              list="inventory-employee-suggestions"
              onChange={e => setEmployee(e.target.value)}
              placeholder="Фамилия сотрудника"
              className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <datalist id="inventory-employee-suggestions">
              {employeeSuggestions.map(name => <option key={name} value={name} />)}
            </datalist>
            {employeeSuggestions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {employeeSuggestions.map(name => (
                  <span key={name} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 rounded-full">
                    {name}
                    <button type="button" onClick={() => onRemoveSuggestion(name)} className="text-red-500">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Примечания</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Дополнительно..."
              className="w-full p-2.5 border rounded-lg text-sm h-20 resize-none focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>
        <div className="flex space-x-3 mt-4">
          <button onClick={onCancel} className="flex-1 py-2.5 border rounded-lg text-sm hover:bg-gray-50">Отмена</button>
          <button onClick={() => onConfirm(employee, notes)}
            className="flex-1 py-2.5 bg-yellow-600 text-white rounded-lg text-sm font-bold hover:bg-yellow-700 flex items-center justify-center space-x-2">
            <Truck size={15} />
            <span>Отправить</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const InventoryTab: React.FC<{ store: StoreType }> = ({ store }) => {
  const [search, setSearch] = useStickyState('search_inventory', '');
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [selectedWaiting, setSelectedWaiting] = useState<Set<string>>(new Set());
  const [selectedWaitingDevices, setSelectedWaitingDevices] = useState<Set<string>>(new Set());
  const [senderList, setSenderList] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('inventory_sender_list') ?? '[]');
    } catch {
      return [];
    }
  });
  const [issueModal, setIssueModal] = useState<
    | null
    | { kind: 'cart'; cartridgeId: string; batchId?: string }
    | { kind: 'printer'; item: RefillBatchItem; batchId?: string }
  >(null);
  const [issueEmployee, setIssueEmployee] = useState('');

  useEffect(() => {
    const onScan = (event: Event) => {
      setSearch((event as CustomEvent<string>).detail);
    };
    window.addEventListener('app-scanner-input', onScan as EventListener);
    return () => window.removeEventListener('app-scanner-input', onScan as EventListener);
  }, []);

  const waiting = useMemo(() => store.cartridges.filter(c => c.status === 'waiting'), [store.cartridges]);
  const waitingDevices = useMemo(() => {
    return store.repairs
      .filter(r => r.status === 'waiting' || r.locationStatus === 'waiting')
      .map(r => {
        const printer = store.printers.find(p => p.inventoryNumber === r.printerInventoryNumber);
        return {
          repairId: r.id,
          id: printer?.programId ?? r.printerInventoryNumber,
          model: printer?.model ?? 'Устройство',
          printerInventoryNumber: r.printerInventoryNumber,
          department: printer?.department ?? '',
          employee: r.technician ?? printer?.boss ?? '',
          status: 'Ожидает отправки в ремонт',
          date: r.date,
        };
      });
  }, [store.repairs, store.printers]);
  const received = useMemo(
    () => store.cartridges.filter(c => c.status === 'received_from_refill' || c.status === 'ready'),
    [store.cartridges],
  );
  const readyDevices = useMemo(
    () => store.repairs.filter(r => r.locationStatus === 'ready'),
    [store.repairs],
  );
  const waitingLinkedCartridges = useMemo(
    () => waiting.filter(c => !!c.linkedRepairId),
    [waiting],
  );
  const waitingFreeCartridges = useMemo(
    () => waiting.filter(c => !c.linkedRepairId),
    [waiting],
  );
  const readyFreeCartridges = useMemo(
    () => received.filter(c => !c.linkedRepairId),
    [received],
  );
  const sentBatches = useMemo(() => store.batches.filter(b => b.status === 'sent'), [store.batches]);
  const receivedBatches = useMemo(() => store.batches.filter(b => b.status === 'received'), [store.batches]);

  const q = search.toLowerCase();

  const getPrinter = (inv: string) => store.printers.find(p => p.inventoryNumber === inv);

  useEffect(() => {
    const hasUpdatable = store.batches.some(batch => {
      if (batch.status !== 'sent') return false;
      return getBatchItems(batch).every(item => {
        if (item.kind === 'printer') {
          const r = item.repairId ? store.repairs.find(x => x.id === item.repairId) : undefined;
          return !!r && r.status === 'repaired';
        }
        const c = store.cartridges.find(x => x.id === item.id);
        return !!c && c.status !== 'at_refill';
      });
    });
    if (!hasUpdatable) return;
    store.setBatches(prev => prev.map(batch => {
      if (batch.status !== 'sent') return batch;
      const allReceived = getBatchItems(batch).every(item => {
        if (item.kind === 'printer') {
          const r = item.repairId ? store.repairs.find(x => x.id === item.repairId) : undefined;
          return !!r && r.status === 'repaired';
        }
        const c = store.cartridges.find(x => x.id === item.id);
        return !!c && c.status !== 'at_refill';
      });
      return allReceived ? { ...batch, status: 'received' as const } : batch;
    }));
  }, [store.batches, store.cartridges, store.repairs]);
  const senderSuggestions = useMemo(() => senderList, [senderList]);
  const filterCarts = (list: Cartridge[]) =>
    list.filter(c => {
      if (!q) return true;
      const pm = (getPrinter(c.printerInventoryNumber)?.model ?? '').toLowerCase();
      return (
        c.id.toLowerCase().includes(q) ||
        c.model.toLowerCase().includes(q) ||
        c.printerInventoryNumber.toLowerCase().includes(q) ||
        pm.includes(q)
      );
    });

  const batchMatchesSearch = (batch: RefillBatch) => {
    if (!q) return true;
    if (batch.id.toLowerCase().includes(q)) return true;
    return getBatchItems(batch).some(item => {
      if (item.id.toLowerCase().includes(q) || item.printerInventoryNumber.toLowerCase().includes(q)) return true;
      if (item.kind === 'printer') {
        const printer = store.printers.find(p => p.inventoryNumber === item.printerInventoryNumber);
        return (
          (printer?.programId ?? '').toLowerCase().includes(q) ||
          (printer?.model ?? '').toLowerCase().includes(q)
        );
      }
      const cart = store.cartridges.find(c => c.id === item.id);
      const pm = cart ? (getPrinter(cart.printerInventoryNumber)?.model ?? '').toLowerCase() : '';
      return !!cart && (
        cart.id.toLowerCase().includes(q) ||
        cart.printerInventoryNumber.toLowerCase().includes(q) ||
        cart.model.toLowerCase().includes(q) ||
        pm.includes(q)
      );
    });
  };

  const filteredSentBatches = useMemo(
    () => sentBatches.filter(batchMatchesSearch),
    [sentBatches, q, store.cartridges, store.printers],
  );
  const filteredReceivedBatches = useMemo(
    () => receivedBatches.filter(batchMatchesSearch),
    [receivedBatches, q, store.cartridges, store.printers],
  );

  const toggleBatch = (id: string) => {
    setExpandedBatches(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedWaiting(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const toggleSelectDevice = (inventoryNumber: string) => {
    setSelectedWaitingDevices(prev => {
      const s = new Set(prev);
      s.has(inventoryNumber) ? s.delete(inventoryNumber) : s.add(inventoryNumber);
      return s;
    });
  };

  const toggleSelectAll = () => {
    setSelectedWaiting(prev =>
      prev.size === waiting.length ? new Set() : new Set(waiting.map(c => c.id)),
    );
  };

  const handleSendToRefill = (employee: string, notes: string) => {
    const toSend = selectedWaiting.size > 0
      ? waiting.filter(c => selectedWaiting.has(c.id))
      : waiting;
    const waitingRepairs = store.repairs.filter(r => r.status === 'waiting');
    const toSendRepairs = selectedWaitingDevices.size > 0
      ? waitingRepairs.filter(r => selectedWaitingDevices.has(r.printerInventoryNumber))
      : waitingRepairs;

    if (toSend.length === 0 && toSendRepairs.length === 0) return;
    if (employee.trim() && !senderList.includes(employee.trim())) {
      const next = [...senderList, employee.trim()].sort();
      setSenderList(next);
      localStorage.setItem('inventory_sender_list', JSON.stringify(next));
    }

    let batchId = '';
    if (toSend.length > 0 || toSendRepairs.length > 0) {
      const year = new Date().getFullYear();
      const seq = store.batches.length + 1;
      batchId = `ПАРТИЯ-${year}-${String(seq).padStart(3, '0')}`;
    }

    if (toSend.length > 0 || toSendRepairs.length > 0) {
      const items: RefillBatchItem[] = [
        ...toSend.map(c => ({ kind: 'cartridge' as const, id: c.id, printerInventoryNumber: c.printerInventoryNumber })),
        ...toSendRepairs.map(r => ({
          kind: 'printer' as const,
          id: r.printerInventoryNumber,
          printerInventoryNumber: r.printerInventoryNumber,
          repairId: r.id,
        })),
      ];
      const newBatch: RefillBatch = {
        id: batchId,
        date: new Date().toISOString(),
        cartridgeIds: toSend.map(c => c.id),
        items,
        status: 'sent',
        company: employee || undefined,
        notes: notes || undefined,
      };
      store.setBatches(prev => [...prev, newBatch]);
    }

    if (toSend.length > 0) {
      toSend.forEach(c => {
        store.updateCartridgeStatus(c.id, 'at_refill', `Отправлен на заправку. Партия ${batchId}`, employee || undefined);
        const printer = store.printers.find(p => p.inventoryNumber === c.printerInventoryNumber);
        store.addRefillLog({
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          cartridgeId: c.id,
          cartridgeModel: c.model,
          consumableType: c.consumableType ?? 'cartridge',
          deviceType: c.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
          serviceType: 'Заправка',
          printerInventoryNumber: c.printerInventoryNumber,
          printerModel: printer?.model ?? '',
          department: printer?.department ?? '',
          employee: employee || undefined,
          action: employee
            ? `Картридж отправлен на заправку (${employee}). Партия ${batchId}`
            : `Картридж отправлен на заправку. Партия ${batchId}`,
          is_technical: false,
        });
      });
    }

    toSendRepairs.forEach(r => {
      const printer = store.printers.find(p => p.inventoryNumber === r.printerInventoryNumber);
      store.updateRepair(r.id, {
        status: 'in_repair',
        locationStatus: 'at_refill',
      });
      store.addRefillLog({
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        cartridgeId: printer?.programId ?? r.printerInventoryNumber,
        cartridgeModel: printer?.model ?? 'Устройство',
        consumableType: 'device',
        deviceType: printer?.printerType ?? 'Устройство',
        serviceType: 'Ремонт',
        printerInventoryNumber: r.printerInventoryNumber,
        printerModel: printer?.model ?? '',
        department: printer?.department ?? '',
        employee: employee || undefined,
        action: employee
          ? `Принтер отправлен в ремонт (${employee}). Партия ${batchId}`
          : `Принтер отправлен в ремонт. Партия ${batchId}`,
        is_technical: false,
      });
    });
    setSelectedWaiting(new Set());
    setSelectedWaitingDevices(new Set());
    setShowSendDialog(false);
  };

  const handleReceiveFromRefill = (batchId: string) => {
    const batch = store.batches.find(b => b.id === batchId);
    if (!batch) return;
    getBatchItems(batch).forEach(item => {
      if (item.kind === 'printer') {
        const repair = item.repairId ? store.repairs.find(r => r.id === item.repairId) : undefined;
        const printer = store.printers.find(p => p.inventoryNumber === item.printerInventoryNumber);
        if (repair) {
          store.updateRepair(repair.id, {
            status: 'repaired',
            completionDate: new Date().toISOString(),
            repairDescription: repair.repairDescription ?? 'Принят с заправки',
            locationStatus: 'ready',
          });
          store.cartridges
            .filter(c => c.linkedRepairId === repair.id && c.status === 'at_refill')
            .forEach(c => {
              store.updateCartridgeStatus(c.id, 'received_from_refill', `Получен с заправки вместе с принтером. Партия ${batchId}`);
            });
        }
        if (printer) {
          store.updatePrinter(printer.inventoryNumber, { refillCount: (printer.refillCount ?? 0) + 1 });
        }
        store.addRefillLog({
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          cartridgeId: printer?.programId ?? item.printerInventoryNumber,
          cartridgeModel: printer?.model ?? 'Устройство',
          consumableType: 'device',
          deviceType: printer?.printerType ?? 'Устройство',
          serviceType: 'Ремонт',
          printerInventoryNumber: item.printerInventoryNumber,
          printerModel: printer?.model ?? '',
          department: printer?.department ?? '',
          employee: printer?.boss,
          action: `Принтер получен с ремонта. Партия ${batchId}`,
          is_technical: false,
        });
        return;
      }
      const id = item.id;
      const cartridge = store.cartridges.find(c => c.id === id);
      store.updateCartridgeStatus(id, 'received_from_refill', `Получен с заправки. Партия ${batchId}`);
      if (cartridge) {
        const printer = store.printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
        store.addRefillLog({
          id: Math.random().toString(36).substr(2, 9),
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
    });
    store.setBatches(prev =>
      prev.map(b => (b.id === batchId ? { ...b, status: 'received' as const } : b)),
    );
  };

  const handleReplaceWithNew = (cartridge: Cartridge, batchId: string) => {
    const slot = store.allocateConsumableSlot(
      cartridge.printerInventoryNumber,
      cartridge.consumableType ?? 'cartridge',
    );
    const newId = store.generateConsumableId(cartridge.consumableType, cartridge.printerInventoryNumber, slot);
    const newCart: Cartridge = {
      ...cartridge,
      id: newId,
      barcode: newId,
      consumableSlot: slot,
      status: 'received_from_refill',
      refillCount: 0,
      registrationDate: new Date().toISOString(),
      isReplaced: false,
      replacedById: undefined,
      history: [{
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        action: `Заменён на новый вместо ${cartridge.id}. Партия ${batchId}`,
      }],
    };
    store.replaceCartridge(
      cartridge.id,
      newCart,
      `Списан при замене на ${newId}. Партия ${batchId}`,
    );
    store.setBatches(prev =>
      prev.map(batch => ({
        ...batch,
        cartridgeIds: (batch.cartridgeIds ?? []).map(id => (id === cartridge.id ? newId : id)),
        items: (batch.items ?? []).map(item =>
          item.kind === 'cartridge' && item.id === cartridge.id ? { ...item, id: newId } : item,
        ),
      })),
    );
    store.setEmployees(prev =>
      prev.map(e => (e.cartridgeId === cartridge.id ? { ...e, cartridgeId: newId } : e)),
    );
    const printer = store.printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
    store.addRefillLog({
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString(),
      cartridgeId: newId,
      cartridgeModel: newCart.model,
      consumableType: newCart.consumableType ?? 'cartridge',
      deviceType: newCart.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
      serviceType: 'Редактирование',
      printerInventoryNumber: newCart.printerInventoryNumber,
      printerModel: printer?.model ?? '',
      department: printer?.department ?? '',
      employee: printer?.boss,
      action: `Расходник заменён на новый (старый ID: ${cartridge.id}). Партия ${batchId}`,
      is_technical: true,
    });
  };

  const openIssueCartModal = (cartridgeId: string, batchId = '') => {
    const c = store.cartridges.find(x => x.id === cartridgeId);
    setIssueEmployee(c?.lastSubmittedBy ?? '');
    setIssueModal({ kind: 'cart', cartridgeId, ...(batchId ? { batchId } : {}) });
  };

  const openIssuePrinterModal = (item: RefillBatchItem, batchId = '') => {
    setIssueEmployee('');
    setIssueModal({ kind: 'printer', item, ...(batchId ? { batchId } : {}) });
  };

  const confirmIssueModal = () => {
    if (!issueModal) return;
    const batchId = issueModal.batchId ?? '';
    if (issueModal.kind === 'cart') {
      store.finishIssueCartridgeFromBatch(issueModal.cartridgeId, batchId, issueEmployee);
    } else {
      store.finishIssuePrinterBundleFromBatch(
        issueModal.item.printerInventoryNumber,
        issueModal.item.repairId,
        batchId,
        issueEmployee,
      );
    }
    setIssueModal(null);
    setIssueEmployee('');
  };

  const getBatchCartridges = (batch: RefillBatch) =>
    store.cartridges.filter(c => getBatchItems(batch).some(i => i.kind === 'cartridge' && i.id === c.id));
  const getBatchPrinters = (batch: RefillBatch) => getBatchItems(batch).filter(i => i.kind === 'printer');

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Фильтр: код, модель расходника, инв. принтера, модель принтера..."
          className="w-full pl-9 pr-8 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
            <X size={14} />
          </button>
        )}
      </div>

      {/* === Ожидают отправки === */}
      <section className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="bg-yellow-50 px-5 py-3.5 border-b border-yellow-100 flex flex-wrap gap-3 justify-between items-center">
          <div className="flex items-center space-x-2 text-yellow-800 font-bold uppercase text-sm">
            <Package size={18} />
            <span>Ожидают отправки ({waiting.length + waitingDevices.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCartridgesToExcel(waiting, 'waiting_refill', inv => getPrinter(inv)?.model)}
              className="px-3 py-1.5 bg-white border border-yellow-200 text-yellow-700 rounded-lg hover:bg-yellow-50 flex items-center space-x-1 text-xs font-semibold"
            >
              <Download size={13} />
              <span>Excel</span>
            </button>
            <button
              onClick={() => setShowSendDialog(true)}
              disabled={waiting.length === 0 && waitingDevices.length === 0}
              className="px-3 py-1.5 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 flex items-center space-x-1 text-xs font-bold"
            >
              <Truck size={13} />
              <span>
                Отправить
                {(selectedWaiting.size > 0 || selectedWaitingDevices.size > 0)
                  ? ` (${selectedWaiting.size + selectedWaitingDevices.size})`
                  : ' (все)'}
              </span>
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-400 border-b bg-gray-50/50">
                <th className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={selectedWaiting.size === waiting.length && waiting.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-2.5 font-semibold">Код</th>
                <th className="px-4 py-2.5 font-semibold">Тип</th>
                <th className="px-4 py-2.5 font-semibold">Модель</th>
                <th className="px-4 py-2.5 font-semibold">Принтер (Инв.)</th>
                <th className="px-4 py-2.5 font-semibold">Модель принтера</th>
                <th className="px-4 py-2.5 font-semibold">Подразделение</th>
                <th className="px-4 py-2.5 font-semibold">Кто сдал</th>
                <th className="px-4 py-2.5 font-semibold">Заправок</th>
                <th className="px-4 py-2.5 font-semibold">Дата приёма</th>
                <th className="px-4 py-2.5 font-semibold">Действия</th>
              </tr>
            </thead>
            <tbody>
              {filterCarts(waitingFreeCartridges).map(c => {
                const printer = getPrinter(c.printerInventoryNumber);
                return (
                <tr key={c.id} className="border-b last:border-0 hover:bg-yellow-50/40">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedWaiting.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => navigator.clipboard?.writeText(c.id)}
                      className="font-mono font-bold text-yellow-700 hover:underline"
                      title="Скопировать ID"
                    >
                      {c.id}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClassByLabel(consumableTypeLabel(c))}`}>
                      {consumableTypeLabel(c)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{c.model}</td>
                  <td className="px-4 py-2.5">{c.printerInventoryNumber}</td>
                  <td className="px-4 py-2.5 text-gray-600">{printer?.model || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{printer?.department || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{c.lastSubmittedBy || '—'}</td>
                  <td className="px-4 py-2.5 text-center">{c.refillCount}</td>
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                    {new Date(c.history[c.history.length - 1]?.date ?? c.registrationDate).toLocaleDateString('ru-RU')}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => store.cancelWaitingCartridgeIntake(c.id)}
                      className="px-2 py-1 text-[11px] border rounded text-orange-700 border-orange-200 hover:bg-orange-50"
                    >
                      Отменить
                    </button>
                  </td>
                </tr>
              );})}
              {filterCarts(waitingFreeCartridges).length === 0 && (
                null
              )}
              {waitingDevices
                .filter(d =>
                  d.id.toLowerCase().includes(q) ||
                  d.model.toLowerCase().includes(q) ||
                  d.printerInventoryNumber.toLowerCase().includes(q) ||
                  d.department.toLowerCase().includes(q) ||
                  d.employee.toLowerCase().includes(q),
                )
                .map(d => (
                  <React.Fragment key={`dev_group_${d.printerInventoryNumber}`}>
                    <tr className="border-b last:border-0 hover:bg-blue-50/30">
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selectedWaitingDevices.has(d.printerInventoryNumber)}
                          onChange={() => toggleSelectDevice(d.printerInventoryNumber)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-4 py-2.5 font-mono font-bold text-blue-700">{d.id}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClassByLabel('Устройство')}`}>Устройство</span>
                      </td>
                      <td className="px-4 py-2.5">{d.model}</td>
                      <td className="px-4 py-2.5">{d.printerInventoryNumber}</td>
                      <td className="px-4 py-2.5 text-gray-600">{d.model || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{d.department || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{d.employee || '—'}</td>
                      <td className="px-4 py-2.5 text-center">—</td>
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                        {new Date(d.date).toLocaleDateString('ru-RU')} · {d.status}
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => store.cancelWaitingRepairIntake(d.repairId)}
                          className="px-2 py-1 text-[11px] border rounded text-orange-700 border-orange-200 hover:bg-orange-50"
                        >
                          Отменить
                        </button>
                      </td>
                    </tr>
                    {waitingLinkedCartridges.filter(c => c.linkedRepairId === d.repairId).map(c => (
                      <tr key={`dev_cart_${d.repairId}_${c.id}`} className="border-b bg-blue-50/20">
                        <td className="px-4 py-2.5" />
                        <td className="px-4 py-2.5 font-mono text-blue-700">↳ {c.id}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClassByLabel(consumableTypeLabel(c))}`}>
                            {consumableTypeLabel(c)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">{c.model}</td>
                        <td className="px-4 py-2.5">{c.printerInventoryNumber}</td>
                        <td className="px-4 py-2.5 text-gray-600">{getPrinter(c.printerInventoryNumber)?.model || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{getPrinter(c.printerInventoryNumber)?.department || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{c.lastSubmittedBy || d.employee || '—'}</td>
                        <td className="px-4 py-2.5 text-center">{c.refillCount}</td>
                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{STATUS_LABELS[c.status]}</td>
                        <td className="px-4 py-2.5" />
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              {filterCarts(waitingFreeCartridges).length === 0 && waitingDevices.length === 0 && (
                <tr><td colSpan={11} className="py-10 text-center text-gray-400 italic">Склад пуст</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* === На заправке — партии === */}
      <section className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="bg-blue-50 px-5 py-3.5 border-b border-blue-100 flex items-center space-x-2 text-blue-800 font-bold uppercase text-sm">
          <Truck size={18} />
          <span>На заправке — партии ({filteredSentBatches.length})</span>
        </div>
        <div className="p-4 space-y-3">
          {filteredSentBatches.length === 0 && (
            <div className="py-8 text-center text-gray-400 italic">Нет активных партий</div>
          )}
          {filteredSentBatches.map(batch => {
            const carts = getBatchCartridges(batch);
            const expanded = expandedBatches.has(batch.id);
            const batchSender = batchSenderDisplay(batch);
            return (
              <div key={batch.id} className="border border-blue-200 rounded-xl overflow-hidden">
                <div className="flex justify-between items-center px-4 py-3 bg-blue-50/50">
                  <div>
                    <div className="font-bold text-blue-700">{batch.id}</div>
                    <div className="text-xs text-gray-500 flex items-center space-x-1 mt-0.5">
                      <Calendar size={12} />
                      <span>{new Date(batch.date).toLocaleDateString('ru-RU')}</span>
                      {batchSender && <span>· отправил: {batchSender}</span>}
                    </div>
                    <div className="text-xs text-gray-500">
                      Позиции: {getBatchItems(batch).length} шт. (картриджи: {carts.length}, устройства: {getBatchItems(batch).filter(i => i.kind === 'printer').length})
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {/* Export batch to Excel */}
                    <button
                      onClick={() => exportBatchToExcel(
                        batch,
                        carts.map(c => {
                          const p = getPrinter(c.printerInventoryNumber);
                          return { ...c, _printerModel: p?.model ?? '', _department: p?.department ?? '' } as Cartridge;
                        }),
                      )}
                      title="Экспорт партии в Excel"
                      className="p-1.5 border rounded-lg hover:bg-gray-100 text-gray-500"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      onClick={() => toggleBatch(batch.id)}
                      className="p-1.5 border rounded-lg hover:bg-blue-100 text-blue-600"
                    >
                      {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <button
                      onClick={() => handleReceiveFromRefill(batch.id)}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 flex items-center space-x-1"
                    >
                      <CheckSquare size={14} />
                      <span>Принять всё</span>
                    </button>
                    {store.settings.enableEventEditing && (
                      <button
                        onClick={() => {
                          const items = getBatchItems(batch);
                          items.forEach(item => {
                            if (item.kind === 'printer') {
                              const repair = item.repairId ? store.repairs.find(r => r.id === item.repairId) : undefined;
                              if (repair) store.updateRepair(repair.id, { status: 'waiting', locationStatus: 'waiting' });
                              return;
                            }
                            store.updateCartridgeStatus(item.id, 'waiting', `Отмена отправки партии ${batch.id}`);
                          });
                          store.setBatches(prev => prev.filter(x => x.id !== batch.id));
                        }}
                        className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-bold hover:bg-red-100 border border-red-200"
                      >
                        Отменить отправку
                      </button>
                    )}
                  </div>
                </div>
                {expanded && (
                  <div className="border-t">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-4 py-2 text-left font-semibold">Код</th>
                          <th className="px-4 py-2 text-left font-semibold">Тип</th>
                          <th className="px-4 py-2 text-left font-semibold">Модель</th>
                          <th className="px-4 py-2 text-left font-semibold">Принтер</th>
                          <th className="px-4 py-2 text-left font-semibold">Модель принтера</th>
                          <th className="px-4 py-2 text-left font-semibold">Подразделение</th>
                          <th className="px-4 py-2 text-left font-semibold">Кто сдал</th>
                          <th className="px-4 py-2 text-left font-semibold">Статус</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {getBatchPrinters(batch).map(item => {
                          const printer = getPrinter(item.printerInventoryNumber);
                          const repair = item.repairId ? store.repairs.find(r => r.id === item.repairId) : undefined;
                          return (
                            <React.Fragment key={`printer_${item.id}_${item.repairId ?? 'x'}`}>
                              <tr className="hover:bg-blue-50">
                                <td className="px-4 py-2 font-mono font-bold text-blue-700">{printer?.programId ?? item.id}</td>
                                <td className="px-4 py-2">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClassByLabel('Устройство')}`}>Устройство</span>
                                </td>
                                <td className="px-4 py-2">
                                  <span className="inline-flex items-center gap-1.5">
                                    <span>{printer?.model ?? 'Устройство'}</span>
                                    {printer?.firmwareFlashed && (
                                      <span className="inline-block w-2 h-2 rounded-full bg-red-500 shrink-0" title="Прошит" />
                                    )}
                                  </span>
                                </td>
                                <td className="px-4 py-2">{item.printerInventoryNumber}</td>
                                <td className="px-4 py-2 text-gray-600">{printer?.model || '—'}</td>
                                <td className="px-4 py-2">{printer?.department || '—'}</td>
                                <td className="px-4 py-2">{repair?.technician || printer?.boss || '—'}</td>
                                <td className="px-4 py-2">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${deviceStatusBadge(repair?.locationStatus === 'ready' ? 'Готов к выдаче' : 'В ремонте')}`}>
                                    {repair?.locationStatus === 'ready' ? 'Готов к выдаче' : 'В ремонте'}
                                  </span>
                                  {printer?.firmwareFlashed ? (
                                    <span className="ml-2 text-[10px] font-semibold text-gray-400" title="Прошивка выполнена">
                                      Прошит
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => store.updatePrinter(item.printerInventoryNumber, { firmwareFlashed: true })}
                                      className="ml-2 px-2 py-0.5 text-[10px] font-bold rounded border border-purple-200 text-purple-700 hover:bg-purple-50"
                                    >
                                      <Microchip size={10} className="inline mr-1 align-middle" />
                                      Прошит
                                    </button>
                                  )}
                                </td>
                              </tr>
                              {carts.filter(c => c.linkedRepairId === item.repairId).map(c => {
                                const linkedPrinter = getPrinter(c.printerInventoryNumber);
                                return (
                                  <tr key={`printer_linked_${item.repairId}_${c.id}`} className="hover:bg-blue-50/20">
                                    <td className="px-4 py-2 font-mono text-blue-700">↳ {c.id}</td>
                                    <td className="px-4 py-2">
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClassByLabel(consumableTypeLabel(c))}`}>
                                        {consumableTypeLabel(c)}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2">{c.model}</td>
                                    <td className="px-4 py-2">{c.printerInventoryNumber}</td>
                                    <td className="px-4 py-2 text-gray-600">{linkedPrinter?.model || '—'}</td>
                                    <td className="px-4 py-2">{linkedPrinter?.department || '—'}</td>
                                    <td className="px-4 py-2">{c.lastSubmittedBy || repair?.technician || '—'}</td>
                                    <td className="px-4 py-2">
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[c.status]}`}>
                                        {STATUS_LABELS[c.status]}
                                      </span>
                                      {c.status === 'at_refill' && (
                                        <button
                                          onClick={() => handleReplaceWithNew(c, batch.id)}
                                          className="ml-2 px-2 py-0.5 text-[10px] font-bold rounded border border-blue-200 text-blue-700 hover:bg-blue-50"
                                        >
                                          <RefreshCw size={10} className="inline mr-1" />
                                          Заменили на новый
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}
                        {carts.filter(c => !c.linkedRepairId).map(c => {
                          const printer = getPrinter(c.printerInventoryNumber);
                          return (
                          <tr key={c.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2">
                              <button
                                onClick={() => navigator.clipboard?.writeText(c.id)}
                                className="font-mono font-bold hover:underline"
                                title="Скопировать ID"
                              >
                                {c.id}
                              </button>
                            </td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClassByLabel(consumableTypeLabel(c))}`}>
                                {consumableTypeLabel(c)}
                              </span>
                            </td>
                            <td className="px-4 py-2">{c.model}</td>
                            <td className="px-4 py-2">{c.printerInventoryNumber}</td>
                            <td className="px-4 py-2 text-gray-600">{printer?.model || '—'}</td>
                            <td className="px-4 py-2">{printer?.department || '—'}</td>
                            <td className="px-4 py-2">{c.lastSubmittedBy || '—'}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[c.status]}`}>
                                {STATUS_LABELS[c.status]}
                              </span>
                              {c.status === 'at_refill' && (
                                <button
                                  onClick={() => handleReplaceWithNew(c, batch.id)}
                                  className="ml-2 px-2 py-0.5 text-[10px] font-bold rounded border border-blue-200 text-blue-700 hover:bg-blue-50"
                                >
                                  <RefreshCw size={10} className="inline mr-1" />
                                  Заменили на новый
                                </button>
                              )}
                            </td>
                          </tr>
                        );})}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* === Готовы к выдаче === */}
      <section className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="bg-green-50 px-5 py-3.5 border-b border-green-100 flex justify-between items-center">
          <div className="flex items-center space-x-2 text-green-800 font-bold uppercase text-sm">
            <CheckSquare size={18} />
            <span>Готовы к выдаче ({readyFreeCartridges.length + readyDevices.length})</span>
          </div>
          <button
            onClick={() => exportCartridgesToExcel(received, 'ready_to_handout', inv => getPrinter(inv)?.model)}
            className="px-3 py-1.5 bg-white border border-green-200 text-green-700 rounded-lg hover:bg-green-50 flex items-center space-x-1 text-xs font-semibold"
          >
            <Download size={13} />
            <span>Excel</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-400 border-b bg-gray-50/50">
                <th className="px-4 py-2.5 font-semibold">Код</th>
                <th className="px-4 py-2.5 font-semibold">Тип</th>
                <th className="px-4 py-2.5 font-semibold">Модель</th>
                <th className="px-4 py-2.5 font-semibold">Принтер (Инв.)</th>
                <th className="px-4 py-2.5 font-semibold">Модель принтера</th>
                <th className="px-4 py-2.5 font-semibold">Подразделение</th>
                <th className="px-4 py-2.5 font-semibold">Кто сдал</th>
                <th className="px-4 py-2.5 font-semibold">Заправок</th>
                <th className="px-4 py-2.5 font-semibold">Статус</th>
                <th className="px-4 py-2.5 font-semibold">Выдача</th>
                {store.settings.enableEventEditing && <th className="px-4 py-2.5 font-semibold">Действия</th>}
              </tr>
            </thead>
            <tbody>
              {filterCarts(readyFreeCartridges).map(c => {
                const printer = getPrinter(c.printerInventoryNumber);
                return (
                <tr key={c.id} className="border-b last:border-0 hover:bg-green-50/30">
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => navigator.clipboard?.writeText(c.id)}
                      className="font-mono font-bold text-green-700 hover:underline"
                      title="Скопировать ID"
                    >
                      {c.id}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClassByLabel(consumableTypeLabel(c))}`}>
                      {consumableTypeLabel(c)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{c.model}</td>
                  <td className="px-4 py-2.5">{c.printerInventoryNumber}</td>
                  <td className="px-4 py-2.5 text-gray-600">{printer?.model || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{printer?.department || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{c.lastSubmittedBy || '—'}</td>
                  <td className="px-4 py-2.5 text-center">{c.refillCount}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${STATUS_COLORS[c.status]}`}>
                      {STATUS_LABELS[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openIssueCartModal(c.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg border border-green-300 bg-green-50 text-green-800 hover:bg-green-100"
                    >
                      <Send size={13} />
                      Выдать
                    </button>
                  </td>
                  {store.settings.enableEventEditing && (
                    <td className="px-4 py-2.5">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            store.updateCartridgeStatus(c.id, 'waiting', 'Отмена статуса "Готов к выдаче"');
                            store.updateCartridge(c.id, { refillCount: Math.max(0, (c.refillCount ?? 0) - 1) });
                          }}
                          className="px-2 py-1 text-[11px] border rounded text-orange-700 border-orange-200 hover:bg-orange-50"
                        >
                          Отменить готовность
                        </button>
                        <button
                          onClick={() => store.removeCartridge(c.id)}
                          className="px-2 py-1 text-[11px] border rounded text-red-700 border-red-200 hover:bg-red-50"
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );})}
              {readyDevices.map(r => {
                const printer = getPrinter(r.printerInventoryNumber);
                return (
                  <tr key={`ready_${r.id}`} className="border-b last:border-0 hover:bg-green-50/30">
                    <td className="px-4 py-2.5 font-mono font-bold text-green-700">{printer?.programId ?? r.printerInventoryNumber}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClassByLabel('Устройство')}`}>Устройство</span>
                    </td>
                    <td className="px-4 py-2.5">{printer?.model ?? 'Устройство'}</td>
                    <td className="px-4 py-2.5">{r.printerInventoryNumber}</td>
                    <td className="px-4 py-2.5 text-gray-600">{printer?.model || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600">{printer?.department || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.technician || printer?.boss || '—'}</td>
                    <td className="px-4 py-2.5 text-center">{printer?.refillCount ?? 0}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${deviceStatusBadge('Готов к выдаче')}`}>Готов к выдаче</span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {r.locationStatus === 'ready' && (
                        <button
                          type="button"
                          onClick={() =>
                            openIssuePrinterModal(
                              {
                                kind: 'printer',
                                id: printer?.programId ?? r.printerInventoryNumber,
                                printerInventoryNumber: r.printerInventoryNumber,
                                repairId: r.id,
                              },
                              '',
                            )}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg border border-green-300 bg-green-50 text-green-800 hover:bg-green-100"
                        >
                          <Send size={13} />
                          Выдать
                        </button>
                      )}
                    </td>
                    {store.settings.enableEventEditing && (
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            store.updateRepair(r.id, { status: 'waiting', locationStatus: 'waiting', completionDate: undefined });
                            if (printer) store.updatePrinter(printer.inventoryNumber, { refillCount: Math.max(0, (printer.refillCount ?? 0) - 1) });
                          }}
                          className="px-2 py-1 text-[11px] border rounded text-orange-700 border-orange-200 hover:bg-orange-50"
                        >
                          Отменить готовность
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {filterCarts(readyFreeCartridges).length === 0 && readyDevices.length === 0 && (
                <tr><td colSpan={store.settings.enableEventEditing ? 11 : 10} className="py-10 text-center text-gray-400 italic">Нет готовых позиций</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* История закрытых партий */}
      {filteredReceivedBatches.length > 0 && (
        <section className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="bg-gray-50 px-5 py-3.5 border-b flex items-center space-x-2 text-gray-600 font-bold uppercase text-sm">
            <Calendar size={18} />
            <span>Закрытые партии ({filteredReceivedBatches.length})</span>
          </div>
          <div className="divide-y">
            {filteredReceivedBatches.slice().reverse().map(batch => {
              const expanded = expandedBatches.has(batch.id);
              const carts = getBatchCartridges(batch);
              const batchSender = batchSenderDisplay(batch);
              return (
                <div key={batch.id} className="text-sm">
                  <div className="px-5 py-3 flex justify-between items-center">
                    <div>
                      <span className="font-bold text-gray-700">{batch.id}</span>
                      {batchSender && <span className="ml-2 text-gray-500 text-xs">отправил: {batchSender}</span>}
                    </div>
                    <div className="flex items-center space-x-4 text-xs text-gray-400">
                      <span>{new Date(batch.date).toLocaleDateString('ru-RU')}</span>
                      <span>{getBatchItems(batch).length} шт.</span>
                      <button onClick={() => toggleBatch(batch.id)} className="p-1 hover:text-gray-600" title="Развернуть">
                        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                      <button
                        onClick={() => exportBatchToExcel(
                          batch,
                          carts.map(c => {
                            const p = getPrinter(c.printerInventoryNumber);
                            return { ...c, _printerModel: p?.model ?? '', _department: p?.department ?? '' } as Cartridge;
                          }),
                        )}
                        title="Экспорт в Excel"
                        className="p-1 hover:text-gray-600"
                      >
                        <Download size={12} />
                      </button>
                      {store.settings.enableEventEditing && (
                        <button
                          onClick={() => store.setBatches(prev => prev.filter(x => x.id !== batch.id))}
                          className="p-1 hover:text-red-600"
                          title="Удалить закрытую партию"
                        >
                          <X size={12} />
                        </button>
                      )}
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold">ПОЛУЧЕНО</span>
                    </div>
                  </div>
                  {expanded && (
                    <div className="px-5 pb-3">
                      <table className="w-full text-xs border rounded-lg overflow-hidden">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-1 text-left">ID</th>
                            <th className="px-2 py-1 text-left">Инв. №</th>
                            <th className="px-2 py-1 text-left">Тип</th>
                            <th className="px-2 py-1 text-left">Модель</th>
                            <th className="px-2 py-1 text-left">Модель принтера</th>
                            <th className="px-2 py-1 text-left">Кто сдал</th>
                            <th className="px-2 py-1 text-left">Статус</th>
                            <th className="px-2 py-1 text-left">Кто забрал</th>
                          </tr>
                        </thead>
                        <tbody>
                          {getBatchPrinters(batch).map(item => {
                            const printer = getPrinter(item.printerInventoryNumber);
                            const repair = item.repairId ? store.repairs.find(r => r.id === item.repairId) : undefined;
                            const deviceHandout = findDeviceHandoutName(
                              item.printerInventoryNumber,
                              printer?.programId,
                              store.refillLog,
                            );
                            const whoCollectedDisplay =
                              repair?.locationStatus === 'issued'
                                ? (deviceHandout || '—')
                                : (deviceHandout || 'На складе (готов к выдаче)');
                            return (
                              <React.Fragment key={`closed_group_${item.id}_${item.repairId ?? 'norepair'}`}>
                                <tr className="border-t">
                                  <td className="px-2 py-1 font-mono">{printer?.programId ?? item.id}</td>
                                  <td className="px-2 py-1 font-mono">{item.printerInventoryNumber}</td>
                                  <td className="px-2 py-1">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClassByLabel('Устройство')}`}>Устройство</span>
                                  </td>
                                  <td className="px-2 py-1">{printer?.model ?? 'Устройство'}</td>
                                  <td className="px-2 py-1 text-gray-600">{printer?.model || '—'}</td>
                                  <td className="px-2 py-1 text-gray-700">{repair?.technician || printer?.boss || '—'}</td>
                                  <td className="px-2 py-1">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${repair?.locationStatus === 'ready' ? deviceStatusBadge('Готов к выдаче') : (repair?.locationStatus === 'issued' ? 'bg-sky-100 text-sky-700' : deviceStatusBadge('В ремонте'))}`}>
                                      {repair?.locationStatus === 'issued' ? 'Выдан' : repair?.locationStatus === 'ready' ? 'Готов к выдаче' : 'В ремонте'}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1">{whoCollectedDisplay}</td>
                                </tr>
                                {carts.filter(c => c.linkedRepairId === item.repairId).map(c => {
                                  const handoutName = findCartridgeHandoutName(c, store.refillLog);
                                  const cartPrinter = getPrinter(c.printerInventoryNumber);
                                  return (
                                    <tr key={`closed_linked_${item.repairId}_${c.id}`} className="border-t bg-gray-50/60">
                                      <td className="px-2 py-1 font-mono">↳ {c.id}</td>
                                      <td className="px-2 py-1 font-mono">{c.printerInventoryNumber}</td>
                                      <td className="px-2 py-1">
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClassByLabel(consumableTypeLabel(c))}`}>
                                          {consumableTypeLabel(c)}
                                        </span>
                                      </td>
                                      <td className="px-2 py-1">{c.model}</td>
                                      <td className="px-2 py-1 text-gray-600">{cartPrinter?.model || '—'}</td>
                                      <td className="px-2 py-1 text-gray-700">{c.lastSubmittedBy || repair?.technician || '—'}</td>
                                      <td className="px-2 py-1">{STATUS_LABELS[c.status]}</td>
                                      <td className="px-2 py-1">
                                        {c.replacedById ? `Изменен ID на ${c.replacedById}` : (handoutName || 'В комплекте с принтером')}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })}
                          {carts.filter(c => !c.linkedRepairId).map(c => {
                            const handoutName = findCartridgeHandoutName(c, store.refillLog);
                            const cartPrinter = getPrinter(c.printerInventoryNumber);
                            return (
                              <tr key={c.id} className="border-t">
                                <td className="px-2 py-1 font-mono">{c.id}</td>
                                <td className="px-2 py-1 font-mono">{c.printerInventoryNumber}</td>
                                <td className="px-2 py-1">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClassByLabel(consumableTypeLabel(c))}`}>
                                    {consumableTypeLabel(c)}
                                  </span>
                                </td>
                                <td className="px-2 py-1">{c.model}</td>
                                <td className="px-2 py-1 text-gray-600">{cartPrinter?.model || '—'}</td>
                                <td className="px-2 py-1 text-gray-700">{c.lastSubmittedBy || '—'}</td>
                                <td className="px-2 py-1">{STATUS_LABELS[c.status]}</td>
                                <td className="px-2 py-1">
                                  {c.replacedById ? `Изменен ID на ${c.replacedById}` : (handoutName || 'На складе (готов к выдаче)')}
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
        </section>
      )}

      {issueModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h2 className="text-lg font-bold mb-1">
              {issueModal.kind === 'cart' ? 'Выдача расходника' : 'Выдача устройства и комплектующих'}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              {issueModal.kind === 'cart'
                ? (issueModal.batchId
                  ? 'Если расходник ещё «На заправке», он будет принят с заправки и сразу отмечен как выданный («На руках»).'
                  : 'Расходник со склада «Готов к выдаче» будет отмечен как выданный пользователю («На руках»).')
                : 'Устройство и связанные с этим ремонтом расходники: при необходимости приём с заправки и выдача вместе, без сканера.'}
            </p>
            <label className="text-xs text-gray-500 block mb-1">Кому выдать (ФИО, необязательно)</label>
            <input
              type="text"
              value={issueEmployee}
              onChange={e => setIssueEmployee(e.target.value)}
              placeholder="Фамилия И.О."
              className="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setIssueModal(null); setIssueEmployee(''); }}
                className="px-4 py-2 rounded-lg border text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={confirmIssueModal}
                className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-bold hover:bg-green-700 inline-flex items-center gap-2"
              >
                <Send size={16} />
                Выдать
              </button>
            </div>
          </div>
        </div>
      )}

      {showSendDialog && (
        <SendBatchDialog
          cartridges={selectedWaiting.size > 0 ? waiting.filter(c => selectedWaiting.has(c.id)) : waiting}
          deviceCount={selectedWaitingDevices.size > 0 ? store.repairs.filter(r => r.status === 'waiting' && selectedWaitingDevices.has(r.printerInventoryNumber)).length : store.repairs.filter(r => r.status === 'waiting').length}
          employeeSuggestions={senderSuggestions}
          onRemoveSuggestion={(name) => {
            const next = senderList.filter(x => x !== name);
            setSenderList(next);
            localStorage.setItem('inventory_sender_list', JSON.stringify(next));
          }}
          onConfirm={handleSendToRefill}
          onCancel={() => setShowSendDialog(false)}
        />
      )}
    </div>
  );
};

export default InventoryTab;
