# NSIS-установщик с Authenticode (PFX). Нужны CSC_LINK и CSC_KEY_PASSWORD.
# Секреты: скопируйте build\sign-env.example -> build\sign-env.local и заполните.
# Запуск из корня: powershell -ExecutionPolicy Bypass -File .\scripts\installer-signed.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$localEnv = Join-Path $root "build\sign-env.local"
if (Test-Path $localEnv) {
  Get-Content $localEnv | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).Trim()
    Set-Item -Path "Env:$k" -Value $v
  }
}

if (-not $env:CSC_LINK) {
  Write-Host "Нет CSC_LINK: укажите путь к .pfx в build\sign-env.local (см. build\sign-env.example)." -ForegroundColor Red
  exit 2
}
if (-not $env:CSC_KEY_PASSWORD) {
  Write-Host "Нет CSC_KEY_PASSWORD: добавьте пароль от .pfx в build\sign-env.local." -ForegroundColor Red
  exit 2
}

$pfx = $env:CSC_LINK -replace '^"', '' -replace '"$', ''
if (-not (Test-Path -LiteralPath $pfx)) {
  Write-Error "Файл сертификата не найден: $pfx"
  exit 1
}

Write-Host "Сборка + NSIS с подписью (PFX)…" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx electron-builder --win nsis --x64 --publish never
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$setup = Join-Path $root "..\Printer-release\CartridgeControl Setup 1.0.0.exe"
if (Test-Path -LiteralPath $setup) {
  $sig = Get-AuthenticodeSignature -File $setup
  Write-Host "Установщик: $setup" -ForegroundColor Green
  Write-Host "Подпись:    $($sig.Status)" -ForegroundColor $(if ($sig.Status -eq 'Valid') { 'Green' } else { 'Yellow' })
  if ($sig.Status -ne 'Valid') {
    Write-Host $sig.StatusMessage -ForegroundColor Yellow
  }
} else {
  Write-Warning "Файл установщика не найден по ожидаемому пути."
}
