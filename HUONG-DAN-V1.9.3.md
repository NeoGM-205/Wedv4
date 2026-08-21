# GiaTộc ┊Name Hub v1.9.3 — Mic sạch + Voice nền

## Mic sạch hơn
Voice yêu cầu trình duyệt bật `echoCancellation`, `noiseSuppression`, `autoGainControl`, mono và ưu tiên 48 kHz. Đây là xử lý native nên nhẹ hơn việc chạy bộ lọc JavaScript liên tục.

## Voice khi ứng dụng ở nền
Khi chuyển sang ứng dụng khác, Hub không stop microphone track. Voice giữ WebRTC/WebSocket, giảm timer giao diện và heartbeat voice chạy nhẹ hơn. Khi quay lại, nếu Android đã ngắt microphone thì Hub tự xin lại stream và thay track vào các peer.

## Giới hạn quan trọng
PWA/TWA không có quyền ép Android giữ microphone mãi sau khi hệ điều hành đóng hoặc freeze tiến trình. Vì vậy voice nền hoạt động tốt nhất khi Android vẫn giữ PWA sống. Nếu cần bảo đảm microphone tiếp tục khi tắt màn hình lâu như Discord, cần một bản Android native dùng Foreground Service và audio/WebRTC native.

## Cách thử
1. Hai thiết bị vào cùng phòng voice và kiểm tra nghe được nhau.
2. Trên một máy, chuyển sang game nhưng không đóng PWA.
3. Nói thử trong game; máy còn lại kiểm tra âm thanh.
4. Quay lại Hub và xem trạng thái microphone. Nếu Android từng ngắt mic, Hub sẽ tự khôi phục.
