# Быстрая сборка portable .exe (без подписи). Результат: release\CartridgeControl *.exe
# Запуск: из корня репозитория —  powershell -ExecutionPolicy Bypass -File .\scripts\quick-exe.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Сборка quick:exe (vite + electron-builder portable)…" -ForegroundColor Cyan
npm run quick:exe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$release = Join-Path $root "..\Printer-release"
if (Test-Path $release) {
  Write-Host "Готово. Папка:" -ForegroundColor Green
  Write-Host "  $release"
  $portable = Get-ChildItem -Path $release -Filter "CartridgeControl*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($portable) {
    Write-Host "Файл:" -ForegroundColor Green
    Write-Host "  $($portable.FullName)"
  }
  Start-Process explorer.exe $release
}
