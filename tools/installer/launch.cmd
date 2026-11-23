@echo off
rem Starts install.ps1 beside this file. Exit codes: 0 = installed, 3 = failed after install.ps1 showed its own message.
rem Any other code means the script never got as far as showing a message, usually because this PC blocks PowerShell scripts.
rem The message command below only shows that message. It does not run, read or work around the installer script.
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0install.ps1"
set LOTWISE_RC=%ERRORLEVEL%
if %LOTWISE_RC%==0 exit /b 0
if %LOTWISE_RC%==3 exit /b 3
rem LOTWISE_SETUP_NO_DIALOG is for the tests: print the message instead of opening a message box.
if defined LOTWISE_SETUP_NO_DIALOG goto print
powershell.exe -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('Lotwise Setup could not start. The usual cause is that this PC does not allow PowerShell scripts (a policy set by your organization or Windows settings). Nothing was installed. You can still load Lotwise by hand: see INSTALL in the project''s README.', 'Lotwise Setup')"
exit /b %LOTWISE_RC%
:print
>&2 echo Lotwise Setup could not start. The usual cause is that this PC does not allow PowerShell scripts (a policy set by your organization or Windows settings). Nothing was installed. You can still load Lotwise by hand: see INSTALL in the project's README.
exit /b %LOTWISE_RC%
