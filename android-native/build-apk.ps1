$ErrorActionPreference = "Stop"
Write-Host "=== GiaToc Name Hub - Android Native Voice ===" -ForegroundColor Cyan
if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
    Write-Host "Chưa có ANDROID_HOME/ANDROID_SDK_ROOT. Cài Android SDK Command-line Tools trước." -ForegroundColor Yellow
    exit 1
}
if (-not (Get-Command gradle -ErrorAction SilentlyContinue)) {
    Write-Host "Chưa có Gradle 8.13 trong PATH." -ForegroundColor Yellow
    exit 1
}
gradle :app:assembleDebug
Write-Host "APK: app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor Green
