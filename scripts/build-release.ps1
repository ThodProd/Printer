# Portable + NSIS установщик, затем подпись (если доступен signtool и сертификат).
# Запуск из корня: powershell -ExecutionPolicy Bypass -File .\scripts\build-release.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path "build\icon.ico")) {
  Write-Error "Отсутствует build\icon.ico — без него electron-builder не соберёт приложение. Проверьте полный clone репозитория."
  exit 1
}

Write-Host "=== Vite + portable ===" -ForegroundColor Cyan
npm run dist:portable
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== NSIS установщик ===" -ForegroundColor Cyan
npm run dist:installer
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== Подпись (опционально) ===" -ForegroundColor Cyan
& (Join-Path $root "scripts\sign-release.ps1")
# sign-release.ps1 сам завершится с кодом 2, если нет сертификата — не считаем это фатальным для сборки
if ($LASTEXITCODE -eq 2) {
  Write-Host "Сборка завершена без подписи. Для PFX: build\sign-env.local + installer-signed.ps1" -ForegroundColor Yellow
  exit 0
}
exit $LASTEXITCODE
