@echo off
REM Android Build Script for ExoMind
REM Usage: run-android-build.bat

echo Setting up Java 17...
set JAVA_HOME=D:\data\AndroidStudioSDK\java17
set PATH=%JAVA_HOME%\bin;%PATH%

echo Building Android debug APK...
cd /d %~dp0
bun run tauri android build --debug

pause
