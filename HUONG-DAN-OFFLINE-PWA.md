# GiaTộc ┊Name Hub v1.3.0 — Chế độ Offline nâng cao

## Mục tiêu
Sau khi người dùng đã mở website và đăng nhập online ít nhất một lần trên thiết bị, PWA có thể mở lại khi mất mạng.

## Dùng được khi không có mạng
- Mở giao diện PWA và chuyển giữa các trang.
- Xem hồ sơ, thành tích, danh sách thành viên, chat và thư viện nhạc đã được lưu gần nhất.
- Tạo Avatar khung Role.
- Tạo mã QR trên thiết bị.
- Gộp PDF, ảnh → PDF và tối ưu cấu trúc PDF trên thiết bị.
- Tạo bảng đấu loại trực tiếp.
- Tạo banner tuyển thành viên.
- Cắt, xoay, watermark và chuyển định dạng ảnh.
- Chỉnh hồ sơ dạng văn bản; thay đổi được xếp hàng chờ đồng bộ.
- Gửi chat; tin nhắn hiện trạng thái "Chờ đồng bộ" rồi tự gửi khi có mạng.
- Thêm link nhạc; thay đổi được xếp hàng chờ đồng bộ.
- Chọn avatar mới; file được giữ trong IndexedDB và chờ upload khi có mạng.

## Cần mạng
- Đăng nhập/đăng ký lần đầu.
- Phát các link nhạc bên ngoài nếu file âm thanh chưa có sẵn trên thiết bị.
- Quản trị: đổi Role, ban/unban, trao thành tích, nhật ký và backup.
- Xóa tin nhắn chat.

## Cơ chế
- Service Worker cache App Shell để website mở được offline.
- IndexedDB lưu snapshot của `/api/me`, `/api/members`, `/api/chat`, `/api/music`.
- IndexedDB lưu hàng đợi thao tác offline.
- Background Sync được dùng khi trình duyệt hỗ trợ; nếu không, app sẽ đồng bộ khi mở lại và có mạng.
- QRCode và PDFLib được đóng thành vendor local bằng `postinstall`, vì vậy các công cụ QR/PDF có thể chạy trực tiếp trên thiết bị.

## Khi deploy Railway
1. Giữ Volume mount tại `/app/storage` như bản v1.2.2.
2. Push toàn bộ source v1.3.0 lên GitHub.
3. Railway chạy `npm install`; script `postinstall` sẽ tạo:
   - `public/vendor/qrcode.bundle.js`
   - `public/vendor/pdf-lib.min.js`
4. Deploy xong, mở web online ít nhất một lần để Service Worker tải App Shell.
5. Cài PWA hoặc mở website trên Android/Chrome.
6. Tắt Wi‑Fi/dữ liệu di động và mở lại để test.

## Nếu bản cũ vẫn hiện
Service Worker cũ có thể còn cache. Mở website online một lần, đóng hoàn toàn rồi mở lại. Bản v1.3.0 dùng cache mới `giatoc-app-1.3.0`.

## Riêng tư trên thiết bị
Dữ liệu offline được lưu trên chính thiết bị/trình duyệt. Mật khẩu không được lưu vào cache offline. Có nút `🧹 Xóa dữ liệu offline` để xóa snapshot và hàng đợi của GiaTộc ┊Name Hub trên thiết bị.
