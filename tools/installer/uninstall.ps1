# Removes the Lotwise files and the uninstall entry created by install.ps1.
# Chrome's own record of the extension stays until the user clicks Remove on chrome://extensions.
param(
  [string]$InstallRoot,
  [string]$UninstallKey,
  [switch]$NoLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DefaultUninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Lotwise'

# Anything that can fail on the machine's environment runs inside the try block at the bottom, so it shows the error box.
function Get-DefaultInstallRoot {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA is not set, so there is no default install folder. Run Lotwise Setup again from a normal Windows session.'
  }
  Join-Path $env:LOCALAPPDATA 'Lotwise'
}

# The guard code below (the next five items) is the same text in install.ps1, because each script is copied alone
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

function Assert-LotwiseInstall([string]$Root) {
  if (-not (Test-LotwiseInstall $Root)) { throw "This folder does not look like a Lotwise install, nothing was removed: $Root" }
}

function Remove-InstalledFiles([string]$Root) {
  foreach ($name in 'extension', 'extension.old', 'extension.new', 'guide.html') {
    $path = Join-Path $Root $name
    if (-not (Test-Path -LiteralPath $path)) { continue }
    try { Remove-Item -LiteralPath $path -Recurse -Force } catch {
      throw "Could not remove $path ($($_.Exception.Message)). If Chrome is open, close it or click Remove on Lotwise in chrome://extensions, then run the uninstall again."
    }
  }
}

# Order: the files (except the marker), then the registry entry, then the marker. If the files cannot be removed, the
# Installed apps entry and the marker are still there, so the uninstall can be run again from Settings. While the marker
# is there the folder still counts as a Lotwise install, so a rerun can finish whatever a failed run left behind.
function Remove-UninstallEntry([string]$Key) {
  if (-not (Test-Path -LiteralPath $Key)) { return }
  try { Remove-Item -LiteralPath $Key -Recurse -Force } catch {
    throw "Could not remove the registry entry $Key ($($_.Exception.Message)). Run the uninstall again, or delete that key by hand."
  }
}

function Remove-InstallMarker([string]$Root) {
  $marker = Join-Path $Root 'lotwise-install.json'
  if (-not (Test-Path -LiteralPath $marker)) { return }
  try { Remove-Item -LiteralPath $marker -Force } catch {
    throw "Could not remove $marker ($($_.Exception.Message)). Run the uninstall again, or delete the folder $Root by hand."
  }
}

# This script may live inside InstallRoot, and Windows cannot delete a running script's folder,
# so a detached cmd finishes the job after this process exits.
function Start-SelfRemoval([string]$Root) {
  $self = Join-Path $Root 'uninstall.ps1'
  $others = @(Get-ChildItem -LiteralPath $Root -Force | Where-Object { $_.Name -ne 'uninstall.ps1' })
  $line = '/c ping -n 3 127.0.0.1 >nul & del /f /q "' + $self + '"'
  if ($others.Count -eq 0) { $line += ' & rmdir "' + $Root + '"' }
  Start-Process -FilePath 'cmd.exe' -ArgumentList $line -WindowStyle Hidden
}

function Show-Done {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show("Lotwise's files are removed from this PC. To finish, open chrome://extensions in Chrome and click Remove on Lotwise.", 'Lotwise Setup')
}

function Show-Failure([string]$Message) {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show("Lotwise could not be removed. $Message", 'Lotwise Setup')
}

try {
  $DefaultInstallRoot = Get-DefaultInstallRoot
  # A value that was passed but is empty is an error, not a request for the default.
  if (-not $PSBoundParameters.ContainsKey('InstallRoot')) { $InstallRoot = $DefaultInstallRoot }
  if (-not $PSBoundParameters.ContainsKey('UninstallKey')) { $UninstallKey = $DefaultUninstallKey }
  $InstallRoot = Resolve-InstallRoot $InstallRoot
  # The final cmd command line would expand a percent sign as a variable, so such a folder is refused (install refuses it too).
  if ($InstallRoot.Contains('%')) { throw "The install folder name cannot contain a percent sign, so nothing was removed: $InstallRoot" }
  Assert-UninstallKey $UninstallKey
  Assert-LotwiseInstall $InstallRoot
  Assert-KeyIsFreeOrLotwise $UninstallKey
  Remove-InstalledFiles $InstallRoot
  Remove-UninstallEntry $UninstallKey
  Remove-InstallMarker $InstallRoot
  Start-SelfRemoval $InstallRoot
  if (-not $NoLaunch) { Show-Done }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  if (-not $NoLaunch) { Show-Failure $_.Exception.Message }
  exit 1
}
exit 0
