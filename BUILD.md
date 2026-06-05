# Сборка CartridgeControl на другом компьютере

## Требования

- **Windows 10/11** (x64)
- **Node.js 18+** и npm
- **Режим разработчика** (для NSIS): Параметры → Конфиденциальность → Для разработчиков → Режим разработчика
- Для подписи (опционально): Windows SDK (`signtool`) или PFX в `build/sign-env.local`

## Клонирование и установка

```powershell
git clone <url> Printer
cd Printer
npm install
```

Проверьте, что в репозитории есть обязательные файлы:

```powershell
Test-Path build/icon.ico          # True
Test-Path drivers/TSC_driver.cab  # True
```

Если `build/icon.ico` отсутствует — сборка electron-builder завершится с ошибкой иконки.

## Результаты сборки

По умолчанию артефакты попадают в **`../Printer-release`** (рядом с папкой репозитория), не в `release/` внутри проекта.

| Команда | Результат |
|---------|-----------|
| `npm run dist:portable` | `CartridgeControl 1.0.0.exe` (portable) |
| `npm run dist:installer` | `CartridgeControl Setup 1.0.0.exe` (NSIS) |
| `npm run dist:signed` | NSIS + попытка подписи через electron-builder |
| `npm run quick:exe` | Portable без подписи (быстрее) |

PowerShell-обёртки:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\quick-exe.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\build-release.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\installer-signed.ps1   # нужен build\sign-env.local
powershell -ExecutionPolicy Bypass -File .\scripts\sign-release.ps1       # подпись после сборки
```

## Полный цикл (portable + установщик + подпись)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-release.ps1
```

Скрипт выполняет `npm run build`, portable, NSIS и подпись через `signtool` (сертификат из хранилища или `CERT_SHA1` в `sign-env.local`).

## Разработка

```bash
npm run dev              # Vite в браузере
npm run build && npm run electron:dev   # Electron
```

## Данные приложения

В собранном EXE папка `Data/` создаётся **рядом с исполняемым файлом** (см. `electron/main.cjs`).

## Секреты

Не коммитьте: `build/sign-env.local`, `*.pfx`, `*.p12`, `.env`.
