# CartridgeControl — Система учёта картриджей

Desktop-приложение для учёта картриджей, печати этикеток TSC TTP-225 и работы со штрих-кодами.

## Сборка на новом компьютере

Подробно: **[BUILD.md](BUILD.md)**

```powershell
git clone <url> Printer
cd Printer
npm install
# Проверка обязательных файлов:
Test-Path build/icon.ico, drivers/TSC_driver.cab

# Portable + установщик + подпись (если есть сертификат):
npm run release:build
```

Артефакты: **`../Printer-release/`** (рядом с репозиторием).

| Команда | Что получится |
|---------|----------------|
| `npm run dist:portable` | Portable EXE |
| `npm run dist:installer` | NSIS установщик |
| `npm run release:sign` | Подпись уже собранных EXE |
| `npm run installer:signed:ps` | NSIS с PFX (`build/sign-env.local`) |

## Запуск готового EXE

1. Portable: `CartridgeControl 1.0.0.exe`
2. Или установщик: `CartridgeControl Setup 1.0.0.exe`
3. Папка `Data/` создаётся **рядом с exe** при первом запуске

## Разработка

```bash
npm install
npm run dev                 # браузер
npm run build && npm run electron:dev
```

## Структура репозитория (сборка)

```
build/icon.ico          — иконка (обязательна в git)
build/sign-env.example  — шаблон подписи
drivers/TSC_driver.cab  — драйвер TSC (в установщик)
electron/               — main + preload
scripts/                — PowerShell-сборка и подпись
```

## Настройки принтера TSC TTP-225

1. Вкладка **Настройки** → **Принтер**
2. **Обновить** список принтеров (desktop)
3. Выберите `TSC TTP-225` или введите имя вручную

## Этикетка

- По умолчанию: **43 × 15 мм** (настраивается в Настройках)
- Шаблон TSPL в редакторе этикеток

## Горячие клавиши

- **Приём/Выдача** — сканирование на главном экране
- Сканер работает как HID-клавиатура
