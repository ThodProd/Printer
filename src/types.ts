
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
  disposed: 'Утилизирован',
};

export const STATUS_COLORS: Record<CartridgeStatus, string> = {
  on_hand: 'bg-blue-100 text-blue-700',
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
}

export interface RefillBatch {
  id: string;
  date: string;
  cartridgeIds: string[];
  status: 'sent' | 'received';
  company?: string;
  notes?: string;
}

export interface RefillLogEntry {
  id: string;
  date: string;
  cartridgeId: string;
  cartridgeModel: string;
  consumableType: ConsumableType;
  printerInventoryNumber: string;
  printerModel: string;
  department?: string;
  employee?: string;
  action: string;
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
  /** Printers tab view mode */
  printersViewMode: 'list' | 'cards';
  /** How to send label data to printer. raw = WinSpool RAW API, driver = Windows print command fallback. */
  labelPrintMode: 'raw' | 'driver';
}

export const DEFAULT_LABEL_TSPL_TEMPLATE = `CLS
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
  printersViewMode: 'list',
  labelPrintMode: 'driver',
};

export const DEFAULT_LABEL_TEMPLATE: LabelTemplate = {
  width: 45,
  height: 25,
  elements: [
    {
      id: 'bc1',
      type: 'barcode',
      x: 4,
      y: 4,
      width: 300,
      height: 80,
      content: '{id}',
      barcodeType: '128',
      barcodeHeight: 80,
    },
    {
      id: 'txt1',
      type: 'text',
      x: 4,
      y: 92,
      width: 300,
      height: 24,
      content: '{id}',
      fontSize: 2,
      fontScale: 1,
      textTag: '2',
    },
    {
      id: 'txt2',
      type: 'text',
      x: 4,
      y: 116,
      width: 300,
      height: 24,
      content: '{inv}',
      fontSize: 2,
      fontScale: 1,
      textTag: '2',
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
    };
  }
}
