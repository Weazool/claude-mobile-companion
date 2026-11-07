# Builds the Windows taskbar program and zips what it needs to run.
# Run from the repo root: powershell -File windows/pack.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json).version

& dotnet build (Join-Path $root 'windows') -c Release
if ($LASTEXITCODE -ne 0) { Write-Error "dotnet build failed ($LASTEXITCODE)"; exit 1 }

$out = Join-Path $root 'windows\bin\Release\net48'
$files = 'DeskCompanionTaskbar.exe', 'DeskCompanionTaskbar.exe.config',
         'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll',
         'WebView2Loader.dll' | ForEach-Object { Join-Path $out $_ }
foreach ($f in $files) { if (-not (Test-Path $f)) { Write-Error "missing $f"; exit 1 } }

$dist = Join-Path $root 'windows\dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist "DeskCompanionTaskbar-$version.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path $files -DestinationPath $zip
Write-Host "Wrote $zip"
