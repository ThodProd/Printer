import type {
  WarehouseBatchItem,
  WarehouseItem,
  WarehouseShipmentBatch,
} from '../types/warehouseLedger';

function statusItemLabel(st: WarehouseItem['status']): string {
  switch (st) {
    case 'waiting':
      return 'Ожидает отправки';
    case 'at_refill':
      return 'На заправке';
    case 'ready':
      return 'Готов к выдаче';
    case 'issued':
      return 'Выдан на руки';
    default:
      return String(st);
  }
}

function statusBatchItemLabel(st: WarehouseBatchItem['status']): string {
  switch (st) {
    case 'at_refill':
      return 'На заправке';
    case 'ready':
      return 'Готов к выдаче';
    case 'replaced':
      return 'Заменён';
    case 'issued':
      return 'Выдан';
    default:
      return String(st);
  }
}

function statusBatchLabel(st: WarehouseShipmentBatch['status']): string {
  switch (st) {
    case 'sent':
      return 'На заправке';
    case 'received':
      return 'Получена';
    case 'closed':
      return 'Закрыта';
    case 'cancelled':
      return 'Отменена';
    default:
      return String(st);
  }
}

/** Все поля позиции склада для Excel. */
export function warehouseItemsToExcelRows(items: WarehouseItem[]): Record<string, string | number>[] {
  return items.map(c => ({
    'Код ID': c.id,
    Тип: c.type,
    Модель: c.model,
    'Инв. № принтера': c.printerInventoryNumber,
    'Модель принтера': c.printerModel,
    Подразделение: c.department,
    'Кто сдал': c.submittedBy,
    Заправок: c.refillCount,
    'Статус (код)': c.status,
    Статус: statusItemLabel(c.status),
    'Родитель (ID устройства)': c.parentDeviceId ?? '—',
    'Заявка ремонта (ID)': c.repairId ?? '—',
    'Текущая партия': c.currentBatchId ?? '—',
    'Кто забрал': c.whoPickedUp ?? '—',
    'Дата регистрации': new Date(c.registrationDate).toLocaleString('ru-RU'),
    'Дата регистрации (ISO)': c.registrationDate,
    'Дата выдачи': c.issueDate ? new Date(c.issueDate).toLocaleString('ru-RU') : '—',
    'Дата выдачи (ISO)': c.issueDate ?? '—',
  }));
}

/** Строки содержимого партии + метаданные партии в каждой строке (удобно фильтровать в Excel). */
export function warehouseShipmentBatchToExcelRows(
  batch: WarehouseShipmentBatch,
): Record<string, string | number>[] {
  const baseBatch = {
    Партия: batch.id,
    'Статус партии (код)': batch.status,
    'Статус партии': statusBatchLabel(batch.status),
    'Дата отправки': new Date(batch.dateSent).toLocaleString('ru-RU'),
    'Дата отправки (ISO)': batch.dateSent,
    'Дата возврата': batch.dateReceived
      ? new Date(batch.dateReceived).toLocaleString('ru-RU')
      : '—',
    'Дата возврата (ISO)': batch.dateReceived ?? '—',
    Отправил: batch.sender,
    Примечания: batch.notes ?? '—',
  };

  return batch.items.map(i => ({
    ...baseBatch,
    'ID позиции': i.id,
    Тип: i.type,
    Модель: i.model,
    'Инв. № принтера': i.printerInventoryNumber,
    'Модель принтера': i.printerModel,
    Подразделение: i.department,
    'Кто сдал': i.submittedBy,
    Заправок: i.refillCount,
    'Статус (код)': i.status,
    Статус: statusBatchItemLabel(i.status),
    'Родитель (ID устройства)': i.parentDeviceId ?? '—',
    'Заявка ремонта (ID)': i.repairId ?? '—',
    'Замена (новый ID)': i.replacementId ?? '—',
    'Кто забрал': i.whoPickedUp ?? '—',
    'Дата выдачи': i.issueDate ? new Date(i.issueDate).toLocaleString('ru-RU') : '—',
    'Дата выдачи (ISO)': i.issueDate ?? '—',
  }));
}

/** Одна строка сводки по партии (лист «Информация о партии»). */
export function warehouseBatchInfoRow(
  batch: WarehouseShipmentBatch,
): Record<string, string | number>[] {
  return [
    {
      Партия: batch.id,
      'Статус (код)': batch.status,
      Статус: statusBatchLabel(batch.status),
      'Дата отправки': new Date(batch.dateSent).toLocaleString('ru-RU'),
      'Дата отправки (ISO)': batch.dateSent,
      'Дата возврата': batch.dateReceived
        ? new Date(batch.dateReceived).toLocaleString('ru-RU')
        : '—',
      'Дата возврата (ISO)': batch.dateReceived ?? '—',
      Отправил: batch.sender,
      Примечания: batch.notes ?? '—',
      'Позиций в партии': batch.items.length,
    },
  ];
}
