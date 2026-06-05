# Builds NSIS installer + zip + unpacked dir with Authenticode when CSC_LINK is set.
# Usage: place build\sign-env.local (see build\sign-env.example) OR set env vars yourself.

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
  Write-Host "CSC_LINK is not set. Unsigned build (same as dist:all)." -ForegroundColor Yellow
  npm run dist:all
  exit $LASTEXITCODE
}

$pfx = $env:CSC_LINK -replace '^"', '' -replace '"$', ''
if (-not (Test-Path -LiteralPath $pfx)) {
  Write-Error "Certificate file not found: $pfx"
  exit 1
}

Write-Host "Signing with: $pfx" -ForegroundColor Cyan
npm run dist:all:signed
exit $LASTEXITCODE
