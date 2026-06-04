# Ресурсы сборки

В репозитории должны быть следующие файлы (не удаляйте их при клонировании):

| Файл | Назначение |
|------|------------|
| `icon.ico` | Иконка приложения, установщика и ярлыков (обязательна для electron-builder) |
| `sign-env.example` | Шаблон переменных для подписи PFX; скопируйте в `sign-env.local` (в git не попадает) |

## Подпись

- **PFX:** `build/sign-env.local` → `CSC_LINK`, `CSC_KEY_PASSWORD` → `npm run installer:signed:ps`
- **Сертификат в хранилище Windows:** после сборки → `npm run release:sign` (см. `BUILD.md`)

`sign-env.local`, `*.pfx`, `*.p12` перечислены в `.gitignore`.
