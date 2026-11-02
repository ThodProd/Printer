import { test, expect } from '@playwright/test';
import { applyChanges, applyRowActions, parseDelimited, parseReference, uniquePrinters, columns } from '../src/utils/reconcile';
import { scannerKey } from '../src/utils/scanner';
import { resolveContent } from '../src/utils/tspl';
import { buildActivitySeries, buildJournalAnalytics, businessEvents } from '../src/utils/logAnalytics';
const printer = { programId: 'P-ABC123', inventoryNumber: '001', boss: 'Иванов И.И.', department: 'Бухгалтерия', printerType: 'printer', model: 'HP', cartridgeModels: ['CF283A'], commissionDate: '', balanceCost: '' };
const header = columns.map(([, label]) => label);
const row = ['Пупкин П.П.', '001', 'Бухгалтерия', 'Принтер', 'HP', 'CF283A', '', ''];
const file = [header.join(';'), row.join(';')].join('\n');
test('reference parsing preserves leading zeroes and quoted delimiters', () => {
  const parsed = parseReference(parseDelimited(file, ';'));
  expect(parsed[0].inventoryNumber).toBe('001');
  expect(parsed[0].printerType).toBe('printer');
  expect(parseDelimited('a;"b;c";"d""e"\n1;"two\nlines";3', ';')).toEqual([['a','b;c','d"e'], ['1', 'two\nlines', '3']]);
  expect(() => parseReference([header, row, row])).toThrow('Дубль');
  expect(() => uniquePrinters([printer, printer])).toThrow('повторный');
  expect(() => parseDelimited('a;"broken', ';')).toThrow('кавычка');
});
test('accepted cells preserve IDs and reject stale comparisons and key edits', () => {
  const original = [printer];
  const change = { inventoryNumber: '001', field: 'boss' as const, before: printer.boss, after: 'Пупкин П.П.' };
  const result = applyChanges(original, [change]);
  expect(result[0]).toEqual({ ...printer, boss: 'Пупкин П.П.' });
  expect(original[0]).toBe(printer);
  expect(printer.boss).toBe('Иванов И.И.');
  expect(() => applyChanges([{ ...printer, boss: 'Сидоров' }], [change])).toThrow('изменились');
  expect(() => applyChanges(original, [{ ...change, field: 'programId' as any }])).toThrow('запрещено');
  expect(applyRowActions(original, [{ kind: 'decommission', inventoryNumber: '001', before: printer }], '2026-11-02')[0].isDecommissioned).toBe(true);
  expect(() => applyRowActions([{ ...printer, model: 'Изменено' }], [{ kind: 'remove', inventoryNumber: '001', before: printer }], '2026-11-02')).toThrow('изменились');
});
test('journal analytics counts business cycles without duplicate compatibility rows', () => {
  const base = { category: 'cartridge', cartridgeModel: 'CF283A', consumableType: 'cartridge', printerInventoryNumber: '001', printerModel: 'HP', department: 'Бухгалтерия' };
  const entries = [
    { ...base, id: '1', cartridgeId: 'C-1', date: '2026-01-01T00:00:00.000Z', action: 'Картридж принят на заправку' },
    { ...base, id: '2', cartridgeId: 'C-1', date: '2026-01-01T00:00:20.000Z', action: 'Картридж принят на заправку' },
    { ...base, id: '3', cartridgeId: 'C-1', date: '2026-01-03T00:00:00.000Z', action: 'Картридж получен с заправки' },
    { ...base, id: '4', cartridgeId: 'C-1', date: '2026-01-04T00:00:00.000Z', action: 'Картридж выдан сотруднику' },
    { ...base, category: 'repair', consumableType: 'device', id: '5', cartridgeId: 'P-1', date: '2026-01-02T00:00:00.000Z', action: 'Принтер принят в ремонт: профилактика' },
  ] as any;
  const analytics = buildJournalAnalytics(entries, [printer as any]);
  expect(businessEvents(entries, 'refill_start')).toHaveLength(1);
  expect(analytics.completedRefills).toBe(1);
  expect(analytics.repairs).toBe(1);
  expect(analytics.averageRefillDays).toBe(3);
  expect(analytics.topPrinters[0]).toMatchObject({ inv: '001', model: 'HP', count: 1 });
  expect(analytics.topDepartments[0]).toMatchObject({ name: 'Бухгалтерия', count: 1 });
  const activity = buildActivitySeries(entries, 'months');
  expect(activity.reduce((sum, point) => sum + point.refills, 0)).toBe(1);
  expect(activity.reduce((sum, point) => sum + point.issues, 0)).toBe(1);
  const rankedEntries = Array.from({ length: 12 }, (_, index) => [
    { ...base, id: `start-${index}`, cartridgeId: `C-${index}`, printerInventoryNumber: String(index), department: `Отдел ${index}`, date: `2026-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, action: 'Картридж принят на заправку' },
    { ...base, id: `complete-${index}`, cartridgeId: `C-${index}`, printerInventoryNumber: String(index), department: `Отдел ${index}`, date: `2026-03-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, action: 'Картридж получен с заправки' },
  ]).flat() as any;
  const fullRanking = buildJournalAnalytics(rankedEntries, []);
  expect(fullRanking.topPrinters).toHaveLength(12);
  expect(fullRanking.topDepartments).toHaveLength(12);
});
test('scanner decodes physical keys in Russian layout including punctuation', () => {
  const key = (code: string, key: string, shiftKey = false, caps = false) => scannerKey({ code, key, shiftKey, getModifierState: () => caps });
  expect(key('KeyC', 'С', true)).toBe('C');
  expect(key('KeyA', 'Ф', false, true)).toBe('A');
  expect(key('Digit3', '№', true)).toBe('#');
  expect(key('Slash', ',', true)).toBe('?');
  expect(key('Minus', '-')).toBe('-');
  expect(resolveContent('{fw}|{firmware}', { id: 'P-1', inv: '1', firmwareFlashed: true })).toBe('Прошит|Прошит');
  expect(resolveContent('{fw}', { id: 'P-1', inv: '1', firmwareFlashed: false })).toBe('');
});
async function seed(page: any, count = 1) {
  await page.addInitScript(({ printer, count }: any) => {
    localStorage.setItem('printers', JSON.stringify(Array.from({ length: count }, (_, i) => ({ ...printer, inventoryNumber: i === 0 ? '001' : String(i + 1).padStart(5, '0'), programId: i === 0 ? printer.programId : `P-${i}` }))));
    localStorage.setItem('cartridges', JSON.stringify([{ id: 'C-ABC123', barcode: 'C-ABC123', model: 'CF283A', printerInventoryNumber: '001', status: 'on_hand', history: [{ id: 'history-1', date: '2026-01-01', action: 'Выдан' }], refillCount: 2, registrationDate: '2026-01-01', consumableType: 'cartridge' }]));
  }, { printer, count });
  await page.goto('/');
}
test('reconciliation preview, skip, accept and save preserve linked data', async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 720, height: 800 });
  await page.getByRole('button', { name: 'Сверка базы', exact: true }).click();
  await page.getByText('Формат и порядок столбцов', { exact: true }).click();
  const formatPanel = page.locator('details').filter({ hasText: 'Формат и порядок столбцов' });
  await expect(formatPanel).toHaveJSProperty('open', true);
  expect(await formatPanel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.locator('input[type=file]').setInputFiles({ name: 'reference.csv', mimeType: 'text/csv', buffer: Buffer.from(file) });
  await expect(page.getByText('Изменений ячеек: 1.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Пропустить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить (0)' })).toBeDisabled();
  await page.getByRole('button', { name: 'Заменить', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить (1)' }).click();
  await expect(page.getByRole('status')).toContainText('Сохранено ячеек: 1');
  const saved = await page.evaluate(() => ({ printers: JSON.parse(localStorage.getItem('printers')!), cartridges: JSON.parse(localStorage.getItem('cartridges')!), backups: Object.keys(localStorage).filter(k => k.startsWith('reference_backup_')) }));
  expect(saved.printers[0].boss).toBe('Пупкин П.П.');
  expect(saved.printers[0].programId).toBe('P-ABC123');
  expect(saved.cartridges[0].id).toBe('C-ABC123');
  expect(saved.cartridges[0].history[0].id).toBe('history-1');
  expect(saved.backups.length).toBe(1);
});
test('reconciliation can hide and restore rows without changes', async ({ page }) => {
  await seed(page, 2);
  await page.getByRole('button', { name: 'Сверка базы', exact: true }).click();
  const unchanged = ['Иванов И.И.', '00002', 'Бухгалтерия', 'Принтер', 'HP', 'CF283A', '', ''];
  const comparison = [header.join(';'), row.join(';'), unchanged.join(';')].join('\n');
  await page.locator('input[type=file]').setInputFiles({ name: 'reference.csv', mimeType: 'text/csv', buffer: Buffer.from(comparison) });
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Скрыть без изменений (1)', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('001');
  await page.getByRole('button', { name: 'Показать без изменений (1)', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
});
test('reconciliation adds a normal printer with cartridge and can remove or decommission missing rows', async ({ page }) => {
  await seed(page, 3);
  await page.getByRole('button', { name: 'Сверка базы', exact: true }).click();
  const current = ['Иванов И.И.', '001', 'Бухгалтерия', 'Принтер', 'HP', 'CF283A', '', ''];
  const added = ['Новый сотрудник', '777', 'Новый отдел', 'Принтер', 'HP', '', '', ''];
  const comparison = [header, current, added].map(values => values.join(';')).join('\n');
  await page.locator('input[type=file]').setInputFiles({ name: 'reference.csv', mimeType: 'text/csv', buffer: Buffer.from(comparison) });
  await page.getByRole('row').filter({ hasText: '777' }).getByRole('button', { name: 'Добавить в базу', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '00002' }).getByRole('button', { name: 'Удалить из базы', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '00003' }).getByRole('button', { name: 'Пометить списанным', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить (3)', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Добавлено: 1. Удалено: 1. Списано: 1.');
  const saved = await page.evaluate(() => ({
    printers: JSON.parse(localStorage.getItem('printers')!),
    cartridges: JSON.parse(localStorage.getItem('cartridges')!),
  }));
  expect(saved.printers.some((item: any) => item.inventoryNumber === '00002')).toBe(false);
  expect(saved.printers.find((item: any) => item.inventoryNumber === '00003').isDecommissioned).toBe(true);
  const newPrinter = saved.printers.find((item: any) => item.inventoryNumber === '777');
  expect(newPrinter.programId).toMatch(/^P-/);
  expect(newPrinter.cartridgeModels).toEqual(['CF283A']);
  expect(saved.cartridges.find((item: any) => item.printerInventoryNumber === '777')).toMatchObject({ model: 'CF283A', status: 'on_hand' });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('refill_log') || '[]').map((item: any) => item.action))).toEqual(expect.arrayContaining([
    'Добавлен принтер при сверке базы', 'Автоматически добавлен картридж при сверке базы',
    'Удалён принтер при сверке базы', 'Принтер помечен списанным',
  ]));
  await page.getByRole('button', { name: 'Принтеры', exact: true }).click();
  const decommissionedRow = page.getByRole('row').filter({ hasText: '00003' });
  await expect(decommissionedRow).toContainText('Списан');
  await decommissionedRow.click();
  const detailsBox = await page.getByTestId('printer-details').boundingBox();
  expect(detailsBox?.width).toBeGreaterThan(850);
  const decommissionedToggle = page.getByRole('checkbox', { name: 'Списан' });
  await expect(decommissionedToggle).toBeChecked();
  await decommissionedToggle.uncheck();
  await expect(decommissionedToggle).not.toBeChecked();
  await page.getByRole('button', { name: 'Закрыть карточку' }).click();
  await expect(decommissionedRow).not.toContainText('Списан');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('refill_log') || '[]').map((item: any) => item.action))).toContain('С принтера снята отметка «Списан»');
});
test('search pagination bounds rendering and Russian manual text remains intact', async ({ page }) => {
  await seed(page, 1500);
  await page.getByRole('button', { name: 'Поиск / История' }).click();
  await expect(page.getByText('Принтеры (1500)', { exact: true })).toBeVisible();
  await expect(page.getByText('Страница 1 из 30')).toBeVisible();
  await page.locator('input[data-scanner]').fill('Иванов');
  await expect(page.locator('input[data-scanner]')).toHaveValue('Иванов');
  await expect(page.getByText('Принтеры (1500)', { exact: true })).toBeVisible();
  await page.locator('input[data-scanner]').fill('P-1499');
  await expect(page.getByText('Принтеры (1)', { exact: true })).toBeVisible();
});
test('printer table sorts both directions, remembers sorting and finds consumable IDs', async ({ page }) => {
  await page.addInitScript(() => {
    const base = { boss: '', department: '', printerType: 'printer', cartridgeModels: [], commissionDate: '', balanceCost: '' };
    localStorage.setItem('printers', JSON.stringify([
      { ...base, programId: 'P-2', inventoryNumber: '002', model: 'Zebra' },
      { ...base, programId: 'P-1', inventoryNumber: '001', model: 'HP' },
      { ...base, programId: 'P-10', inventoryNumber: '010', model: 'Canon' },
    ]));
    localStorage.setItem('cartridges', JSON.stringify([{ id: 'C-SPECIAL-77', barcode: 'BC-SPECIAL-77', model: 'TEST', consumableType: 'cartridge', printerInventoryNumber: '010', status: 'on_hand', history: [], refillCount: 0, registrationDate: '2026-01-01' }]));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Принтеры', exact: true }).click();
  const modelHeader = page.getByRole('button', { name: 'Модель', exact: true });
  await modelHeader.click();
  await expect(page.locator('tbody tr').first()).toContainText('Canon');
  await modelHeader.click();
  await expect(page.locator('tbody tr').first()).toContainText('Zebra');
  await page.getByRole('button', { name: 'Поиск / История', exact: true }).click();
  await page.getByRole('button', { name: 'Принтеры', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Модель', exact: true })).toHaveAttribute('aria-sort', 'descending');
  await page.getByPlaceholder('Поиск принтера, ID...').fill('C-SPECIAL-77');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr').first()).toContainText('010');
  await page.getByPlaceholder('Поиск принтера, ID...').fill('BC-SPECIAL-77');
  await expect(page.locator('tbody tr').first()).toContainText('Canon');
});
test('Russian HID scan replaces search text with English in each search menu', async ({ page }) => {
  await seed(page);
  for (const name of ['Поиск / История', 'Принтеры', 'Склады', 'Новые картриджи', 'Ремонт', 'Журнал действий']) {
    await page.getByRole('button', { name, exact: true }).click();
    const input = page.locator('input[data-scanner]').first();
    await input.focus();
    await input.evaluate((target: HTMLInputElement) => {
      for (const [code, key, shiftKey] of [['KeyC', 'С', true], ['Minus', '-', false], ['KeyA', 'Ф', true], ['Digit1', '1', false]]) {
        target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: code as string, key: key as string, shiftKey: shiftKey as boolean }));
      }
      target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
    });
    await expect(input).toHaveValue('C-A1');
  }
});

test('journal dashboard renders chart, rankings, duration and clickable event calendar', async ({ page }) => {
  await seed(page);
  await page.addInitScript(() => {
    const base = { category: 'cartridge', cartridgeModel: 'CF283A', consumableType: 'cartridge', printerInventoryNumber: '001', printerModel: 'HP', department: 'Бухгалтерия', employee: '' };
    localStorage.setItem('refill_log', JSON.stringify([
      { ...base, id: 'log-1', cartridgeId: 'C-ABC123', date: '2026-01-01T00:00:00.000Z', action: 'Картридж принят на заправку' },
      { ...base, id: 'log-2', cartridgeId: 'C-ABC123', date: '2026-01-03T00:00:00.000Z', action: 'Картридж получен с заправки' },
      { ...base, id: 'log-3', cartridgeId: 'C-ABC123', date: '2026-01-04T00:00:00.000Z', action: 'Картридж выдан сотруднику' },
      { ...base, category: 'repair', consumableType: 'device', id: 'log-4', cartridgeId: 'P-ABC123', date: '2026-01-02T00:00:00.000Z', action: 'Принтер принят в ремонт: профилактика' },
      { ...base, category: 'printer', id: 'log-5', cartridgeId: '', date: '2026-01-04T01:00:00.000Z', action: 'Добавлен принтер' },
    ]));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Журнал действий', exact: true }).click();
  const chart = page.getByRole('img', { name: 'График заправок и ремонтов' });
  await expect(chart).toBeVisible();
  await expect(chart.locator('polyline')).toHaveCount(3);
  await expect(page.getByText('Топ-10 принтеров по заправкам', { exact: true })).toBeVisible();
  await expect(page.getByText('Топ подразделений по сдаче', { exact: true })).toBeVisible();
  await expect(page.getByText('3,0', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Недели', exact: true }).click();
  await page.getByRole('button', { name: /04\.01\.2026: событий 1/ }).click();
  await expect(page.getByText(/4 января 2026 г\./).first()).toBeVisible();
  const calendarEvents = page.getByTestId('calendar-event-list');
  await expect(calendarEvents.getByText('Картридж выдан сотруднику', { exact: true })).toBeVisible();
  await expect(calendarEvents.getByText('Добавлен принтер', { exact: true })).toHaveCount(0);
});

test('manual printer creation writes printer and automatic cartridge to the complete audit log', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Принтеры', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).first().click();
  const form = page.locator('.fixed form').first();
  await form.getByPlaceholder('КБ01384553 или 1013402202600078').fill('002');
  await form.getByPlaceholder('HP LaserJet Pro M404dn').fill('Test Printer');
  await form.getByPlaceholder('Бухгалтерия').fill('Тестовый отдел');
  await form.getByPlaceholder('Иванов И.И.').fill('Петров П.П.');
  await form.getByPlaceholder('CF283A, CF283X, ...').fill('TEST-CART');
  await form.getByRole('button', { name: 'Добавить', exact: true }).click();

  await page.getByRole('button', { name: 'Журнал действий', exact: true }).click();
  await expect(page.getByText('Добавлен принтер', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Добавлен картридж', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Test Printer', { exact: false }).first()).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem('refill_log') || '[]');
    return entries.filter((entry: any) => ['Добавлен принтер', 'Добавлен картридж'].includes(entry.action)).length;
  })).toBe(2);
});
test('firmware information remains separate from decommissioning in printer card', async ({ page }) => {
  await page.addInitScript(printer => {
    localStorage.setItem('printers', JSON.stringify([{ ...printer, firmwareFlashed: true }]));
    localStorage.setItem('cartridges', '[]');
  }, printer);
  await page.goto('/');
  await page.getByRole('button', { name: 'Принтеры', exact: true }).click();
  await expect(page.getByLabel('Прошит').first()).toBeVisible();
  await page.getByRole('row').filter({ hasText: '001' }).click();
  await expect(page.getByText('Прошивка', { exact: true })).toBeVisible();
  await expect(page.getByText('Прошит', { exact: true })).toBeVisible();
  await page.getByTestId('printer-details').getByRole('button', { name: /Редактировать/ }).click();
  const firmware = page.getByRole('checkbox', { name: /Принтер прошит/ });
  await expect(firmware).toBeChecked();
  await expect(firmware).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Списан' })).toBeEnabled();
});

test('printer card shows a small consumable ID caption', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Принтеры', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '001' }).click();
  const consumable = page.getByTestId('printer-consumable').filter({ hasText: 'CF283A' });
  await expect(consumable).toContainText('ID: C-ABC123');
});
test('model catalog derives existing compatibility and saves cartridge and drum names', async ({ page }) => {
  await seed(page);
  const catalogPosition = await page.getByRole('button', { name: 'Модели расходников', exact: true }).boundingBox();
  const reconcilePosition = await page.getByRole('button', { name: 'Сверка базы', exact: true }).boundingBox();
  expect(catalogPosition!.y).toBeLessThan(reconcilePosition!.y);
  await page.getByRole('button', { name: 'Модели расходников', exact: true }).click();
  await expect(page.getByRole('button', { name: /HP/ }).first()).toContainText('1 картр.');
  await page.getByRole('button', { name: 'Новая модель', exact: true }).click();
  await page.getByPlaceholder('Например: HP LaserJet Pro M404dn').fill('Brother HL-L5100DN');
  const tagInputs = page.getByPlaceholder('Введите модель и нажмите Enter');
  await tagInputs.nth(0).fill('TN-3480');
  await tagInputs.nth(0).press('Enter');
  await tagInputs.nth(1).fill('DR-3400');
  await tagInputs.nth(1).press('Enter');
  await page.getByRole('button', { name: 'Сохранить справочник', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Сохранено');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('model_catalog') || '[]'))).toEqual(expect.arrayContaining([
    expect.objectContaining({ printerModel: 'Brother HL-L5100DN', cartridgeModels: ['TN-3480'], drumModels: ['DR-3400'] }),
  ]));
});

test('header counters navigate with highlight and a closed batch expands', async ({ page }) => {
  await seed(page);
  await page.addInitScript(() => {
    const cartridges = JSON.parse(localStorage.getItem('cartridges')!);
    cartridges[0].status = 'waiting';
    cartridges.push({ ...cartridges[0], id: 'C-SECOND', barcode: 'C-SECOND', status: 'at_refill' });
    localStorage.setItem('cartridges', JSON.stringify(cartridges));
    localStorage.setItem('batches', JSON.stringify([
      { id: 'ACTIVE-001', date: '2026-11-01T00:00:00.000Z', cartridgeIds: ['C-SECOND'], status: 'sent' },
      { id: 'CLOSED-001', date: '2026-11-01T00:00:00.000Z', cartridgeIds: ['C-ABC123'], status: 'received' },
    ]));
  });
  await page.reload();
  await page.getByRole('button', { name: /1 ожидают/ }).click();
  await expect(page.getByText('Ожидают отправки (1)', { exact: true })).toBeVisible();
  await expect(page.getByTestId('warehouse-waiting')).toHaveClass(/ring-2/);
  await expect(page.getByRole('button', { name: 'Склады', exact: true })).not.toHaveClass(/ring-2/);
  await expect(page.getByRole('columnheader', { name: 'Наименование принтера' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Принять всё', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /1 на заправке/ }).click();
  await expect(page.getByTestId('warehouse-refill')).toHaveClass(/ring-2/);
  await page.getByRole('button', { name: 'Раскрыть CLOSED-001' }).click();
  await expect(page.getByRole('button', { name: 'Свернуть CLOSED-001' })).toBeVisible();
  await expect(page.getByText('HP', { exact: true }).last()).toBeVisible();
});

test('warehouse restores separate receive, cancel and issue actions', async ({ page }) => {
  await seed(page);
  await page.addInitScript(() => {
    const cartridges = JSON.parse(localStorage.getItem('cartridges')!);
    cartridges[0].status = 'waiting';
    cartridges.push(
      { ...cartridges[0], id: 'C-REFILL-1', barcode: 'C-REFILL-1', status: 'at_refill' },
      { ...cartridges[0], id: 'C-REFILL-2', barcode: 'C-REFILL-2', status: 'at_refill' },
    );
    localStorage.setItem('cartridges', JSON.stringify(cartridges));
    localStorage.setItem('batches', JSON.stringify([
      { id: 'ACTIVE-ACTIONS', date: '2026-11-01T00:00:00.000Z', cartridgeIds: ['C-REFILL-1', 'C-REFILL-2'], status: 'sent' },
    ]));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Склады', exact: true }).click();

  const waitingRow = page.getByRole('row').filter({ hasText: 'C-ABC123' });
  await waitingRow.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cartridges')!).find((item: any) => item.id === 'C-ABC123').status)).toBe('on_hand');

  await page.getByRole('button', { name: 'Принять отдельно из ACTIVE-ACTIONS' }).click();
  await page.getByRole('row').filter({ hasText: 'C-REFILL-1' }).getByRole('button', { name: 'Принять', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cartridges')!).find((item: any) => item.id === 'C-REFILL-1').status)).toBe('received_from_refill');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('batches')!)[0].status)).toBe('sent');

  await page.getByRole('row').filter({ hasText: 'C-REFILL-2' }).getByRole('button', { name: 'Принять', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('batches')!)[0].status)).toBe('received');

  await page.getByRole('row').filter({ hasText: 'C-REFILL-1' }).getByRole('button', { name: 'Выдать', exact: true }).click();
  const issueDialog = page.getByRole('dialog', { name: 'Выдача расходных материалов' });
  await issueDialog.getByLabel('Кто забрал (ФИО полностью)').fill('Петров П.П.');
  await issueDialog.getByRole('button', { name: 'Зарегистрировать выдачу', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cartridges')!).find((item: any) => item.id === 'C-REFILL-1').status)).toBe('on_hand');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('refill_log') || '[]').map((item: any) => item.action))).toContain('Картридж выдан сотруднику Петров П.П.');
});

test('new cartridge warehouse creates quick filters from every saved location', async ({ page }) => {
  await page.addInitScript(printer => {
    localStorage.setItem('printers', JSON.stringify([printer]));
    localStorage.setItem('cartridges', '[]');
    localStorage.setItem('new_cartridges', JSON.stringify([
      { id: 'N-1', model: 'CF283A', quantity: 2, location: 'Шкаф', registrationDate: '2026-11-01' },
      { id: 'N-2', model: 'TN-217', quantity: 3, location: 'Загородка', registrationDate: '2026-11-01' },
      { id: 'N-3', model: 'Q2612A', quantity: 1, location: 'Полка 7', registrationDate: '2026-11-01' },
    ]));
  }, printer);
  await page.goto('/');
  await page.getByRole('button', { name: 'Новые картриджи', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Шкаф (1)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Загородка (1)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Полка 7 (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Шкаф (1)' }).click();
  await expect(page.getByText('CF283A', { exact: true })).toBeVisible();
  await expect(page.getByText('TN-217', { exact: true })).toHaveCount(0);
});
test('import keeps existing ID and in-page notification restores keyboard input', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Импорт', exact: true }).click();
  await page.locator('textarea').fill('Пупкин П.П.;001;Бухгалтерия;Принтер;HP;CF283A;;');
  await page.getByRole('button', { name: 'Подтвердить импорт' }).click();
  await expect(page.locator('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'ОК', exact: true }).click();
  await page.locator('textarea').click();
  await page.keyboard.type('keyboard works');
  await expect(page.locator('textarea')).toHaveValue('keyboard works');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('printers')!)[0].programId)).toBe('P-ABC123');
});

test('failed database load blocks editing and never saves empty data', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).saveCalls = 0;
    (window as any).desktopAPI = { loadDatabase: async () => ({ success: false, error: 'test read failure' }), saveDatabase: async () => { (window as any).saveCalls++; return { success: true }; } };
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('База не загружена');
  await expect(page.getByRole('button', { name: 'Импорт', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).saveCalls)).toBe(0);
});
test('failed explicit save leaves original data and accepted decisions available', async ({ page }) => {
  await page.addInitScript(printer => {
    (window as any).desktopAPI = {
      loadDatabase: async () => ({ success: true, data: { version: 1, printers: [printer] } }),
      saveDatabase: async (_data: unknown, backup: unknown) => backup ? { success: false, error: 'Disk full' } : { success: true, path: 'test.json' },
    };
  }, printer);
  await page.goto('/');
  await page.getByRole('button', { name: 'Сверка базы', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'reference.csv', mimeType: 'text/csv', buffer: Buffer.from(file) });
  await page.getByRole('button', { name: 'Применить все' }).click();
  await page.getByRole('button', { name: 'Сохранить (1)' }).click();
  await expect(page.getByRole('status')).toContainText('Не сохранено');
  await expect(page.getByRole('button', { name: 'Сохранить (1)' })).toBeEnabled();
  await page.getByRole('button', { name: 'Поиск / История' }).click();
  await expect(page.getByText('Бухгалтерия — Иванов И.И.', { exact: true })).toBeVisible();
});
