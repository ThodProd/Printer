$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$packageVersion = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
$redistDirectory = Join-Path $projectRoot 'installer/redist'
$webViewInstaller = Join-Path $redistDirectory 'MicrosoftEdgeWebview2Setup.exe'
$innoScript = Join-Path $projectRoot 'installer/CartridgeControl.iss'
$outputInstaller = Join-Path $projectRoot "release/CartridgeControl-$packageVersion-Setup.exe"

npm run dist
if ($LASTEXITCODE -ne 0) { throw 'Portable build failed' }

New-Item -ItemType Directory -Path $redistDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $webViewInstaller)) {
    Write-Output 'Downloading the official Microsoft Edge WebView2 bootstrapper...'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $webViewInstaller
}

$webViewFile = Get-Item -LiteralPath $webViewInstaller
if ($webViewFile.Length -lt 1000000) { throw 'Downloaded WebView2 bootstrapper is unexpectedly small' }

$isccCandidates = @(
    (Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs/Inno Setup 6/ISCC.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$iscc = $isccCandidates | Select-Object -First 1
if (-not $iscc) {
    throw 'Inno Setup 6 is required. Install it with: winget install --id JRSoftware.InnoSetup --exact'
}

& $iscc "/DMyAppVersion=$packageVersion" $innoScript
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
if (-not (Test-Path -LiteralPath $outputInstaller)) { throw 'Installer was not created' }

$installerStream = [System.IO.File]::OpenRead($outputInstaller)
$installerHasher = [System.Security.Cryptography.SHA256]::Create()
try { $installerHash = [BitConverter]::ToString($installerHasher.ComputeHash($installerStream)).Replace('-', '').ToLowerInvariant() }
finally { $installerStream.Dispose(); $installerHasher.Dispose() }
Write-Output "Installer SHA256: $installerHash"
Get-Item -LiteralPath $outputInstaller | Select-Object FullName, Length
