@echo off
setlocal

:: Build a local Android preview APK on Windows.
:: Produces a release-variant APK for testing without a dev client.
::
:: Usage: scripts\build-preview-apk.bat
:: Output: builds\preview\locate720-v<version>-preview-<timestamp>-<git>.apk

cd /d "%~dp0\.."

:: --- Find Java JDK ---
if not "%JAVA_HOME%"=="" (
    if exist "%JAVA_HOME%\bin\java.exe" goto :javaok
)

:: Fall back to Android Studio's bundled JDK
if exist "C:\Program Files\Android\Android Studio\jbr\bin\java.exe" (
    set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
    goto :javaok
)

:: Fall back to common JDK 17 locations
if exist "C:\Program Files\Eclipse Adoptium\jdk-17" (
    set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17"
    goto :javaok
)
if exist "C:\Program Files\Java\jdk-17" (
    set "JAVA_HOME=C:\Program Files\Java\jdk-17"
    goto :javaok
)

echo ERROR: JAVA_HOME is not set and a JDK 17 was not found.
echo Install JDK 17, set JAVA_HOME, and try again.
exit /b 1

:javaok

:: --- Find Android SDK ---
if "%ANDROID_HOME%"=="" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not exist "%ANDROID_HOME%" (
    echo ERROR: ANDROID_HOME is not set and %ANDROID_HOME% does not exist.
    echo Install Android Studio and set ANDROID_HOME.
    exit /b 1
)

set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

:: Disable Sentry auto-upload for local builds unless an auth token is present.
if not defined SENTRY_AUTH_TOKEN if not defined SENTRY_DISABLE_AUTO_UPLOAD set "SENTRY_DISABLE_AUTO_UPLOAD=true"

set "BUILD_DIR=builds\preview"

for /f "usebackq tokens=*" %%a in (`powershell -Command "Get-Date -Format 'yyyyMMdd-HHmmss'"`) do set "TIMESTAMP=%%a"
for /f "usebackq tokens=*" %%a in (`git rev-parse --short HEAD 2^>nul`) do set "GIT_SHORT=%%a"
if "%GIT_SHORT%"=="" set "GIT_SHORT=unknown"
for /f "usebackq tokens=*" %%v in (`powershell -Command "(Get-Content package.json | ConvertFrom-Json).version"`) do set "APP_VERSION=%%v"

if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"

echo ============================================
echo  Locate720 Preview APK Build
echo ============================================
echo JAVA_HOME:    %JAVA_HOME%
echo ANDROID_HOME: %ANDROID_HOME%
echo Version:      %APP_VERSION%
echo Git:          %GIT_SHORT%
echo Timestamp:    %TIMESTAMP%
echo ============================================
echo.

echo [1/3] Prebuilding Android project...
if exist "android" powershell -Command "Get-ChildItem 'android' -Force | Remove-Item -Recurse -Force"
call npx expo prebuild --clean --platform android
if errorlevel 1 (
    echo Prebuild failed, retrying once...
    powershell -Command "Start-Sleep -Seconds 2; if (Test-Path 'android') { Get-ChildItem 'android' -Force | Remove-Item -Recurse -Force }"
    call npx expo prebuild --clean --platform android
    if errorlevel 1 (
        echo ERROR: expo prebuild failed.
        exit /b 1
    )
)

:: Bump JVM memory to avoid Metaspace OOM during build
powershell -Command "(Get-Content android\gradle.properties) -replace 'org.gradle.jvmargs=.*', 'org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m' | Set-Content android\gradle.properties"

echo.
echo [2/3] Building release APK with Gradle...
cd android
call gradlew.bat assembleRelease -x lintVitalAnalyzeRelease -x lintAnalyzeRelease
if errorlevel 1 (
    echo ERROR: Gradle build failed.
    exit /b 1
)

echo.
echo [3/3] Copying APK to output directory...
set "OUTPUT_NAME=locate720-v%APP_VERSION%-preview-%TIMESTAMP%-%GIT_SHORT%.apk"
copy "app\build\outputs\apk\release\app-release.apk" "..\%BUILD_DIR%\%OUTPUT_NAME%"
if errorlevel 1 (
    echo ERROR: Failed to copy APK.
    exit /b 1
)

echo.
echo ============================================
echo  BUILD COMPLETE
echo  Output: %BUILD_DIR%\%OUTPUT_NAME%
echo ============================================
echo  Sideload this APK onto any Android device.
echo  The app connects to the OVH server automatically.
echo ============================================
