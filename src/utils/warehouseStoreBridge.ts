import type { Cartridge, Printer, RefillBatch, RefillBatchItem, RepairEntry } from '../types';
import type {
  WarehouseAuditLogEntry,
  WarehouseItem,
  WarehouseItemStatus,
  WarehouseItemType,
  WarehouseLedgerState,
  WarehouseShipmentBatch,
} from '../types/warehouseLedger';

export function nextShipmentBatchId(batches: WarehouseShipmentBatch[]): string {
  const year = new Date().getFullYear();
  const re = new RegExp(`^ПАРТИЯ-${year}-(\\d+)$`);
  let max = 0;
  for (const b of batches) {
    const m = re.exec(b.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `ПАРТИЯ-${year}-${String(max + 1).padStart(3, '0')}`;
}

function cartridgeStatusToWarehouse(c: Cartridge): WarehouseItemStatus | null {
  switch (c.status) {
    case 'waiting':
      return 'waiting';
    case 'at_refill':
      return 'at_refill';
    case 'received_from_refill':
    case 'ready':
      return 'ready';
    default:
      return null;
  }
}

function consumableTypeLabel(c: Cartridge): WarehouseItemType {
  return c.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж';
}

/** Строка устройства на складе — тот же идентификатор, что на этикетке принтера (programId или инв. №). */
function resolveParentDeviceId(
  c: Cartridge,
  repairs: RepairEntry[],
  printers: Printer[],
): string | undefined {
  if (!c.linkedRepairId) return undefined;
  const r = repairs.find(rep => rep.id === c.linkedRepairId);
  if (!r) return undefined;
  if ((r.locationStatus ?? '') === 'issued') return undefined;
  if (r.status !== 'waiting' && r.status !== 'in_repair' && r.status !== 'repaired') return undefined;
  const p = printers.find(pr => pr.inventoryNumber === r.printerInventoryNumber);
  return p?.programId ?? r.printerInventoryNumber;
}

/** Строка склада из расходника (только для синхронизации с основной БД). */
export function warehouseItemFromCartridge(c: Cartridge, printer?: Printer): WarehouseItem | null {
  const st = cartridgeStatusToWarehouse(c);
  if (st == null) return null;
  return {
    id: c.id,
    type: consumableTypeLabel(c),
    model: c.model,
    printerInventoryNumber: c.printerInventoryNumber || '—',
    printerModel: printer?.model ?? '—',
    department: printer?.department ?? '—',
    submittedBy: c.lastSubmittedBy?.trim() || '—',
    refillCount: c.refillCount ?? 0,
    status: st,
    registrationDate: c.registrationDate,
    parentDeviceId: undefined,
  };
}

function repairLocationToWarehouseStatus(
  r: RepairEntry,
): 'waiting' | 'at_refill' | 'ready' | null {
  const ls = r.locationStatus ?? 'waiting';
  if (ls === 'waiting') return 'waiting';
  if (ls === 'at_refill') return 'at_refill';
  if (ls === 'ready') return 'ready';
  return null;
}

export function warehouseItemFromRepair(r: RepairEntry, printer?: Printer): WarehouseItem | null {
  if ((r.locationStatus ?? '') === 'issued') return null;
  if (r.status !== 'waiting' && r.status !== 'in_repair' && r.status !== 'repaired') return null;
  const st = repairLocationToWarehouseStatus(r);
  if (st == null) return null;
  const id = printer?.programId ?? r.printerInventoryNumber;
  return {
    id,
    type: 'Устройство',
    model: printer?.model ?? 'Устройство',
    printerInventoryNumber: r.printerInventoryNumber,
    printerModel: printer?.model ?? '—',
    department: printer?.department ?? '—',
    submittedBy: (r.technician ?? printer?.boss ?? '—').trim() || '—',
    refillCount: 0,
    status: st,
    registrationDate: r.date,
    repairId: r.id,
  };
}

/**
 * Объединяет сохранённый реестр вкладки с текущими данными принтеров/расходников из основной БД:
 * новые «ожидающие» из приёмной появляются на складе; выданные строки не перезаписываются из стора.
 */
export function mergeLedgerWithStore(
  ledger: WarehouseLedgerState,
  cartridges: Cartridge[],
  repairs: RepairEntry[],
  printers: Printer[],
): WarehouseItem[] {
  const byId = new Map<string, WarehouseItem>();
  for (const it of ledger.items) {
    byId.set(it.id, { ...it });
  }

  const printerByInv = (inv: string) => printers.find(p => p.inventoryNumber === inv);

  for (const c of cartridges) {
    let fromCart = warehouseItemFromCartridge(c, printerByInv(c.printerInventoryNumber));
    if (!fromCart) continue;
    const parentDeviceId = resolveParentDeviceId(c, repairs, printers);
    fromCart = { ...fromCart, parentDeviceId };
    const existing = byId.get(c.id);
    /**
     * В persisted ledger может остаться status «issued» после прошлого цикла; если в основной базе
     * расходник снова waiting / at_refill / ready — показываем актуальное состояние, иначе строка
     * не попадает в «Ожидают» и кажется «пропавшей» со склада.
     */
    if (existing?.status === 'issued') {
      const reopened =
        fromCart.status === 'waiting' ||
        fromCart.status === 'at_refill' ||
        fromCart.status === 'ready';
      if (reopened) {
        byId.set(c.id, {
          ...existing,
          ...fromCart,
          currentBatchId: fromCart.status === 'at_refill' ? existing.currentBatchId : undefined,
          whoPickedUp: undefined,
          issueDate: undefined,
          parentDeviceId,
        });
      }
      continue;
    }
    if (existing) {
      byId.set(c.id, {
        ...existing,
        ...fromCart,
        /** Партия только у строк «на заправке»; при переходе в «готов» ссылку на партию сбрасываем */
        currentBatchId: fromCart.status === 'at_refill' ? existing.currentBatchId : undefined,
        whoPickedUp: existing.whoPickedUp,
        issueDate: existing.issueDate,
        parentDeviceId,
      });
    } else {
      byId.set(c.id, fromCart);
    }
  }

  /** Убрать «висячие» строки картриджа в ledger, если в основной базе он уже на руках / вне склада */
  for (const c of cartridges) {
    if (cartridgeStatusToWarehouse(c) != null) continue;
    const ex = byId.get(c.id);
    if (ex && (ex.type === 'Картридж' || ex.type === 'Драм-картридж')) {
      byId.delete(c.id);
    }
  }

  for (const r of repairs) {
    const printer = printerByInv(r.printerInventoryNumber);
    const fromRep = warehouseItemFromRepair(r, printer);
    if (!fromRep) continue;
    const existing = byId.get(fromRep.id);
    if (existing?.status === 'issued') {
      const reopenActiveRepair =
        fromRep.type === 'Устройство' && (r.locationStatus ?? 'waiting') !== 'issued';
      if (reopenActiveRepair) {
        byId.set(fromRep.id, { ...fromRep });
      }
      continue;
    }
    if (existing) {
      byId.set(fromRep.id, {
        ...existing,
        ...fromRep,
        currentBatchId:
          fromRep.status === 'waiting'
            ? undefined
            : existing.currentBatchId,
        whoPickedUp: existing.whoPickedUp,
        issueDate: existing.issueDate,
      });
    } else {
      byId.set(fromRep.id, fromRep);
    }
  }

  /** Убрать «висячие» строки принтера/устройства в ledger, если в основной базе ремонт уже выдан/закрыт */
  for (const r of repairs) {
    if ((r.locationStatus ?? '') !== 'issued') continue;
    const hasActiveRepair = repairs.some(
      other =>
        other.id !== r.id &&
        other.printerInventoryNumber === r.printerInventoryNumber &&
        (other.locationStatus ?? 'waiting') !== 'issued' &&
        (other.status === 'waiting' || other.status === 'in_repair' || other.status === 'repaired'),
    );
    if (hasActiveRepair) continue;
    const id = printerByInv(r.printerInventoryNumber)?.programId ?? r.printerInventoryNumber;
    const ex = byId.get(id);
    if (ex && ex.type === 'Устройство') {
      byId.delete(id);
    }
  }

  return Array.from(byId.values());
}

export function buildLegacyRefillBatch(
  batchId: string,
  sender: string,
  notes: string | undefined,
  cartridgeIds: string[],
  items: RefillBatchItem[],
): RefillBatch {
  return {
    id: batchId,
    date: new Date().toISOString(),
    cartridgeIds,
    items,
    status: 'sent',
    company: sender || undefined,
    notes: notes || undefined,
  };
}

export function newAuditEntry(
  action: string,
  details: string,
  type: WarehouseAuditLogEntry['type'] = 'info',
  user = 'Администратор',
): WarehouseAuditLogEntry {
  return {
    id: `L-${Math.random().toString(36).substring(2, 11)}`,
    date: new Date().toISOString(),
    action,
    details,
    user,
    type,
  };
}
