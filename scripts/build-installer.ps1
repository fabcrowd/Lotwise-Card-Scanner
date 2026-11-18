# Builds dist\Sweep-Setup-<version>.exe, a self-extracting installer made with IExpress (ships with Windows).
#
# IExpress stores files flat, so the extension travels as one zip (the store package) next to install.ps1.
# Use -SkipExtensionBuild to reuse an existing dist\extension-wasm-store.zip.
param([switch]$SkipExtensionBuild)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$InstallerSource = Join-Path $RepoRoot 'tools\installer'
$StoreZip = Join-Path $RepoRoot 'dist\extension-wasm-store.zip'

if (-not $SkipExtensionBuild) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-wasm-extension.ps1') -Store
  if ($LASTEXITCODE -ne 0) { throw "build-wasm-extension.ps1 -Store failed (exit $LASTEXITCODE)." }
}
if (-not (Test-Path -LiteralPath $StoreZip)) { throw "The store package was not found: $StoreZip" }

# A reused zip must not be older than the source it claims to package.
if ($SkipExtensionBuild) {
  $zipTime = (Get-Item -LiteralPath $StoreZip).LastWriteTime
  # The store package also depends on the store transform and the build script that made it.
  $sources = @(Get-ChildItem -LiteralPath (Join-Path $RepoRoot 'tools\extension-wasm') -Recurse -File)
  foreach ($extra in 'scripts\lib\store-package.mjs', 'scripts\build-wasm-extension.ps1') {
    $extraPath = Join-Path $RepoRoot $extra
    if (Test-Path -LiteralPath $extraPath) { $sources += Get-Item -LiteralPath $extraPath }
  }
  $newest = $sources | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($newest -and $newest.LastWriteTime -gt $zipTime) {
    [Console]::Error.WriteLine("Newest source file: $($newest.FullName), changed at $($newest.LastWriteTime.ToString('s'))")
    [Console]::Error.WriteLine("Store package:      $StoreZip, written at $($zipTime.ToString('s'))")
    throw '-SkipExtensionBuild would reuse a stale package, a source file is newer than it. Run this script without -SkipExtensionBuild.'
  }
}

# The version comes from the zip that ships, so a stale zip cannot be labelled with the source version.
function Get-ZipVersion([string]$ZipPath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'manifest.json' } | Select-Object -First 1
    if (-not $entry) { throw "The store package has no top-level manifest.json: $ZipPath" }
    $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
    try { return ($reader.ReadToEnd() | ConvertFrom-Json).version } finally { $reader.Dispose() }
  } finally {
    $zip.Dispose()
  }
}
$Version = Get-ZipVersion $StoreZip
if ([string]::IsNullOrWhiteSpace($Version)) { throw "The store package's manifest.json has no version, so the installer cannot be named: $StoreZip" }

# IExpress is unreliable with spaces in paths, so the stage folder must not have any.
$Stage = Join-Path $env:TEMP ('sweep-installer-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
if ($Stage -match '\s') { throw "The stage folder path contains a space ($Stage) and IExpress cannot be trusted with it. Set TEMP to a path without spaces for this build, for example: `$env:TEMP = 'C:\Temp'" }
New-Item -ItemType Directory -Path $Stage | Out-Null

try {
  foreach ($name in 'install.ps1', 'uninstall.ps1', 'guide.html', 'launch.cmd') {
    Copy-Item -LiteralPath (Join-Path $InstallerSource $name) -Destination (Join-Path $Stage $name)
  }
  [System.IO.File]::WriteAllText((Join-Path $Stage 'version.txt'), $Version, [System.Text.Encoding]::ASCII)
  Copy-Item -LiteralPath $StoreZip -Destination (Join-Path $Stage 'sweep-extension.zip')

  $Exe = Join-Path $Stage 'Sweep-Setup.exe'
  $files = 'install.ps1', 'uninstall.ps1', 'guide.html', 'launch.cmd', 'version.txt', 'sweep-extension.zip'
  $sed = New-Object System.Collections.Generic.List[string]
  $sed.AddRange([string[]]@(
    '[Version]', 'Class=IEXPRESS', 'SEDVersion=3',
    '[Options]',
    'PackagePurpose=InstallApp', 'ShowInstallProgramWindow=1', 'HideExtractAnimation=1', 'UseLongFileName=1',
    'InsideCompressed=0', 'CAB_FixedSize=0', 'CAB_ResvCodeSigning=0', 'RebootMode=N',
    'InstallPrompt=%InstallPrompt%', 'DisplayLicense=%DisplayLicense%', 'FinishMessage=%FinishMessage%',
    'TargetName=%TargetName%', 'FriendlyName=%FriendlyName%', 'AppLaunched=%AppLaunched%',
    'PostInstallCmd=%PostInstallCmd%', 'AdminQuietInstCmd=%AdminQuietInstCmd%', 'UserQuietInstCmd=%UserQuietInstCmd%',
    'SourceFiles=SourceFiles',
    '[Strings]',
    'InstallPrompt="Install Sweep, the card scanner for Chrome, for this Windows user?"',
    'DisplayLicense=""', 'FinishMessage=""',
    ('TargetName="' + $Exe + '"'),
    'FriendlyName="Sweep Setup"',
    # launch.cmd starts install.ps1 and tells the user if this PC blocks PowerShell scripts. The line is capped near 259
    # characters. The ".\" matters: when NoDefaultCurrentDirectoryInExePath is set, cmd does not find a bare launch.cmd.
    'AppLaunched="cmd.exe /c .\launch.cmd"',
    'PostInstallCmd=<None>', 'AdminQuietInstCmd=""', 'UserQuietInstCmd=""'
  ))
  for ($i = 0; $i -lt $files.Count; $i++) { $sed.Add('FILE' + $i + '="' + $files[$i] + '"') }
  $sed.Add('[SourceFiles]')
  $sed.Add('SourceFiles0=' + $Stage + '\')
  $sed.Add('[SourceFiles0]')
  for ($i = 0; $i -lt $files.Count; $i++) { $sed.Add('%FILE' + $i + '%=') }
  $SedPath = Join-Path $Stage 'sweep.sed'
  [System.IO.File]::WriteAllLines($SedPath, $sed, [System.Text.Encoding]::ASCII)

  Start-Process -FilePath 'C:\Windows\System32\iexpress.exe' -ArgumentList @('/N', '/Q', $SedPath) -Wait
  # IExpress can hand control back before makecab has finished writing the exe.
  $deadline = (Get-Date).AddSeconds(120)
  while (-not (Test-Path -LiteralPath $Exe) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
  if (-not (Test-Path -LiteralPath $Exe)) { throw 'IExpress did not produce the installer exe.' }
  Start-Sleep -Seconds 2

  $zipSize = (Get-Item -LiteralPath $StoreZip).Length
  $exeSize = (Get-Item -LiteralPath $Exe).Length
  if ($exeSize -lt ($zipSize / 2)) { throw "The installer exe is too small ($exeSize bytes for a $zipSize byte package)." }

  $Output = Join-Path $RepoRoot ('dist\Sweep-Setup-' + $Version + '.exe')
  Move-Item -LiteralPath $Exe -Destination $Output -Force
} finally {
  Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Output).Hash.ToLowerInvariant()
Write-Output "Installer: $Output"
Write-Output "Size: $((Get-Item -LiteralPath $Output).Length) bytes"
Write-Output "SHA-256: $hash"
