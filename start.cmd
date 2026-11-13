@echo off
setlocal
pushd "%~dp0" || goto bad_folder
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if not errorlevel 1 goto run_py
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if not errorlevel 1 goto run_python
echo InkTrace requires Python 3.10 or newer. No compatible Python was found.
echo Install Python, or check that py or python works in PowerShell.
set "APP_EXIT=1"
goto finish

:run_py
py -3 -X utf8 -u app.py %*
set "APP_EXIT=%errorlevel%"
goto finish

:run_python
python -X utf8 -u app.py %*
set "APP_EXIT=%errorlevel%"

:finish
popd
if not "%APP_EXIT%"=="0" echo InkTrace stopped with exit code %APP_EXIT%. See the message above.
pause
exit /b %APP_EXIT%

:bad_folder
echo Cannot open the InkTrace folder. Extract the full ZIP before launching.
pause
exit /b 1
