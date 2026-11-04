import type { Printer } from '../types';
export const columns = [
  ['boss', 'МатОтв'], ['inventoryNumber', 'ИнвНомер'], ['department', 'Подразделение'],
  ['printerType', 'Тип'], ['model', 'Модель'], ['commissionDate', 'Дата'], ['balanceCost', 'Стоимость'],
] as const;
export type Field = Exclude<typeof columns[number][0], 'inventoryNumber'>;
export type Change = { inventoryNumber: string; field: Field; before: string | string[]; after: string | string[] };
export type ReferenceRowAction =
  | { kind: 'add'; printer: Printer }
  | { kind: 'remove'; inventoryNumber: string; before: Printer }
  | { kind: 'decommission'; inventoryNumber: string; before: Printer };
export const displayValue = (value: string | string[] | undefined) => Array.isArray(value) ? value.join(', ') : value ?? '';
export const displayFieldValue = (field: typeof columns[number][0], value: string | string[] | undefined) => {
  if (field === 'printerType') {
    if (value === 'printer') return 'Принтер';
    if (value === 'mfu') return 'МФУ';
  }
  return displayValue(value);
};
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const inventoryKey = (value: string) => value.replace(/^\s*Инв\.\s*№\s*/i, '').trim();

/** Quoted delimiters, escaped quotes and multiline cells are supported. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === delimiter || char === '\n' || char === '\r')) {
      row.push(cell); cell = '';
      if (char !== delimiter) {
        rows.push(row); row = [];
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else cell += char;
  }
  if (quoted) throw new Error('Незакрытая кавычка в файле.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
export function parseReference(rows: string[][]): Printer[] {
  if (!rows.length) throw new Error('Файл пуст.');
  const header = rows[0].map(s => s.trim());
  const currentHeader = columns.map(([, label]) => label);
  const legacyHeader = ['МатОтв', 'ИнвНомер', 'Подразделение', 'Тип', 'Модель', 'Картриджи', 'Дата', 'Стоимость'];
  if (new Set(header).size !== header.length) throw new Error('В первой строке есть повторяющиеся названия столбцов.');
  const hasColumns = (expected: string[]) => header.length === expected.length && expected.every(label => header.includes(label));
  const currentFormat = hasColumns(currentHeader);
  const legacyFormat = hasColumns(legacyHeader);
  if (!currentFormat && !legacyFormat) throw new Error(`Первая строка обязательна и должна содержать названия столбцов шаблона: ${currentHeader.join(', ')}. Порядок столбцов может быть любым.`);
  const indexOf = (label: string) => header.indexOf(label);
  const seen = new Set<string>();
  return rows.slice(1).filter(r => r.some(c => c.trim())).map((row, i) => {
    if (row.length !== header.length) throw new Error(`Строка ${i + 2}: нужно ${header.length} столбцов, получено ${row.length}.`);
    const values = row.map(value => String(value ?? '').trim());
    const value = (label: string) => values[indexOf(label)] ?? '';
    const boss = value('МатОтв');
    const rawInventory = value('ИнвНомер');
    const department = value('Подразделение');
    const type = value('Тип');
    const model = value('Модель');
    const commissionDate = value('Дата');
    const balanceCost = value('Стоимость');
    const inventoryNumber = inventoryKey(rawInventory);
    if (!inventoryNumber) throw new Error(`Строка ${i + 2}: пустой инвентарный номер.`);
    if (seen.has(inventoryNumber)) throw new Error(`Дубль инвентарного номера ${inventoryNumber}, строка ${i + 2}.`);
    seen.add(inventoryNumber);
    const printerType = /^(принтер|printer)$/i.test(type) ? 'printer' : /^(мфу|mfu)$/i.test(type) ? 'mfu' : type;
    return { inventoryNumber, boss, department, printerType, model, commissionDate, balanceCost, cartridgeModels: [], drumModels: [] };
  });
}
export function uniquePrinters(printers: Printer[]): Map<string, Printer> {
  const result = new Map<string, Printer>();
  for (const p of printers) {
    const key = inventoryKey(p.inventoryNumber);
    if (!key || result.has(key)) throw new Error(`В текущей базе пустой или повторный инвентарный номер: ${key}. Сверка остановлена.`);
    result.set(key, p);
  }
  return result;
}
export function applyChanges(printers: Printer[], changes: Change[]): Printer[] {
  const current = uniquePrinters(printers);
  const updates = new Map<string, Printer>();
  const seen = new Set<string>();
  for (const change of changes) {
    if (!columns.some(([field]) => field !== 'inventoryNumber' && field === change.field)) throw new Error('Изменение ключевых полей запрещено.');
    const original = current.get(change.inventoryNumber);
    const key = JSON.stringify([change.inventoryNumber, change.field]);
    if (!original || !same(original[change.field], change.before) || seen.has(key))
      throw new Error(`Данные ${change.inventoryNumber} изменились после сверки. Загрузите файл заново.`);
    seen.add(key);
    const updated = updates.get(change.inventoryNumber) ?? { ...original };
    Object.assign(updated, { [change.field]: change.after }); updates.set(change.inventoryNumber, updated);
  }
  return printers.map(p => updates.get(inventoryKey(p.inventoryNumber)) ?? p);
}

/** Apply whole-row reconciliation decisions with stale-preview protection. */
export function applyRowActions(printers: Printer[], actions: ReferenceRowAction[], decommissionedAt: string): Printer[] {
  const result = [...printers];
  const seen = new Set<string>();
  for (const action of actions) {
    const inventoryNumber = inventoryKey(action.kind === 'add' ? action.printer.inventoryNumber : action.inventoryNumber);
    if (!inventoryNumber || seen.has(inventoryNumber)) throw new Error(`Повторное действие для ${inventoryNumber || 'пустого номера'}.`);
    seen.add(inventoryNumber);
    const index = result.findIndex(printer => inventoryKey(printer.inventoryNumber) === inventoryNumber);
    if (action.kind === 'add') {
      if (index >= 0) throw new Error(`Принтер ${inventoryNumber} уже появился в базе. Загрузите файл заново.`);
      result.push({ ...action.printer, inventoryNumber });
      continue;
    }
    if (index < 0 || !same(result[index], action.before))
      throw new Error(`Данные ${inventoryNumber} изменились после сверки. Загрузите файл заново.`);
    if (action.kind === 'remove') result.splice(index, 1);
    else result[index] = { ...result[index], isDecommissioned: true, decommissionedAt };
  }
  return result;
}
