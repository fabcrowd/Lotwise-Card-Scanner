# Installs the Lotwise extension for the current Windows user (no admin rights).
#
# Chrome only auto-installs extensions from the Chrome Web Store, so this copies the extension to a fixed
# folder, registers an uninstall entry, and opens guide.html, which walks through Developer mode and
# Load unpacked. The folder <InstallRoot>\extension keeps the same path across updates because Chrome
# identifies an unpacked extension by its path.
param(
  [string]$InstallRoot,
  [string]$UninstallKey,
  [string]$PackageZip,
  [string]$Version,
  [switch]$NoLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DefaultUninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Lotwise'

# Exit codes: 0 means installed, and this code means it failed after showing its own message. launch.cmd treats any other
# code as "the script never got as far as showing a message" and says so.
$ExitShownFailure = 3

# Anything that can fail on the machine's environment runs inside the try block at the bottom, so it shows the error box.
function Get-DefaultInstallRoot {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA is not set, so there is no default install folder. Run Lotwise Setup again from a normal Windows session.'
  }
  Join-Path $env:LOCALAPPDATA 'Lotwise'
}

# The guard code below (the next five items) is the same text in uninstall.ps1, because each script is copied alone
# into the install; tests/installer.test.js keeps the two copies identical.
$LotwiseDisplayName = 'Lotwise card scanner (Chrome extension)'

# Only a full path is accepted: a relative path or 'C:' would resolve against the current directory.
function Resolve-InstallRoot([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or $Path -notmatch '^([A-Za-z]:\\|\\\\)') {
    throw "The install folder must be a full path such as C:\Users\you\AppData\Local\Lotwise, not: $Path"
  }
  $full = [System.IO.Path]::GetFullPath($Path)
  if ($full.TrimEnd('\') -eq [System.IO.Path]::GetPathRoot($full).TrimEnd('\')) { throw "Refusing to use a drive root or share root: $full" }
  $full.TrimEnd('\')
}

# install.ps1 writes uninstall.ps1 and lotwise-install.json ({"app":"Lotwise",...}) into every install root.
function Test-LotwiseInstall([string]$Root) {
  if (-not (Test-Path -LiteralPath (Join-Path $Root 'uninstall.ps1'))) { return $false }
  $marker = Join-Path $Root 'lotwise-install.json'
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { return $false }
  try { $data = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json } catch { return $false }
  return [bool]($data -and $data.PSObject.Properties['app'] -and $data.app -eq 'Lotwise')
}

# A registry path under HKCU:\Software whose parts are plain names, so no filesystem path, other hive or wildcard gets through.
function Assert-UninstallKey([string]$Key) {
  if ([string]::IsNullOrWhiteSpace($Key) -or $Key -notmatch '^HKCU:\\Software(\\[A-Za-z0-9 ._-]+)+$' -or ($Key -split '\\' | Where-Object { $_ -match '^\.+$' })) {
    throw "The uninstall key must be a registry path under HKCU:\Software with a plain name, not: $Key"
  }
}

# An existing key is only ever touched when it is a Lotwise entry. A missing key is fine.
function Assert-KeyIsFreeOrLotwise([string]$Key) {
  if (-not (Test-Path -LiteralPath $Key)) { return }
  $found = Get-ItemProperty -LiteralPath $Key
  if (-not ($found.PSObject.Properties['DisplayName'] -and $found.DisplayName -eq $LotwiseDisplayName)) {
    throw "The registry key exists and is not a Lotwise entry, so it was left untouched: $Key"
  }
}

function Get-PackageVersion {
  $file = Join-Path $PSScriptRoot 'version.txt'
  if (-not (Test-Path -LiteralPath $file)) { throw 'No version was given and version.txt is missing.' }
  (Get-Content -LiteralPath $file -Raw).Trim()
}

function Expand-Package([string]$Zip, [string]$Target) {
  if (-not (Test-Path -LiteralPath $Zip)) { throw "The package was not found: $Zip" }
  if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  try { [System.IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Target) } catch {
    $reason = $_.Exception.Message
    Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue
    throw "The package could not be unpacked ($reason)."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $Target 'manifest.json'))) {
    Remove-Item -LiteralPath $Target -Recurse -Force
    throw 'The package has no manifest.json at its top level.'
  }
}

# Rename-based swap so a failure part-way leaves the previous install in place.
function Switch-ExtensionFolder([string]$Root) {
  $current = Join-Path $Root 'extension'
  $old = Join-Path $Root 'extension.old'
  $new = Join-Path $Root 'extension.new'
  if (Test-Path -LiteralPath $old) {
    try { Remove-Item -LiteralPath $old -Recurse -Force } catch {
      $reason = $_.Exception.Message
      Remove-Item -LiteralPath $new -Recurse -Force -ErrorAction SilentlyContinue
      throw "Could not remove the leftover folder $old ($reason). If Chrome is open, close it and run Lotwise Setup again."
    }
  }
  $hadCurrent = Test-Path -LiteralPath $current
  try {
    if ($hadCurrent) { Rename-Item -LiteralPath $current -NewName 'extension.old' }
    Rename-Item -LiteralPath $new -NewName 'extension'
  } catch {
    $reason = $_.Exception.Message
    $rollbackNote = ''
    if ($hadCurrent -and -not (Test-Path -LiteralPath $current) -and (Test-Path -LiteralPath $old)) {
      try { Rename-Item -LiteralPath $old -NewName 'extension' } catch {
        $rollbackNote = " Putting the previous copy back also failed ($($_.Exception.Message)). The previous copy is in $old; rename it to 'extension' to restore it."
      }
    }
    Remove-Item -LiteralPath $new -Recurse -Force -ErrorAction SilentlyContinue
    throw "$reason$rollbackNote If Chrome is open, close it and run Lotwise Setup again."
  }
  # The new folder is already live, so a stuck old copy is only clutter and must not stop the rest of the install.
  # The note it returns reaches the user in the final message.
  if ($hadCurrent) {
    try { Remove-Item -LiteralPath $old -Recurse -Force } catch { return (Get-LeftoverNote $old) }
  }
  return ''
}

function Get-LeftoverNote([string]$Folder) {
  "Lotwise is installed, but the old copy could not be removed. Delete the folder $Folder by hand when Chrome is closed."
}

# Names what a failed first install could not clean up, so the message never claims more than is true.
function Get-FirstInstallFailureMessage([string]$Where, [string]$Reason, [string[]]$Left) {
  $head = "Lotwise could not be installed$Where. $Reason"
  if (@($Left).Count -eq 0) { return "$head Nothing was left behind, so Lotwise Setup can be run again." }
  "$head Setup could not remove everything it wrote: delete $(@($Left) -join ' and ') by hand, then run Lotwise Setup again."
}

function Write-InstallMarker([string]$Root, [string]$Ver) {
  $json = [ordered]@{ app = 'Lotwise'; installer = 1; version = $Ver } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText((Join-Path $Root 'lotwise-install.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Write-Guide([string]$Root, [string]$Ver) {
  $template = Join-Path $PSScriptRoot 'guide.html'
  $html = [System.IO.File]::ReadAllText($template, [System.Text.Encoding]::UTF8)
  $path = [System.Net.WebUtility]::HtmlEncode((Join-Path $Root 'extension'))
  $html = $html.Replace('{{EXTENSION_PATH}}', $path).Replace('{{VERSION}}', [System.Net.WebUtility]::HtmlEncode($Ver))
  [System.IO.File]::WriteAllText((Join-Path $Root 'guide.html'), $html, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-FolderSizeKb([string]$Folder) {
  $total = 0L
  foreach ($file in Get-ChildItem -LiteralPath $Folder -Recurse -File) { $total += $file.Length }
  [int][math]::Ceiling($total / 1KB)
}

function Get-UninstallCommand([string]$Root, [string]$Key) {
  $cmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $Root 'uninstall.ps1') + '"'
  # A non-default install must be removed from where it went, so the entry carries the same arguments.
  if ($Root -ne $DefaultInstallRoot.TrimEnd('\')) { $cmd += ' -InstallRoot "' + $Root + '"' }
  if ($Key -ne $DefaultUninstallKey) { $cmd += ' -UninstallKey "' + $Key + '"' }
  $cmd
}

function Register-Uninstall([string]$Root, [string]$Key, [string]$Ver) {
  New-Item -Path $Key -Force | Out-Null
  # DisplayName goes in first, so a partly written key is still recognized as a Lotwise entry.
  $strings = [ordered]@{
    DisplayName     = $LotwiseDisplayName
    DisplayVersion  = $Ver
    Publisher       = 'fabcrowd'
    InstallLocation = $Root
    UninstallString = (Get-UninstallCommand $Root $Key)
  }
  foreach ($name in $strings.Keys) {
    New-ItemProperty -Path $Key -Name $name -Value $strings[$name] -PropertyType String -Force | Out-Null
  }
  $numbers = @{ NoModify = 1; NoRepair = 1; EstimatedSize = (Get-FolderSizeKb (Join-Path $Root 'extension')) }
  foreach ($name in $numbers.Keys) {
    New-ItemProperty -Path $Key -Name $name -Value $numbers[$name] -PropertyType DWord -Force | Out-Null
  }
  # No DisplayIcon: the extension ships PNG icons only, and the entry needs an .ico.
}

function Find-Chrome {
  foreach ($hive in 'HKCU:', 'HKLM:') {
    $key = "$hive\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
    if (-not (Test-Path -LiteralPath $key)) { continue }
    $value = (Get-ItemProperty -LiteralPath $key).'(default)'
    if ($value -and (Test-Path -LiteralPath $value)) { return $value }
  }
  $programFilesX86 = ${env:ProgramFiles(x86)}
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    $(if ($programFilesX86) { Join-Path $programFilesX86 'Google\Chrome\Application\chrome.exe' }),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return $null
}

function Open-Guide([string]$Root) {
  $guide = Join-Path $Root 'guide.html'
  # Chrome ignores chrome:// addresses on its command line, so only the guide is opened.
  $chrome = Find-Chrome
  if ($chrome) {
    Start-Process -FilePath $chrome -ArgumentList @(([System.Uri]$guide).AbsoluteUri)
  } else {
    Start-Process -FilePath $guide
  }
}

function Show-Failure([string]$Message) {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($Message, 'Lotwise Setup')
}

# Last resort for an unexpected error outside the try block below: still show a message and use the shown-failure code.
trap {
  $unexpected = "Lotwise Setup stopped unexpectedly. $($_.Exception.Message)"
  try {
    [Console]::Error.WriteLine($unexpected)
    if (-not $NoLaunch) { Show-Failure $unexpected }
  } catch {
    # Nothing more can be shown; the exit code below still tells launch.cmd a message was attempted.
    [Console]::Error.WriteLine($_.Exception.Message)
  }
  exit $ExitShownFailure
}

# Setup into an empty or missing folder is a first install. If it fails, everything it wrote is removed again, so the
# folder is empty and running setup again works (a half-written folder would otherwise fail the Lotwise install check).
function Remove-FailedFirstInstall([string]$Root, [string]$Key, [bool]$RootExisted, [bool]$KeyWasMissing) {
  if (Test-Path -LiteralPath $Root) {
    Get-ChildItem -LiteralPath $Root -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    if (-not $RootExisted) { Remove-Item -LiteralPath $Root -Force -ErrorAction SilentlyContinue }
  }
  if ($KeyWasMissing -and (Test-Path -LiteralPath $Key)) { Remove-Item -LiteralPath $Key -Recurse -Force -ErrorAction SilentlyContinue }
  # What is still there goes back to the caller, so the message names it instead of claiming a clean slate.
  $left = @()
  if ((Test-Path -LiteralPath $Root) -and (-not $RootExisted -or @(Get-ChildItem -LiteralPath $Root -Force).Count -gt 0)) { $left += "the folder $Root" }
  if ($KeyWasMissing -and (Test-Path -LiteralPath $Key)) { $left += "the registry key $Key" }
  return ,$left
}

# Once the folder swap has gone through, the new extension is live, so a later failure is "setup did not finish".
$swapped = $false
$firstInstall = $false
$rootExisted = $false
$keyWasMissing = $false
$step = ''
try {
  $DefaultInstallRoot = Get-DefaultInstallRoot
  # A value that was passed but is empty is an error, not a request for the default.
  if (-not $PSBoundParameters.ContainsKey('InstallRoot')) { $InstallRoot = $DefaultInstallRoot }
  if (-not $PSBoundParameters.ContainsKey('UninstallKey')) { $UninstallKey = $DefaultUninstallKey }
  if ([string]::IsNullOrWhiteSpace($PackageZip)) { $PackageZip = Join-Path $PSScriptRoot 'lotwise-extension.zip' }
  $InstallRoot = Resolve-InstallRoot $InstallRoot
  # The uninstaller finishes with a cmd command line, where a percent sign would be expanded as a variable.
  if ($InstallRoot.Contains('%')) { throw "The install folder name cannot contain a percent sign, so nothing was changed: $InstallRoot" }
  Assert-UninstallKey $UninstallKey
  Assert-KeyIsFreeOrLotwise $UninstallKey
  $rootExisted = Test-Path -LiteralPath $InstallRoot
  $isEmpty = (-not $rootExisted) -or (@(Get-ChildItem -LiteralPath $InstallRoot -Force).Count -eq 0)
  if (-not $isEmpty -and -not (Test-LotwiseInstall $InstallRoot)) {
    throw "This folder is not empty and is not a Lotwise install, so nothing was changed: $InstallRoot"
  }
  $firstInstall = $isEmpty
  $keyWasMissing = -not (Test-Path -LiteralPath $UninstallKey)
  if ([string]::IsNullOrWhiteSpace($Version)) { $Version = Get-PackageVersion }
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  Expand-Package $PackageZip (Join-Path $InstallRoot 'extension.new')
  $leftoverNote = Switch-ExtensionFolder $InstallRoot
  $swapped = $true
  $step = 'copying uninstall.ps1'
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall.ps1') -Destination (Join-Path $InstallRoot 'uninstall.ps1') -Force
  $step = 'writing the install marker'
  Write-InstallMarker $InstallRoot $Version
  $step = 'writing the guide'
  Write-Guide $InstallRoot $Version
  $step = 'registering the uninstall entry'
  Register-Uninstall $InstallRoot $UninstallKey $Version
} catch {
  $message = $_.Exception.Message
  if ($firstInstall) {
    $left = @(Remove-FailedFirstInstall $InstallRoot $UninstallKey $rootExisted $keyWasMissing)
    $where = if ($swapped) { " while $step" } else { '' }
    $message = Get-FirstInstallFailureMessage $where $message $left
    [Console]::Error.WriteLine($message)
    if (-not $NoLaunch) { Show-Failure $message }
  } elseif ($swapped) {
    $message = "The extension files were updated, but setup did not finish while $step. $message"
    [Console]::Error.WriteLine($message)
    if (-not $NoLaunch) { Show-Failure $message }
  } else {
    [Console]::Error.WriteLine($message)
    if (-not $NoLaunch) { Show-Failure "Lotwise could not be installed. $message" }
  }
  exit $ExitShownFailure
}

# The install is complete here, so a stuck old copy or a guide that will not open is not a failure: the final
# message names what is left to do by hand.
$notices = @()
if ($leftoverNote) { $notices += $leftoverNote }
if (-not $NoLaunch) {
  try { Open-Guide $InstallRoot } catch {
    $notices += "Lotwise is installed, but its guide could not be opened ($($_.Exception.Message)). Open this file yourself to finish setup: $(Join-Path $InstallRoot 'guide.html')"
  }
}
foreach ($notice in $notices) { [Console]::Error.WriteLine($notice) }
if ($notices.Count -gt 0 -and -not $NoLaunch) { Show-Failure ($notices -join ' ') }
exit 0
