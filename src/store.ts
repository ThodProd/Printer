import { applyChanges, applyRowActions, Change, ReferenceRowAction } from './utils/reconcile';

import { useState, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  Printer,
  Cartridge,
  RepairEntry,
  RefillBatch,
  HistoryEntry,
  CartridgeStatus,
  AppSettings,
  DEFAULT_SETTINGS,
  STATUS_LABELS,
  EmployeeRecord,
  RefillLogEntry,
  ConsumableType,
  NewCartridge,
  PrinterModelMapping,
} from './types';
import {
  DEFAULT_WAREHOUSE_LEDGER,
  type WarehouseBatchItem,
  type WarehouseLedgerState,
  type WarehouseShipmentBatch,
} from './types/warehouseLedger';

interface DatabaseData {
  version: 1;
  savedAt: string;
  printers: Printer[];
  cartridges: Cartridge[];
  repairs: RepairEntry[];
  batches: RefillBatch[];
  settings: AppSettings;
  employees: EmployeeRecord[];
  refillLog: RefillLogEntry[];
  newCartridges: NewCartridge[];
  modelCatalog: PrinterModelMapping[];
  warehouseLedger: WarehouseLedgerState;
}

function readLocalStorage<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) as T : fallback;
  } catch {
    return fallback;
  }
}

function shouldUseFileDatabase() {
  return !!window.desktopAPI?.loadDatabase;
}

function useDebouncedDatabase(data: DatabaseData, hydrated: boolean, onError: (error: string) => void) {
  const timer = useRef<number | undefined>(undefined);
  const persist = async (snapshot: DatabaseData, backup?: DatabaseData) => {
    if (window.desktopAPI?.saveDatabase) {
      const result = await window.desktopAPI.saveDatabase(snapshot, backup);
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить базу');
      return result.backupPath ?? result.path;
    }
    // Browser preview: keep a complete backup before updating legacy storage keys.
    if (backup) localStorage.setItem('reference_backup_' + Date.now(), JSON.stringify(backup));
    for (const [key, value] of Object.entries({ printers: snapshot.printers, cartridges: snapshot.cartridges,
      repairs: snapshot.repairs, batches: snapshot.batches, app_settings: snapshot.settings,
      employees: snapshot.employees, refill_log: snapshot.refillLog, new_cartridges: snapshot.newCartridges,
      model_catalog: snapshot.modelCatalog, warehouse_ledger: snapshot.warehouseLedger })) {
      localStorage.setItem(key, JSON.stringify(value));
    }
    return 'локальное хранилище браузера';
  };
  useEffect(() => {
    if (!hydrated) return;
    timer.current = window.setTimeout(() => {
      void persist(data).then(() => onError('')).catch(error => onError(String(error)));
    }, 500);
    return () => window.clearTimeout(timer.current);
  }, [data, hydrated]);
  return async (snapshot: DatabaseData, backup?: DatabaseData) => {
    window.clearTimeout(timer.current);
    return persist(snapshot, backup);
  };
}

/** Generate a short 6-char alphanumeric ID with type prefix: e.g. "C-AB3F7K" */
function generateShortId(prefix: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 6; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${rand}`;
}

function normalizeInventoryNumber(value: string): string {
  return value.replace(/^\s*Инв\.\s*№\s*/i, '').trim();
}

function migratePrinter(p: Partial<Printer> & { inventoryNumber: string }): Printer {
  const inventoryNumber = normalizeInventoryNumber(p.inventoryNumber);
  return {
    ...p,
    programId: (p as any).programId ?? generateShortId('P'),
    inventoryNumber,
    model: p.model ?? '',
    printerType: (p as any).printerType ?? 'printer',
    department: p.department ?? '',
    boss: p.boss ?? (p as any).employee ?? '',
    cartridgeModels: p.cartridgeModels ?? [],
    drumModels: p.drumModels ?? [],
    commissionDate: p.commissionDate ?? '',
    balanceCost: p.balanceCost ?? '',
    firmwareFlashed: p.firmwareFlashed === true,
    isDecommissioned: p.isDecommissioned ?? false,
    decommissionedAt: p.decommissionedAt,
    refillCount: p.refillCount ?? 0,
    repairCount: p.repairCount ?? 0,
    consumableCartridgeSeq: p.consumableCartridgeSeq ?? 0,
    consumableDrumSeq: p.consumableDrumSeq ?? 0,
  };
}

const cleanModels = (values: string[] | undefined) => [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))];
const modelKey = (value: string) => value.trim().toLocaleLowerCase('ru');

function migrateModelCatalog(value: unknown): PrinterModelMapping[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<string, PrinterModelMapping>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<PrinterModelMapping>;
    const printerModel = String(item.printerModel ?? '').trim();
    if (!printerModel) continue;
    result.set(modelKey(printerModel), { printerModel, cartridgeModels: cleanModels(item.cartridgeModels), drumModels: cleanModels(item.drumModels) });
  }
  return [...result.values()].sort((a, b) => a.printerModel.localeCompare(b.printerModel, 'ru', { numeric: true }));
}

function deriveModelCatalog(printers: Printer[], cartridges: Cartridge[]): PrinterModelMapping[] {
  const result = new Map<string, PrinterModelMapping>();
  const printersByInventory = new Map(printers.map(printer => [printer.inventoryNumber, printer]));
  const ensure = (printer: Printer) => {
    const key = modelKey(printer.model);
    if (!key) return undefined;
    let entry = result.get(key);
    if (!entry) {
      entry = { printerModel: printer.model.trim(), cartridgeModels: [], drumModels: [] };
      result.set(key, entry);
    }
    entry.cartridgeModels = cleanModels([...entry.cartridgeModels, ...printer.cartridgeModels]);
    entry.drumModels = cleanModels([...entry.drumModels, ...(printer.drumModels ?? [])]);
    return entry;
  };
  printers.forEach(ensure);
  cartridges.forEach(cartridge => {
    const printer = printersByInventory.get(cartridge.printerInventoryNumber);
    const entry = printer && ensure(printer);
    if (!entry || !cartridge.model.trim()) return;
    if (cartridge.consumableType === 'drum') entry.drumModels = cleanModels([...entry.drumModels, cartridge.model]);
    else entry.cartridgeModels = cleanModels([...entry.cartridgeModels, cartridge.model]);
  });
  return [...result.values()].sort((a, b) => a.printerModel.localeCompare(b.printerModel, 'ru', { numeric: true }));
}

function migrateCartridge(c: Partial<Cartridge> & { id: string }): Cartridge {
  return {
    ...c,
    id: c.id,
    barcode: c.barcode ?? c.id,
    model: c.model ?? '',
    consumableType: (c as any).consumableType ?? 'cartridge',
    color: (c as any).color,
    printerInventoryNumber: normalizeInventoryNumber(c.printerInventoryNumber ?? ''),
    status: c.status ?? 'on_hand',
    history: c.history ?? [],
    isReplaced: c.isReplaced ?? false,
    replacedById: c.replacedById,
    refillCount: c.refillCount ?? 0,
    registrationDate: c.registrationDate ?? (c.history?.[0]?.date ?? new Date().toISOString()),
    lastSubmittedBy: (c as any).lastSubmittedBy,
    linkedRepairId: c.linkedRepairId,
    consumableSlot: c.consumableSlot,
    labelPrinted: c.labelPrinted,
  };
}

function normalizeWarehouseLedger(value: unknown): WarehouseLedgerState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_WAREHOUSE_LEDGER };
  const raw = value as Partial<WarehouseLedgerState>;
  return {
    ...DEFAULT_WAREHOUSE_LEDGER,
    ...raw,
    items: Array.isArray(raw.items) ? raw.items : [],
    shipmentBatches: Array.isArray(raw.shipmentBatches) ? raw.shipmentBatches : [],
    auditLogs: Array.isArray(raw.auditLogs) ? raw.auditLogs : [],
  };
}

function ledgerFromLegacyBatches(
  value: unknown,
  legacyBatches: RefillBatch[],
  cartridges: Cartridge[],
  printers: Printer[],
): WarehouseLedgerState {
  const saved = normalizeWarehouseLedger(value);
  if (saved.shipmentBatches.length > 0 || legacyBatches.length === 0) return saved;
  const cartridgeById = new Map(cartridges.map(cartridge => [cartridge.id, cartridge]));
  const printerByInventory = new Map(printers.map(printer => [printer.inventoryNumber, printer]));
  const shipmentBatches: WarehouseShipmentBatch[] = legacyBatches.map(batch => {
    const items: WarehouseBatchItem[] = batch.cartridgeIds.flatMap(id => {
      const cartridge = cartridgeById.get(id);
      if (!cartridge) return [];
      const printer = printerByInventory.get(cartridge.printerInventoryNumber);
      const status: WarehouseBatchItem['status'] = cartridge.status === 'at_refill'
        ? 'at_refill'
        : cartridge.status === 'received_from_refill' || cartridge.status === 'ready'
          ? 'ready'
          : 'issued';
      return [{
        id: cartridge.id,
        type: cartridge.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж',
        model: cartridge.model,
        printerInventoryNumber: cartridge.printerInventoryNumber,
        printerModel: printer?.model ?? '—',
        department: printer?.department ?? '—',
        submittedBy: cartridge.lastSubmittedBy?.trim() || '—',
        refillCount: cartridge.refillCount ?? 0,
        status,
      }];
    });
    const allClosed = items.length > 0 && items.every(item => item.status === 'issued');
    return {
      id: batch.id,
      dateSent: batch.date,
      dateReceived: batch.status === 'received' ? batch.date : undefined,
      sender: batch.company?.trim() || 'Не указан',
      notes: batch.notes,
      status: batch.status === 'sent' ? 'sent' : allClosed ? 'closed' : 'received',
      items,
    };
  });
  return { ...saved, shipmentBatches };
}

export const useStore = () => {
  const [databaseExtras, setDatabaseExtras] = useState<Record<string, unknown>>({});
  const [databaseError, setDatabaseError] = useState('');
  const [databaseBusy, setDatabaseBusy] = useState(false);
  const [hydrated, setHydrated] = useState(() => !window.desktopAPI?.loadDatabase);
  const [printers, setPrinters] = useState<Printer[]>(() => {
    if (shouldUseFileDatabase()) return [];
    return readLocalStorage<(Partial<Printer> & { inventoryNumber: string })[]>('printers', []).map(migratePrinter);
  });

  const [cartridges, setCartridges] = useState<Cartridge[]>(() => {
    if (shouldUseFileDatabase()) return [];
    return readLocalStorage<(Partial<Cartridge> & { id: string })[]>('cartridges', []).map(migrateCartridge);
  });

  const [repairs, setRepairs] = useState<RepairEntry[]>(() => {
    if (shouldUseFileDatabase()) return [];
    return readLocalStorage<RepairEntry[]>('repairs', []);
  });

  const [batches, setBatchesState] = useState<RefillBatch[]>(() => {
    if (shouldUseFileDatabase()) return [];
    return readLocalStorage<RefillBatch[]>('batches', []);
  });

  const [settings, setSettingsState] = useState<AppSettings>(() => {
    if (shouldUseFileDatabase()) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...readLocalStorage<Partial<AppSettings>>('app_settings', {}) };
  });

  const setSettings = (next: AppSettings) => {
    const changed = Object.keys(next).filter(key =>
      JSON.stringify(next[key as keyof AppSettings]) !== JSON.stringify(settings[key as keyof AppSettings]),
    );
    if (changed.length > 0) logAction({
      category: 'settings', entityId: 'app', action: 'Изменены настройки', details: `Поля: ${changed.join(', ')}`,
    });
    setSettingsState(next);
  };

  const [employees, setEmployees] = useState<EmployeeRecord[]>(() => {
    if (shouldUseFileDatabase()) return [];
    return readLocalStorage<EmployeeRecord[]>('employees', []);
  });

  const [refillLog, setRefillLog] = useState<RefillLogEntry[]>(() => {
    if (shouldUseFileDatabase()) return [];
    return readLocalStorage<RefillLogEntry[]>('refill_log', []);
  });

  const [newCartridges, setNewCartridges] = useState<NewCartridge[]>(() => {
    if (shouldUseFileDatabase()) return [];
    return readLocalStorage<NewCartridge[]>('new_cartridges', []);
  });

  const [modelCatalog, setModelCatalog] = useState<PrinterModelMapping[]>(() => {
    if (shouldUseFileDatabase()) return [];
    const saved = readLocalStorage<unknown>('model_catalog', undefined);
    return saved === undefined ? deriveModelCatalog(printers, cartridges) : migrateModelCatalog(saved);
  });

  const [warehouseLedger, setWarehouseLedger] = useState<WarehouseLedgerState>(() => {
    if (shouldUseFileDatabase()) return { ...DEFAULT_WAREHOUSE_LEDGER };
    return ledgerFromLegacyBatches(
      readLocalStorage<unknown>('warehouse_ledger', undefined),
      batches,
      cartridges,
      printers,
    );
  });

  const logAction = (entry: Pick<RefillLogEntry, 'action'> & Partial<RefillLogEntry>) => {
    const record: RefillLogEntry = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      cartridgeId: '',
      cartridgeModel: '',
      printerInventoryNumber: '',
      printerModel: '',
      ...entry,
    };
    setRefillLog(prev => [...prev, record]);
  };

  const setBatches: Dispatch<SetStateAction<RefillBatch[]>> = next => {
    const updated = typeof next === 'function' ? next(batches) : next;
    const added = updated.filter(batch => !batches.some(old => old.id === batch.id));
    const changed = updated.filter(batch => {
      const old = batches.find(item => item.id === batch.id);
      return old && old.status !== batch.status;
    });
    added.forEach(batch => logAction({
      category: 'batch', entityId: batch.id,
      action: `Создана партия ${batch.id}`,
      details: `${batch.cartridgeIds.length} расходников${batch.company ? `; организация: ${batch.company}` : ''}`,
    }));
    changed.forEach(batch => logAction({
      category: 'batch', entityId: batch.id,
      action: `Статус партии ${batch.id}: ${batch.status === 'received' ? 'получена' : 'отправлена'}`,
    }));
    setBatchesState(updated);
  };

  useEffect(() => {
    if (!window.desktopAPI?.loadDatabase) return;
    let cancelled = false;
    window.desktopAPI.loadDatabase()
      .then(result => {
        if (cancelled) return;
        if (!result.success) { setDatabaseError(result.error || 'Не удалось прочитать базу. Автосохранение отключено.'); return; }
        if (result.data) {
          const db = result.data as Partial<DatabaseData>;
          if (typeof db !== 'object' || Array.isArray(db) || (db.version !== undefined && db.version !== 1)) throw new Error('Неподдерживаемый формат базы.');
          for (const field of ['printers', 'cartridges', 'repairs', 'batches', 'employees', 'refillLog', 'newCartridges', 'modelCatalog'] as const) {
            if (db[field] !== undefined && !Array.isArray(db[field])) throw new Error(`Повреждён раздел базы: ${field}`);
          }
          setDatabaseExtras(db as unknown as Record<string, unknown>);
          const loadedPrinters = ((db.printers ?? []) as (Partial<Printer> & { inventoryNumber: string })[]).map(migratePrinter);
          const loadedCartridges = ((db.cartridges ?? []) as (Partial<Cartridge> & { id: string })[]).map(migrateCartridge);
          setPrinters(loadedPrinters);
          setCartridges(loadedCartridges);
          setRepairs((db.repairs ?? []) as RepairEntry[]);
          setBatchesState((db.batches ?? []) as RefillBatch[]);
          setSettingsState({ ...DEFAULT_SETTINGS, ...(db.settings ?? {}) });
          setEmployees((db.employees ?? []) as EmployeeRecord[]);
          setRefillLog((db.refillLog ?? []) as RefillLogEntry[]);
          setNewCartridges((db.newCartridges ?? []) as NewCartridge[]);
          setModelCatalog(db.modelCatalog === undefined ? deriveModelCatalog(loadedPrinters, loadedCartridges) : migrateModelCatalog(db.modelCatalog));
          setWarehouseLedger(ledgerFromLegacyBatches(db.warehouseLedger, (db.batches ?? []) as RefillBatch[], loadedCartridges, loadedPrinters));
        } else {
          const loadedPrinters = readLocalStorage<(Partial<Printer> & { inventoryNumber: string })[]>('printers', []).map(migratePrinter);
          const loadedCartridges = readLocalStorage<(Partial<Cartridge> & { id: string })[]>('cartridges', []).map(migrateCartridge);
          setPrinters(loadedPrinters);
          setCartridges(loadedCartridges);
          setRepairs(readLocalStorage<RepairEntry[]>('repairs', []));
          setBatchesState(readLocalStorage<RefillBatch[]>('batches', []));
          setSettingsState({ ...DEFAULT_SETTINGS, ...readLocalStorage<Partial<AppSettings>>('app_settings', {}) });
          setEmployees(readLocalStorage<EmployeeRecord[]>('employees', []));
          setRefillLog(readLocalStorage<RefillLogEntry[]>('refill_log', []));
          setNewCartridges(readLocalStorage<NewCartridge[]>('new_cartridges', []));
          const savedCatalog = readLocalStorage<unknown>('model_catalog', undefined);
          setModelCatalog(savedCatalog === undefined ? deriveModelCatalog(loadedPrinters, loadedCartridges) : migrateModelCatalog(savedCatalog));
          setWarehouseLedger(ledgerFromLegacyBatches(
            readLocalStorage<unknown>('warehouse_ledger', undefined),
            readLocalStorage<RefillBatch[]>('batches', []),
            loadedCartridges,
            loadedPrinters,
          ));
        }
        setHydrated(true);
      })
      .catch(error => {
        if (!cancelled) setDatabaseError(String(error));
      });
    return () => { cancelled = true; };
  }, []);

  const database: DatabaseData = useMemo(() => ({
    ...databaseExtras,
    version: 1,
    savedAt: new Date().toISOString(),
    printers,
    cartridges,
    repairs,
    batches,
    settings,
    employees,
    refillLog,
    newCartridges,
    modelCatalog,
    warehouseLedger,
  }), [databaseExtras, printers, cartridges, repairs, batches, settings, employees, refillLog, newCartridges, modelCatalog, warehouseLedger]);

  const saveNow = useDebouncedDatabase(database, hydrated, setDatabaseError);
  const saveReferenceChanges = async (changes: Change[], rowActions: ReferenceRowAction[] = []) => {
    if (!hydrated || databaseBusy) throw new Error('База пока недоступна.');
    const now = new Date().toISOString();
    const preparedActions: ReferenceRowAction[] = rowActions.map(action => {
      if (action.kind !== 'add') return action;
      let cartridgeModels = action.printer.cartridgeModels;
      const catalogEntry = modelCatalog.find(entry => modelKey(entry.printerModel) === modelKey(action.printer.model));
      if (cartridgeModels.length === 0 && catalogEntry) cartridgeModels = catalogEntry.cartridgeModels;
      if (cartridgeModels.length === 0 && action.printer.model.trim()) {
        const variants = printers
          .filter(printer => printer.model.trim().toLocaleLowerCase('ru') === action.printer.model.trim().toLocaleLowerCase('ru') && printer.cartridgeModels.length > 0)
          .map(printer => JSON.stringify(printer.cartridgeModels));
        const uniqueVariants = [...new Set(variants)];
        if (uniqueVariants.length === 1) cartridgeModels = JSON.parse(uniqueVariants[0]) as string[];
      }
      return { ...action, printer: { ...action.printer, cartridgeModels, drumModels: catalogEntry?.drumModels ?? action.printer.drumModels ?? [], programId: action.printer.programId ?? generateShortId('P') } };
    });
    const nextPrinters = applyRowActions(applyChanges(printers, changes), preparedActions, now);
    const addedPrinters = preparedActions.filter((action): action is Extract<ReferenceRowAction, { kind: 'add' }> => action.kind === 'add');
    const addedCartridges: Cartridge[] = addedPrinters.map(action => {
      const id = generateShortId('C');
      return {
        id, barcode: id, model: action.printer.cartridgeModels[0] ?? '', consumableType: 'cartridge',
        printerInventoryNumber: action.printer.inventoryNumber, status: 'on_hand', refillCount: 0,
        registrationDate: now,
        history: [{ id: crypto.randomUUID(), date: now, action: 'Зарегистрирован (Картридж). Выдан пользователю.' }],
      };
    });
    const nextCartridges = [...cartridges, ...addedCartridges];
    setDatabaseBusy(true);
    try {
      const backup = await saveNow({ ...database, printers: nextPrinters, cartridges: nextCartridges, savedAt: now }, database);
      setPrinters(nextPrinters);
      setCartridges(nextCartridges);
      preparedActions.forEach(action => {
        const printer = action.kind === 'add' ? action.printer : action.before;
        logAction({
          category: 'printer', entityId: printer.programId ?? printer.inventoryNumber,
          printerInventoryNumber: printer.inventoryNumber, printerModel: printer.model, department: printer.department,
          action: action.kind === 'add' ? 'Добавлен принтер при сверке базы' : action.kind === 'remove' ? 'Удалён принтер при сверке базы' : 'Принтер помечен списанным',
          details: action.kind === 'add' ? `ID: ${printer.programId}; создан картридж: ${printer.cartridgeModels[0] || 'модель не указана'}` : `Инвентарный номер: ${printer.inventoryNumber}`,
        });
      });
      addedCartridges.forEach(cartridge => logAction({
        category: 'cartridge', entityId: cartridge.id, cartridgeId: cartridge.id, cartridgeModel: cartridge.model,
        consumableType: cartridge.consumableType, printerInventoryNumber: cartridge.printerInventoryNumber,
        action: 'Автоматически добавлен картридж при сверке базы',
        details: `Статус: ${STATUS_LABELS[cartridge.status]}; модель: ${cartridge.model || 'не указана'}`,
      }));
      logAction({
        category: 'database', entityId: 'printers',
        action: 'Применены изменения сверки базы',
        details: `Изменено ячеек: ${changes.length}; добавлено: ${addedPrinters.length}; удалено: ${preparedActions.filter(a => a.kind === 'remove').length}; списано: ${preparedActions.filter(a => a.kind === 'decommission').length}`,
      });
      setDatabaseError('');
      return backup;
    } finally { setDatabaseBusy(false); }
  };

  useEffect(() => {
    const close = async () => {
      if (databaseBusy) { await window.desktopAPI?.finishClose?.(false); return; }
      try {
        if (hydrated) await saveNow(database);
        await window.desktopAPI?.finishClose?.(true);
      } catch (error) {
        setDatabaseError(String(error));
        await window.desktopAPI?.finishClose?.(false);
      }
    };
    window.addEventListener('app-before-close', close);
    void window.desktopAPI?.ready?.();
    return () => window.removeEventListener('app-before-close', close);
  }, [database, hydrated, databaseBusy]);

  const addPrinter = (printer: Printer) => {
    const inventoryNumber = normalizeInventoryNumber(printer.inventoryNumber);
    const withProgramId: Printer = {
      ...printer,
      inventoryNumber,
      programId: printer.programId ?? generateShortId('P'),
    };
    const existing = printers.find(p => p.inventoryNumber === inventoryNumber);
    const decommissionChanged = Boolean(existing) && Boolean(existing?.isDecommissioned) !== Boolean(withProgramId.isDecommissioned);
    const firmwareMarked = withProgramId.firmwareFlashed === true && existing?.firmwareFlashed !== true;
    logAction({
      category: 'printer', entityId: existing?.programId ?? withProgramId.programId ?? inventoryNumber,
      printerInventoryNumber: inventoryNumber, printerModel: withProgramId.model,
      department: withProgramId.department,
      action: firmwareMarked ? 'Принтер отмечен как прошитый' : decommissionChanged ? (withProgramId.isDecommissioned ? 'Принтер помечен списанным' : 'С принтера снята отметка «Списан»') : existing ? 'Изменён принтер' : 'Добавлен принтер',
      details: `ID: ${existing?.programId ?? withProgramId.programId ?? '—'}; модель: ${withProgramId.model || '—'}; мат. отв.: ${withProgramId.boss || '—'}`,
    });
    setPrinters(prev => existing
      ? prev.map(p => p.inventoryNumber === inventoryNumber ? { ...p, ...withProgramId, programId: p.programId } : p)
      : [...prev, withProgramId]);
  };

  const removePrinter = (inventoryNumber: string) => {
    const printer = printers.find(p => p.inventoryNumber === inventoryNumber);
    logAction({
      category: 'printer', entityId: printer?.programId ?? inventoryNumber,
      printerInventoryNumber: inventoryNumber, printerModel: printer?.model ?? '', department: printer?.department,
      action: 'Удалён принтер', details: `Модель: ${printer?.model || '—'}`,
    });
    setPrinters(prev => prev.filter(p => p.inventoryNumber !== inventoryNumber));
  };

  const addCartridge = (cartridge: Cartridge) => {
    const printer = printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
    logAction({
      category: 'cartridge', entityId: cartridge.id,
      cartridgeId: cartridge.id, cartridgeModel: cartridge.model, consumableType: cartridge.consumableType,
      printerInventoryNumber: cartridge.printerInventoryNumber, printerModel: printer?.model ?? '', department: printer?.department,
      action: `Добавлен ${cartridge.consumableType === 'drum' ? 'драм-картридж' : 'картридж'}`,
      details: `Статус: ${STATUS_LABELS[cartridge.status]}`,
    });
    setCartridges(prev => [...prev, cartridge]);
  };

  const removeCartridge = (id: string) => {
    const cartridge = cartridges.find(c => c.id === id);
    const printer = printers.find(p => p.inventoryNumber === cartridge?.printerInventoryNumber);
    logAction({
      category: 'cartridge', entityId: id,
      cartridgeId: id, cartridgeModel: cartridge?.model ?? '', consumableType: cartridge?.consumableType,
      printerInventoryNumber: cartridge?.printerInventoryNumber ?? '', printerModel: printer?.model ?? '', department: printer?.department,
      action: 'Удалён расходник', details: `Модель: ${cartridge?.model || '—'}`,
    });
    setCartridges(prev => prev.filter(c => c.id !== id));
  };

  const allocateConsumableSlot = (inventoryNumber: string, type: ConsumableType): number => {
    const inv = normalizeInventoryNumber(inventoryNumber);
    const printer = printers.find(item => item.inventoryNumber === inv);
    const field = type === 'drum' ? 'consumableDrumSeq' : 'consumableCartridgeSeq';
    const maximumExisting = cartridges.reduce((maximum, cartridge) => {
      if (normalizeInventoryNumber(cartridge.printerInventoryNumber) !== inv || cartridge.consumableType !== type) return maximum;
      return Math.max(maximum, cartridge.consumableSlot ?? 0);
    }, 0);
    const next = Math.max(printer?.[field] ?? 0, maximumExisting) + 1;
    if (printer) setPrinters(prev => prev.map(item => item.inventoryNumber === inv ? { ...item, [field]: next } : item));
    return next;
  };

  /** Generate a short unique ID for consumables: C-XXXXXX for cartridge, D-XXXXXX for drum */
  const generateConsumableId = (type: ConsumableType = 'cartridge', _inventoryNumber?: string, _slot?: number) => {
    const prefix = type === 'drum' ? 'D' : 'C';
    return generateShortId(prefix);
  };

  /** Generate a short unique ID for new stock cartridges */
  const generateNewCartridgeId = () => generateShortId('N');

  /** Generate a short unique ID for printers */
  const generatePrinterId = () => generateShortId('P');

  /** @deprecated use generateConsumableId */
  const generateCartridgeId = () => generateConsumableId('cartridge');

  const updateCartridgeStatus = (
    id: string,
    status: CartridgeStatus,
    comment?: string,
    employee?: string,
  ) => {
    const cartridge = cartridges.find(c => c.id === id);
    const printer = printers.find(p => p.inventoryNumber === cartridge?.printerInventoryNumber);
    logAction({
      category: 'cartridge', entityId: id,
      cartridgeId: id, cartridgeModel: cartridge?.model ?? '', consumableType: cartridge?.consumableType,
      printerInventoryNumber: cartridge?.printerInventoryNumber ?? '', printerModel: printer?.model ?? '', department: printer?.department,
      employee, action: comment || `Изменён статус: ${STATUS_LABELS[status]}`,
      details: cartridge ? `${STATUS_LABELS[cartridge.status]} → ${STATUS_LABELS[status]}` : undefined,
    });
    setCartridges(prev =>
      prev.map(c => {
        if (c.id !== id) return c;
        const historyEntry: HistoryEntry = {
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          action: STATUS_LABELS[status] ?? status,
          comment,
          employee,
        };
        const refillCount =
          status === 'waiting' ? (c.refillCount ?? 0) + 1 : c.refillCount ?? 0;
        const updated: Cartridge = {
          ...c,
          status,
          history: [...c.history, historyEntry],
          refillCount,
          lastSubmittedBy: employee ?? c.lastSubmittedBy,
        };
        return updated;
      }),
    );
  };

  const updateCartridge = (id: string, updates: Partial<Cartridge>) => {
    const cartridge = cartridges.find(c => c.id === id);
    const changed = Object.keys(updates).join(', ');
    logAction({
      category: 'cartridge', entityId: id, cartridgeId: id,
      cartridgeModel: updates.model ?? cartridge?.model ?? '', consumableType: updates.consumableType ?? cartridge?.consumableType,
      printerInventoryNumber: updates.printerInventoryNumber ?? cartridge?.printerInventoryNumber ?? '',
      action: 'Изменён расходник', details: `Поля: ${changed}`,
    });
    setCartridges(prev => prev.map(c => (c.id === id ? { ...c, ...updates } : c)));
  };

  const updateRepair = (id: string, updates: Partial<RepairEntry>) => {
    const repair = repairs.find(r => r.id === id);
    logAction({
      category: 'repair', entityId: id, printerInventoryNumber: repair?.printerInventoryNumber ?? '',
      action: updates.status === 'repaired' ? 'Завершён ремонт' : 'Изменена заявка на ремонт',
      details: updates.repairDescription || updates.comment || (updates.status ? `Статус: ${updates.status}` : undefined),
    });
    setRepairs(prev => prev.map(r => (r.id === id ? { ...r, ...updates } : r)));
  };

  const replaceCartridge = (oldId: string, newCartridge: Cartridge, reason?: string) => {
    logAction({
      category: 'cartridge', entityId: newCartridge.id, cartridgeId: newCartridge.id,
      cartridgeModel: newCartridge.model, consumableType: newCartridge.consumableType,
      printerInventoryNumber: newCartridge.printerInventoryNumber,
      action: 'Заменён расходник', details: reason || `${oldId} → ${newCartridge.id}`,
    });
    setCartridges(prev => {
      const updated = prev.map(c => {
        if (c.id !== oldId) return c;
        const historyEntry: HistoryEntry = {
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          action: reason || `Заменён. Новый: ${newCartridge.id}`,
        };
        return {
          ...c,
          isReplaced: true,
          status: 'replaced' as CartridgeStatus,
          replacedById: newCartridge.id,
          history: [...c.history, historyEntry],
        };
      });
      return [...updated, newCartridge];
    });
  };

  const cancelWaitingCartridgeIntake = (cartridgeId: string) => {
    const cartridge = cartridges.find(item => item.id === cartridgeId);
    if (!cartridge || cartridge.status !== 'waiting') return;
    updateCartridgeStatus(cartridgeId, 'on_hand', 'Отмена ожидания отправки');
  };

  const cancelWaitingRepairIntake = (repairId: string) => {
    const repair = repairs.find(item => item.id === repairId);
    if (!repair) return;
    setRepairs(prev => prev.filter(item => item.id !== repairId));
    setCartridges(prev => prev.map(cartridge =>
      cartridge.linkedRepairId === repairId && cartridge.status === 'waiting'
        ? { ...cartridge, linkedRepairId: undefined, status: 'on_hand' as const }
        : cartridge,
    ));
    logAction({
      category: 'repair', entityId: repairId, printerInventoryNumber: repair.printerInventoryNumber,
      action: 'Отменён приём устройства в ремонт', details: repair.reason,
    });
  };

  const finishIssueCartridgeFromBatch = (cartridgeId: string, batchId: string, employeeRaw?: string) => {
    const cartridge = cartridges.find(item => item.id === cartridgeId);
    if (!cartridge || !['at_refill', 'received_from_refill', 'ready'].includes(cartridge.status)) return;
    const employee = employeeRaw?.trim() || undefined;
    setCartridges(prev => prev.map(item => item.id !== cartridgeId ? item : {
      ...item,
      status: 'on_hand' as const,
      lastSubmittedBy: employee ?? item.lastSubmittedBy,
      history: [...item.history,
        ...(item.status === 'at_refill' ? [{ id: crypto.randomUUID(), date: new Date().toISOString(), action: STATUS_LABELS.received_from_refill, comment: `Получен с заправки. Партия ${batchId}` }] : []),
        { id: crypto.randomUUID(), date: new Date().toISOString(), action: STATUS_LABELS.on_hand, comment: 'Выдан пользователю', employee },
      ],
    }));
    const printer = printers.find(item => item.inventoryNumber === cartridge.printerInventoryNumber);
    logAction({
      category: 'cartridge', entityId: cartridge.id, cartridgeId: cartridge.id, cartridgeModel: cartridge.model,
      consumableType: cartridge.consumableType, printerInventoryNumber: cartridge.printerInventoryNumber,
      printerModel: printer?.model ?? '', department: printer?.department, employee,
      action: employee ? `Картридж выдан сотруднику ${employee}` : 'Картридж выдан пользователю',
      details: `Партия ${batchId}`,
    });
    if (employee && !employees.some(item => item.name === employee && item.printerInventoryNumber === cartridge.printerInventoryNumber)) {
      setEmployees(prev => [...prev, { id: crypto.randomUUID(), name: employee, printerInventoryNumber: cartridge.printerInventoryNumber, cartridgeId, addedDate: new Date().toISOString() }]);
    }
  };

  const finishIssuePrinterBundleFromBatch = (
    printerInventoryNumber: string,
    repairId: string | undefined,
    batchId: string,
    employeeRaw?: string,
  ) => {
    if (!repairId) return;
    const repair = repairs.find(item => item.id === repairId);
    if (!repair || repair.locationStatus === 'issued') return;
    const employee = employeeRaw?.trim() || undefined;
    setRepairs(prev => prev.map(item => item.id === repairId ? {
      ...item, status: 'repaired' as const, locationStatus: 'issued' as const,
      completionDate: item.completionDate ?? new Date().toISOString(),
    } : item));
    setCartridges(prev => prev.map(item => item.linkedRepairId === repairId && ['at_refill', 'received_from_refill', 'ready'].includes(item.status)
      ? { ...item, status: 'on_hand' as const, lastSubmittedBy: employee ?? item.lastSubmittedBy }
      : item));
    const printer = printers.find(item => item.inventoryNumber === printerInventoryNumber);
    logAction({
      category: 'repair', entityId: repairId, printerInventoryNumber, printerModel: printer?.model ?? '',
      department: printer?.department, employee, action: employee ? `Устройство выдано сотруднику ${employee}` : 'Устройство выдано пользователю',
      details: `Партия ${batchId}`,
    });
  };

  const applyWarehouseIssueSnapshotFromDashboard = (idsToIssue: string[], recipientRaw: string) => {
    const ids = new Set(idsToIssue);
    const recipient = recipientRaw.trim() || 'Сотрудник';
    const issueDate = new Date().toISOString();
    setWarehouseLedger(prev => ({
      ...prev,
      items: prev.items.map(item => ids.has(item.id) ? { ...item, status: 'issued' as const, whoPickedUp: recipient, issueDate } : item),
      shipmentBatches: prev.shipmentBatches.map(batch => {
        if (!batch.items.some(item => ids.has(item.id))) return batch;
        const items = batch.items.map(item => ids.has(item.id) && item.status !== 'replaced'
          ? { ...item, status: 'issued' as const, whoPickedUp: recipient, issueDate }
          : item);
        return { ...batch, items, status: items.every(item => item.status === 'issued' || item.status === 'replaced') ? 'closed' as const : batch.status };
      }),
    }));
  };

  const applyWarehouseReceiveForCartridgeFromDashboard = (cartridgeId: string) => {
    const cartridge = cartridges.find(item => item.id === cartridgeId);
    const activeBatch = warehouseLedger.shipmentBatches.find(batch =>
      batch.status === 'sent' && batch.items.some(item => item.id === cartridgeId && item.status === 'at_refill'),
    );
    const completesBatch = activeBatch
      ? !activeBatch.items.some(item => item.id !== cartridgeId && item.status === 'at_refill')
      : false;
    setWarehouseLedger(prev => {
      const shipmentBatches = prev.shipmentBatches.map(batch => {
        if (batch.status !== 'sent' || !batch.items.some(item => item.id === cartridgeId && item.status === 'at_refill')) return batch;
        const items = batch.items.map(item => item.id === cartridgeId && item.status === 'at_refill'
          ? { ...item, status: 'ready' as const, refillCount: cartridge?.refillCount ?? item.refillCount }
          : item);
        const hasAtRefill = items.some(item => item.status === 'at_refill');
        return { ...batch, items, status: hasAtRefill ? batch.status : 'received' as const, dateReceived: hasAtRefill ? batch.dateReceived : new Date().toISOString() };
      });
      return {
        ...prev,
        items: prev.items.map(item => item.id === cartridgeId ? { ...item, status: 'ready' as const, currentBatchId: undefined } : item),
        shipmentBatches,
      };
    });
    if (activeBatch && completesBatch) {
      setBatchesState(prev => prev.map(batch => batch.id === activeBatch.id ? { ...batch, status: 'received' as const } : batch));
    }
  };

  const addRepair = (repair: RepairEntry) => {
    logAction({
      category: 'repair', entityId: repair.id, printerInventoryNumber: repair.printerInventoryNumber,
      action: 'Создана заявка на ремонт', details: repair.reason,
    });
    setRepairs(prev => [...prev, repair]);
  };

  const addEmployee = (record: EmployeeRecord) => {
    logAction({
      category: 'employee', entityId: record.id, employee: record.name,
      printerInventoryNumber: record.printerInventoryNumber ?? '', cartridgeId: record.cartridgeId ?? '',
      action: 'Добавлен сотрудник', details: record.name,
    });
    setEmployees(prev => [...prev, record]);
  };

  const removeEmployee = (id: string) => {
    const employee = employees.find(e => e.id === id);
    logAction({
      category: 'employee', entityId: id, employee: employee?.name,
      printerInventoryNumber: employee?.printerInventoryNumber ?? '', cartridgeId: employee?.cartridgeId ?? '',
      action: 'Удалён сотрудник', details: employee?.name,
    });
    setEmployees(prev => prev.filter(e => e.id !== id));
  };

  const addRefillLog = (entry: RefillLogEntry) => {
    setRefillLog(prev => [...prev, entry]);
  };

  const getEmployeesForPrinter = (invNum: string) =>
    employees.filter(e => e.printerInventoryNumber === invNum);

  const getEmployeesForCartridge = (cartId: string) =>
    employees.filter(e => e.cartridgeId === cartId);

  const addNewCartridge = (c: NewCartridge) => {
    logAction({ category: 'stock', entityId: c.id, cartridgeId: c.id, cartridgeModel: c.model, action: 'Добавлена позиция нового склада', details: `Количество: ${c.quantity}` });
    setNewCartridges(prev => [...prev, c]);
  };

  const removeNewCartridge = (id: string) => {
    const item = newCartridges.find(c => c.id === id);
    logAction({ category: 'stock', entityId: id, cartridgeId: id, cartridgeModel: item?.model ?? '', action: 'Удалена позиция нового склада', details: `Количество: ${item?.quantity ?? 0}` });
    setNewCartridges(prev => prev.filter(c => c.id !== id));
  };

  const updateNewCartridge = (id: string, updates: Partial<NewCartridge>) => {
    const item = newCartridges.find(c => c.id === id);
    logAction({ category: 'stock', entityId: id, cartridgeId: id, cartridgeModel: updates.model ?? item?.model ?? '', action: 'Изменена позиция нового склада', details: Object.keys(updates).join(', ') });
    setNewCartridges(prev => prev.map(c => (c.id === id ? { ...c, ...updates } : c)));
  };

  const updatePrinter = (inventoryNumber: string, updates: Partial<Printer>) => {
    const printer = printers.find(p => p.inventoryNumber === inventoryNumber);
    const decommissionChanged = updates.isDecommissioned !== undefined && Boolean(updates.isDecommissioned) !== Boolean(printer?.isDecommissioned);
    const firmwareMarked = updates.firmwareFlashed === true && printer?.firmwareFlashed !== true;
    logAction({
      category: 'printer', entityId: printer?.programId ?? inventoryNumber,
      printerInventoryNumber: inventoryNumber, printerModel: updates.model ?? printer?.model ?? '', department: updates.department ?? printer?.department,
      action: firmwareMarked ? 'Принтер отмечен как прошитый' : decommissionChanged ? (updates.isDecommissioned ? 'Принтер помечен списанным' : 'С принтера снята отметка «Списан»') : 'Изменён принтер', details: `Поля: ${Object.keys(updates).join(', ')}`,
    });
    setPrinters(prev => prev.map(p => (p.inventoryNumber === inventoryNumber ? { ...p, ...updates } : p)));
  };

  /** Link selected on-hand/waiting consumables to a device repair so the whole bundle moves through warehouse stages together. */
  const linkConsumablesToRepair = (repairId: string, printerInventoryNumber: string, consumableIds: string[], submitter?: string) => {
    const selected = new Set(consumableIds);
    cartridges
      .filter(cartridge => selected.has(cartridge.id) && cartridge.printerInventoryNumber === printerInventoryNumber && !cartridge.isReplaced)
      .forEach(cartridge => {
        if (cartridge.status === 'on_hand') {
          updateCartridgeStatus(cartridge.id, 'waiting', 'Принят на склад вместе с принтером', submitter);
          updateCartridge(cartridge.id, { linkedRepairId: repairId });
        } else if (cartridge.status === 'waiting') {
          updateCartridge(cartridge.id, { linkedRepairId: repairId });
        }
      });
  };

  /**
   * Complete a device repair atomically across repairs, linked consumables, warehouse rows,
   * shipment snapshots and legacy batches. Safe for completion before or after shipment.
   */
  const completeRepairWorkflow = (repairId: string, solutionRaw: string, markFirmware = false) => {
    const repair = repairs.find(item => item.id === repairId);
    if (!repair || repair.locationStatus === 'issued') return false;
    const printer = printers.find(item => item.inventoryNumber === repair.printerInventoryNumber);
    const deviceId = printer?.programId ?? repair.printerInventoryNumber;
    const solution = solutionRaw.trim() || 'Ремонт завершён';
    const linked = cartridges.filter(cartridge => cartridge.linkedRepairId === repairId);
    const linkedIds = new Set(linked.map(cartridge => cartridge.id));
    const matches = (item: { id: string; repairId?: string; parentDeviceId?: string }) =>
      item.repairId === repairId || item.id === deviceId || item.parentDeviceId === deviceId || linkedIds.has(item.id);
    const now = new Date().toISOString();

    updateRepair(repairId, { status: 'repaired', locationStatus: 'ready', completionDate: now, repairDescription: solution });
    linked.forEach(cartridge => {
      if (cartridge.status === 'waiting' || cartridge.status === 'at_refill') {
        updateCartridgeStatus(cartridge.id, 'received_from_refill', 'Ремонт завершён — готов к выдаче вместе с принтером');
      }
    });
    if (printer) {
      const updates: Partial<Printer> = {};
      if (repair.status !== 'repaired') updates.repairCount = (printer.repairCount ?? 0) + 1;
      if (markFirmware && !printer.firmwareFlashed) updates.firmwareFlashed = true;
      if (Object.keys(updates).length > 0) updatePrinter(printer.inventoryNumber, updates);
    }

    const completedBatchIds = new Set(warehouseLedger.shipmentBatches
      .filter(batch => batch.items.some(matches) && !batch.items.some(item => item.status === 'at_refill' && !matches(item)))
      .map(batch => batch.id));
    setWarehouseLedger(previous => ({
      ...previous,
      items: previous.items.map(item => matches(item) && (item.status === 'waiting' || item.status === 'at_refill')
        ? { ...item, status: 'ready' as const, currentBatchId: undefined }
        : item),
      shipmentBatches: previous.shipmentBatches.map(batch => {
        if (!batch.items.some(matches)) return batch;
        const items = batch.items.map(item => matches(item) && item.status === 'at_refill' ? { ...item, status: 'ready' as const } : item);
        const completed = !items.some(item => item.status === 'at_refill');
        return { ...batch, items, status: completed && batch.status === 'sent' ? 'received' as const : batch.status, dateReceived: completed ? (batch.dateReceived ?? now) : batch.dateReceived };
      }),
    }));
    setBatchesState(previous => previous.map(batch => completedBatchIds.has(batch.id) ? { ...batch, status: 'received' as const } : batch));
    setRefillLog(previous => [{
      id: crypto.randomUUID(), date: now, cartridgeId: deviceId, cartridgeModel: printer?.model ?? 'Устройство',
      consumableType: 'device', deviceType: printer?.printerType ?? 'Устройство', serviceType: 'Ремонт',
      printerInventoryNumber: repair.printerInventoryNumber, printerModel: printer?.model ?? '', department: printer?.department ?? '',
      employee: printer?.boss, action: `Принтер получен с ремонта. Решение: ${solution}`, is_technical: false,
    }, ...previous]);
    return true;
  };

  const upsertModelMapping = (originalModel: string | null, mapping: PrinterModelMapping) => {
    const cleaned: PrinterModelMapping = {
      printerModel: mapping.printerModel.trim(),
      cartridgeModels: cleanModels(mapping.cartridgeModels),
      drumModels: cleanModels(mapping.drumModels),
    };
    if (!cleaned.printerModel) throw new Error('Укажите модель принтера.');
    const duplicate = modelCatalog.some(entry => modelKey(entry.printerModel) === modelKey(cleaned.printerModel)
      && (!originalModel || modelKey(entry.printerModel) !== modelKey(originalModel)));
    if (duplicate) throw new Error(`Модель «${cleaned.printerModel}» уже есть в справочнике.`);
    setModelCatalog(prev => [...prev.filter(entry => !originalModel || modelKey(entry.printerModel) !== modelKey(originalModel)), cleaned]
      .sort((a, b) => a.printerModel.localeCompare(b.printerModel, 'ru', { numeric: true })));
    if (originalModel) {
      setPrinters(prev => prev.map(printer => modelKey(printer.model) === modelKey(originalModel)
        ? { ...printer, model: cleaned.printerModel, cartridgeModels: cleaned.cartridgeModels, drumModels: cleaned.drumModels }
        : printer));
    }
    logAction({
      category: 'database', entityId: cleaned.printerModel,
      action: originalModel ? 'Изменён справочник расходников' : 'Добавлена модель в справочник расходников',
      details: `Принтер: ${cleaned.printerModel}; картриджи: ${cleaned.cartridgeModels.join(', ') || 'нет'}; драмы: ${cleaned.drumModels.join(', ') || 'нет'}`,
    });
  };

  const removeModelMapping = (printerModel: string) => {
    setModelCatalog(prev => prev.filter(entry => modelKey(entry.printerModel) !== modelKey(printerModel)));
    logAction({ category: 'database', entityId: printerModel, action: 'Удалена модель из справочника расходников', details: printerModel });
  };

  const clearAllData = () => {
    setPrinters([]);
    setCartridges([]);
    setRepairs([]);
    setBatchesState([]);
    setEmployees([]);
    setNewCartridges([]);
    setModelCatalog([]);
    setWarehouseLedger({ ...DEFAULT_WAREHOUSE_LEDGER });
    setRefillLog([{
      id: crypto.randomUUID(), date: new Date().toISOString(), category: 'database', entityId: 'all',
      cartridgeId: '', cartridgeModel: '', printerInventoryNumber: '', printerModel: '',
      action: 'Очищены все данные приложения', details: 'Операция подтверждена пользователем',
    }]);
  };

  return {
    hydrated, databaseError, databaseBusy, saveReferenceChanges, clearAllData, recordAction: logAction,
    printers, setPrinters,
    cartridges, setCartridges,
    repairs, setRepairs,
    batches, setBatches,
    warehouseLedger, setWarehouseLedger,
    settings, setSettings,
    employees, setEmployees,
    refillLog, setRefillLog,
    addPrinter,
    removePrinter,
    updatePrinter,
    linkConsumablesToRepair,
    completeRepairWorkflow,
    addCartridge,
    removeCartridge,
    allocateConsumableSlot,
    generateConsumableId,
    generateNewCartridgeId,
    generatePrinterId,
    generateCartridgeId,
    updateCartridgeStatus,
    updateCartridge,
    updateRepair,
    replaceCartridge,
    finishIssueCartridgeFromBatch,
    finishIssuePrinterBundleFromBatch,
    addRepair,
    addEmployee,
    removeEmployee,
    addRefillLog,
    cancelWaitingCartridgeIntake,
    cancelWaitingRepairIntake,
    applyWarehouseIssueSnapshotFromDashboard,
    applyWarehouseReceiveForCartridgeFromDashboard,
    getEmployeesForPrinter,
    getEmployeesForCartridge,
    newCartridges, setNewCartridges,
    modelCatalog, upsertModelMapping, removeModelMapping,
    addNewCartridge,
    removeNewCartridge,
    updateNewCartridge,
  };
};

export type StoreType = ReturnType<typeof useStore>;
