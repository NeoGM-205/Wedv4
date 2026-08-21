# GiaTộc ┊Name Hub v1.9.0 — Web + PWA + Railway 24/7 + Bubblewrap

Đây vẫn là **website**. PWA/Bubblewrap chỉ là lớp để cài website lên Android khi cần, không chuyển source thành ứng dụng desktop.



## Nâng cấp v1.9.0 — Phòng voice & Tối ưu chạy nền
- 🎙️ Phòng voice chơi game bằng WebRTC P2P, có phòng công khai/khóa mã, mute/deafen và đổi micro.
- ⚡ Tối ưu chạy nền: dừng polling/animation không cần thiết khi app ẩn, giữ voice khi hệ điều hành cho phép và tự nối lại khi quay lại.
- 🛡️ Chống spam nâng cao cho đăng ký, chat, upload và voice.
- 🧹 Tự dọn session/log/file upload không còn dùng.
- 🚨 Cảnh báo Storage/Backup và trạng thái Voice trong System Status.
- ⚙️ Cài đặt hệ thống tập trung cho Boss.
- Hướng dẫn chi tiết: `HUONG-DAN-V1.9.md`.

## Nâng cấp v1.8.0 — Professional System
- Permission Matrix: Boss cấu hình quyền chi tiết cho Kì Cựu/Member.
- Audit Log có phân loại, tìm kiếm và lịch sử thao tác quản trị.
- Account Center: tổng quan tài khoản, phiên đăng nhập, 2FA, quyền và xuất dữ liệu cá nhân.
- Notification Preferences + Quiet Hours.
- Moderation Workflow: Open → In Review → Resolved/Dismissed, có người phụ trách và ghi chú nội bộ.
- System Status: Backend, Database, Storage, Push, Backup, uptime và phiên bản.
- Version & Cache Manager: kiểm tra Service Worker, cập nhật ngay và xóa cache ứng dụng.

## Chạy local
1. Cài Node.js 20+.
2. Mở terminal trong thư mục project.
3. Chạy `npm install`.
4. Sao chép `.env.example` thành `.env` nếu muốn cấu hình riêng.
5. Chạy `npm start`.
6. Mở `http://localhost:3000`.

Tài khoản đăng ký đầu tiên tự động là **Boss**. Các tài khoản sau là **Member**.

## Các chức năng hiện có
### Tài khoản & cộng đồng
- Đăng ký / đăng nhập, hash mật khẩu bcrypt.
- Giới hạn đăng nhập sai bằng rate-limit.
- Hồ sơ thành viên: tên hiển thị, giới thiệu, game đang chơi, ID game, Discord, avatar.
- Role Boss / Kì Cựu / Member với avatar/khung Role.
- Danh sách thành viên và trạng thái online gần đúng.
- Thành tích thành viên; Boss/Kì Cựu có thể trao thành tích từ Trung tâm quản trị.
- Trò chuyện cộng đồng bằng REST polling; chủ tin nhắn hoặc quản trị viên có thể xóa.
- Thư viện nhạc lưu link trong dữ liệu website.

### Công cụ
- Tạo avatar khung Role 512×512 và tải PNG.
- Trình tạo mã QR và tải PNG.
- PDF: gộp nhiều PDF, chuyển PNG/JPG thành PDF, nén/tối ưu cấu trúc PDF cơ bản.
- Trình tạo bảng đấu loại trực tiếp tối đa 64 người/đội.
- Tạo banner tuyển thành viên 1600×400; đây chỉ là công cụ thiết kế, **không có hệ thống Bang hội trên website**.
- Công cụ ảnh chạy phía trình duyệt: cắt theo tọa độ/kích thước, xoay, watermark, đổi PNG/JPG/WebP.

### Quản trị
- Tìm thành viên.
- Boss đổi Role.
- Cấm / mở cấm tài khoản.
- Trao thành tích.
- Xem nhật ký quản trị.
- Backup dữ liệu thủ công vào `backups/`.

## Dữ liệu
Bản này dùng `data/db.json` để dễ chạy thử. Các thư mục `data`, `backups`, `public/uploads` tự tạo khi server khởi động.

## File đã sửa/thêm ở v1.2.0
- `server.js` — API chat, hồ sơ nâng cao, thành tích, QR, PDF.
- `public/index.html` — dashboard và toàn bộ trang công cụ.
- `public/app.js` — giao diện, chat và các công cụ Canvas.
- `public/style.css` — giao diện các module mới.
- `public/manifest.webmanifest` — shortcut PWA.
- `public/sw.js` — tăng cache version.
- `package.json` — thêm `pdf-lib` và `qrcode`.
- `data/db.json` — thêm vùng dữ liệu chat.

## PWA + Android không cần Android Studio
- Web Manifest: `public/manifest.webmanifest`
- Service Worker: `public/sw.js`
- Trang offline: `public/offline.html`
- Icon PWA/Android: `public/icons/`
- Script tạo TWA Android: `build-android.ps1`
- Hướng dẫn: `HUONG-DAN-PWA-BUBBLEWRAP.md`

Sau khi deploy bản web này lên domain, bạn có thể cài trực tiếp dạng PWA hoặc dùng Bubblewrap để xuất APK/AAB.

## Ghi chú trước khi public lớn
Bản JSON phù hợp cho cộng đồng nhỏ/chạy thử. Khi public đông người nên chuyển dữ liệu sang PostgreSQL/MySQL, dùng session store bền vững, HTTPS, SESSION_SECRET cố định, CAPTCHA server-side và backup ngoài máy chủ.

## Bản vá v1.2.1 - sửa nút không phản hồi

- Bỏ toàn bộ `onclick/onchange/oninput/onkeydown` inline trong giao diện chính.
- Dùng event delegation trong `public/app.js` cho các nút và input.
- Sửa các nút động trong Chat và Trung tâm quản trị.
- Service Worker đổi cache sang `giatoc-name-hub-v1.2.1`.
- HTML dùng cache-busting cho `style.css`, `app.js`, `pwa.js`.
- Server gửi `Cache-Control: no-cache` cho giao diện/JS/PWA để tránh chạy file JS cũ.
- Thêm `/api/health` để kiểm tra backend.
- Nếu mở `index.html` bằng `file://`, web sẽ cảnh báo phải chạy bằng `npm start`.

### Cách chạy đúng

```powershell
npm install
npm start
```

Sau đó mở `http://localhost:3000`.

Nếu đã từng cài PWA/bản web cũ, đóng tab cũ rồi mở lại. Nếu vẫn thấy giao diện cũ, xóa dữ liệu trang/cache của domain một lần để bỏ Service Worker cũ.


## v1.3.0 — Railway 24/7 + Persistent Storage

Bản này gom toàn bộ dữ liệu phát sinh vào **một thư mục duy nhất** `storage/`:

```text
storage/
├── data/       # tài khoản, role, chat, thành tích, nhạc, ban, log
├── uploads/    # avatar và ảnh upload
├── backups/    # backup thủ công
└── sessions/   # dành cho dữ liệu phiên nếu nâng cấp session store sau này
```

### Railway
1. Mở Volume `wedandroid-volume`.
2. Đổi **Mount Path** thành:

```text
/app/storage
```

3. Deploy lại service `WedAndroid`.
4. Mở:

```text
https://TEN-DOMAIN-CUA-BAN/api/health
```

Nếu thấy `version: 1.3.0` và `storage.root` là `/app/storage` thì đúng.

### Tự migrate dữ liệu cũ
- Nếu Volume cũ từng mount `/app/data`, file `db.json` ở root Volume sẽ được copy sang `storage/data/db.json` khi bản mới chạy lần đầu.
- Nếu source cũ có `data/db.json`, `public/uploads/` hoặc `backups/`, server cũng cố gắng copy sang `storage/` mà không ghi đè file đã có.

### Lưu ý
- Không đưa thư mục `storage/` chứa dữ liệu thật lên GitHub.
- Trên Railway nên đặt biến `SESSION_SECRET` cố định và đủ dài.
- `PORT` do Railway cấp tự động; server đã lắng nghe trên `0.0.0.0`.


## Offline nâng cao v1.3.0

Bản này bổ sung Service Worker App Shell, IndexedDB snapshot + hàng đợi đồng bộ, Background Sync, QR/PDF chạy phía trình duyệt và trạng thái Online/Offline. Xem `HUONG-DAN-OFFLINE-PWA.md`.


## v1.4.0 — Community Advanced
- Đồng bộ Offline thông minh: trạng thái pending/error, số lần thử và retry khi có mạng.
- Trung tâm thông báo: thành tích, đổi Role, mention và reply trong chat.
- Tìm đồng đội: game, chế độ, server, giờ chơi, số người, tự hết hạn; tạo bài offline rồi đồng bộ.
- Chat nâng cao: phòng theo game, reply, @mention, reaction.
- Bảo mật: đổi mật khẩu, xem phiên đăng nhập và đăng xuất thiết bị khác.
- Vẫn giữ Railway Volume `/app/storage` và toàn bộ công cụ v1.3.0.


## v1.5.0 — Social, Push & Reliability

- Push Notification Web/PWA với VAPID key lưu bền vững trong Railway Volume.
- Bạn bè: gửi/chấp nhận/từ chối/hủy kết bạn.
- DM 1-1 giữa bạn bè; DM gửi khi offline được xếp hàng chờ đồng bộ.
- Báo cáo thành viên, chat, bài tìm đồng đội và DM.
- Boss/Kì Cựu có Trung tâm báo cáo và Timeout/Mute theo phút.
- Backup tự động theo `AUTO_BACKUP_HOURS`, giữ số bản theo `BACKUP_KEEP`, có danh sách/Restore/Delete. Restore yêu cầu nhập lại mật khẩu.
- Offline Queue Center: xem pending/error/conflict, retry, hủy và xử lý xung đột hồ sơ.
- Xung đột hồ sơ dùng `profileUpdatedAt`; có lựa chọn giữ bản thiết bị hoặc bản máy chủ.

### Railway Variables gợi ý

```env
NODE_ENV=production
SESSION_SECRET=chuoi-bi-mat-rat-dai-va-co-dinh
PUBLIC_ORIGIN=https://domain-cua-ban
VAPID_SUBJECT=https://domain-cua-ban
AUTO_BACKUP_HOURS=6
BACKUP_KEEP=30
```

Volume vẫn mount tại:

```text
/app/storage
```


## v1.6.0 — Smart Community

- 🎯 Ghép đồng đội tự động theo game/chế độ/server/giờ chơi.
- 🏆 Level + XP + huy hiệu có cooldown chống farm chat.
- 📅 Trung tâm sự kiện: tạo, đăng ký, check-in bằng mã, nhận XP.
- 👤 Profile Card 1200×630 có avatar, Role, Level, huy hiệu và QR.
- 🔐 2FA TOTP + Recovery Codes, không cần dịch vụ bên ngoài.
- 📈 Analytics quản trị: thành viên, online, chat 24h, tìm đội, sự kiện, báo cáo, backup, storage, top XP.
- 💬 Chat nâng cao: tìm kiếm, sửa tin 30 phút, ghim tin, gửi ảnh tối đa 3MB.

Không có Game Hub thông minh và không có hệ thống Bang hội trên website.


## v1.7.0 — Unique Community

- Smart Match Score v2: lịch rảnh + phong cách + hoạt động gần đây.
- Dynamic Role Aura theo trạng thái.
- 🎬 Highlight Vault.
- 🖼️ Auto Profile Showcase.
- 🏅 Achievement Composer cho Boss/Kì Cựu.
- 🛰️ Live Community Pulse.
- Smart Availability trong hồ sơ.
- 🧰 Personal Toolbox tối đa 6 mục.
- ✦ Prestige System.
- 👤 Profile Card dùng icon mới.
