'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, execSync } = require('child_process');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow;

function getAppIconPath() {
  const candidates = isDev
    ? [path.join(__dirname, '..', 'build', 'icon.ico')]
    : [
        path.join(process.resourcesPath, 'build', 'icon.ico'),
        path.join(__dirname, '..', 'build', 'icon.ico'),
      ];
  return candidates.find(p => fs.existsSync(p));
}

function createWindow() {
  const iconPath = getAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'CartridgeControl — Система учёта картриджей',
    show: false,
    backgroundColor: '#f9fafb',
    ...(iconPath ? { icon: iconPath } : {}),
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: 'Файл',
      submenu: [
        {
          label: 'Перезагрузить',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow && mainWindow.reload(),
        },
        { type: 'separator' },
        {
          label: 'Выход',
          accelerator: 'Alt+F4',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Повторить', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: 'Вырезать', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Копировать', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Вставить', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Выделить всё', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        {
          label: 'Инструменты разработчика',
          accelerator: 'F12',
          click: () => mainWindow && mainWindow.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        { label: 'Уменьшить', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Увеличить', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: 'Сбросить масштаб', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        {
          label: 'Полный экран',
          accelerator: 'F11',
          click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()),
        },
      ],
    },
    {
      label: 'Помощь',
      submenu: [
        {
          label: 'О программе',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'О программе',
              message: 'CartridgeControl',
              detail: `Версия: ${app.getVersion()}\nСистема учёта картриджей и принтеров\nПечать этикеток на TSC TTP-225`,
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function ensureDataDirs() {
  const base = getDataDir();

  ['', 'logs', 'backup', 'config', 'Logs', 'Backups', 'Config'].forEach(sub => {
    const dir = path.join(base, sub);
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    }
  });
}

function getDataDir() {
  if (isDev) return path.join(__dirname, '..', 'Data');

  // electron-builder portable provides stable folder рядом с launcher .exe
  // (в отличие от app.getPath('exe'), который может указывать на temp extraction dir).
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) return path.join(portableDir, 'Data');

  // Installed app: store under current user's Documents to avoid Program Files/ACL issues.
  return path.join(app.getPath('documents'), 'CartridgeControl', 'Data');
}

function getDatabasePath() {
  return path.join(getDataDir(), 'database.json');
}

function appendAppLog(message) {
  try {
    ensureDataDirs();
    const ts = new Date();
    const file = path.join(getDataDir(), 'logs', `${ts.toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(file, `[${ts.toISOString()}] ${message}\n`, 'utf8');
  } catch {}
}

let lastBackupAt = 0;
function writeBackupSnapshot(data, reason = 'auto') {
  try {
    ensureDataDirs();
    const now = Date.now();
    if (reason === 'auto' && now - lastBackupAt < 5 * 60 * 1000) return null;
    lastBackupAt = now;
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(getDataDir(), 'backup', `database-${reason}-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(data, null, 2), 'utf8');
    appendAppLog(`backup created: ${backupPath}`);
    return backupPath;
  } catch {
    return null;
  }
}

app.whenReady().then(() => {
  ensureDataDirs();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC Handlers ────────────────────────────────────────────────────────────

/** TSC: задание печати должно начинаться с CLS (очистка буфера изображения). */
function ensureTsplStartsWithCls(tsplData) {
  const raw = String(tsplData ?? '').replace(/^\uFEFF/, '');
  const firstLine = raw.trimStart().split(/\r?\n/, 1)[0];
  const withCls = firstLine && firstLine.trim().toUpperCase() === 'CLS' ? raw : `CLS\r\n${raw}`;
  if (/^\s*CODEPAGE\s+1251\b/im.test(withCls)) return withCls;
  return withCls.replace(/^(\s*CLS\s*(?:\r?\n)?)/i, '$1CODEPAGE 1251\r\n');
}

function encodeWindows1251(text) {
  const extra = {
    'Ё': 0xA8, 'ё': 0xB8, 'Є': 0xAA, 'є': 0xBA, 'І': 0xB2, 'і': 0xB3,
    'Ї': 0xAF, 'ї': 0xBF, 'Ґ': 0xA5, 'ґ': 0xB4, '№': 0xB9,
  };
  const bytes = [];
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0);
    if (code <= 0x7F) bytes.push(code);
    else if (code >= 0x0410 && code <= 0x044F) bytes.push(code - 0x0410 + 0xC0);
    else if (extra[ch] !== undefined) bytes.push(extra[ch]);
    else bytes.push(0x3F);
  }
  return Buffer.from(bytes);
}

function cleanPowerShellOutput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('#< CLIXML')) return raw;
  return raw
    .replace(/#< CLIXML/g, '')
    .replace(/_x000D__x000A_/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

ipcMain.handle('get-printers', async event => {
  try {
    const printers = await event.sender.getPrintersAsync();
    return printers.map(p => p.name);
  } catch {
    return [];
  }
});

/**
 * Send raw TSPL bytes directly to a Windows printer via the Win32 spooler API.
 * Works best with "Generic / Text Only" driver (passes bytes through as-is).
 * For TSC printers: use printer named "TSC TTP-225 (RAW)" that was set up with
 * Generic/Text Only driver on the USB port for reliable TSPL passthrough.
 */
ipcMain.handle('raw-print', async (_event, printerName, tsplData, mode = 'raw') => {
  if (!printerName) {
    return { success: false, error: 'Принтер не выбран. Укажите принтер в Настройках.' };
  }

  // ── SHELL MODE ───────────────────────────────────────────────────────────
  // Uses Electron's own webContents.print() — the print job comes from
  // CartridgeControl.exe itself, exactly like pressing Ctrl+P in any app.
  // Security software that blocks PowerShell/scripts will NOT block this.
  // The TSPL is sent as plain text; works when the printer driver is set to
  // TEXT or RAW spool data type (TSC OEM driver with "passthrough" mode).
  if (mode === 'shell') {
    return new Promise(resolve => {
      try {
        const tsplText = ensureTsplStartsWithCls(tsplData);
        const escaped = tsplText
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;}body{font-family:monospace;font-size:6pt;white-space:pre;line-height:1.1;}</style></head><body>${escaped}</body></html>`;

        const printWin = new BrowserWindow({
          show: false,
          skipTaskbar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            offscreen: false,
          },
        });

        let settled = false;
        const settle = result => {
          if (settled) return;
          settled = true;
          try { if (!printWin.isDestroyed()) printWin.destroy(); } catch {}
          resolve(result);
        };

        const timer = setTimeout(() => settle({ success: false, error: 'Timeout: принтер не ответил за 20 секунд' }), 20000);

        printWin.webContents.once('did-finish-load', () => {
          printWin.webContents.print(
            { silent: true, printBackground: false, deviceName: printerName },
            (success, failureReason) => {
              clearTimeout(timer);
              settle(success
                ? { success: true }
                : { success: false, error: `Ошибка Electron print: ${failureReason ?? 'unknown'}` },
              );
            },
          );
        });

        printWin.webContents.on('did-fail-load', (_e, code, desc) => {
          clearTimeout(timer);
          settle({ success: false, error: `Не удалось загрузить страницу для печати: ${desc} (${code})` });
        });

        printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      } catch (e) {
        resolve({ success: false, error: String(e.message ?? e) });
      }
    });
  }

  // ── DRIVER MODE (cmd.exe) ────────────────────────────────────────────────
  // Uses Windows built-in print.exe via cmd.exe — NO PowerShell at all.
  // Security policies that block powershell.exe will not affect this path.
  if (mode === 'driver') {
    return new Promise(resolve => {
      try {
        const tmpFile = path.join(os.tmpdir(), `label_${Date.now()}.prn`);
        fs.writeFileSync(tmpFile, encodeWindows1251(ensureTsplStartsWithCls(tsplData)));

        // Wrap printer name in quotes; escape internal quotes for cmd
        const safeName = printerName.replace(/"/g, '');
        const safePath = tmpFile;

        // Primary: print.exe /D:"<name>" "<file>"  (built into Windows)
        const cmd = `print /D:"${safeName}" "${safePath}"`;

        exec(`cmd.exe /c ${cmd}`, { timeout: 20000 }, (err, stdout, stderr) => {
          try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
          if (err) {
            const msg = (stderr || stdout || err.message || '').toString().trim();
            resolve({
              success: false,
              error: `Ошибка print.exe: ${msg || err.message}. Попробуйте режим «RAW» или «Через приложение».`,
            });
          } else {
            resolve({ success: true });
          }
        });
      } catch (e) {
        resolve({ success: false, error: String(e.message ?? e) });
      }
    });
  }

  // ── RAW MODE (Win32 winspool via PowerShell C# P/Invoke) ─────────────────
  return new Promise(resolve => {
    try {
      const tmpFile = path.join(os.tmpdir(), `label_${Date.now()}.prn`);
      fs.writeFileSync(tmpFile, encodeWindows1251(ensureTsplStartsWithCls(tsplData)));

      const safePrinterName = printerName.replace(/'/g, "''");
      const safeFilePath = tmpFile.replace(/\\/g, '\\\\').replace(/'/g, "''");
      const psScript = `
$ErrorActionPreference = 'Stop';
$printerName = '${safePrinterName}';
$filePath = '${safeFilePath}';
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]
  public struct DOC_INFO_1 {
    [MarshalAs(UnmanagedType.LPTStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPTStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPTStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr hPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, ref DOC_INFO_1 di);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
}
'@ -Language CSharp -ErrorAction Stop;

  $bytes = [System.IO.File]::ReadAllBytes($filePath);
  $hPrinter = [IntPtr]::Zero;
  if (-not [RawPrint]::OpenPrinter($printerName, [ref]$hPrinter, [IntPtr]::Zero)) {
    $errCode = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error();
    throw "OpenPrinter failed (Win32=$errCode). Проверьте имя принтера."
  }
  $di = New-Object RawPrint+DOC_INFO_1;
  $di.pDocName = "TSPL Print Job";
  $di.pOutputFile = $null;
  $di.pDataType = "RAW";
  $docId = [RawPrint]::StartDocPrinter($hPrinter, 1, [ref]$di);
  if ($docId -le 0) {
    [RawPrint]::ClosePrinter($hPrinter) | Out-Null;
    throw "StartDocPrinter failed: " + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error();
  }
  [RawPrint]::StartPagePrinter($hPrinter) | Out-Null;
  $written = 0;
  $ok = [RawPrint]::WritePrinter($hPrinter, $bytes, $bytes.Length, [ref]$written);
  $writeErr = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error();
  [RawPrint]::EndPagePrinter($hPrinter) | Out-Null;
  [RawPrint]::EndDocPrinter($hPrinter) | Out-Null;
  [RawPrint]::ClosePrinter($hPrinter) | Out-Null;

  if (-not $ok) {
    throw "WritePrinter error (Win32=$writeErr). Если используется OEM-драйвер TSC, смените на режим 'Драйвер (cmd)' или 'Через приложение'."
  }
  Write-Output "OK:$written";
} catch {
  Write-Error $_.Exception.Message;
  exit 1;
} finally {
  if (Test-Path $filePath) { Remove-Item $filePath -Force -ErrorAction SilentlyContinue }
}
`;

      const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');

      exec(
        `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
        { timeout: 20000 },
        (err, stdout, stderr) => {
          try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}

          if (err) {
            const msg = cleanPowerShellOutput(stderr || stdout || err.message || '');
            if (msg.includes('Win32=5')) {
              resolve({
                success: false,
                error: 'Windows запретил RAW-запись (Win32=5). Попробуйте режим «Драйвер (cmd)» или «Через приложение» в Настройках.',
              });
              return;
            }
            resolve({ success: false, error: `Ошибка печати: ${msg}` });
          } else {
            resolve({ success: true });
          }
        },
      );
    } catch (e) {
      resolve({ success: false, error: String(e.message ?? e) });
    }
  });
});

ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('load-database', async () => {
  try {
    ensureDataDirs();
    const dbPath = getDatabasePath();
    if (!fs.existsSync(dbPath)) {
      return { success: true, data: null, path: dbPath };
    }
    const raw = fs.readFileSync(dbPath, 'utf8');
    appendAppLog(`database loaded: ${dbPath}`);
    return { success: true, data: JSON.parse(raw), path: dbPath };
  } catch (e) {
    return { success: false, error: String(e.message ?? e), path: getDatabasePath() };
  }
});

ipcMain.handle('save-database', async (_event, data) => {
  try {
    ensureDataDirs();
    const dbPath = getDatabasePath();
    const tmpPath = `${dbPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, dbPath);
    appendAppLog(`database saved: ${dbPath}`);
    writeBackupSnapshot(data, 'auto');
    if (data && typeof data === 'object' && data.settings) {
      const settingsPath = path.join(getDataDir(), 'Config', 'settings.json');
      const settingsTmpPath = `${settingsPath}.tmp`;
      fs.writeFileSync(settingsTmpPath, JSON.stringify(data.settings, null, 2), 'utf8');
      fs.renameSync(settingsTmpPath, settingsPath);
    }
    return { success: true, path: dbPath };
  } catch (e) {
    return { success: false, error: String(e.message ?? e), path: getDatabasePath() };
  }
});

ipcMain.handle('export-json-backup', async (_event, data) => {
  try {
    ensureDataDirs();
    const backupPath = writeBackupSnapshot(data, 'export');
    return { success: true, path: backupPath };
  } catch (e) {
    return { success: false, error: String(e.message ?? e) };
  }
});

ipcMain.handle('get-data-folder', async () => {
  ensureDataDirs();
  return getDataDir();
});

/** Quick connectivity check: try to open the printer handle without printing */
ipcMain.handle('ping-printer', async (_event, printerName) => {
  return new Promise(resolve => {
    if (!printerName) {
      resolve({ ok: false, message: 'Имя принтера не задано' });
      return;
    }
    const psScript = `
$printerName = '${printerName.replace(/'/g, "''")}';
try {
  Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class PingPrint {
  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr h);
}
'@ -Language CSharp -ErrorAction Stop;
  $h = [IntPtr]::Zero;
  if ([PingPrint]::OpenPrinter($printerName, [ref]$h, [IntPtr]::Zero)) {
    [PingPrint]::ClosePrinter($h) | Out-Null;
    Write-Output "REACHABLE";
  } else {
    $c = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error();
    Write-Output "FAIL:$c";
  }
} catch { Write-Output "ERROR:$_"; exit 1 }
`;
    const psTmp = path.join(os.tmpdir(), `ps_ping_${Date.now()}.ps1`);
    fs.writeFileSync(psTmp, psScript, 'utf8');
    exec(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psTmp}"`,
      { timeout: 8000 },
      (err, stdout) => {
        try { fs.unlinkSync(psTmp); } catch {}
        const out = (stdout || '').trim();
        if (err || out.startsWith('FAIL') || out.startsWith('ERROR')) {
          resolve({ ok: false, message: out || err?.message || 'Нет ответа' });
        } else if (out === 'REACHABLE') {
          resolve({ ok: true, message: 'Принтер доступен' });
        } else {
          resolve({ ok: false, message: out || 'Неизвестный ответ' });
        }
      },
    );
  });
});

ipcMain.handle('show-save-dialog', async (_event, options) => {
  if (!mainWindow) return { canceled: true };
  return dialog.showSaveDialog(mainWindow, options);
});

/**
 * Install TSC printer driver from the bundled .cab file.
 * Uses pnputil which is available on Windows 7+ and Windows 10.
 * Requires administrator privileges (Electron app should be run as admin for this to work).
 */
ipcMain.handle('install-driver', async () => {
  return new Promise(resolve => {
    const driversDir = isDev
      ? path.join(__dirname, '..', 'drivers')
      : path.join(path.dirname(app.getPath('exe')), 'resources', 'drivers');

    const cabFile = path.join(driversDir, 'TSC_driver.cab');

    if (!fs.existsSync(cabFile)) {
      resolve({ success: false, error: `Driver CAB not found: ${cabFile}` });
      return;
    }

    const tempDir = path.join(os.tmpdir(), `TSCDriver_${Date.now()}`);
    const logFile = path.join(getDataDir(), 'Logs', `install-driver-${Date.now()}.log`);

    const psScript = `
$ErrorActionPreference = 'Stop';
$cabFile = '${cabFile.replace(/\\/g, '\\\\').replace(/'/g, "''")}';
$tempDir = '${tempDir.replace(/\\/g, '\\\\').replace(/'/g, "''")}';
$logFile = '${logFile.replace(/\\/g, '\\\\').replace(/'/g, "''")}';

try {
  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null;
  $shell = New-Object -ComObject Shell.Application;
  $cab   = $shell.NameSpace($cabFile);
  $dest  = $shell.NameSpace($tempDir);
  if (-not $cab) { throw "Cannot open CAB: $cabFile" }
  $dest.CopyHere($cab.Items(), 20);
  Start-Sleep -Seconds 3;
  $infFiles = Get-ChildItem -Path $tempDir -Filter '*.inf' -Recurse -ErrorAction Stop;
  if ($infFiles.Count -eq 0) { throw 'INF not found in driver package' }
  $infFile = $infFiles[0].FullName;
  "INF: $infFile" | Out-File -FilePath $logFile -Encoding UTF8;
  $result1 = & pnputil /add-driver $infFile /install 2>&1;
  $result1 | Out-File -FilePath $logFile -Encoding UTF8 -Append;
  if ($LASTEXITCODE -eq 0) {
    Write-Output "OK";
    exit 0;
  }
  $result2 = & pnputil -a $infFile 2>&1;
  $result2 | Out-File -FilePath $logFile -Encoding UTF8 -Append;
  if ($LASTEXITCODE -eq 0) {
    Write-Output "OK";
    exit 0;
  }
  throw "pnputil failed. See log: $logFile";
} catch {
  $_.Exception.Message | Out-File -FilePath $logFile -Encoding UTF8 -Append;
  Write-Error $_.Exception.Message;
  exit 1;
} finally {
  if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
}
`;

    const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
    const runElevated = `Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}'`;
    const encodedLauncher = Buffer.from(runElevated, 'utf16le').toString('base64');
    exec(
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedLauncher}`,
      { timeout: 15000 },
      err => {
        if (err) {
          resolve({ success: false, error: `Не удалось запросить права администратора: ${cleanPowerShellOutput(err.message)}` });
        } else {
          resolve({ success: true });
        }
      },
    );
  });
});

ipcMain.handle('open-folder', async (_event, folderPath) => {
  try {
    await shell.openPath(folderPath);
    return true;
  } catch {
    return false;
  }
});
