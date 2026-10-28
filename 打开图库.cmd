@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 goto FILEMODE
python -X utf8 "%~dp0scripts\serve.py"
if not errorlevel 1 exit /b
:FILEMODE
start "" "%~dp0index.html"
exit /b
