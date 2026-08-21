# GiaTộc ┊Name Hub v1.9.0 — Phòng voice & Tối ưu chạy nền

## Tính năng mới

### 🎙️ Phòng voice chơi game
- Tạo phòng voice theo game, tên phòng, số người và mã phòng tùy chọn.
- WebRTC P2P: âm thanh đi trực tiếp giữa các thành viên, máy chủ chỉ chuyển tín hiệu kết nối và không ghi âm.
- Tắt/bật mic, tắt/bật âm thanh phòng, đổi micro khi đang ở trong phòng.
- Tự nối lại khi mất mạng ngắn hoặc khi trình duyệt tạm dừng kết nối rồi người dùng quay lại ứng dụng.
- Tối đa 8 người/phòng; khuyến nghị 2–6 người để nhẹ máy và ít tốn băng thông.
- Phòng voice là phòng tạm thời: tự xóa sau khoảng 10 phút không còn ai và sẽ mất khi Railway redeploy/restart. Không lưu/ghi âm nội dung voice.

### ⚡ Tối ưu chạy nền
- Khi PWA/tab bị ẩn: dừng refresh chat, dừng refresh danh sách voice và tạm dừng hiệu ứng Aura.
- Giảm nhịp cập nhật đồng hồ/presence; nếu đang voice thì vẫn giữ heartbeat nhẹ.
- Thông báo nền ưu tiên Web Push + Service Worker thay vì polling liên tục.
- Khi quay lại ứng dụng: tự làm mới thành viên/thông báo và khôi phục voice nếu cần.

> Lưu ý: Android có thể tạm dừng PWA khi màn hình tắt hoặc hệ thống thiếu RAM. PWA/TWA không thể bảo đảm chạy voice nền 100% như ứng dụng Android native có Foreground Service. Bản này tối ưu để nhẹ và tự khôi phục kết nối, không tìm cách vượt giới hạn của hệ điều hành.

### 🛡️ Chống spam và vận hành
- Đăng ký: giới hạn 5 lần/IP/giờ.
- Chat: rate limit + cooldown riêng theo tài khoản.
- Upload: giới hạn số lượt upload theo thời gian.
- Tạo/kết nối voice: rate limit riêng.

### 🧹 Tự dọn dữ liệu
- Dọn session hết hạn.
- Cắt Audit Log cũ theo số ngày Boss cấu hình.
- Xóa thông báo rất cũ và bài tìm đội hết hạn lâu.
- Xóa file upload không còn được dữ liệu nào sử dụng sau thời gian an toàn.

### 🚨 Cảnh báo hệ thống
Trang Trạng thái hệ thống cảnh báo nếu Storage không ghi được, dung lượng vượt ngưỡng hoặc backup quá cũ.

### ⚙️ Cài đặt hệ thống tập trung
Boss có thể chỉnh trực tiếp trên giao diện:
- Cho phép/tắt đăng ký tài khoản mới.
- Cooldown chat.
- Số người/phòng voice và tổng số phòng voice.
- Chu kỳ tự dọn.
- Số ngày giữ Audit Log.
- Thời gian giữ file upload không còn tham chiếu.
- Ngưỡng cảnh báo Storage.

## Railway và Voice
Railway hỗ trợ WebSocket nên phần signaling voice dùng chung domain hiện tại. Không cần mở port riêng.

Cấu hình tối thiểu vẫn giống các bản trước. Nếu voice giữa một số mạng không kết nối được, cấu hình thêm TURN trong Railway Variables:

```env
WEBRTC_TURN_URL=turn:turn.example.com:3478
WEBRTC_TURN_SECRET=shared-secret-cua-coturn
WEBRTC_TURN_TTL_SECONDS=3600
```

STUN mặc định đủ cho nhiều mạng, nhưng TURN giúp kết nối ổn định hơn khi hai người dùng nằm sau NAT/firewall nghiêm ngặt. Bản v1.9 hỗ trợ Coturn `use-auth-secret` để tạo credential TURN tạm thời; nếu không dùng chế độ này vẫn có thể đặt `WEBRTC_TURN_USERNAME` và `WEBRTC_TURN_CREDENTIAL` tĩnh.

## Kiểm tra sau khi deploy
1. Mở `/api/health` và kiểm tra `version` là `1.9.0`.
2. Đăng nhập bằng hai thiết bị/trình duyệt khác nhau.
3. Thiết bị A tạo phòng voice; thiết bị B tham gia.
4. Cho phép quyền Micro trên cả hai thiết bị.
5. Thử tắt mic, đổi micro, chuyển app sang nền rồi quay lại.
6. Mở Trạng thái hệ thống để xem số phòng/người voice và cảnh báo.

## Giới hạn kỹ thuật
Voice hiện dùng mô hình P2P mesh phù hợp cộng đồng nhỏ. Nếu sau này cần phòng 10–50+ người, nên chuyển phần media sang SFU như LiveKit/mediasoup thay vì tăng giới hạn P2P, vì mỗi thành viên phải gửi nhiều luồng audio hơn khi phòng đông.
