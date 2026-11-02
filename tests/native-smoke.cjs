const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'printer-webview-regression-'));
  const dataDir = path.join(root, 'Data'); await fs.mkdir(dataDir);
  const printer = { programId: 'P-PRESERVE', inventoryNumber: '00017', boss: 'Иванов', department: 'Отдел', model: 'HP', printerType: 'printer', cartridgeModels: ['CF283A'], commissionDate: '', balanceCost: '' };
  const cartridge = { id: 'C-PRESERVE', barcode: 'C-PRESERVE', printerInventoryNumber: '00017', model: 'CF283A', status: 'on_hand', isReplaced: false, history: [{ id: 'H-PRESERVE', date: '2026-01-01', action: 'Выдан' }], refillCount: 3, registrationDate: '2026-01-01', consumableType: 'cartridge' };
  const original = { version: 1, printers: [printer], cartridges: [cartridge], repairs: [], batches: [], employees: [], refillLog: [], newCartridges: [], settings: {}, legacyExtra: { keep: true } };
  const dbPath = path.join(dataDir, 'database.json'); const originalText = JSON.stringify(original);
  await fs.writeFile(dbPath, originalText);
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const executable = path.resolve(`release/windows-native-${require('../package.json').version}/CartridgeControl.exe`);
  const child = spawn(executable, [], { windowsHide: true, env: { ...process.env, CARTRIDGE_DATA_DIR: dataDir, CARTRIDGE_WEBVIEW_DIR: path.join(root, 'WebView'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
  let browser;
  const exited = new Promise(resolve => child.on('exit', resolve));
  try {
    const deadline = Date.now() + 30000;
    while (true) {
      try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) break; } catch { }
      if (Date.now() > deadline || child.exitCode !== null) throw new Error('WebView2 startup failed. Exit: ' + child.exitCode);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    let page;
    await expect.poll(() => { page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://cartridgecontrol.local')); return !!page; }).toBe(true);
    await page.getByRole('button', { name: 'Модели расходников', exact: true }).click();
    await expect(page.getByRole('button', { name: /HP/ }).first()).toContainText('1 картр.');
    await page.getByRole('button', { name: 'Сверка базы', exact: true }).click();
    const devtools = await browser.newBrowserCDPSession();
    await devtools.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: root, eventsEnabled: true });
    await page.getByRole('button', { name: 'Скачать шаблон с текущими данными' }).click();
    await expect.poll(async () => { try { return await fs.readFile(path.join(root, 'reference-template.txt'), 'utf8'); } catch { return ''; } }).toContain('00017');
    const file = 'МатОтв;ИнвНомер;Подразделение;Тип;Модель;Картриджи;Дата;Стоимость\nПупкин;00017;Отдел;Принтер;HP;CF283A;;';
    await page.locator('input[type=file]').setInputFiles({ name: 'reference.csv', mimeType: 'text/csv', buffer: Buffer.from(file) });
    await page.getByRole('button', { name: 'Применить все' }).click();
    await page.getByRole('button', { name: 'Сохранить (1)' }).click();
    await expect(page.locator('p[role=status]')).toContainText('Сохранено ячеек: 1');
    const saved = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    assert.equal(saved.printers[0].boss, 'Пупкин'); assert.equal(saved.printers[0].programId, printer.programId);
    assert.deepEqual(saved.cartridges, original.cartridges); assert.deepEqual(saved.legacyExtra, original.legacyExtra);
    assert.equal(await fs.readFile(path.join(dataDir, 'Backups', 'before-first-native.json'), 'utf8'), originalText);
    const backups = (await fs.readdir(path.join(dataDir, 'Backups'))).filter(f => f.startsWith('before-reference-'));
    assert.equal(backups.length, 1);
    const backup = JSON.parse(await fs.readFile(path.join(dataDir, 'Backups', backups[0]), 'utf8'));
    assert.equal(backup.printers[0].boss, 'Иванов'); assert.deepEqual(backup.cartridges, original.cartridges);
    const printers = await page.evaluate(() => window.desktopAPI.getPrinters()); assert.ok(Array.isArray(printers));
    await page.getByRole('button', { name: 'Импорт', exact: true }).click();
    await page.locator('textarea').fill('Последний;00017;Отдел;Принтер;HP;CF283A;;');
    await page.getByRole('button', { name: 'Подтвердить импорт' }).click();
    await page.getByRole('button', { name: 'ОК', exact: true }).click();
    await page.locator('textarea').click(); await page.keyboard.type('keyboard works');
    await expect(page.locator('textarea')).toHaveValue('keyboard works');
    spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).CloseMainWindow()`], { windowsHide: true });
    await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('Window did not close after saving')), 10000))]);
    const finalDatabase = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    assert.equal(finalDatabase.printers[0].boss, 'Последний');
    assert.deepEqual(finalDatabase.modelCatalog, [{ printerModel: 'HP', cartridgeModels: ['CF283A'], drumModels: [] }]);
    assert.ok(finalDatabase.refillLog.some(entry => entry.action === 'Изменён принтер'), 'import action was not written to the complete audit log');
    console.log('PASS WebView2: catalog migration, disk save, exact legacy backup, reconciliation backup, IDs/history, printer list, keyboard and close-save. Temporary database:', root);
  } finally { if (child.exitCode === null) child.kill(); if (browser) await browser.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
