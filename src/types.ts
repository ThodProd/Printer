
export type CartridgeStatus =
  | 'on_hand'
  | 'waiting'
  | 'at_refill'
  | 'received_from_refill'
  | 'ready'
  | 'replaced'
  | 'disposed';

export type ConsumableType = 'cartridge' | 'drum';
export type ConsumableColor = 'black' | 'cyan' | 'magenta' | 'yellow';

/** 'printer' | 'mfu' | any custom string like 'Плоттер' */
export type PrinterType = string;

export const STATUS_LABELS: Record<CartridgeStatus, string> = {
  on_hand: 'На руках',
  waiting: 'Ожидает отправки',
  at_refill: 'На заправке',
  received_from_refill: 'Готов к выдаче',
  ready: 'Готов к выдаче',
  replaced: 'Заменён',
  disposed: 'Списан',
};

export const STATUS_COLORS: Record<CartridgeStatus, string> = {
  on_hand: 'bg-sky-100 text-sky-700',
  waiting: 'bg-yellow-100 text-yellow-700',
  at_refill: 'bg-purple-100 text-purple-700',
  received_from_refill: 'bg-green-100 text-green-700',
  ready: 'bg-green-100 text-green-700',
  replaced: 'bg-gray-100 text-gray-500',
  disposed: 'bg-red-100 text-red-600',
};

export interface HistoryEntry {
  id: string;
  date: string;
  action: string;
  employee?: string;
  comment?: string;
}

export interface Cartridge {
  id: string;
  barcode: string;
  model: string;
  consumableType: ConsumableType;
  color?: ConsumableColor;
  printerInventoryNumber: string;
  status: CartridgeStatus;
  history: HistoryEntry[];
  isReplaced?: boolean;
  replacedById?: string;
  refillCount: number;
  registrationDate: string;
  lastSubmittedBy?: string;
  /** If set, cartridge is logically bundled with this printer repair workflow */
  linkedRepairId?: string;
  /** Порядковый номер расходника у принтера (Картридж 2 / Драм 2); не уменьшается при удалении */
  consumableSlot?: number;
  /** Флаг о том, что этикетка на данный картридж уже была напечатана */
  labelPrinted?: boolean;
}

export interface Printer {
  /** Auto-generated short program ID, e.g. P-AB3K7F */
  programId?: string;
  inventoryNumber: string;
  model: string;
  /** 'printer' | 'mfu' | custom string */
  printerType: PrinterType;
  department: string;
  boss: string;
  cartridgeModels: string[];
  commissionDate: string;
  balanceCost: string;
  refillCount?: number;
  repairCount?: number;
  /** Прошивка выполнена — на этикетке {fw} печатается «П»; красная точка в списках; снять нельзя из UI */
  firmwareFlashed?: boolean;
  /** Последний выданный номер слота для картриджей (монотонно, для ID и подписи «Картридж N») */
  consumableCartridgeSeq?: number;
  /** То же для драмов */
  consumableDrumSeq?: number;
}

export interface RepairEntry {
  id: string;
  printerInventoryNumber: string;
  date: string;
  completionDate?: string;
  reason: string;
  repairDescription?: string;
  status: 'waiting' | 'in_repair' | 'repaired';
  comment?: string;
  technician?: string;
  /** Workflow state shown in repair/inventory tabs */
  locationStatus?: 'waiting' | 'at_refill' | 'ready' | 'issued';
}

export interface RefillBatchItem {
  kind: 'cartridge' | 'printer';
  id: string;
  printerInventoryNumber: string;
  repairId?: string;
}

export interface RefillBatch {
  id: string;
  date: string;
  cartridgeIds: string[];
  items?: RefillBatchItem[];
  status: 'sent' | 'received';
  company?: string;
  notes?: string;
}

/** Human-readable service category stored on each log entry. Russian strings map directly to UI tab names. */
export type LogServiceType =
  // === User-facing (is_technical: false) ===
  | 'Заправка'       // Cartridge/device refill cycle: accept → ship → receive
  | 'Выдача'         // Issue to end user
  | 'Ремонт'         // Printer repair cycle: accept → ship → receive → issue
  // === Technical (is_technical: true) ===
  | 'Создание'       // Adding a new record (printer, cartridge, import)
  | 'Редактирование' // Editing an existing record
  | 'Списание'       // Writeoff or deletion
  | 'Системное'      // System events: employees, firmware, etc.
  // === Legacy values (kept for backward compatibility with existing DB data) ===
  | 'refill' | 'repair' | 'replacement' | 'writeoff' | 'system'
  | 'accept' | 'shipment' | 'receive' | 'issue' | 'delete' | 'cancel';

export interface RefillLogEntry {
  id: string;
  date: string;
  cartridgeId: string;
  cartridgeModel: string;
  consumableType: ConsumableType | 'device';
  deviceType?: string;
  serviceType?: LogServiceType;
  printerInventoryNumber: string;
  printerModel: string;
  department?: string;
  employee?: string;
  action: string;
  /** true = technical/system record hidden from user by default; false/undefined = user-facing business event */
  is_technical?: boolean;
}

export interface EmployeeRecord {
  id: string;
  name: string;
  printerInventoryNumber?: string;
  cartridgeId?: string;
  addedDate: string;
}

export interface LabelElement {
  id: string;
  type: 'barcode' | 'qrcode' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  fontSize?: number;
  fontScale?: number;
  rotation?: number;
  barcodeType?: string;
  barcodeHeight?: number;
  textTag?: string;
}

export interface LabelTemplate {
  width: number;
  height: number;
  elements: LabelElement[];
}

export interface AppSettings {
  labelPrinterName: string;
  labelWidth: number;
  labelHeight: number;
  labelDensity: number;
  labelSpeed: number;
  labelGap: number;
  labelType: 'gap' | 'blackmark';
  autoPrintOnRegister: boolean;
  showPreviewBeforePrint: boolean;
  soundNotification: boolean;
  labelTemplate?: LabelTemplate;
  /** Optional raw TSPL template edited manually in label editor. Supports {id}, {inv}, {model}, {cartModel}, {date}. */
  labelTsplTemplate?: string;
  labelRotation: 0 | 1 | 2 | 3;
  /** What data to encode in barcode: 'id' = program ID, 'inv' = inventory number (cleaned) */
  barcodeKey: 'id' | 'inv';
  /** Show technical/system log tabs in journal */
  showTechLogs: boolean;
  /** Enable destructive event editing/cancel actions in UI */
  enableEventEditing: boolean;
  /** Printers tab view mode */
  printersViewMode: 'list' | 'cards';
  /** How to send label data to printer.
   * raw    = Win32 winspool RAW API (via PowerShell C# P/Invoke)
   * driver = Windows print.exe via cmd.exe (no PowerShell, bypasses PS-blockers)
   * shell  = Electron webContents.print() — app-level print, never blocked by security software */
  labelPrintMode: 'raw' | 'driver' | 'shell';
}

export const DEFAULT_LABEL_TSPL_TEMPLATE = `CLS
CODEPAGE 1251
SIZE 43 mm, 15 mm
GAP 3 mm, 0 mm
DENSITY 10
SPEED 4
DIRECTION 0,0
REFERENCE 0,0
BARCODE 15,41,"128",36,0,0,2,2,"{id}"
TEXT 16,89,"3",0,1,1,"{id}"
TEXT 16,16,"1",0,2,2,"{inv}"
TEXT 154,89,"3",0,1,1,"{department}"
PRINT 1,1
CLS
INITIALPRINTER`;

export const DEFAULT_SETTINGS: AppSettings = {
  labelPrinterName: '',
  labelWidth: 43,
  labelHeight: 15,
  labelDensity: 10,
  labelSpeed: 4,
  labelGap: 3,
  labelType: 'gap',
  autoPrintOnRegister: false,
  showPreviewBeforePrint: false,
  soundNotification: false,
  labelTsplTemplate: DEFAULT_LABEL_TSPL_TEMPLATE,
  labelRotation: 0,
  barcodeKey: 'id',
  showTechLogs: false,
  enableEventEditing: false,
  printersViewMode: 'list',
  labelPrintMode: 'driver',
};

export const DEFAULT_LABEL_TEMPLATE: LabelTemplate = {
  width: 43,
  height: 15,
  elements: [
    {
      id: 'bc1',
      type: 'barcode',
      x: 15,
      y: 41,
      width: 220,
      height: 36,
      content: '{id}',
      barcodeType: '128',
      barcodeHeight: 36,
    },
    {
      id: 'txt1',
      type: 'text',
      x: 16,
      y: 89,
      width: 110,
      height: 16,
      content: '{id}',
      fontScale: 1,
      textTag: '3',
    },
    {
      id: 'txt2',
      type: 'text',
      x: 16,
      y: 16,
      width: 130,
      height: 24,
      content: '{inv}',
      fontScale: 2,
      textTag: '1',
    },
    {
      id: 'txt3',
      type: 'text',
      x: 154,
      y: 89,
      width: 150,
      height: 16,
      content: '{department}',
      fontScale: 1,
      textTag: '3',
    },
  ],
};

export interface NewCartridge {
  id: string;
  model: string;
  quantity: number;
  vendor?: string;
  description?: string;
  location?: string;
  registrationDate: string;
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      getPrinters: () => Promise<string[]>;
      rawPrint: (printerName: string, data: string, mode?: 'raw' | 'driver') => Promise<{ success: boolean; error?: string }>;
      pingPrinter: (printerName: string) => Promise<{ ok: boolean; message: string }>;
      getAppVersion: () => Promise<string>;
      showSaveDialog: (options: object) => Promise<{ canceled: boolean; filePath?: string }>;
      openFolder: (path: string) => Promise<boolean>;
      installDriver: () => Promise<{ success: boolean; error?: string }>;
      loadDatabase: () => Promise<{ success: boolean; data: unknown | null; path: string; error?: string }>;
      saveDatabase: (data: unknown) => Promise<{ success: boolean; path: string; error?: string }>;
      getDataFolder: () => Promise<string>;
      exportJsonBackup: (data: unknown) => Promise<{ success: boolean; path?: string | null; error?: string }>;
    };
  }
}
