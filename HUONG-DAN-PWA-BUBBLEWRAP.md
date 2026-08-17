# GiaTộc ┊Name Hub — PWA + Bubblewrap

Bản này vẫn là **website**. PWA cho phép cài từ trình duyệt, còn Bubblewrap tạo APK/AAB Android bằng Trusted Web Activity (TWA) mà không cần mở Android Studio.

## 1. Deploy website trước

Đưa toàn bộ source này lên host đang chạy:

`https://giatoc-name-hub.robloxdatgaming.chatgpt.site/`

Sau khi deploy, kiểm tra các URL sau trả về bình thường:

- `/manifest.webmanifest`
- `/sw.js`
- `/icons/icon-512.png`
- `/offline.html`

## 2. Cài Node.js

Trong PowerShell:

```powershell
node -v
npm -v
```

Bubblewrap CLI hiện yêu cầu Node.js 14.15+; Node.js LTS mới hơn cũng phù hợp.

## 3. Cách dễ nhất: chạy script có sẵn

Mở PowerShell trong thư mục project rồi chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-android.ps1
```

Script dùng Bubblewrap 1.25.0 và tạo project Android trong:

`android-twa/`

Lần đầu `bubblewrap init` sẽ hỏi tên app, package ID và thông tin khóa ký. Nên dùng package ID:

`com.robloxdatgaming.giatocnamehub`

**Giữ kỹ file keystore và mật khẩu.** Nếu mất khóa ký, bạn có thể gặp khó khăn khi cập nhật cùng một app sau này.

## 4. Cách chạy thủ công

```powershell
npm install -g @bubblewrap/cli@1.25.0
bubblewrap init --manifest "https://giatoc-name-hub.robloxdatgaming.chatgpt.site/manifest.webmanifest" --directory ".\android-twa"
cd .\android-twa
bubblewrap build
```

Kết quả thường gồm:

- `app-release-signed.apk` — cài trực tiếp để thử.
- `app-release-bundle.aab` — gói dùng khi phát hành qua Google Play.

## 5. Digital Asset Links — bắt buộc để ẩn thanh trình duyệt

TWA chỉ chạy full-screen đúng nghĩa khi Android xác minh app và website thuộc cùng chủ sở hữu.

Bubblewrap có thể quản lý fingerprint và tạo `assetlinks.json`:

```powershell
cd .\android-twa
bubblewrap fingerprint list
bubblewrap fingerprint generateAssetLinks --output assetlinks.json
```

Nếu fingerprint chưa có trong `twa-manifest.json`, thêm fingerprint SHA-256 thật:

```powershell
bubblewrap fingerprint add "AA:BB:CC:..." --name "release"
bubblewrap fingerprint generateAssetLinks --output assetlinks.json
```

Sau đó đặt file thật vào:

`public/.well-known/assetlinks.json`

và **deploy website lại**.

Không dùng `assetlinks.template.json` nguyên trạng; file đó chỉ là mẫu.

### Nếu phát hành Google Play

Nếu bật Play App Signing, chứng thư ký phân phối của Google Play có thể khác khóa upload Bubblewrap. Khi đó cần thêm SHA-256 của **App signing key certificate** trong Play Console vào `assetlinks.json`.

## 6. Cập nhật website sau này

Các thay đổi HTML/CSS/JS/data trên website được app TWA tải từ website, nên phần lớn cập nhật giao diện/chức năng web **không cần build APK lại**.

Chỉ cần build APK/AAB mới khi thay đổi những phần Android như package ID, version app, icon Android, cấu hình TWA hoặc khóa ký.

## 7. PWA trên Android không cần APK

Người dùng Chrome Android có thể mở website và chọn **Cài ứng dụng**. Bản source này cũng có nút `📲 Cài ứng dụng` khi trình duyệt cho phép cài PWA.
