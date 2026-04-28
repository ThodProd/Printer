
import { useState, useEffect, useMemo } from 'react';
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
    }, 1500);
    return () => window.clearTimeout(handle);
  }, [data, hydrated]);
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
    programId: (p as any).programId ?? generateShortId('P'),
    inventoryNumber,
    model: p.model ?? '',
    printerType: (p as any).printerType ?? 'printer',
    department: p.department ?? '',
    boss: p.boss ?? (p as any).employee ?? '',
    cartridgeModels: p.cartridgeModels ?? [],
    commissionDate: p.commissionDate ?? '',
    balanceCost: p.balanceCost ?? '',
  };
}

function migrateCartridge(c: Partial<Cartridge> & { id: string }): Cartridge {
  return {
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
  };
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
    return { ...DEFAULT_SETTINGS, ...readLocalStorage<Partial<AppSettings>>('app_settings', {}) };
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

  useEffect(() => {
    if (!window.electronAPI?.loadDatabase) return;
    let cancelled = false;
    window.electronAPI.loadDatabase()
      .then(result => {
        if (cancelled) return;
        if (result.success && result.data) {
          const db = result.data as Partial<DatabaseData>;
          setPrinters(((db.printers ?? []) as (Partial<Printer> & { inventoryNumber: string })[]).map(migratePrinter));
          setCartridges(((db.cartridges ?? []) as (Partial<Cartridge> & { id: string })[]).map(migrateCartridge));
          setRepairs((db.repairs ?? []) as RepairEntry[]);
          setBatches((db.batches ?? []) as RefillBatch[]);
          setSettingsState({ ...DEFAULT_SETTINGS, ...(db.settings ?? {}) });
          setEmployees((db.employees ?? []) as EmployeeRecord[]);
          setRefillLog((db.refillLog ?? []) as RefillLogEntry[]);
          setNewCartridges((db.newCartridges ?? []) as NewCartridge[]);
        } else {
          setPrinters(readLocalStorage<(Partial<Printer> & { inventoryNumber: string })[]>('printers', []).map(migratePrinter));
          setCartridges(readLocalStorage<(Partial<Cartridge> & { id: string })[]>('cartridges', []).map(migrateCartridge));
          setRepairs(readLocalStorage<RepairEntry[]>('repairs', []));
          setBatches(readLocalStorage<RefillBatch[]>('batches', []));
          setSettingsState({ ...DEFAULT_SETTINGS, ...readLocalStorage<Partial<AppSettings>>('app_settings', {}) });
          setEmployees(readLocalStorage<EmployeeRecord[]>('employees', []));
          setRefillLog(readLocalStorage<RefillLogEntry[]>('refill_log', []));
          setNewCartridges(readLocalStorage<NewCartridge[]>('new_cartridges', []));
        }
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => { cancelled = true; };
  }, []);

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
  }), [printers, cartridges, repairs, batches, settings, employees, refillLog, newCartridges]);

  useDebouncedDatabase(database, hydrated);

  const addPrinter = (printer: Printer) => {
    const inventoryNumber = normalizeInventoryNumber(printer.inventoryNumber);
    const withProgramId: Printer = {
      ...printer,
      inventoryNumber,
      programId: printer.programId ?? generateShortId('P'),
    };
    setPrinters(prev => [
      ...prev.filter(p => p.inventoryNumber !== inventoryNumber),
      withProgramId,
    ]);
  };

  const removePrinter = (inventoryNumber: string) => {
    setPrinters(prev => prev.filter(p => p.inventoryNumber !== inventoryNumber));
  };

  const addCartridge = (cartridge: Cartridge) => {
    setCartridges(prev => [...prev, cartridge]);
  };

  const removeCartridge = (id: string) => {
    setCartridges(prev => prev.filter(c => c.id !== id));
  };

  /** Generate a short unique ID for consumables: C-XXXXXX for cartridge, D-XXXXXX for drum */
  const generateConsumableId = (type: ConsumableType = 'cartridge') => {
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
    setCartridges(prev => prev.map(c => (c.id === id ? { ...c, ...updates } : c)));
  };

  const updateRepair = (id: string, updates: Partial<RepairEntry>) => {
    setRepairs(prev => prev.map(r => (r.id === id ? { ...r, ...updates } : r)));
  };

  const replaceCartridge = (oldId: string, newCartridge: Cartridge) => {
    setCartridges(prev => {
      const updated = prev.map(c => {
        if (c.id !== oldId) return c;
        const historyEntry: HistoryEntry = {
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toISOString(),
          action: `Заменён. Новый: ${newCartridge.id}`,
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

  const addRepair = (repair: RepairEntry) => {
    setRepairs(prev => [...prev, repair]);
  };

  const addEmployee = (record: EmployeeRecord) => {
    setEmployees(prev => [...prev, record]);
  };

  const removeEmployee = (id: string) => {
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
    setNewCartridges(prev => [...prev, c]);
  };

  const removeNewCartridge = (id: string) => {
    setNewCartridges(prev => prev.filter(c => c.id !== id));
  };

  const updateNewCartridge = (id: string, updates: Partial<NewCartridge>) => {
    setNewCartridges(prev => prev.map(c => (c.id === id ? { ...c, ...updates } : c)));
  };

  const updatePrinter = (inventoryNumber: string, updates: Partial<Printer>) => {
    setPrinters(prev => prev.map(p => (p.inventoryNumber === inventoryNumber ? { ...p, ...updates } : p)));
  };

  return {
    printers, setPrinters,
    cartridges, setCartridges,
    repairs, setRepairs,
    batches, setBatches,
    settings, setSettings,
    employees, setEmployees,
    refillLog, setRefillLog,
    addPrinter,
    removePrinter,
    updatePrinter,
    addCartridge,
    removeCartridge,
    generateConsumableId,
    generateNewCartridgeId,
    generatePrinterId,
    generateCartridgeId,
    updateCartridgeStatus,
    updateCartridge,
    updateRepair,
    replaceCartridge,
    addRepair,
    addEmployee,
    removeEmployee,
    addRefillLog,
    getEmployeesForPrinter,
    getEmployeesForCartridge,
    newCartridges, setNewCartridges,
    addNewCartridge,
    removeNewCartridge,
    updateNewCartridge,
  };
};

export type StoreType = ReturnType<typeof useStore>;
