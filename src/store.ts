
import { useState, useEffect, useMemo, useRef } from 'react';
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
} from './types';
import {
  DEFAULT_WAREHOUSE_LEDGER,
  type WarehouseBatchItem,
  type WarehouseLedgerState,
} from './types/warehouseLedger';

const LEGACY_DEFAULT_TSPL = `CLS
CODEPAGE 1251
SIZE 43 mm, 15 mm
GAP 3 mm, 0 mm
DENSITY 10
SPEED 4
DIRECTION 0,0
REFERENCE 0,0
BARCODE 41,13,"128",36,0,0,2,2,"{id}"
TEXT 101,60,"1",0,1,1,"{id}"
TEXT 101,85,"2",0,1,1,"{inv}"
PRINT 1,1
CLS
INITIALPRINTER`;

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
  warehouseLedger?: WarehouseLedgerState;
}

function readLocalStorage<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) as T : fallback;
  } catch {
    return fallback;
  }
}

function loadWarehouseLedgerFromStorage(): WarehouseLedgerState {
  const parsed = readLocalStorage<Partial<WarehouseLedgerState> | null>('warehouse_ledger', null);
  if (parsed && Array.isArray((parsed as WarehouseLedgerState).items) && Array.isArray((parsed as WarehouseLedgerState).shipmentBatches)) {
    const w = parsed as WarehouseLedgerState;
    return {
      ...DEFAULT_WAREHOUSE_LEDGER,
      ...w,
      items: w.items,
      shipmentBatches: w.shipmentBatches,
      auditLogs: w.auditLogs ?? [],
    };
  }
  try {
    const legacyItems = localStorage.getItem('warehouse_items_v3');
    if (legacyItems) {
      return {
        ...DEFAULT_WAREHOUSE_LEDGER,
        items: JSON.parse(legacyItems) as WarehouseLedgerState['items'],
        shipmentBatches: JSON.parse(localStorage.getItem('warehouse_batches_v3') ?? '[]') as WarehouseLedgerState['shipmentBatches'],
        auditLogs: JSON.parse(localStorage.getItem('warehouse_logs_v3') ?? '[]') as WarehouseLedgerState['auditLogs'],
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_WAREHOUSE_LEDGER };
}

function shouldUseFileDatabase() {
  return !!window.electronAPI?.loadDatabase;
}

function useDebouncedDatabase(data: DatabaseData, hydrated: boolean) {
  useEffect(() => {
    if (!hydrated) return;
    const handle = window.setTimeout(() => {
      if (window.electronAPI?.saveDatabase) {
        window.electronAPI.saveDatabase(data);
        return;
      }

      localStorage.setItem('printers', JSON.stringify(data.printers));
      localStorage.setItem('cartridges', JSON.stringify(data.cartridges));
      localStorage.setItem('repairs', JSON.stringify(data.repairs));
      localStorage.setItem('batches', JSON.stringify(data.batches));
      localStorage.setItem('app_settings', JSON.stringify(data.settings));
      localStorage.setItem('employees', JSON.stringify(data.employees));
      localStorage.setItem('refill_log', JSON.stringify(data.refillLog));
      localStorage.setItem('new_cartridges', JSON.stringify(data.newCartridges));
      localStorage.setItem('warehouse_ledger', JSON.stringify(data.warehouseLedger ?? DEFAULT_WAREHOUSE_LEDGER));
    }, 1500);
    return () => window.clearTimeout(handle);
  }, [data, hydrated]);
}

function migrateSettings(s: Partial<AppSettings>): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...s };
  if (typeof merged.labelTsplTemplate === 'string') {
    merged.labelTsplTemplate = merged.labelTsplTemplate.replace(
      /^(TEXT\s+[^,\r\n]+(?:,[^,\r\n]+){5},)"П"\s*$/gim,
      '$1"{fw}"',
    );
  }
  if ((merged.labelTsplTemplate ?? '').trim() === LEGACY_DEFAULT_TSPL.trim()) {
    merged.labelTsplTemplate = DEFAULT_SETTINGS.labelTsplTemplate;
  }
  return merged;
}

function stripLastMatchingRefillLog(
  prev: RefillLogEntry[],
  predicate: (e: RefillLogEntry) => boolean,
): RefillLogEntry[] {
  for (let i = prev.length - 1; i >= 0; i--) {
    if (predicate(prev[i])) return prev.filter((_, j) => j !== i);
  }
  return prev;
}

/** Строка журнала о приёме в очередь «ожидает отправки» — убирается при отмене из списка на складе. */
function isRefillLogWaitingAcceptEntry(e: RefillLogEntry): boolean {
  const a = e.action;
  // Only 'accept' or 'Заправка' service types can be waiting accept entries
  if (e.serviceType != null && e.serviceType !== 'accept' && e.serviceType !== 'Заправка' && e.serviceType !== 'Ремонт') return false;
  return (
    a === 'Принят на склад (сдан на заправку)' ||
    a === 'Принят на склад (вместе с принтером)' ||
    a === 'Зарегистрирован. Принят на склад ожидания.' ||
    a === 'Картридж принят на заправку' ||
    a === 'Картридж принят на заправку вместе с принтером' ||
    a === 'Принтер принят в ремонт' ||
    (e.consumableType === 'device' && a.includes('Принят на склад') && a.includes('ожидание'))
  );
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function hashToCode(input: string, length = 6): string {
  // Deterministic pseudo-hash (fast, stable across sessions)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c + ((h2 << 5) >>> 0) + (h2 >>> 2);
    h2 >>>= 0;
  }
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    const mixed = (h1 ^ (h2 >>> (i % 16))) >>> 0;
    out.push(ALPHABET[mixed % ALPHABET.length]);
    h1 = Math.imul(h1 ^ mixed, 0x45d9f3b) >>> 0;
    h2 = Math.imul(h2 ^ (mixed >>> 1), 0x27d4eb2d) >>> 0;
  }
  return out.join('');
}

function generateDeterministicId(prefix: 'P' | 'C' | 'D' | 'N', base: string): string {
  return `${prefix}-${hashToCode(`${prefix}:${base}`)}`;
}

function generateRandomId(prefix: 'P' | 'C' | 'D' | 'N'): string {
  let rand = '';
  for (let i = 0; i < 6; i++) rand += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${prefix}-${rand}`;
}

function normalizeInventoryNumber(value: string): string {
  return value.replace(/^\s*Инв\.\s*№\s*/i, '').trim();
}

function migratePrinter(p: Partial<Printer> & { inventoryNumber: string }): Printer {
  const inventoryNumber = normalizeInventoryNumber(p.inventoryNumber);
  return {
    programId: (p as any).programId ?? generateDeterministicId('P', inventoryNumber),
    inventoryNumber,
    model: p.model ?? '',
    printerType: (p as any).printerType ?? 'printer',
    department: p.department ?? '',
    boss: p.boss ?? (p as any).employee ?? '',
    cartridgeModels: p.cartridgeModels ?? [],
    commissionDate: p.commissionDate ?? '',
    balanceCost: p.balanceCost ?? '',
    refillCount: (p as any).refillCount ?? 0,
    repairCount: (p as any).repairCount ?? 0,
    firmwareFlashed: (p as any).firmwareFlashed === true,
    ...(Number.isFinite((p as any).consumableCartridgeSeq)
      ? { consumableCartridgeSeq: (p as any).consumableCartridgeSeq as number }
      : {}),
    ...(Number.isFinite((p as any).consumableDrumSeq)
      ? { consumableDrumSeq: (p as any).consumableDrumSeq as number }
      : {}),
  };
}

function migrateCartridge(c: Partial<Cartridge> & { id: string }): Cartridge {
  const rawStatus = c.status ?? 'on_hand';
  const migratedStatus =
    (c.isReplaced || !!c.replacedById) && (rawStatus === 'on_hand' || rawStatus === 'replaced')
      ? 'disposed'
      : rawStatus;
  return {
    id: c.id,
    barcode: c.barcode ?? c.id,
    model: c.model ?? '',
    consumableType: (c as any).consumableType ?? 'cartridge',
    color: (c as any).color,
    printerInventoryNumber: normalizeInventoryNumber(c.printerInventoryNumber ?? ''),
    status: migratedStatus,
    history: c.history ?? [],
    isReplaced: c.isReplaced ?? false,
    replacedById: c.replacedById,
    refillCount: c.refillCount ?? 0,
    registrationDate: c.registrationDate ?? (c.history?.[0]?.date ?? new Date().toISOString()),
    lastSubmittedBy: (c as any).lastSubmittedBy,
    linkedRepairId: (c as any).linkedRepairId,
    ...(Number.isFinite((c as any).consumableSlot)
      ? { consumableSlot: (c as any).consumableSlot as number }
      : {}),
  };
}

/** Однократно: проставить consumableSlot и синхронизировать счётчики на принтере с уже существующими расходниками. */
export function migrateConsumableSlots(
  cartridges: Cartridge[],
  printers: Printer[],
): { cartridges: Cartridge[]; printers: Printer[]; changed: boolean } {
  const byKey = new Map<string, Cartridge[]>();
  for (const c of cartridges) {
    const inv = normalizeInventoryNumber(c.printerInventoryNumber);
    if (!inv) continue;
    const type = c.consumableType ?? 'cartridge';
    const key = `${inv}\0${type}`;
    let arr = byKey.get(key);
    if (!arr) {
      arr = [];
      byKey.set(key, arr);
    }
    arr.push(c);
  }
  const idToPatched = new Map<string, Cartridge>();
  for (const [, group] of byKey) {
    const sorted = [...group].sort(
      (a, b) => new Date(a.registrationDate).getTime() - new Date(b.registrationDate).getTime(),
    );
    sorted.forEach((c, i) => {
      if (c.consumableSlot != null) return;
      idToPatched.set(c.id, { ...c, consumableSlot: i + 1 });
    });
  }
  let changed = idToPatched.size > 0;
  const newCartridges = cartridges.map(c => idToPatched.get(c.id) ?? c);

  const maxByPrinter = new Map<string, { cart: number; drum: number }>();
  for (const c of newCartridges) {
    const inv = normalizeInventoryNumber(c.printerInventoryNumber);
    if (!inv) continue;
    const slot = c.consumableSlot;
    if (slot == null || !Number.isFinite(slot)) continue;
    const cur = maxByPrinter.get(inv) ?? { cart: 0, drum: 0 };
    if (c.consumableType === 'drum') cur.drum = Math.max(cur.drum, slot);
    else cur.cart = Math.max(cur.cart, slot);
    maxByPrinter.set(inv, cur);
  }

  const newPrinters = printers.map(p => {
    const m = maxByPrinter.get(p.inventoryNumber) ?? { cart: 0, drum: 0 };
    const nextCart = Math.max(p.consumableCartridgeSeq ?? 0, m.cart);
    const nextDrum = Math.max(p.consumableDrumSeq ?? 0, m.drum);
    if (nextCart === (p.consumableCartridgeSeq ?? 0) && nextDrum === (p.consumableDrumSeq ?? 0)) return p;
    changed = true;
    return { ...p, consumableCartridgeSeq: nextCart, consumableDrumSeq: nextDrum };
  });

  return { cartridges: newCartridges, printers: newPrinters, changed };
}

/** Сколько элементов обрабатывать за один кадр; между чанками — yield, чтобы не блокировать ввод с клавиатуры. */
const MIGRATE_CHUNK = 400;

async function mapInChunks<T, R>(
  items: T[],
  mapFn: (item: T) => R,
  chunkSize: number,
  isCancelled: () => boolean,
): Promise<R[] | null> {
  const result: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    if (isCancelled()) return null;
    const end = Math.min(i + chunkSize, items.length);
    for (let j = i; j < end; j++) {
      result.push(mapFn(items[j]));
    }
    if (end < items.length) {
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    }
  }
  return result;
}

export const useStore = () => {
  const [hydrated, setHydrated] = useState(() => !window.electronAPI?.loadDatabase);
  const [printers, setPrinters] = useState<Printer[]>(() => {
    if (shouldUseFileDatabase()) return [];
    return readLocalStorage<(Partial<Printer> & { inventoryNumber: string })[]>('printers', []).map(migratePrinter);
  });

  const [cartridges, setCartridges] = useState<Cartridge[]>(() => {
    if (shouldUseFileDatabase()) return [];
    return readLocalStorage<(Partial<Cartridge> & { id: string })[]>('cartridges', []).map(migrateCartridge);
  });

  const cartridgesRef = useRef(cartridges);
  const printersRef = useRef(printers);
  cartridgesRef.current = cartridges;
  printersRef.current = printers;

  const [repairs, setRepairs] = useState<RepairEntry[]>(() => {
    if (shouldUseFileDatabase()) return [];
    return readLocalStorage<RepairEntry[]>('repairs', []);
  });

  const [batches, setBatches] = useState<RefillBatch[]>(() => {
    if (shouldUseFileDatabase()) return [];
    return readLocalStorage<RefillBatch[]>('batches', []);
  });

  const [settings, setSettingsState] = useState<AppSettings>(() => {
    if (shouldUseFileDatabase()) return { ...DEFAULT_SETTINGS };
    return migrateSettings(readLocalStorage<Partial<AppSettings>>('app_settings', {}));
  });

  const setSettings = (next: AppSettings) => {
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

  const [warehouseLedger, setWarehouseLedger] = useState<WarehouseLedgerState>(() => {
    if (shouldUseFileDatabase()) return { ...DEFAULT_WAREHOUSE_LEDGER };
    return loadWarehouseLedgerFromStorage();
  });
  const [dbProcessing, setDbProcessing] = useState<{
    visible: boolean;
    done: boolean;
    progress: number;
    text: string;
  }>({
    visible: shouldUseFileDatabase(),
    done: false,
    progress: shouldUseFileDatabase() ? 1 : 100,
    text: shouldUseFileDatabase() ? 'Обработка базы...' : '',
  });

  useEffect(() => {
    if (!window.electronAPI?.loadDatabase) return;
    let cancelled = false;
    const progressSteps = [8, 18, 30, 45, 58, 72, 85, 94];
    const setProgressAt = (idx: number) => {
      if (cancelled) return;
      setDbProcessing({
        visible: true,
        done: false,
        progress: progressSteps[Math.min(idx, progressSteps.length - 1)],
        text: 'Обработка базы...',
      });
    };

    (async () => {
      try {
        setProgressAt(0);
        const result = await window.electronAPI.loadDatabase();
        if (cancelled) return;
        if (result.success && result.data) {
          const db = result.data as Partial<DatabaseData>;
          const rawPrinters = (db.printers ?? []) as (Partial<Printer> & { inventoryNumber: string })[];
          const migratedPrinters = await mapInChunks(rawPrinters, migratePrinter, MIGRATE_CHUNK, () => cancelled);
          if (migratedPrinters === null) return;
          setPrinters(migratedPrinters);
          setProgressAt(1);
          const rawCartridges = (db.cartridges ?? []) as (Partial<Cartridge> & { id: string })[];
          const migratedCartridges = await mapInChunks(rawCartridges, migrateCartridge, MIGRATE_CHUNK, () => cancelled);
          if (migratedCartridges === null) return;
          setCartridges(migratedCartridges);
          setProgressAt(2);
          setRepairs((db.repairs ?? []) as RepairEntry[]);
          setProgressAt(3);
          setBatches((db.batches ?? []) as RefillBatch[]);
          setProgressAt(4);
          setSettingsState(migrateSettings(db.settings ?? {}));
          setProgressAt(5);
          setEmployees((db.employees ?? []) as EmployeeRecord[]);
          setRefillLog((db.refillLog ?? []) as RefillLogEntry[]);
          setNewCartridges((db.newCartridges ?? []) as NewCartridge[]);
          const wl = (db as Partial<DatabaseData>).warehouseLedger;
          setWarehouseLedger(
            wl
              ? {
                  ...DEFAULT_WAREHOUSE_LEDGER,
                  ...wl,
                  items: wl.items ?? [],
                  shipmentBatches: wl.shipmentBatches ?? [],
                  auditLogs: wl.auditLogs ?? [],
                }
              : loadWarehouseLedgerFromStorage(),
          );
          setProgressAt(6);
        } else {
          const rawPrinters = readLocalStorage<(Partial<Printer> & { inventoryNumber: string })[]>('printers', []);
          const migratedPrinters = await mapInChunks(rawPrinters, migratePrinter, MIGRATE_CHUNK, () => cancelled);
          if (migratedPrinters === null) return;
          setPrinters(migratedPrinters);
          setProgressAt(1);
          const rawCartridges = readLocalStorage<(Partial<Cartridge> & { id: string })[]>('cartridges', []);
          const migratedCartridges = await mapInChunks(rawCartridges, migrateCartridge, MIGRATE_CHUNK, () => cancelled);
          if (migratedCartridges === null) return;
          setCartridges(migratedCartridges);
          setProgressAt(2);
          setRepairs(readLocalStorage<RepairEntry[]>('repairs', []));
          setProgressAt(3);
          setBatches(readLocalStorage<RefillBatch[]>('batches', []));
          setProgressAt(4);
          setSettingsState(migrateSettings(readLocalStorage<Partial<AppSettings>>('app_settings', {})));
          setProgressAt(5);
          setEmployees(readLocalStorage<EmployeeRecord[]>('employees', []));
          setRefillLog(readLocalStorage<RefillLogEntry[]>('refill_log', []));
          setNewCartridges(readLocalStorage<NewCartridge[]>('new_cartridges', []));
          setWarehouseLedger(loadWarehouseLedgerFromStorage());
          setProgressAt(6);
        }
        setHydrated(true);
        setDbProcessing({
          visible: true,
          done: true,
          progress: 100,
          text: 'Обработка завершилась',
        });
        window.setTimeout(() => {
          if (!cancelled) {
            setDbProcessing(prev => ({ ...prev, visible: false }));
          }
        }, 1800);
      } catch {
        if (!cancelled) {
          setHydrated(true);
          setDbProcessing(prev => ({ ...prev, visible: false }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const consumableSlotMigratedRef = useRef(false);
  useEffect(() => {
    if (!hydrated) return;
    if (consumableSlotMigratedRef.current) return;
    consumableSlotMigratedRef.current = true;
    const { cartridges: nextC, printers: nextP, changed } = migrateConsumableSlots(cartridges, printers);
    if (changed) {
      setCartridges(nextC);
      setPrinters(nextP);
    }
  }, [hydrated, cartridges, printers]);

  const database: DatabaseData = useMemo(() => ({
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
    warehouseLedger,
  }), [printers, cartridges, repairs, batches, settings, employees, refillLog, newCartridges, warehouseLedger]);

  useDebouncedDatabase(database, hydrated);

  const addPrinter = (printer: Printer, logAction?: string) => {
    const inventoryNumber = normalizeInventoryNumber(printer.inventoryNumber);
    const prevExisting = printers.find(p => p.inventoryNumber === inventoryNumber);
    const withProgramId: Printer = {
      ...printer,
      inventoryNumber,
      programId: printer.programId ?? generateDeterministicId('P', inventoryNumber),
    };
    const firmwareJustMarked =
      withProgramId.firmwareFlashed === true && prevExisting?.firmwareFlashed !== true;

    setPrinters(prev => [
      ...prev.filter(p => p.inventoryNumber !== inventoryNumber),
      withProgramId,
    ]);
    setRefillLog(prev => {
      const created: RefillLogEntry = {
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        cartridgeId: withProgramId.programId ?? withProgramId.inventoryNumber,
        cartridgeModel: withProgramId.model,
        consumableType: 'device',
        deviceType: withProgramId.printerType,
        serviceType: 'Создание',
        printerInventoryNumber: withProgramId.inventoryNumber,
        printerModel: withProgramId.model,
        department: withProgramId.department,
        employee: withProgramId.boss,
        action: logAction ?? 'Принтер добавлен в систему',
        is_technical: true,
      };
      const next: RefillLogEntry[] = [...prev, created];
      if (firmwareJustMarked) {
        next.push({
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          cartridgeId: withProgramId.programId ?? withProgramId.inventoryNumber,
          cartridgeModel: withProgramId.model,
          consumableType: 'device',
          deviceType: withProgramId.printerType,
          serviceType: 'Редактирование',
          printerInventoryNumber: withProgramId.inventoryNumber,
          printerModel: withProgramId.model,
          department: withProgramId.department,
          employee: withProgramId.boss,
          action: prevExisting
            ? `Отметка «принтер прошит» установлена при сохранении карточки. Инв. № ${withProgramId.inventoryNumber}, модель ${withProgramId.model}. На этикетке будет отображаться метка прошивки.`
            : 'При добавлении принтера установлена отметка «принтер прошит»: прошивка зафиксирована в учёте (метка на этикетке).',
          is_technical: false,
        });
      }
      return next;
    });
  };

  const removePrinter = (inventoryNumber: string) => {
    const printer = printers.find(p => p.inventoryNumber === inventoryNumber);
    if (printer) {
      setRefillLog(prev => [
        {
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          cartridgeId: printer.programId ?? printer.inventoryNumber,
          cartridgeModel: printer.model,
          consumableType: 'device',
          deviceType: printer.printerType,
          serviceType: 'Списание',
          printerInventoryNumber: printer.inventoryNumber,
          printerModel: printer.model,
          department: printer.department,
          employee: printer.boss,
          action: 'Принтер удалён из системы',
          is_technical: true,
        },
        ...prev,
      ]);
    }
    setPrinters(prev => prev.filter(p => p.inventoryNumber !== inventoryNumber));
  };

  const addCartridge = (cartridge: Cartridge) => {
    setCartridges(prev => [...prev, cartridge]);
    const printer = printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
    const typeLabel = cartridge.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж';
    setRefillLog(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString(),
      cartridgeId: cartridge.id,
      cartridgeModel: cartridge.model,
      consumableType: cartridge.consumableType ?? 'cartridge',
      deviceType: typeLabel,
      serviceType: 'Создание',
      printerInventoryNumber: cartridge.printerInventoryNumber,
      printerModel: printer?.model ?? '',
      department: printer?.department ?? '',
      employee: printer?.boss,
      action: `Добавлен расходник: ${typeLabel} ${cartridge.model}`,
      is_technical: true,
    }]);
  };

  const removeCartridge = (id: string) => {
    const cartridge = cartridges.find(c => c.id === id);
    if (cartridge) {
      const printer = printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
      const typeLabel = cartridge.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж';
      setRefillLog(prev => [
        {
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          cartridgeId: cartridge.id,
          cartridgeModel: cartridge.model,
          consumableType: cartridge.consumableType ?? 'cartridge',
          deviceType: typeLabel,
          serviceType: 'Списание',
          printerInventoryNumber: cartridge.printerInventoryNumber,
          printerModel: printer?.model ?? '',
          department: printer?.department ?? '',
          employee: printer?.boss,
          action: `Расходник удалён из системы: ${typeLabel} ${cartridge.model}`,
          is_technical: true,
        },
        ...prev,
      ]);
    }
    setCartridges(prev => prev.filter(c => c.id !== id));
  };

  /**
   * Следующий монотонный слот для принтера (не сбрасывается при удалении расходника).
   * Обновляет consumableCartridgeSeq / consumableDrumSeq на записи принтера.
   */
  const allocateConsumableSlot = (invRaw: string, type: ConsumableType, ensurePrinter?: Printer): number => {
    const inv = normalizeInventoryNumber(invRaw);
    const seqKey = type === 'drum' ? 'consumableDrumSeq' : 'consumableCartridgeSeq';
    let nextSlot = 0;
    setPrinters(prev => {
      let row = prev.find(p => p.inventoryNumber === inv);
      if (!row && ensurePrinter && normalizeInventoryNumber(ensurePrinter.inventoryNumber) === inv) {
        row = ensurePrinter;
      }
      const carts = cartridgesRef.current;
      let maxFromCarts = 0;
      for (const c of carts) {
        if (normalizeInventoryNumber(c.printerInventoryNumber) !== inv) continue;
        if ((c.consumableType ?? 'cartridge') !== type) continue;
        const sl = c.consumableSlot;
        if (sl != null && Number.isFinite(sl) && sl > maxFromCarts) maxFromCarts = sl;
      }
      const seq = row ? (row[seqKey] ?? 0) : 0;
      nextSlot = Math.max(seq, maxFromCarts) + 1;
      if (!row) return prev;
      const inPrev = prev.some(p => p.inventoryNumber === inv);
      if (!inPrev) {
        return [...prev, { ...row, [seqKey]: nextSlot }];
      }
      return prev.map(p => (p.inventoryNumber === inv ? { ...p, [seqKey]: nextSlot } : p));
    });
    return nextSlot;
  };

  /** Generate a short unique ID for consumables: C-XXXXXX for cartridge, D-XXXXXX for drum */
  const generateConsumableId = (
    type: ConsumableType = 'cartridge',
    printerInventoryNumber?: string,
    /** Монотонный слот (см. allocateConsumableSlot), не индекс «текущего количества» */
    consumableSlot?: number,
  ) => {
    const prefix = type === 'drum' ? 'D' : 'C';
    if (printerInventoryNumber && Number.isFinite(consumableSlot)) {
      return generateDeterministicId(prefix, `${normalizeInventoryNumber(printerInventoryNumber)}:${consumableSlot}`);
    }
    return generateRandomId(prefix);
  };

  /** Generate a short unique ID for new stock cartridges */
  const generateNewCartridgeId = (seed?: string) => (
    seed ? generateDeterministicId('N', seed) : generateRandomId('N')
  );

  /** Generate a short unique ID for printers */
  const generatePrinterId = (inventoryNumber?: string) => (
    inventoryNumber ? generateDeterministicId('P', normalizeInventoryNumber(inventoryNumber)) : generateRandomId('P')
  );

  /** @deprecated use generateConsumableId */
  const generateCartridgeId = () => generateConsumableId('cartridge');

  /**
   * @param employee — кто совершил шаг (в историю), не обязательно «кто сдал» на склад
   * @param submitterName — если задано непустое, записать в lastSubmittedBy («Кто сдал» в складе); иначе поле не меняем
   */
  const updateCartridgeStatus = (
    id: string,
    status: CartridgeStatus,
    comment?: string,
    employee?: string,
    submitterName?: string,
  ) => {
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
          status === 'received_from_refill' ? (c.refillCount ?? 0) + 1 : c.refillCount ?? 0;
        const trimmedSubmitter = submitterName?.trim();
        const updated: Cartridge = {
          ...c,
          status,
          history: [...c.history, historyEntry],
          refillCount,
          lastSubmittedBy: trimmedSubmitter ? trimmedSubmitter : c.lastSubmittedBy,
        };
        return updated;
      }),
    );
  };

  const updateCartridge = (id: string, updates: Partial<Cartridge>) => {
    setCartridges(prev => prev.map(c => (c.id === id ? { ...c, ...updates } : c)));
  };

  const updateRepair = (id: string, updates: Partial<RepairEntry>) => {
    setRepairs(prev => prev.map(r => (r.id === id ? { ...r, ...updates } : r)));
  };

  const rndId = () => Math.random().toString(36).substr(2, 9);

  /** Одним шагом: принять с заправки (если ещё at_refill) и выдать пользователю — без двойного batching setState. */
  const finishIssueCartridgeFromBatch = (cartridgeId: string, batchId: string, employeeRaw?: string) => {
    const employee = employeeRaw?.trim() || undefined;
    const cartridge = cartridgesRef.current.find(c => c.id === cartridgeId);
    if (!cartridge) return;
    if (!['at_refill', 'received_from_refill', 'ready'].includes(cartridge.status)) return;

    const printer = printers.find(p => p.inventoryNumber === cartridge.printerInventoryNumber);
    const hadAtRefill = cartridge.status === 'at_refill';

    setCartridges(prev =>
      prev.map(c => {
        if (c.id !== cartridgeId) return c;
        const hist = [...c.history];
        let refillCount = c.refillCount ?? 0;
        if (c.status === 'at_refill') {
          refillCount += 1;
          hist.push({
            id: rndId(),
            date: new Date().toISOString(),
            action: STATUS_LABELS.received_from_refill,
            comment: `Получен с заправки. Партия ${batchId}`,
          });
        } else if (c.status !== 'received_from_refill' && c.status !== 'ready') {
          return c;
        }
        hist.push({
          id: rndId(),
          date: new Date().toISOString(),
          action: STATUS_LABELS.on_hand,
          comment: 'Выдан пользователю',
          employee,
        });
        const trimmed = employee?.trim();
        return {
          ...c,
          status: 'on_hand',
          refillCount,
          history: hist,
          lastSubmittedBy: trimmed ? trimmed : c.lastSubmittedBy,
        };
      }),
    );

    const typeLabel = cartridge.consumableType === 'drum' ? 'Драм-картридж' : 'Картридж';
    const logs: RefillLogEntry[] = [];
    if (hadAtRefill) {
      logs.push({
        id: rndId(),
        date: new Date().toISOString(),
        cartridgeId: cartridge.id,
        cartridgeModel: cartridge.model,
        consumableType: cartridge.consumableType ?? 'cartridge',
        deviceType: typeLabel,
        serviceType: 'Заправка',
        printerInventoryNumber: cartridge.printerInventoryNumber,
        printerModel: printer?.model ?? '',
        department: printer?.department ?? '',
        employee: printer?.boss,
        action: `Картридж получен с заправки. Партия ${batchId}`,
        is_technical: false,
      });
    }
    logs.push({
      id: rndId(),
      date: new Date().toISOString(),
      cartridgeId: cartridge.id,
      cartridgeModel: cartridge.model,
      consumableType: cartridge.consumableType ?? 'cartridge',
      deviceType: typeLabel,
      serviceType: 'Выдача',
      printerInventoryNumber: cartridge.printerInventoryNumber,
      printerModel: printer?.model ?? '',
      department: printer?.department ?? '',
      employee,
      action: employee ? `Картридж выдан сотруднику ${employee}` : 'Картридж выдан пользователю',
      is_technical: false,
    });
    setRefillLog(prev => [...logs, ...prev]);

    if (employee) {
      const exists = employees.find(
        e => e.name === employee && e.printerInventoryNumber === cartridge.printerInventoryNumber,
      );
      if (!exists) {
        setEmployees(prevE => [
          ...prevE,
          {
            id: rndId(),
            name: employee,
            printerInventoryNumber: cartridge.printerInventoryNumber,
            cartridgeId: cartridge.id,
            addedDate: new Date().toISOString(),
          },
        ]);
      }
    }
  };

  /** Устройство с партии + связанные расходники: принять с заправки при необходимости и выдать одной кнопкой. */
  const finishIssuePrinterBundleFromBatch = (
    printerInventoryNumber: string,
    repairId: string | undefined,
    batchId: string,
    employeeRaw?: string,
  ) => {
    const employee = employeeRaw?.trim() || undefined;
    if (!repairId) return;
    const repair = repairs.find(r => r.id === repairId);
    const printer = printers.find(p => p.inventoryNumber === printerInventoryNumber);
    if (!repair || !printer) return;
    if (repair.locationStatus === 'issued') return;

    const repairWasAtRefill = repair.locationStatus === 'at_refill';

    const linkedIds = cartridgesRef.current
      .filter(c => c.linkedRepairId === repair.id)
      .map(c => c.id);

    setRepairs(prev =>
      prev.map(r => {
        if (r.id !== repair.id) return r;
        const next: RepairEntry = {
          ...r,
          locationStatus: 'issued',
        };
        if (repairWasAtRefill) {
          next.status = 'repaired';
          next.completionDate = new Date().toISOString();
          next.repairDescription = r.repairDescription ?? 'Принят с заправки';
        }
        return next;
      }),
    );

    setCartridges(prev =>
      prev.map(c => {
        if (!linkedIds.includes(c.id)) return c;
        if (c.status === 'disposed') return c;
        const hist = [...c.history];
        let refillCount = c.refillCount ?? 0;
        if (c.status === 'at_refill') {
          refillCount += 1;
          hist.push({
            id: rndId(),
            date: new Date().toISOString(),
            action: STATUS_LABELS.received_from_refill,
            comment: `Получен с заправки вместе с принтером. Партия ${batchId}`,
          });
        }
        if (['at_refill', 'received_from_refill', 'ready'].includes(c.status)) {
          hist.push({
            id: rndId(),
            date: new Date().toISOString(),
            action: STATUS_LABELS.on_hand,
            comment: 'Выдан вместе с принтером',
            employee,
          });
          return {
            ...c,
            status: 'on_hand',
            refillCount,
            history: hist,
            lastSubmittedBy: c.lastSubmittedBy,
          };
        }
        return c;
      }),
    );

    if (repairWasAtRefill) {
      setPrinters(prev =>
        prev.map(p =>
          p.inventoryNumber === printer.inventoryNumber
            ? { ...p, refillCount: (p.refillCount ?? 0) + 1 }
            : p,
        ),
      );
    }

    const logs: RefillLogEntry[] = [];
    if (repairWasAtRefill) {
      logs.push({
        id: rndId(),
        date: new Date().toISOString(),
        cartridgeId: printer.programId ?? printer.inventoryNumber,
        cartridgeModel: printer.model,
        consumableType: 'device',
        deviceType: printer.printerType ?? 'Устройство',
        serviceType: 'Ремонт',
        printerInventoryNumber,
        printerModel: printer.model,
        department: printer.department ?? '',
        employee: printer.boss,
        action: `Принтер получен с ремонта. Партия ${batchId}`,
        is_technical: false,
      });
    }
    logs.push({
      id: rndId(),
      date: new Date().toISOString(),
      cartridgeId: printer.programId ?? printer.inventoryNumber,
      cartridgeModel: printer.model,
      consumableType: 'device',
      deviceType: printer.printerType ?? 'Устройство',
      serviceType: 'Ремонт',
      printerInventoryNumber,
      printerModel: printer.model,
      department: printer.department ?? '',
      employee,
      action: employee ? `Принтер выдан сотруднику ${employee}` : 'Принтер выдан пользователю',
      is_technical: false,
    });
    setRefillLog(prev => [...logs, ...prev]);
  };

  const replaceCartridge = (
    oldId: string,
    newCartridge: Cartridge,
    disposeNote?: string,
  ) => {
    setCartridges(prev => {
      const updated = prev.map(c => {
        if (c.id !== oldId) return c;
        const trimmed = disposeNote?.trim();
        const historyEntry: HistoryEntry = {
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          action: trimmed
            ? `${trimmed} (новый ID: ${newCartridge.id})`
            : `Заменён. Новый: ${newCartridge.id}`,
        };
        return {
          ...c,
          isReplaced: true,
          status: 'disposed' as CartridgeStatus,
          replacedById: newCartridge.id,
          history: [...c.history, historyEntry],
        };
      });
      return [...updated, newCartridge];
    });
  };

  const addRepair = (repair: RepairEntry) => {
    setRepairs(prev => [...prev, repair]);
    const printer = printers.find(p => p.inventoryNumber === repair.printerInventoryNumber);
    if (printer) {
      setPrinters(prev => prev.map(p => p.inventoryNumber === printer.inventoryNumber ? {
        ...p,
        repairCount: (p.repairCount ?? 0) + 1,
      } : p));
    }
    setRefillLog(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      date: repair.date,
      cartridgeId: printer?.programId ?? repair.printerInventoryNumber,
      cartridgeModel: printer?.model ?? '',
      consumableType: 'device',
      deviceType: printer?.printerType ?? 'Устройство',
      serviceType: 'Ремонт',
      printerInventoryNumber: repair.printerInventoryNumber,
      printerModel: printer?.model ?? '',
      department: printer?.department ?? '',
      employee: repair.technician,
      action: `Принтер принят в ремонт: ${repair.reason}`,
      is_technical: false,
    }]);
  };

  const addEmployee = (record: EmployeeRecord) => {
    setEmployees(prev => [...prev, record]);
    const printer = printers.find(p => p.inventoryNumber === record.printerInventoryNumber);
    const empAddCartId: string = printer?.programId ?? printer?.inventoryNumber ?? record.printerInventoryNumber ?? '';
    setRefillLog(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString(),
      cartridgeId: empAddCartId,
      cartridgeModel: printer?.model ?? '',
      consumableType: 'device',
      deviceType: printer?.printerType ?? 'Устройство',
      serviceType: 'Системное',
      printerInventoryNumber: record.printerInventoryNumber ?? '',
      printerModel: printer?.model ?? '',
      department: printer?.department ?? '',
      employee: record.name,
      action: `Добавлен сотрудник: ${record.name}`,
      is_technical: true,
    }]);
  };

  const removeEmployee = (id: string) => {
    const record = employees.find(e => e.id === id);
    setEmployees(prev => prev.filter(e => e.id !== id));
    if (record) {
      const printer = printers.find(p => p.inventoryNumber === record.printerInventoryNumber);
      const empRemCartId: string = printer?.programId ?? printer?.inventoryNumber ?? record.printerInventoryNumber ?? '';
      setRefillLog(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        cartridgeId: empRemCartId,
        cartridgeModel: printer?.model ?? '',
        consumableType: 'device',
        deviceType: printer?.printerType ?? 'Устройство',
        serviceType: 'Системное',
        printerInventoryNumber: record.printerInventoryNumber ?? '',
        printerModel: printer?.model ?? '',
        department: printer?.department ?? '',
        employee: record.name,
        action: `Удалён сотрудник: ${record.name}`,
        is_technical: true,
      }]);
    }
  };

  const addRefillLog = (entry: RefillLogEntry) => {
    setRefillLog(prev => [...prev, entry]);
  };

  const removeLastWaitingAcceptRefillLogEntry = (cartridgeId: string) => {
    setRefillLog(prev =>
      stripLastMatchingRefillLog(prev, e => e.cartridgeId === cartridgeId && isRefillLogWaitingAcceptEntry(e)),
    );
  };

  /** Отмена позиции «ожидает отправки»: убрать приём из журнала и вернуть расходник на руки. */
  const cancelWaitingCartridgeIntake = (cartridgeId: string) => {
    removeLastWaitingAcceptRefillLogEntry(cartridgeId);
    updateCartridgeStatus(cartridgeId, 'on_hand', 'Отмена ожидания отправки');
  };

  /** Устройство в ожидании отправки в ремонт: удалить заявку, снять связанные расходники, убрать приём из журнала. */
  const cancelWaitingRepairIntake = (repairId: string) => {
    const repair = repairs.find(r => r.id === repairId);
    const printer = repair ? printers.find(p => p.inventoryNumber === repair.printerInventoryNumber) : undefined;
    const linkedWaiting = cartridges.filter(c => c.linkedRepairId === repairId && c.status === 'waiting');

    setRefillLog(prev => {
      let next = prev;
      if (repair) {
        const deviceKey = printer?.programId ?? repair.printerInventoryNumber;
        next = stripLastMatchingRefillLog(
          next,
          e =>
            e.consumableType === 'device' &&
            isRefillLogWaitingAcceptEntry(e) &&
            (e.cartridgeId === deviceKey || e.cartridgeId === repair.printerInventoryNumber),
        );
      }
      for (const c of linkedWaiting) {
        next = stripLastMatchingRefillLog(
          next,
          e => e.cartridgeId === c.id && isRefillLogWaitingAcceptEntry(e),
        );
      }
      return next;
    });

    linkedWaiting.forEach(c => {
      updateCartridge(c.id, { linkedRepairId: undefined });
      updateCartridgeStatus(c.id, 'on_hand', 'Отмена ожидания отправки (устройство)');
    });

    setRepairs(prev => prev.filter(r => r.id !== repairId));
    if (printer) {
      setPrinters(prev =>
        prev.map(p =>
          p.inventoryNumber === printer.inventoryNumber
            ? { ...p, repairCount: Math.max(0, (p.repairCount ?? 0) - 1) }
            : p,
        ),
      );
    }
  };

  const getEmployeesForPrinter = (invNum: string) =>
    employees.filter(e => e.printerInventoryNumber === invNum);

  const getEmployeesForCartridge = (cartId: string) =>
    employees.filter(e => e.cartridgeId === cartId);

  const addNewCartridge = (c: NewCartridge) => {
    setNewCartridges(prev => [...prev, c]);
  };

  const removeNewCartridge = (id: string) => {
    setNewCartridges(prev => prev.filter(c => c.id !== id));
  };

  const updateNewCartridge = (id: string, updates: Partial<NewCartridge>) => {
    setNewCartridges(prev => prev.map(c => (c.id === id ? { ...c, ...updates } : c)));
  };

  const updatePrinter = (inventoryNumber: string, updates: Partial<Printer>) => {
    const prevP = printers.find(p => p.inventoryNumber === inventoryNumber);
    const logFirmwareMarked =
      !!prevP &&
      updates.firmwareFlashed === true &&
      prevP.firmwareFlashed !== true;

    setPrinters(prev => prev.map(p => (p.inventoryNumber === inventoryNumber ? { ...p, ...updates } : p)));

    if (logFirmwareMarked && prevP) {
      const p: Printer = { ...prevP, ...updates };
      addRefillLog({
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toISOString(),
        cartridgeId: p.programId ?? p.inventoryNumber,
        cartridgeModel: p.model,
        consumableType: 'device',
        deviceType: p.printerType,
        serviceType: 'Редактирование',
        printerInventoryNumber: p.inventoryNumber,
        printerModel: p.model,
        department: p.department,
        employee: p.boss,
        action:
          `Отметка «принтер прошит» установлена: прошивка зафиксирована в учёте. Инв. № ${p.inventoryNumber}, модель ${p.model}. На этикетке будет отображаться метка прошивки.`,
        is_technical: false,
      });
    }
  };

  /**
   * Приём принтера «с заправки» с приёмной (сканер): синхронизирует снимок партии склада и legacy `batches`,
   * если устройство отмечалось в активной партии как at_refill.
   */
  const applyWarehouseReceiveForPrinterFromDashboard = (repairId: string, deviceRowId: string) => {
    const printer = printers.find(
      p => p.programId === deviceRowId || p.inventoryNumber === deviceRowId,
    );
    const inv = printer?.inventoryNumber ?? '';
    const programId = printer?.programId;

    const matchesChildParent = (parentId: string | undefined) => {
      if (!parentId) return false;
      if (parentId === deviceRowId) return true;
      if (inv && parentId === inv) return true;
      if (programId && parentId === programId) return true;
      return false;
    };

    let batchIdToSync: string | null = null;
    let nextItemsForLegacy: WarehouseBatchItem[] | null = null;

    setWarehouseLedger(prev => {
      const batch = prev.shipmentBatches.find(
        b =>
          b.status === 'sent' &&
          b.items.some(
            it =>
              it.type === 'Устройство' &&
              it.repairId === repairId &&
              it.status === 'at_refill',
          ),
      );
      if (!batch) return prev;

      const nextItems = batch.items.map(it => {
        if (it.status !== 'at_refill') return it;
        const isDevice = it.type === 'Устройство' && it.repairId === repairId;
        const isChild = matchesChildParent(it.parentDeviceId);
        if (isDevice || isChild) {
          return { ...it, status: 'ready' as const, refillCount: it.refillCount + 1 };
        }
        return it;
      });

      const hasAtRefill = nextItems.some(i => i.status === 'at_refill');
      batchIdToSync = batch.id;
      nextItemsForLegacy = nextItems;

      const nextShipmentBatches = prev.shipmentBatches.map(b =>
        b.id !== batch.id
          ? b
          : {
              ...b,
              items: nextItems,
              status: hasAtRefill ? b.status : ('received' as const),
              dateReceived: hasAtRefill ? b.dateReceived : new Date().toISOString(),
            },
      );

      const nextLedgerItems = prev.items.map(it => {
        if (it.status !== 'at_refill') return it;
        const matchDevice = it.type === 'Устройство' && it.repairId === repairId;
        const matchChild = matchesChildParent(it.parentDeviceId);
        if (matchDevice || matchChild) {
          return { ...it, status: 'ready', refillCount: it.refillCount + 1 };
        }
        return it;
      });

      return { ...prev, shipmentBatches: nextShipmentBatches, items: nextLedgerItems };
    });

    if (batchIdToSync && nextItemsForLegacy) {
      const hasAtRefill = nextItemsForLegacy.some(i => i.status === 'at_refill');
      setBatches(pb =>
        pb.map(b =>
          b.id === batchIdToSync
            ? { ...b, status: hasAtRefill ? ('sent' as const) : ('received' as const) }
            : b,
        ),
      );
    }
  };

  /** Приём одного расходника с заправки с приёмной — снимок партии в склад не «зависает» в at_refill. */
  const applyWarehouseReceiveForCartridgeFromDashboard = (cartridgeId: string) => {
    let batchIdToSync: string | null = null;
    let nextItemsForLegacy: WarehouseBatchItem[] | null = null;

    setWarehouseLedger(prev => {
      const batch = prev.shipmentBatches.find(
        b =>
          b.status === 'sent' && b.items.some(it => it.id === cartridgeId && it.status === 'at_refill'),
      );
      if (!batch) return prev;

      const nextItems = batch.items.map(it =>
        it.id === cartridgeId && it.status === 'at_refill'
          ? { ...it, status: 'ready' as const, refillCount: it.refillCount + 1 }
          : it,
      );
      const hasAtRefill = nextItems.some(i => i.status === 'at_refill');
      batchIdToSync = batch.id;
      nextItemsForLegacy = nextItems;

      const nextShipmentBatches = prev.shipmentBatches.map(b =>
        b.id !== batch.id
          ? b
          : {
              ...b,
              items: nextItems,
              status: hasAtRefill ? b.status : ('received' as const),
              dateReceived: hasAtRefill ? b.dateReceived : new Date().toISOString(),
            },
      );

      const nextLedgerItems = prev.items.map(it => {
        if (it.id === cartridgeId && it.status === 'at_refill') {
          return { ...it, status: 'ready', refillCount: it.refillCount + 1 };
        }
        return it;
      });

      return { ...prev, shipmentBatches: nextShipmentBatches, items: nextLedgerItems };
    });

    if (batchIdToSync && nextItemsForLegacy) {
      const hasAtRefill = nextItemsForLegacy.some(i => i.status === 'at_refill');
      setBatches(pb =>
        pb.map(b =>
          b.id === batchIdToSync
            ? { ...b, status: hasAtRefill ? ('sent' as const) : ('received' as const) }
            : b,
        ),
      );
    }
  };

  /**
   * Выдача на руки: обновить shipmentBatches + ledger.items (как кнопка «Выдать» на вкладке Склад).
   * Вызывать после смены статусов в основной БД (ремонт/расходники).
   */
  const applyWarehouseIssueSnapshotFromDashboard = (idsToIssue: string[], recipient: string) => {
    const issueDate = new Date().toISOString();
    const who = recipient.trim() || 'Сотрудник';
    const idSet = new Set(idsToIssue.filter(Boolean));

    setWarehouseLedger(prev => {
      const nextShipmentBatches = prev.shipmentBatches.map(b => {
        const hasAny = b.items.some(it => idSet.has(it.id));
        if (!hasAny) return b;
        const updated = b.items.map(item => {
          if (!idSet.has(item.id)) return item;
          if (item.status === 'issued' || item.status === 'replaced') return item;
          return {
            ...item,
            status: 'issued' as const,
            whoPickedUp: who,
            issueDate,
          };
        });
        const allClosed = updated.every(i => i.status === 'issued' || i.status === 'replaced');
        return {
          ...b,
          status: allClosed ? ('closed' as const) : b.status,
          items: updated,
        };
      });

      const nextItems = prev.items.map(i => {
        if (!idSet.has(i.id)) return i;
        if (i.status !== 'ready') return i;
        return {
          ...i,
          status: 'issued',
          whoPickedUp: who,
          issueDate,
        };
      });

      return { ...prev, shipmentBatches: nextShipmentBatches, items: nextItems };
    });
  };

  /** Сразу записать пустую базу на диск / в localStorage (обход 1.5s debounce перед reload). */
  const wipeAllPersistedData = async () => {
    const empty: DatabaseData = {
      version: 1,
      savedAt: new Date().toISOString(),
      printers: [],
      cartridges: [],
      repairs: [],
      batches: [],
      settings: migrateSettings({}),
      employees: [],
      refillLog: [],
      newCartridges: [],
      warehouseLedger: { ...DEFAULT_WAREHOUSE_LEDGER },
    };
    if (shouldUseFileDatabase() && window.electronAPI?.saveDatabase) {
      const res = await window.electronAPI.saveDatabase(empty);
      if (!res.success) {
        throw new Error(res.error ?? 'Не удалось записать пустую базу');
      }
      return;
    }
    localStorage.setItem('printers', '[]');
    localStorage.setItem('cartridges', '[]');
    localStorage.setItem('repairs', '[]');
    localStorage.setItem('batches', '[]');
    localStorage.setItem('app_settings', JSON.stringify(migrateSettings({})));
    localStorage.setItem('employees', '[]');
    localStorage.setItem('refill_log', '[]');
    localStorage.setItem('new_cartridges', '[]');
    localStorage.setItem('warehouse_ledger', JSON.stringify(DEFAULT_WAREHOUSE_LEDGER));
  };

  return {
    printers, setPrinters,
    cartridges, setCartridges,
    repairs, setRepairs,
    batches, setBatches,
    settings, setSettings,
    employees, setEmployees,
    refillLog, setRefillLog,
    warehouseLedger, setWarehouseLedger,
    addPrinter,
    removePrinter,
    updatePrinter,
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
    applyWarehouseReceiveForPrinterFromDashboard,
    applyWarehouseReceiveForCartridgeFromDashboard,
    applyWarehouseIssueSnapshotFromDashboard,
    getEmployeesForPrinter,
    getEmployeesForCartridge,
    newCartridges, setNewCartridges,
    addNewCartridge,
    removeNewCartridge,
    updateNewCartridge,
    dbProcessing,
    wipeAllPersistedData,
  };
};

export type StoreType = ReturnType<typeof useStore>;
