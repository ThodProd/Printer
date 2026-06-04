# Подпись артефактов в ../Printer-release через signtool (сертификат из хранилища Windows или CERT_SHA1).
# Запуск из корня: powershell -ExecutionPolicy Bypass -File .\scripts\sign-release.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root "..\Printer-release"

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

$thumb = $env:CERT_SHA1
if (-not $thumb) {
  $subjectHint = if ($env:CERT_SUBJECT) { $env:CERT_SUBJECT } else { "Code Signing" }
  $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -like "*$subjectHint*" } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1
  if (-not $cert) {
    Write-Host "Сертификат не найден. Задайте CERT_SHA1 или CERT_SUBJECT в build\sign-env.local" -ForegroundColor Red
    exit 2
  }
  $thumb = $cert.Thumbprint
  Write-Host "Сертификат: $($cert.Subject)" -ForegroundColor Cyan
}

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) {
  Write-Error "signtool.exe не найден. Установите Windows SDK."
  exit 1
}

if (-not (Test-Path $release)) {
  Write-Error "Папка сборки не найдена: $release. Сначала выполните npm run dist:portable или build-release.ps1"
  exit 1
}

$targets = @()
$targets += Get-ChildItem -Path $release -Filter "CartridgeControl*.exe" -File -ErrorAction SilentlyContinue
$appExe = Join-Path $release "win-unpacked\CartridgeControl.exe"
if (Test-Path $appExe) { $targets += Get-Item $appExe }

if ($targets.Count -eq 0) {
  Write-Warning "Нет EXE для подписи в $release"
  exit 1
}

foreach ($file in $targets) {
  Write-Host "Подпись: $($file.Name)" -ForegroundColor Cyan
  & $signtool.FullName sign /sha1 $thumb /tr http://timestamp.digicert.com /td sha256 /fd sha256 $file.FullName
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $sig = Get-AuthenticodeSignature $file.FullName
  Write-Host "  $($sig.Status) — $($sig.SignerCertificate.Subject)" -ForegroundColor $(if ($sig.SignerCertificate) { 'Green' } else { 'Yellow' })
}

Write-Host "Готово: $release" -ForegroundColor Green
