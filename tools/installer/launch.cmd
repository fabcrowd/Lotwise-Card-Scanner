@echo off
rem Starts install.ps1 beside this file. Exit codes: 0 = installed, 3 = failed after install.ps1 showed its own message.
rem Any other code means the script never got as far as showing a message, usually because this PC blocks PowerShell scripts.
rem The message command below only shows that message. It does not run, read or work around the installer script.
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0install.ps1"
set SWEEP_RC=%ERRORLEVEL%
if %SWEEP_RC%==0 exit /b 0
if %SWEEP_RC%==3 exit /b 3
rem SWEEP_SETUP_NO_DIALOG is for the tests: print the message instead of opening a message box.
if defined SWEEP_SETUP_NO_DIALOG goto print
powershell.exe -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('Sweep Setup could not start. The usual cause is that this PC does not allow PowerShell scripts (a policy set by your organization or Windows settings). Nothing was installed. You can still load Sweep by hand: see INSTALL in the project''s README.', 'Sweep Setup')"
exit /b %SWEEP_RC%
:print
>&2 echo Sweep Setup could not start. The usual cause is that this PC does not allow PowerShell scripts (a policy set by your organization or Windows settings). Nothing was installed. You can still load Sweep by hand: see INSTALL in the project's README.
exit /b %SWEEP_RC%
