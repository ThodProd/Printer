/**
 * Отдельный реестр вкладки «Склад»: позиции, история партий (отправок) и журнал аудита.
 * Сохраняется в общей базе приложения (Electron / localStorage).
 */

export type WarehouseItemType = 'Устройство' | 'Картридж' | 'Драм-картридж';

export type WarehouseItemStatus = 'waiting' | 'at_refill' | 'ready' | 'issued';

export interface WarehouseItem {
  id: string;
  type: WarehouseItemType;
  model: string;
  printerInventoryNumber: string;
  printerModel: string;
  department: string;
  submittedBy: string;
  refillCount: number;
  status: WarehouseItemStatus;
  registrationDate: string;
  currentBatchId?: string;
  whoPickedUp?: string;
  issueDate?: string;
  parentDeviceId?: string;
  /** Для типа «Устройство»: связь с заявкой ремонта */
  repairId?: string;
}

export interface WarehouseBatchItem {
  id: string;
  type: WarehouseItemType;
  model: string;
  printerInventoryNumber: string;
  printerModel: string;
  department: string;
  submittedBy: string;
  refillCount: number;
  status: 'at_refill' | 'ready' | 'issued' | 'replaced';
  whoPickedUp?: string;
  issueDate?: string;
  parentDeviceId?: string;
  replacementId?: string;
  repairId?: string;
  /** Строка добавлена заменой «новым» — без повторной кнопки «Замена новым». */
  fromReplacement?: boolean;
}

/** Партия отправки на заправку / в сервис (полная история, в т.ч. отменённые). */
export type WarehouseShipmentStatus = 'sent' | 'received' | 'closed' | 'cancelled';

export interface WarehouseShipmentBatch {
  id: string;
  dateSent: string;
  dateReceived?: string;
  sender: string;
  notes?: string;
  status: WarehouseShipmentStatus;
  items: WarehouseBatchItem[];
}

export interface WarehouseAuditLogEntry {
  id: string;
  date: string;
  action: string;
  details: string;
  user?: string;
  type: 'info' | 'success' | 'warning' | 'danger';
}

export interface WarehouseLedgerState {
  items: WarehouseItem[];
  shipmentBatches: WarehouseShipmentBatch[];
  auditLogs: WarehouseAuditLogEntry[];
  viewMode?: 'classic' | 'dashboard' | 'compact';
  darkMode?: boolean;
}

export const DEFAULT_WAREHOUSE_LEDGER: WarehouseLedgerState = {
  items: [],
  shipmentBatches: [],
  auditLogs: [],
  viewMode: 'classic',
  darkMode: false,
};
