$ErrorActionPreference = "Stop"

$BubblewrapVersion = "1.25.0"
$ManifestUrl = "https://giatoc-name-hub.robloxdatgaming.chatgpt.site/manifest.webmanifest"
$ProjectDir = Join-Path $PSScriptRoot "android-twa"

Write-Host "=== GiaToc Name Hub - PWA -> Android TWA ===" -ForegroundColor Cyan
Write-Host "Manifest: $ManifestUrl"
Write-Host "Bubblewrap: $BubblewrapVersion"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Chua tim thay Node.js. Hay cai Node.js truoc."
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw "Chua tim thay npx/npm. Hay cai Node.js kem npm truoc."
}

Write-Host "`n[1/3] Kiem tra PWA da deploy..." -ForegroundColor Yellow
try {
  $r = Invoke-WebRequest -Uri $ManifestUrl -UseBasicParsing -TimeoutSec 20
  if ($r.StatusCode -ne 200) { throw "HTTP $($r.StatusCode)" }
} catch {
  throw "Khong doc duoc manifest tren website. Hay deploy ban PWA nay len website truoc, roi chay lai. Chi tiet: $($_.Exception.Message)"
}

Write-Host "`n[2/3] Tao Android TWA project..." -ForegroundColor Yellow
if (Test-Path $ProjectDir) {
  Write-Host "Thu muc android-twa da ton tai. Khong init lai de tranh mat khoa ky/cau hinh." -ForegroundColor DarkYellow
} else {
  & npx -y "@bubblewrap/cli@$BubblewrapVersion" init --manifest $ManifestUrl --directory $ProjectDir
  if ($LASTEXITCODE -ne 0) { throw "bubblewrap init that bai." }
}

Write-Host "`n[3/3] Build APK/AAB..." -ForegroundColor Yellow
Push-Location $ProjectDir
try {
  & npx -y "@bubblewrap/cli@$BubblewrapVersion" build
  if ($LASTEXITCODE -ne 0) { throw "bubblewrap build that bai." }

  $assetLinks = Join-Path $ProjectDir "assetlinks.json"
  if (Test-Path $assetLinks) {
    $destDir = Join-Path $PSScriptRoot "public\.well-known"
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    Copy-Item $assetLinks (Join-Path $destDir "assetlinks.json") -Force
    Write-Host "`nDa copy assetlinks.json vao public/.well-known/." -ForegroundColor Green
    Write-Host "QUAN TRONG: deploy lai website sau buoc nay de TWA duoc xac minh." -ForegroundColor Yellow
  } else {
    Write-Host "`nKhong thay assetlinks.json tu build. Dung lenh fingerprint generateAssetLinks theo HUONG-DAN-PWA-BUBBLEWRAP.md." -ForegroundColor Yellow
  }

  Write-Host "`nAPK: $ProjectDir\app-release-signed.apk" -ForegroundColor Green
  Write-Host "AAB: $ProjectDir\app-release-bundle.aab" -ForegroundColor Green
} finally {
  Pop-Location
}
