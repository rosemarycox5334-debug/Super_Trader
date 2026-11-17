@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================================
echo   Super Agent Workbench  (Tou Yan Gong Zuo Tai)
echo ============================================================
echo.

REM ---- find python ----
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Please install Python 3.10+ and add it to PATH.
  pause
  exit /b 1
)

REM ---- check backend deps, install if missing ----
python -c "import fastapi, uvicorn, httpx" >nul 2>nul
if errorlevel 1 (
  echo [INFO] Installing backend deps: fastapi / uvicorn / httpx ...
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo [ERROR] Install failed. Run manually: pip install -r requirements.txt
    pause
    exit /b 1
  )
)

REM ---- Model: connects to Command Code by default. ----
REM Key is auto-loaded from D:\cl\commandcode_key.txt (no setup needed).
REM To override, uncomment and edit the lines below:
REM set "ST_MODEL_API_KEY=your_key_here"
REM set "ST_MODEL_BASE_URL=https://api.commandcode.ai/provider/v1"
REM set "ST_MODEL_NAME=deepseek/deepseek-v4.1-flash"
REM set "ST_MODEL_KEY_FILE=D:\cl\commandcode_key.txt"

echo [INFO] Model gateway: Command Code (key auto-loaded from commandcode_key.txt if present).
echo.
echo Starting... browser will open http://127.0.0.1:8000 shortly.
echo Close this window to stop the server.
echo.

REM ---- open browser after a short delay ----
start "" /b cmd /c "timeout /t 3 >nul & start http://127.0.0.1:8000"

REM ---- run server in foreground (Ctrl+C or close window to stop) ----
python -m backend.serve

echo.
echo Server stopped.
pause
endlocal
