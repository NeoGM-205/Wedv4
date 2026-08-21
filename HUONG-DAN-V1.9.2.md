# GiaTộc ┊Name Hub v1.9.2 — Fix Voice bị kẹt “Đang nối âm thanh”

## Điểm sửa chính
- WebRTC thử P2P trước bằng nhiều STUN server.
- Nếu ICE vẫn `new/checking` sau khoảng 8 giây hoặc thất bại, ứng dụng tự chuyển sang **WebSocket Audio Relay** qua chính server Railway.
- Không bắt buộc TURN để hai người có thể nghe nhau trong trường hợp P2P bị NAT/4G chặn.
- Relay dùng PCM mono 16 kHz, gói nhỏ khoảng 40 ms để giảm độ trễ; server chỉ chuyển tiếp trong đúng phòng voice.
- Có giới hạn gói relay để tránh spam/băng thông bất thường.

## Trạng thái mong đợi
- `🟢 Âm thanh đã kết nối` = WebRTC P2P/TURN hoạt động.
- `🟢 Âm thanh đã kết nối • Relay máy chủ` = P2P không đi được và hệ thống đã tự dùng Railway relay.
- Nếu trình duyệt chặn phát tiếng, bấm **Bật nghe** một lần.

## Railway
Không cần thêm biến mới. Mặc định `VOICE_RELAY_FALLBACK=true`. Muốn tắt fallback có thể đặt `VOICE_RELAY_FALLBACK=false`.

> TURN vẫn là lựa chọn tốt hơn cho phòng đông vì tiết kiệm băng thông server. Relay dự phòng ưu tiên độ tương thích cho phòng chơi game nhỏ.
