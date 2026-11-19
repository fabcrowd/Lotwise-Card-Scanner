# Builds dist\Lotwise-Setup-<version>.exe, a self-extracting installer made with IExpress (ships with Windows).
#
# IExpress stores files flat, so the extension travels as one zip (the store package) next to install.ps1.
# Use -SkipExtensionBuild to reuse an existing dist\extension-wasm-store.zip.
# The packaged copy of the zip gets the fixed extension key from tools\installer\extension-key.json; the store zip is not changed.
# -StagedZipPath <file> (for tests) writes that packaged copy to the file and stops without building the exe.
param([switch]$SkipExtensionBuild, [string]$StagedZipPath)

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

# The installer's copy of the extension carries a manifest "key", so every PC gets the same extension id (the relay allows
# it). The store package must not: the Chrome Web Store assigns its own id. Only the staged copy below gets the key.
$KeyFile = Join-Path $InstallerSource 'extension-key.json'
if (-not (Test-Path -LiteralPath $KeyFile)) { throw "The installer's extension key file was not found: $KeyFile" }
try { $KeyInfo = Get-Content -LiteralPath $KeyFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { throw "The installer's extension key file is not valid JSON: $KeyFile" }
$ExtensionKey = $KeyInfo.key
if (-not ($ExtensionKey -is [string]) -or $ExtensionKey -notmatch '^[A-Za-z0-9+/]{100,}={0,2}$') { throw "The installer's extension key file has no usable base64 `"key`" value: $KeyFile" }

# Copies the zip and adds "key" to its top-level manifest.json as text, so every other byte of the manifest stays as it was.
function New-KeyedZip([string]$SourceZip, [string]$TargetZip, [string]$Key) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  Copy-Item -LiteralPath $SourceZip -Destination $TargetZip
  $zip = [System.IO.Compression.ZipFile]::Open($TargetZip, [System.IO.Compression.ZipArchiveMode]::Update)
  try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'manifest.json' } | Select-Object -First 1
    if (-not $entry) { throw "The store package has no top-level manifest.json: $SourceZip" }
    $reader = New-Object System.IO.StreamReader($entry.Open(), (New-Object System.Text.UTF8Encoding($false)))
    try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($null -ne ($text | ConvertFrom-Json).PSObject.Properties['key']) { throw "The store package's manifest.json already has a key, which a store package must not: $SourceZip" }
    $open = $text.IndexOf('{')
    if ($open -lt 0) { throw "The store package's manifest.json is not a JSON object: $SourceZip" }
    $keyed = $text.Substring(0, $open + 1) + "`n  `"key`": `"$Key`"," + $text.Substring($open + 1)
    $entry.Delete()
    $new = $zip.CreateEntry('manifest.json', [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $new.Open()
    try { $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($keyed); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
  } finally {
    $zip.Dispose()
  }
}
function Get-ZipManifestKey([string]$ZipPath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'manifest.json' } | Select-Object -First 1
    $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
    try { return ($reader.ReadToEnd() | ConvertFrom-Json).key } finally { $reader.Dispose() }
  } finally {
    $zip.Dispose()
  }
}

# IExpress is unreliable with spaces in paths, so the stage folder must not have any.
$Stage = Join-Path $env:TEMP ('lotwise-installer-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
if ($Stage -match '\s') { throw "The stage folder path contains a space ($Stage) and IExpress cannot be trusted with it. Set TEMP to a path without spaces for this build, for example: `$env:TEMP = 'C:\Temp'" }
New-Item -ItemType Directory -Path $Stage | Out-Null

try {
  foreach ($name in 'install.ps1', 'uninstall.ps1', 'guide.html', 'launch.cmd') {
    Copy-Item -LiteralPath (Join-Path $InstallerSource $name) -Destination (Join-Path $Stage $name)
  }
  [System.IO.File]::WriteAllText((Join-Path $Stage 'version.txt'), $Version, [System.Text.Encoding]::ASCII)
  $StagedZip = Join-Path $Stage 'lotwise-extension.zip'
  New-KeyedZip $StoreZip $StagedZip $ExtensionKey
  if ((Get-ZipManifestKey $StagedZip) -ne $ExtensionKey) { throw 'The staged extension package does not carry the key in its manifest.json.' }
  # For tests: write the staged package here and stop before IExpress.
  if ($StagedZipPath) {
    Copy-Item -LiteralPath $StagedZip -Destination $StagedZipPath -Force
    return
  }

  $Exe = Join-Path $Stage 'Lotwise-Setup.exe'
  $files = 'install.ps1', 'uninstall.ps1', 'guide.html', 'launch.cmd', 'version.txt', 'lotwise-extension.zip'
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
    'InstallPrompt="Install Lotwise, the card scanner for Chrome, for this Windows user?"',
    'DisplayLicense=""', 'FinishMessage=""',
    ('TargetName="' + $Exe + '"'),
    'FriendlyName="Lotwise Setup"',
    # launch.cmd starts install.ps1 and tells the user if this PC blocks PowerShell scripts. The line is capped near 259
    # characters. The ".\" matters: when NoDefaultCurrentDirectoryInExePath is set, cmd does not find a bare launch.cmd.
    'AppLaunched="cmd.exe /c .\launch.cmd"',
    # With empty quiet commands, /Q fails with "Error creating process <<None>>. Reason: The system cannot find the file specified."
    # and /Q:A installs nothing, so both quiet commands repeat AppLaunched.
    'PostInstallCmd=<None>', 'AdminQuietInstCmd="cmd.exe /c .\launch.cmd"', 'UserQuietInstCmd="cmd.exe /c .\launch.cmd"'
  ))
  for ($i = 0; $i -lt $files.Count; $i++) { $sed.Add('FILE' + $i + '="' + $files[$i] + '"') }
  $sed.Add('[SourceFiles]')
  $sed.Add('SourceFiles0=' + $Stage + '\')
  $sed.Add('[SourceFiles0]')
  for ($i = 0; $i -lt $files.Count; $i++) { $sed.Add('%FILE' + $i + '%=') }
  $SedPath = Join-Path $Stage 'lotwise.sed'
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

  $Output = Join-Path $RepoRoot ('dist\Lotwise-Setup-' + $Version + '.exe')
  Move-Item -LiteralPath $Exe -Destination $Output -Force
} finally {
  Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Output).Hash.ToLowerInvariant()
Write-Output "Installer: $Output"
Write-Output "Size: $((Get-Item -LiteralPath $Output).Length) bytes"
Write-Output "SHA-256: $hash"

# The file installed copies read to learn the newest version (lib/self-update.js). It goes on the release next to the exe.
$VersionFile = Join-Path $RepoRoot 'dist\lotwise-version.json'
[System.IO.File]::WriteAllText($VersionFile, ('{"product":"Lotwise","version":"' + $Version + '"}'), (New-Object System.Text.UTF8Encoding($false)))
Write-Output "Release files for the GitHub release tagged installer: $Output and $VersionFile"
