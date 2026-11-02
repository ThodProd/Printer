# CartridgeControl

Windows-программа учёта принтеров, картриджей, заправок и ремонта. Оболочка WPF/.NET 10 + Microsoft Edge WebView2, как ThodHUB. Electron и Node.js для работы программы не нужны.

## Установка

Для обычной установки используйте `CartridgeControl-1.1.17-Setup.exe` из раздела Releases. Программа устанавливается в профиль текущего пользователя, создаёт ярлык в меню «Пуск» и отдельную папку `Data` рядом с приложением. При обновлении существующая база в `Data` не заменяется и не удаляется.

Портативная сборка остаётся доступна в архиве `CartridgeControl-1.1.17-win-x64.zip`. Рабочая база данных в публичные сборки не включается.

## Запуск

Распакуйте Windows-архив и запустите `CartridgeControl.exe`. .NET включён в комплект. Нужен Microsoft Edge WebView2 Evergreen Runtime. При его отсутствии окно программы покажет ссылку на Microsoft.

База — `Data/database.json` рядом с EXE. При переходе с прежней версии закройте её, сохраните копию Data и скопируйте Data в папку новой программы. Формат JSON версии 1 и существующие ID сохраняются. При первом открытии создаётся точная исходная копия, при сохранении сверки — отдельная полная копия.

Последние изменения описаны в [CHANGES-1.1.17.md](CHANGES-1.1.17.md).

## Разработка и сборка

Требуются Windows, .NET SDK 10 и Node.js для сборки веб-ресурсов.

```powershell
npm ci
npm run desktop:dev
npm run dist
npm run dist:installer
```

`npm run dev` открывает веб-режим разработки с localStorage. `npm run dist` создаёт `release/CartridgeControl-1.1.17-win-x64.zip` и самостоятельную программу в `release/windows-native-1.1.17`. `npm run dist:installer` дополнительно собирает установочный EXE; для него требуется Inno Setup 6. Пользовательские базы в публичные сборки не включаются.

```powershell
npm run typecheck
npx playwright install chromium
npm test
npm run test:native
# После сборки Windows-программы:
npm run test:desktop
```

`CARTRIDGE_DATA_DIR` и `CARTRIDGE_WEBVIEW_DIR` переопределяют папки базы и профиля для изолированных тестов. В обычном запуске база лежит рядом с EXE, профиль WebView2 — в LocalAppData/CartridgeControl/WebView2.

Нативный код — `native/CartridgeControl`, интерфейс — `src`, обмен с оболочкой — `src/platform.ts`. Модель учёта и статусы сохранены. Расхождение складского счётчика отложено до получения проблемной рабочей базы.
