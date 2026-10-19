@echo off
echo ===================================================
echo   COMPILING SMART PARKING C CORE ENGINE (DLL)
echo ===================================================

gcc -Wall -Wextra -O2 -DBUILDING_PARKING_DLL -shared -o parking_engine.dll parking_engine.c

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Compiled parking_engine.dll successfully!
) else (
    echo [ERROR] Compilation failed. Ensure GCC / MinGW is installed in PATH.
)
pause
