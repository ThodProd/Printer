$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'TypeScript validation failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'UI build failed' }
$packageVersion = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
$packageOutput = Join-Path $projectRoot "release/windows-native-$packageVersion"
$stagingOutput = Join-Path $projectRoot "release/.windows-native-$packageVersion-staging"
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'release'))
$stagingFullPath = [System.IO.Path]::GetFullPath($stagingOutput)
if (-not $stagingFullPath.StartsWith($releaseRoot + [System.IO.Path]::DirectorySeparatorChar)) {
    throw 'Invalid staging output path'
}
if (Test-Path -LiteralPath $stagingFullPath) {
    Remove-Item -LiteralPath $stagingFullPath -Recurse -Force
}
dotnet publish native/CartridgeControl -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -o $stagingOutput
if ($LASTEXITCODE -ne 0) { throw 'Windows publish failed' }
Copy-Item -LiteralPath "CHANGES-$packageVersion.md" -Destination (Join-Path $stagingOutput 'README.md') -Force
if (Test-Path -LiteralPath (Join-Path $stagingOutput 'Data')) { throw 'Staging output contains a database; refusing to package it' }
$packageArchive = Join-Path $projectRoot "release/CartridgeControl-$packageVersion-win-x64.zip"
Compress-Archive -Path (Join-Path $stagingOutput '*') -DestinationPath $packageArchive -Force
New-Item -ItemType Directory -Path $packageOutput -Force | Out-Null
Copy-Item -Path (Join-Path $stagingOutput '*') -Destination $packageOutput -Recurse -Force
Remove-Item -LiteralPath $stagingFullPath -Recurse -Force
$packageStream = [System.IO.File]::OpenRead($packageArchive)
$packageHasher = [System.Security.Cryptography.SHA256]::Create()
try { $packageHash = [BitConverter]::ToString($packageHasher.ComputeHash($packageStream)).Replace('-', '').ToLowerInvariant() }
finally { $packageStream.Dispose(); $packageHasher.Dispose() }
Write-Output "SHA256: $packageHash"
Get-Item -LiteralPath $packageArchive | Select-Object FullName, Length
